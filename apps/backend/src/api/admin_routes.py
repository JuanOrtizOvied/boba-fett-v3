"""FastAPI routes for the admin panel API: user CRUD, read-only portfolio
viewing, read-only thread listing. Every route requires `require_admin`
(`access-control/spec.md` — "Role-Based Route Protection").

`app.state.user_repo` (`auth.repository.UserRepository`), `app.state.repo`
(`db.repository.ProductRepository`), and `app.state.versioning_repo`
(`db.versioning.VersioningRepository`) must be set by the parent app's
lifespan before this router is exercised — see `api/routes.py`.
"""

from __future__ import annotations

import asyncio
import base64

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import ValidationError

from agent.search import cascade_search
from api.chat_routes import _graph_config, _serialize_message, _state_messages
from auth.dependencies import require_admin
from auth.models import UserCreate
from auth.passwords import hash_password
from auth.repository import UserRepository
from db.catalog_repository import CatalogRepository
from db.ficha_patrimonial import (
    FichaConfirmRequest,
    FichaEnrichedRow,
    FichaParsedRow,
    FichaParseError,
    FichaParseRequest,
    FichaParseResponse,
    parse_ficha_excel,
)
from db.models import (
    AdministratorCreate,
    CatalogProductCreate,
    CatalogProductUpdate,
    ManagerCreate,
    ProductCreate,
)
from db.repository import ProductRepository
from db.versioning import VersioningRepository

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])

# Bounded concurrency for cascade_search enrichment calls during ficha parse
# (spec: "Concurrency bounded" — no more than 3 in flight at once).
_FICHA_ENRICHMENT_CONCURRENCY = 3


def _user_repo(request: Request) -> UserRepository:
    return request.app.state.user_repo


def _product_repo(request: Request) -> ProductRepository:
    return request.app.state.repo


def _catalog_repo(request: Request) -> CatalogRepository:
    return request.app.state.catalog_repo


def _versioning_repo(request: Request) -> VersioningRepository:
    return request.app.state.versioning_repo


def _strip_password_hash(row: dict) -> dict:
    return {k: v for k, v in dict(row).items() if k != "password_hash"}


@router.get("/users")
async def list_users(repo: UserRepository = Depends(_user_repo)) -> list[dict]:
    """List all user accounts (`user-management/spec.md` — "Admin lists
    users"). Password hashes are always excluded."""
    rows = await repo.list_all()
    return [_strip_password_hash(r) for r in rows]


@router.post("/users", status_code=201)
async def create_user(
    data: UserCreate,
    admin: dict = Depends(require_admin),
    repo: UserRepository = Depends(_user_repo),
) -> dict:
    """Create a new user account (`user-management/spec.md` — "Admin
    creates a user", "Duplicate email rejected"). No public registration
    endpoint exists — this is the only way to create a user."""
    existing = await repo.get_by_email(data.email)
    if existing is not None:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    row = await repo.create(
        email=data.email,
        password_hash=hash_password(data.password),
        role=data.role,
        created_by=admin["id"],
    )
    return _strip_password_hash(row)


@router.get("/portfolios")
async def list_portfolios(
    user_repo: UserRepository = Depends(_user_repo),
    product_repo: ProductRepository = Depends(_product_repo),
) -> list[dict]:
    """List every user with a portfolio summary (`admin-panel/spec.md` —
    "Admin lists all portfolios")."""
    users = await user_repo.list_all()
    result = []
    for user in users:
        summary = await product_repo.get_summary(user["id"])
        result.append(
            {
                "user_id": user["id"],
                "email": user["email"],
                "product_count": summary["product_count"],
                "total": summary["total_amount"],
            }
        )
    return result


@router.get("/portfolios/{user_id}")
async def view_portfolio(
    user_id: str, product_repo: ProductRepository = Depends(_product_repo)
) -> dict:
    """View a specific user's portfolio, read-only (`admin-panel/spec.md`
    — "Admin views a user's portfolio"). No mutation endpoint exists here
    on purpose — admins cannot edit another user's products."""
    products = await product_repo.list_by_user(user_id)
    return {"products": [p.model_dump() for p in products]}


@router.get("/portfolios/{user_id}/changes")
async def view_user_changes(
    user_id: str,
    limit: int = 50,
    offset: int = 0,
    operation: str | None = None,
    versioning_repo: VersioningRepository = Depends(_versioning_repo),
) -> dict:
    """Read-only change history for a specific client, admin-scoped
    (AL-007 "Admin views a client's change history"). Reuses the same
    `list_changes` method as `/portfolio/me/changes` (`db/versioning.py`),
    called with the *target* client's `user_id` — never the admin's own id.
    No route exists to mutate or delete `portfolio_changes` rows."""
    return await versioning_repo.list_changes(
        user_id, limit=limit, offset=offset, operation=operation
    )


@router.get("/portfolios/{user_id}/snapshots")
async def view_user_snapshots(
    user_id: str,
    limit: int = 50,
    offset: int = 0,
    versioning_repo: VersioningRepository = Depends(_versioning_repo),
) -> dict:
    """Read-only snapshot list for a specific client, admin-scoped
    (SNAP-010 "Admin views a client's snapshots read-only"). No route
    exists here to create, modify, or delete a snapshot on behalf of
    another user."""
    snapshots = await versioning_repo.list_snapshots(user_id, limit=limit, offset=offset)
    return {"snapshots": snapshots}


@router.get("/products")
async def list_all_products(
    user_repo: UserRepository = Depends(_user_repo),
    product_repo: ProductRepository = Depends(_product_repo),
) -> list[dict]:
    """Cross-list every product across every user with `user_email`
    attached (`sdd/product-catalog-approval/design` — "Admin portfolio
    cross-list"). A flat list avoids N+1 calls from the frontend for the
    catalog approval flow."""
    users = await user_repo.list_all()
    result: list[dict] = []
    for user in users:
        products = await product_repo.list_by_user(user["id"])
        for product in products:
            result.append({**product.model_dump(), "user_email": user["email"]})
    return result


@router.get("/catalog/entries")
async def list_catalog_entries(
    catalog_repo: CatalogRepository = Depends(_catalog_repo),
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List all `product_catalog` entries
    (`sdd/product-catalog-approval/spec` — "Catalog Listing")."""
    search_term = search.strip() if search is not None else None
    if search_term == "":
        search_term = None

    entries = await catalog_repo.get_catalog(search_term, limit, offset)
    return entries#[e.model_dump() for e in entries]

@router.post("/catalog/create", status_code=201)
async def create_catalog_entry(
    data: CatalogProductCreate,
    catalog_repo: CatalogRepository = Depends(_catalog_repo),
) -> dict:
    """Create a new product catalog entry.

    Validates uniqueness of Name + Asset Class.
    Returns 409 Conflict if a duplicate exists.
    """
    entry = await catalog_repo.insert_if_not_duplicate(data)
    if entry is None:
        raise HTTPException(status_code=409, detail="A matching catalog entry already exists")

    return entry.model_dump()


@router.post("/catalog/approve", status_code=201)
async def approve_to_catalog(
    data: CatalogProductCreate,
    response: Response,
    catalog_repo: CatalogRepository = Depends(_catalog_repo),
) -> dict:
    """Approve a portfolio product into `product_catalog`
    (`sdd/product-catalog-approval/spec` — "Approve Portfolio Product to
    Catalog", "Duplicate Detection Before Catalog Insertion"). Returns 409
    when a normalized match already exists instead of inserting a
    duplicate."""
    if data.catalog_product_id is not None:
        entry = await catalog_repo.replace_from_approval(data.catalog_product_id, data)
        if entry is None:
            raise HTTPException(
                status_code=404,
                detail=f"Catalog entry {data.catalog_product_id} not found",
            )
        response.status_code = 200
        return entry.model_dump()

    entry = await catalog_repo.insert_if_not_duplicate(data)
    if entry is None:
        raise HTTPException(
            status_code=409, detail="A matching catalog entry already exists"
        )
    return entry.model_dump()


@router.patch("/catalog/entries/{catalog_id}")
async def update_catalog_entry(
    catalog_id: int,
    data: CatalogProductUpdate,
    catalog_repo: CatalogRepository = Depends(_catalog_repo),
) -> dict:
    entry = await catalog_repo.update(catalog_id, data)
    if entry is None:
        raise HTTPException(
            status_code=404, detail=f"Catalog entry {catalog_id} not found"
        )
    return entry.model_dump()


@router.delete("/catalog/entries/{catalog_id}", status_code=204)
async def delete_catalog_entry(
    catalog_id: int, catalog_repo: CatalogRepository = Depends(_catalog_repo)
) -> None:
    """Delete a catalog entry (`sdd/product-catalog-approval/spec` —
    "Catalog Entry Deletion"). Catalog entries are not inline-editable —
    deletion is the only supported mutation after approval."""
    deleted = await catalog_repo.delete(catalog_id)
    if not deleted:
        raise HTTPException(
            status_code=404, detail=f"Catalog entry {catalog_id} not found"
        )


@router.get("/administrators")
async def list_administrators(
    catalog_repo: CatalogRepository = Depends(_catalog_repo),
) -> list[dict]:
    """Backs the catalog edit modal's Administrador dropdown — replaces the
    old hardcoded ADMINISTRATOR_OPTIONS array with real entities + scores."""
    entries = await catalog_repo.list_administrators()
    return [e.model_dump() for e in entries]


@router.post("/administrators", status_code=201)
async def create_administrator(
    data: AdministratorCreate,
    catalog_repo: CatalogRepository = Depends(_catalog_repo),
) -> dict:
    """Persists a new administrator typed into the modal's "+ Agregar"
    input (`task_fffceb1e`), with its required score. Returns 409 on a
    case/whitespace-insensitive duplicate name."""
    entry = await catalog_repo.create_administrator(data.name, data.score)
    if entry is None:
        raise HTTPException(status_code=409, detail="Administrator already exists")
    return entry.model_dump()


@router.get("/managers")
async def list_managers(
    catalog_repo: CatalogRepository = Depends(_catalog_repo),
) -> list[dict]:
    """Backs the catalog edit modal's Gestor dropdown — replaces the old
    hardcoded MANAGER_OPTIONS array with real entities + scores."""
    entries = await catalog_repo.list_managers()
    return [e.model_dump() for e in entries]


@router.post("/managers", status_code=201)
async def create_manager(
    data: ManagerCreate,
    catalog_repo: CatalogRepository = Depends(_catalog_repo),
) -> dict:
    entry = await catalog_repo.create_manager(data.name, data.score)
    if entry is None:
        raise HTTPException(status_code=409, detail="Manager already exists")
    return entry.model_dump()


@router.get("/threads")
async def list_threads(repo: UserRepository = Depends(_user_repo)) -> list[dict]:
    """List active FastAPI chat threads across users (`admin-panel/spec.md`
    — "Admin browses a user's thread list"). The current SABBI runtime stores
    one active thread ID per user, so this directory intentionally lists those
    persisted thread IDs instead of querying a separate LangGraph Platform API."""
    threads = await repo.list_active_threads()
    return [
        {
            "thread_id": t["active_thread_id"],
            "user_id": str(t["id"]),
            "email": t["email"],
            "created_at": t.get("updated_at") if isinstance(t, dict) else t["updated_at"],
        }
        for t in threads
    ]


@router.get("/threads/{thread_id}")
async def view_thread(thread_id: str, request: Request) -> dict:
    """View a specific thread's message history, read-only
    (`admin-panel/spec.md` — "Admin views a user's chat thread"). Reads from
    the same FastAPI-compiled chat graph used by the user-facing chat routes;
    this endpoint never posts messages, so the admin cannot act as the thread's
    owner."""
    graph = request.app.state.chat_graph
    if graph is None:
        raise HTTPException(status_code=503, detail="Chat graph not initialized")

    try:
        state = await graph.aget_state(config=_graph_config(thread_id))
    except Exception:
        return {"messages": []}

    messages = _state_messages(state)
    return {
        "messages": [_serialize_message(m) for m in messages],
        "message_count": len(messages),
        "last_message_at": getattr(state, "created_at", None),
    }


# ---------------------------------------------------------------------------
# Ficha Patrimonial bulk import (`sdd/admin-ficha-patrimonial/spec`)
# ---------------------------------------------------------------------------


async def _enrich_ficha_row(
    row: FichaParsedRow, pool: asyncpg.Pool, semaphore: asyncio.Semaphore
) -> FichaEnrichedRow:
    """Enrich one parsed ficha row via `cascade_search()`, isolating
    per-row failures so one bad/slow lookup never breaks the batch (spec:
    "Per-row enrichment failure is isolated"). Excel-sourced currency wins
    over whatever the cascade returns (spec: design.md — "Excel
    amount/currency win; enriched fields fill gaps")."""
    async with semaphore:
        try:
            result = await cascade_search(row.raw_name, pool)
        except Exception:
            result = None
            failed = True
        else:
            failed = result is None

    if result is not None and row.raw_currency:
        result.currency = row.raw_currency
        result.provenance.pop("currency", None)

    return FichaEnrichedRow(**row.model_dump(), enriched=result, enrichment_failed=failed)


@router.post("/ficha-patrimonial/parse")
async def parse_ficha_patrimonial(
    data: FichaParseRequest,
    user_repo: UserRepository = Depends(_user_repo),
    product_repo: ProductRepository = Depends(_product_repo),
) -> FichaParseResponse:
    """Parse and enrich an uploaded "Ficha Patrimonial" workbook for admin
    review (`sdd/admin-ficha-patrimonial/spec` — "Ficha Parse Endpoint",
    "Excel Parsing — Sabbi Sheet", "Batch Enrichment via cascade_search",
    "Target User Resolution by Email"). Persists nothing — rows are only
    written to the database via `/ficha-patrimonial/confirm`."""
    try:
        file_bytes = base64.b64decode(data.file_data, validate=True)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="El archivo no es un base64 válido"
        ) from exc

    try:
        parsed = parse_ficha_excel(file_bytes)
    except FichaParseError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user_row = await user_repo.get_by_email(parsed.client.email)
    if user_row is not None:
        parsed.client.user_id = str(user_row["id"])

    semaphore = asyncio.Semaphore(_FICHA_ENRICHMENT_CONCURRENCY)
    enriched_rows = await asyncio.gather(
        *[_enrich_ficha_row(row, product_repo.pool, semaphore) for row in parsed.rows]
    )

    return FichaParseResponse(client=parsed.client, rows=list(enriched_rows))


@router.post("/ficha-patrimonial/confirm", status_code=201)
async def confirm_ficha_patrimonial(
    data: FichaConfirmRequest,
    user_repo: UserRepository = Depends(_user_repo),
    product_repo: ProductRepository = Depends(_product_repo),
) -> dict:
    """Bulk-create every admin-reviewed ficha row atomically under one
    target user (`sdd/admin-ficha-patrimonial/spec` — "Ficha Confirm
    Endpoint", "Confirm creates all products", "Unknown email hard-fails",
    "One invalid row rejects the whole batch"). All-or-nothing: any row
    failure rolls back the whole batch and creates zero products."""
    user_row = await user_repo.get_by_id(data.user_id)
    if user_row is None:
        raise HTTPException(
            status_code=404, detail=f"Usuario '{data.user_id}' no encontrado"
        )

    product_ids: list[str] = []
    try:
        async with product_repo.pool.acquire() as conn:
            async with conn.transaction():
                for row in data.products:
                    product = await product_repo.create(
                        data.user_id,
                        ProductCreate(**row.model_dump()),
                        source="admin_ficha_import",
                        conn=conn,
                    )
                    product_ids.append(product.id)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"created_count": len(product_ids), "product_ids": product_ids}

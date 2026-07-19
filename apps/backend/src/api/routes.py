"""FastAPI REST API for direct portfolio CRUD.

Co-located with the LangGraph agent so manual edits (add/edit/delete a
product from the portfolio panel UI) never incur an LLM call — they write
straight to PostgreSQL. Shares the same connection pool and
`ProductRepository` as the agent's tools (`agent.tools`) via
`db.connection.get_pool()`, so both paths read/write the same data.

Every route requires a valid `sabbi_access` session (`get_current_user`) —
`access-control/spec.md` — "Role-Based Route Protection". Portfolio routes
are scoped to `/portfolio/me` (identity resolved from the JWT, never a
client-supplied id) and product mutations enforce ownership: only the
product's `user_id` may PATCH/DELETE it, including admins — admin access to
other users' data is read-only (`access-control/spec.md` — "Ownership
Enforcement").

Runs as a separate ASGI app alongside the LangGraph dev server in
development (see `package.json` — `dev:api` script) and can be mounted
alongside it or run as a separate container in production.
"""

from __future__ import annotations

import os
import uuid
from contextlib import AsyncExitStack, asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.store.postgres.aio import AsyncPostgresStore

from agent.graph import builder as graph_builder
from api.admin_routes import router as admin_router
from api.auth_routes import router as auth_router
from api.chat_routes import router as chat_router
from auth.dependencies import get_current_user
from auth.repository import UserRepository
from db.catalog_repository import CatalogRepository
from db.connection import close_pool, get_pool
from db.excel import build_portfolio_workbook, export_filename
from db.models import ProductCreate, ProductUpdate, SnapshotCreate
from db.repository import ProductRepository
from db.versioning import (
    SnapshotAccessError,
    SnapshotNotFoundError,
    SnapshotUnchangedError,
    VersioningRepository,
)


async def _init_chat_graph(app: FastAPI, stack: AsyncExitStack) -> None:
    """Build the Postgres-backed checkpointer/store and compile the chat
    graph onto `app.state.chat_graph`.

    Unlike `langgraph dev` (in-memory), this gives the chat endpoints
    (`api/chat_routes.py`) durable, checkpointed thread history. The
    checkpointer/store connections are entered on the caller-owned
    `AsyncExitStack` so they stay open for the lifetime of the app and are
    closed automatically when the lifespan's `AsyncExitStack` block exits.

    `app.state.chat_graph` stays `None` when `POSTGRES_URI` is not set
    (e.g. local dev still using `langgraph dev`) — the chat routes return
    503 in that case instead of failing to start the whole API.
    """
    app.state.chat_graph = None
    postgres_uri = os.environ.get("POSTGRES_URI")
    if not postgres_uri:
        return

    checkpointer = await stack.enter_async_context(
        AsyncPostgresSaver.from_conn_string(postgres_uri)
    )
    store = await stack.enter_async_context(AsyncPostgresStore.from_conn_string(postgres_uri))
    await checkpointer.setup()
    await store.setup()
    app.state.chat_graph = graph_builder.compile(checkpointer=checkpointer, store=store)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = await get_pool()
    app.state.repo = ProductRepository(pool)
    app.state.versioning_repo = VersioningRepository(pool)
    app.state.user_repo = UserRepository(pool)
    app.state.catalog_repo = CatalogRepository(pool)

    async with AsyncExitStack() as stack:
        await _init_chat_graph(app, stack)
        yield

    await close_pool()


app = FastAPI(title="SABBI Portfolio API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(chat_router)


async def _get_owned_product(product_id: str, user: dict):
    """Fetch a product and enforce ownership: only the owning `user_id` may
    act on it — admins included (`access-control/spec.md` — "Admin denied
    mutation on another user's resource")."""
    product = await app.state.repo.get(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    if product.user_id != user["id"]:
        raise HTTPException(status_code=403, detail="You do not own this product")
    return product


@app.get("/portfolio/me")
async def list_products(user: dict = Depends(get_current_user)) -> dict:
    products = await app.state.repo.list_by_user(user["id"])
    return {"products": [p.model_dump() for p in products]}


@app.post("/portfolio/me/products", status_code=201)
async def create_product(data: ProductCreate, user: dict = Depends(get_current_user)) -> dict:
    product = await app.state.repo.create(user["id"], data)
    return product.model_dump()


@app.patch("/products/{product_id}")
async def update_product(
    product_id: str, data: ProductUpdate, user: dict = Depends(get_current_user)
) -> dict:
    await _get_owned_product(product_id, user)
    product = await app.state.repo.update(product_id, data)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    return product.model_dump()


@app.delete("/products/{product_id}", status_code=204)
async def delete_product(product_id: str, user: dict = Depends(get_current_user)) -> None:
    await _get_owned_product(product_id, user)
    deleted = await app.state.repo.delete(product_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")


@app.get("/portfolio/me/summary")
async def portfolio_summary(user: dict = Depends(get_current_user)) -> dict:
    return await app.state.repo.get_summary(user["id"])


@app.get("/portfolio/me/export")
async def export_portfolio(user: dict = Depends(get_current_user)) -> StreamingResponse:
    """Stream a server-generated .xlsx for the portfolio ("Portafolio Final"
    summary sheet + one sheet per category), built straight from Postgres —
    no client-side spreadsheet dependency (`portfolio-dashboard.spec.md` →
    "Exportar portafolio a Excel").
    """
    products = await app.state.repo.list_by_user(user["id"])
    buffer = build_portfolio_workbook(products)
    filename = export_filename()
    return StreamingResponse(
        buffer,
        media_type=(
            "application/vnd.openxmlformats-officedocument"
            ".spreadsheetml.sheet"
        ),
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Portfolio Versioning — snapshots, comparison, change log
# (`sdd/portfolio-versioning/design.md`)
# ---------------------------------------------------------------------------


def _validate_uuid(value: str, *, field_name: str) -> None:
    """Raise `422` when a query-param snapshot id is not a syntactically
    valid UUID (CMP-005 "Malformed snapshot id") instead of letting an
    invalid value reach `asyncpg` and surface as an unhandled `500`.
    """
    try:
        uuid.UUID(value)
    except ValueError:
        raise HTTPException(
            status_code=422, detail=f"'{field_name}' is not a valid snapshot id"
        )


@app.post("/portfolio/me/snapshots", status_code=201)
async def create_snapshot(
    data: SnapshotCreate, user: dict = Depends(get_current_user)
) -> dict:
    """Create a named, immutable point-in-time snapshot of the current
    portfolio (SNAP-001). Empty portfolios are valid snapshots (SNAP-009)
    — `VersioningRepository.create_snapshot` never raises for that case.
    Returns 409 when the portfolio is identical to the latest snapshot."""
    try:
        return await app.state.versioning_repo.create_snapshot(
            user["id"], data.name, data.description
        )
    except SnapshotUnchangedError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@app.get("/portfolio/me/snapshots")
async def list_snapshots(
    limit: int = 50, offset: int = 0, user: dict = Depends(get_current_user)
) -> dict:
    """List the authenticated user's snapshots, summary view, newest first
    (SNAP-003)."""
    snapshots = await app.state.versioning_repo.list_snapshots(
        user["id"], limit=limit, offset=offset
    )
    return {"snapshots": snapshots}


@app.get("/portfolio/me/snapshots/has-changes")
async def has_portfolio_changes(user: dict = Depends(get_current_user)) -> dict:
    """Return whether the current portfolio differs from the latest snapshot."""
    has_changes = await app.state.versioning_repo.has_changes_since_latest(user["id"])
    return {"has_changes": has_changes}


@app.get("/portfolio/me/snapshots/{snapshot_id}")
async def get_snapshot(snapshot_id: str, user: dict = Depends(get_current_user)) -> dict:
    """Get a single snapshot with its full materialized product list
    (SNAP-004). Returns `404` both for a missing id and for a snapshot
    owned by another user (SNAP-010 — non-disclosing, `get_snapshot`
    collapses both cases into `None`).

    No `PATCH`/`PUT` route is registered for this path — snapshots are
    immutable (SNAP-005), enforced by omission."""
    snapshot = await app.state.versioning_repo.get_snapshot(snapshot_id, user["id"])
    if snapshot is None:
        raise HTTPException(status_code=404, detail=f"Snapshot {snapshot_id} not found")
    return snapshot


@app.get("/portfolio/me/compare")
async def compare_snapshots(a: str, b: str, user: dict = Depends(get_current_user)) -> dict:
    """Compare two snapshots owned by the current user (CMP-001). `a` is
    always the baseline for `before`/`after` labeling, `b` the comparison
    (CMP-007), regardless of query-param order.

    Registered at `/portfolio/me/compare` — not
    `/portfolio/me/snapshots/compare` — to avoid a FastAPI path conflict
    with the parametric `/portfolio/me/snapshots/{snapshot_id}` route
    (design.md — "Route ordering note")."""
    _validate_uuid(a, field_name="a")
    _validate_uuid(b, field_name="b")
    try:
        return await app.state.versioning_repo.compare_snapshots(a, b, user["id"])
    except SnapshotNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except SnapshotAccessError as exc:
        raise HTTPException(status_code=403, detail=str(exc))


@app.get("/portfolio/me/changes")
async def list_changes(
    limit: int = 50,
    offset: int = 0,
    operation: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict:
    """Paginated change log for the current user's own portfolio (AL-006),
    scoped entirely to the authenticated user via `WHERE user_id = $1`
    inside `list_changes` (AL-007)."""
    return await app.state.versioning_repo.list_changes(
        user["id"], limit=limit, offset=offset, operation=operation
    )

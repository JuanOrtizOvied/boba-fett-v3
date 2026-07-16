"""FastAPI routes for the admin panel API: user CRUD, read-only portfolio
viewing, read-only thread listing. Every route requires `require_admin`
(`access-control/spec.md` — "Role-Based Route Protection").

`app.state.user_repo` (`auth.repository.UserRepository`) and `app.state.repo`
(`db.repository.ProductRepository`) must be set by the parent app's lifespan
before this router is exercised — see `api/routes.py`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from api.chat_routes import _graph_config, _serialize_message, _state_messages
from auth.dependencies import require_admin
from auth.models import UserCreate
from auth.passwords import hash_password
from auth.repository import UserRepository
from db.repository import ProductRepository

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _user_repo(request: Request) -> UserRepository:
    return request.app.state.user_repo


def _product_repo(request: Request) -> ProductRepository:
    return request.app.state.repo


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

    return {"messages": [_serialize_message(m) for m in _state_messages(state)]}

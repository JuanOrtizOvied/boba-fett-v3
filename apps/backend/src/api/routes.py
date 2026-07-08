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

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from api.admin_routes import router as admin_router
from api.auth_routes import router as auth_router
from auth.dependencies import get_current_user
from auth.repository import UserRepository
from db.connection import close_pool, get_pool
from db.excel import build_portfolio_workbook, export_filename
from db.models import ProductCreate, ProductUpdate
from db.repository import ProductRepository


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = await get_pool()
    app.state.repo = ProductRepository(pool)
    app.state.user_repo = UserRepository(pool)
    yield
    await close_pool()


app = FastAPI(title="SABBI Portfolio API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(admin_router)


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

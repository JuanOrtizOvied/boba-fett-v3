"""FastAPI REST API for direct portfolio CRUD.

Co-located with the LangGraph agent so manual edits (add/edit/delete a
product from the portfolio panel UI) never incur an LLM call — they write
straight to PostgreSQL. Shares the same connection pool and
`ProductRepository` as the agent's tools (`agent.tools`) via
`db.connection.get_pool()`, so both paths read/write the same data.

Runs as a separate ASGI app alongside the LangGraph dev server in
development (see `package.json` — `dev:api` script) and can be mounted
alongside it or run as a separate container in production.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from db.connection import close_pool, get_pool
from db.excel import build_portfolio_workbook, export_filename
from db.models import ProductCreate, ProductUpdate
from db.repository import ProductRepository


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    pool = await get_pool()
    app.state.repo = ProductRepository(pool)
    yield
    await close_pool()


app = FastAPI(title="SABBI Portfolio API", lifespan=lifespan)


@app.get("/portfolio/{portfolio_id}")
async def list_products(portfolio_id: str) -> dict:
    products = await app.state.repo.list_by_portfolio(portfolio_id)
    return {"products": [p.model_dump() for p in products]}


@app.post("/portfolio/{portfolio_id}/products", status_code=201)
async def create_product(portfolio_id: str, data: ProductCreate) -> dict:
    product = await app.state.repo.create(portfolio_id, data)
    return product.model_dump()


@app.patch("/products/{product_id}")
async def update_product(product_id: str, data: ProductUpdate) -> dict:
    product = await app.state.repo.update(product_id, data)
    if product is None:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")
    return product.model_dump()


@app.delete("/products/{product_id}", status_code=204)
async def delete_product(product_id: str) -> None:
    deleted = await app.state.repo.delete(product_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Product {product_id} not found")


@app.get("/portfolio/{portfolio_id}/summary")
async def portfolio_summary(portfolio_id: str) -> dict:
    return await app.state.repo.get_summary(portfolio_id)


@app.get("/portfolio/{portfolio_id}/export")
async def export_portfolio(portfolio_id: str) -> StreamingResponse:
    """Stream a server-generated .xlsx for the portfolio ("Portafolio Final"
    summary sheet + one sheet per category), built straight from Postgres —
    no client-side spreadsheet dependency (`portfolio-dashboard.spec.md` →
    "Exportar portafolio a Excel").
    """
    products = await app.state.repo.list_by_portfolio(portfolio_id)
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

"""Portfolio management tools — read/write directly to PostgreSQL.

Tools do NOT go through LangGraph state. They persist to Postgres via
`ProductRepository` so the portfolio survives across chat threads and page
reloads (see `agent.state` module docstring). `portfolio_id` is supplied
per-run via `RunnableConfig["configurable"]["portfolio_id"]` — the frontend
generates a UUID per investor and passes it as `configurable.portfolio_id`
on every run (see design.md — "Portfolio Identity").

The Postgres pool itself is NOT passed through `RunnableConfig`: an
`asyncpg.Pool` cannot be serialized across the LangGraph API boundary, and
`db.connection.get_pool()` already manages it as a process-wide singleton
(lazily created on first use, schema auto-applied). Tools simply await
`get_pool()` and hand it to `get_repository()`.
"""

from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from db.catalog_repository import CatalogRepository
from db.connection import get_catalog_repository, get_pool, get_repository
from db.models import AssetAllocation, ProductCreate, ProductUpdate
from db.repository import ProductRepository


async def _repository() -> ProductRepository:
    """Resolve the `ProductRepository` bound to the process-wide connection pool."""
    pool = await get_pool()
    return get_repository(pool)


async def _catalog_repository() -> CatalogRepository:
    """Resolve the `CatalogRepository` bound to the process-wide connection pool."""
    pool = await get_pool()
    return get_catalog_repository(pool)


def _portfolio_id(config: RunnableConfig) -> str:
    portfolio_id = (config.get("configurable") or {}).get("portfolio_id")
    if not portfolio_id:
        raise ValueError(
            "portfolio_id is required in RunnableConfig['configurable'] to run portfolio tools"
        )
    return portfolio_id


def _to_composition(items: list[dict[str, Any]]) -> list[AssetAllocation]:
    return [AssetAllocation(name=item["name"], percentage=item["percentage"]) for item in items]


@tool
async def propose_product(
    name: str,
    amount: float,
    category: str,
    provider: str = "",
    composition: list[dict[str, Any]] | None = None,
    *,
    config: RunnableConfig,
) -> dict:
    """Propose adding an investment product and ask the user to confirm.

    Call this INSTEAD of add_product when you first identify a product.
    The UI will render a confirmation card with Yes/No buttons. Only after
    the user confirms should you call add_product with the same data.

    Args:
        name: Product name (e.g. 'BlackRock Private Credit Fund').
        amount: Investment amount in USD.
        category: One of: directas, privados, club, publicos, otros, cash.
        provider: Provider or fund manager name.
        composition: List of {name, percentage} asset class allocations.
    """
    del config
    return {
        "status": "proposed",
        "product": {
            "name": name,
            "amount": amount,
            "category": category,
            "provider": provider,
            "composition": composition or [{"name": name, "percentage": 100}],
        },
    }


@tool
async def add_product(
    name: str,
    amount: float,
    category: str,
    provider: str = "",
    composition: list[dict[str, Any]] | None = None,
    *,
    config: RunnableConfig,
) -> dict:
    """Add a new investment product to the investor's portfolio.

    Args:
        name: Product name (e.g. 'BlackRock Private Credit Fund').
        amount: Investment amount in USD.
        category: One of: directas, privados, club, publicos, otros, cash.
        provider: Provider or fund manager name.
        composition: List of {name, percentage} asset class allocations. When
            omitted, the product is treated as 100% allocated to itself.
    """
    repo = await _repository()
    portfolio_id = _portfolio_id(config)
    comp = _to_composition(composition or [{"name": name, "percentage": 100}])
    product = await repo.create(
        portfolio_id,
        ProductCreate(
            name=name,
            provider=provider,
            amount=amount,
            category=category,
            composition=comp,
        ),
    )
    return {"status": "added", "product": product.model_dump()}


@tool
async def update_product(
    product_id: str,
    name: str | None = None,
    provider: str | None = None,
    amount: float | None = None,
    category: str | None = None,
    composition: list[dict[str, Any]] | None = None,
    *,
    config: RunnableConfig,
) -> dict:
    """Update an existing investment product in the portfolio.

    Args:
        product_id: ID of the product to update (e.g. 'prod_1a2b3c4d').
        name: New product name, if changed.
        provider: New provider name, if changed.
        amount: New amount in USD, if changed.
        category: New category, if changed.
        composition: New composition list, if changed.
    """
    del config  # unused — product_id already scopes the update, no portfolio lookup needed
    repo = await _repository()
    comp = _to_composition(composition) if composition is not None else None
    product = await repo.update(
        product_id,
        ProductUpdate(
            name=name,
            provider=provider,
            amount=amount,
            category=category,
            composition=comp,
        ),
    )
    if product is None:
        return {"status": "error", "message": f"Product {product_id} not found"}
    return {"status": "updated", "product": product.model_dump()}


@tool
async def delete_product(product_id: str, *, config: RunnableConfig) -> dict:
    """Remove an investment product from the portfolio.

    Args:
        product_id: ID of the product to remove.
    """
    del config  # unused — product_id already scopes the delete
    repo = await _repository()
    deleted = await repo.delete(product_id)
    if not deleted:
        return {"status": "error", "message": f"Product {product_id} not found"}
    return {"status": "deleted", "product_id": product_id}


@tool
async def get_portfolio_summary(*, config: RunnableConfig) -> dict:
    """Get a summary of the current portfolio: totals, distribution, and largest position.

    Call this when the user asks about the overall state of their portfolio
    or before generating the final portfolio view.
    """
    repo = await _repository()
    portfolio_id = _portfolio_id(config)
    return await repo.get_summary(portfolio_id)


@tool
async def search_catalog(query: str, *, config: RunnableConfig) -> dict:
    """Search the SABBI product catalog for products matching a name, ticker, or description.

    Use this tool FIRST when a user mentions a product to check if it exists
    in the catalog. The catalog contains 200+ pre-loaded investment products
    with detailed info (asset class, commission, currency, geographic focus,
    underlying, administrator, manager, liquidity, return rate).

    If no matches are found, try alternative terms — translations, tickers,
    or common names (e.g. search 'oro' if 'GLD' returns nothing).

    Args:
        query: Product name, ticker symbol, or description to search for
               (e.g. 'QQQ', 'Credicorp', 'oro', 'bitcoin').
    """
    del config
    repo = await _catalog_repository()
    results = await repo.search(query)

    if not results:
        return {"status": "no_matches", "query": query, "products": []}

    return {
        "status": "found",
        "query": query,
        "products": [p.model_dump() for p in results],
    }


portfolio_tools = [
    search_catalog,
    propose_product,
    add_product,
    update_product,
    delete_product,
    get_portfolio_summary,
]

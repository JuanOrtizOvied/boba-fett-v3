"""Portfolio management tools — read/write directly to PostgreSQL.

Tools do NOT go through LangGraph state. They persist to Postgres via
`ProductRepository` so the portfolio survives across chat threads and page
reloads (see `agent.state` module docstring). `user_id` is supplied per-run
via `RunnableConfig["configurable"]["user_id"]` — the Next.js proxy injects
it from the authenticated user's validated JWT subject claim, replacing the
previously client-supplied `portfolio_id` (`agent.spec.md` delta —
"Portfolio Identity Resolution").

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

from agent.search import cascade_search
from agent.state import CATEGORIES
from db.connection import get_pool, get_repository
from db.models import AssetAllocation, FieldSource, ProductCreate, ProductUpdate
from db.repository import ProductRepository
from db.versioning import VersioningRepository

_KEY_TO_LABEL: dict[str, str] = {k: str(v["label"]) for k, v in CATEGORIES.items()}
_LABEL_TO_KEY: dict[str, str] = {v.lower(): k for k, v in _KEY_TO_LABEL.items()}

_LEGACY_ALIASES: dict[str, str] = {
    "real estate directo": "inversiones_directas",
    "mercados privados": "mercados_privados",
    "club deals": "club_deals",
    "mercados públicos": "mercados_publicos",
    "mercados publicos": "mercados_publicos",
    "cash y equivalentes": "cash_y_equivalentes",
    "inversiones directas": "inversiones_directas",
    "mercados privado": "mercados_privados",
    # Old short keys → new canonical keys
    "directas": "inversiones_directas",
    "privados": "mercados_privados",
    "club": "club_deals",
    "publicos": "mercados_publicos",
    "cash": "cash_y_equivalentes",
}
_LABEL_TO_KEY.update(_LEGACY_ALIASES)


def _normalize_category_key(key_or_label: str) -> str:
    """Normalize a category value to its canonical key (e.g. 'Cash y
    Equivalentes' -> 'cash_y_equivalentes', 'privados' ->
    'mercados_privados'). Falls back to 'otros' for unknown values."""
    if key_or_label in _KEY_TO_LABEL:
        return key_or_label
    resolved = _LABEL_TO_KEY.get(key_or_label.lower())
    return resolved if resolved else "otros"


async def _repository() -> ProductRepository:
    """Resolve the `ProductRepository` bound to the process-wide connection pool."""
    pool = await get_pool()
    return get_repository(pool)


async def _versioning_repository() -> VersioningRepository:
    """Resolve the `VersioningRepository` bound to the process-wide connection
    pool (same pool-acquisition pattern as `_repository()`)."""
    pool = await get_pool()
    return VersioningRepository(pool)


def _derive_card_tag(provenance: dict[str, str]) -> str:
    """Aggregate a per-field `provenance` map into one card-level reliability
    tag (`provenance-ui.spec.md` — "Provenance Data Contract"):
    - product identity (`name`) came from `catalog` -> "verified"
    - no field is `catalog` or `web_search` (only `claude_knowledge`/empty) -> "unverified"
    - anything else involving `web_search` -> "web"
    """
    sources = set(provenance.values())
    if not sources:
        return "unverified"
    if provenance.get("name") == "catalog":
        return "verified"
    if "web_search" in sources:
        return "web"
    return "unverified"


def _user_id(config: RunnableConfig) -> str:
    user_id = (config.get("configurable") or {}).get("user_id")
    if not user_id:
        raise ValueError(
            "user_id is required in RunnableConfig['configurable'] to run portfolio tools"
        )
    return user_id


def _to_composition(items: list[dict[str, Any]]) -> list[AssetAllocation]:
    return [AssetAllocation(name=item["name"], percentage=item["percentage"]) for item in items]


@tool
async def propose_product(
    name: str,
    amount: float,
    category: str,
    provider: str = "",
    composition: list[dict[str, Any]] | None = None,
    asset_class: str = "",
    currency: str = "",
    commission: str = "",
    administrator: str = "",
    manager: str = "",
    liquidity: str = "",
    return_rate: str = "",
    geographic_focus: str = "",
    subcategory: str = "",
    catalog_product_id: int | None = None,
    primary_source: FieldSource = "catalog",
    provenance: dict[str, FieldSource] | None = None,
    *,
    config: RunnableConfig,
) -> dict:
    """Propose adding an investment product and ask the user to confirm.

    Call this INSTEAD of add_product when you first identify a product.
    The UI will render a confirmation card with Yes/No buttons. Only after
    the user confirms should you call add_product with the same data.

    Call `search_product` first and forward its enrichment fields and its
    `primary_source`/`provenance` here, unmodified, so the confirmation card
    can show the user where each value came from (catalog, Claude's own
    knowledge, or a web search).

    Args:
        name: Product name (e.g. 'BlackRock Private Credit Fund').
        amount: Investment amount in USD.
        category: Category key, one of: inversiones_directas,
            mercados_privados, club_deals, mercados_publicos, otros,
            cash_y_equivalentes.
        provider: Provider or fund manager name.
        composition: List of {name, percentage} subcategory allocations.
            Names MUST be canonical subcategory leaves from the CATEGORIES
            taxonomy for the chosen category. Use the leaf name when it equals
            the group name (e.g. 'Deuda Privada', 'Private Equity') or
            '{group} {leaf}' when they differ (e.g. 'Renta Variable US Large
            Cap', 'Renta Fija US Treasuries', 'RE Perú Residencial').
            Percentages MUST sum to 100.
        asset_class: Asset class, from search_product if available.
        currency: Currency, from search_product if available.
        commission: Commission/fee, from search_product if available.
        administrator: Fund administrator, from search_product if available.
        manager: Fund manager, from search_product if available.
        liquidity: Liquidity terms, from search_product if available.
        return_rate: Historical return rate, from search_product if available.
        geographic_focus: Geographic focus, from search_product if available.
        subcategory: Taxonomy leaf subcategory (auto-classified or user-picked).
        catalog_product_id: Source `product_catalog.id` when search_product found
            the product in the SABBI catalog. Forward it unchanged.
        primary_source: Weakest data source used across all fields
            ('catalog', 'claude_knowledge', or 'web_search'), forwarded
            from search_product's result.
        provenance: Per-field source map forwarded from search_product's
            result — keys are field names, values are 'catalog',
            'claude_knowledge', or 'web_search'.
    """
    del config
    resolved_provenance = provenance or {}
    return {
        "status": "proposed",
        "product": {
            "name": name,
            "amount": amount,
            "category": _normalize_category_key(category),
            "provider": provider,
            "composition": composition or [{"name": subcategory or name, "percentage": 100}],
            "asset_class": asset_class,
            "currency": currency,
            "commission": commission,
            "administrator": administrator,
            "manager": manager,
            "liquidity": liquidity,
            "return_rate": return_rate,
            "geographic_focus": geographic_focus,
            "subcategory": subcategory,
            "catalog_product_id": catalog_product_id,
            "primary_source": primary_source,
            "provenance": resolved_provenance,
            "reliability_tag": _derive_card_tag(resolved_provenance),
        },
    }


@tool
async def add_product(
    name: str,
    amount: float,
    category: str,
    provider: str = "",
    composition: list[dict[str, Any]] | None = None,
    subcategory: str = "",
    asset_class: str = "",
    currency: str = "",
    commission: str = "",
    administrator: str = "",
    manager: str = "",
    liquidity: str = "",
    return_rate: str = "",
    geographic_focus: str = "",
    underlying: str = "",
    catalog_product_id: int | None = None,
    *,
    config: RunnableConfig,
) -> dict:
    """Add a new investment product to the investor's portfolio.

    Args:
        name: Product name (e.g. 'BlackRock Private Credit Fund').
        amount: Investment amount in USD.
        category: Category key, one of: inversiones_directas,
            mercados_privados, club_deals, mercados_publicos, otros,
            cash_y_equivalentes.
        provider: Provider or fund manager name.
        composition: List of {name, percentage} subcategory allocations.
            Names MUST be canonical subcategory leaves from the CATEGORIES
            taxonomy for the chosen category. Use the leaf name when it equals
            the group name (e.g. 'Deuda Privada') or '{group} {leaf}' when
            they differ (e.g. 'Renta Variable US Large Cap').
            Percentages MUST sum to 100. When omitted, defaults to 100%
            allocated to the subcategory if provided.
        subcategory: Taxonomy leaf subcategory (e.g. 'Real Estate Extranjero').
        asset_class: Asset class, from search_product if available.
        currency: Currency, from search_product if available.
        commission: Commission/fee, from search_product if available.
        administrator: Fund administrator, from search_product if available.
        manager: Fund manager, from search_product if available.
        liquidity: Liquidity terms, from search_product if available.
        return_rate: Historical return rate, from search_product if available.
        geographic_focus: Geographic focus, from search_product if available.
        underlying: Underlying asset, from search_product if available.
        catalog_product_id: Source `product_catalog.id` when the product came
            from the SABBI catalog. Keep it so admin approval can replace that row.
    """
    repo = await _repository()
    user_id = _user_id(config)
    comp = _to_composition(composition or [{"name": subcategory or name, "percentage": 100}])
    product = await repo.create(
        user_id,
        ProductCreate(
            name=name,
            provider=provider,
            amount=amount,
            category=_normalize_category_key(category),
            subcategory=subcategory,
            composition=comp,
            asset_class=asset_class,
            geographic_focus=geographic_focus,
            underlying=underlying,
            commission=commission,
            currency=currency,
            administrator=administrator,
            manager=manager,
            liquidity=liquidity,
            return_rate=return_rate,
            catalog_product_id=catalog_product_id,
        ),
        source="agent",
        metadata={"tool": "add_product"},
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
            category=_normalize_category_key(category) if category else None,
            composition=comp,
        ),
        source="agent",
        metadata={"tool": "update_product"},
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
    deleted = await repo.delete(
        product_id, source="agent", metadata={"tool": "delete_product"}
    )
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
    user_id = _user_id(config)
    return await repo.get_summary(user_id)


@tool
async def search_product(query: str, *, config: RunnableConfig) -> dict:
    """Search for an investment product's data via a three-level cascade.

    Use this tool FIRST when a user mentions a product to find out what is
    already known about it. The cascade queries, in strict order, the SABBI
    catalog (L1, fastest and most trusted), then Claude's own training
    knowledge (L2), then a Tavily web search (L3) — stopping as soon as
    every field is filled. Any field none of the three levels could verify
    is left empty in the result; never invent a value for it yourself.

    If nothing is found anywhere, try alternative terms — translations,
    tickers, or common names (e.g. search 'oro' if 'GLD' returns nothing).

    Args:
        query: Product name, ticker symbol, or description to search for
               (e.g. 'QQQ', 'Credicorp', 'oro', 'bitcoin').
    """
    del config
    pool = await get_pool()
    result = await cascade_search(query, pool)

    if result is None:
        return {"status": "not_found", "query": query}

    return {"status": "found", "query": query, "result": result.model_dump()}


@tool
async def create_snapshot(
    name: str,
    description: str = "",
    *,
    config: RunnableConfig,
) -> dict:
    """Save the current portfolio as a named, immutable snapshot.

    Only call this on the user's explicit request or after they confirm a
    suggestion you made — do NOT create a snapshot on your own initiative
    just because it seems like a natural breakpoint (e.g. after a document
    upload or a restructuring conversation). You may suggest saving one and
    ask the user first; only call this tool once they say yes.

    Args:
        name: Short descriptive name for this snapshot (e.g. 'Pre-Q3 Review',
              'After Document Upload - Jul 2026').
        description: Optional longer description of what this snapshot represents.
    """
    versioning_repo = await _versioning_repository()
    user_id = _user_id(config)
    try:
        snapshot = await versioning_repo.create_snapshot(user_id, name, description)
        return {"status": "created", "snapshot": snapshot}
    except ValueError as e:
        return {"status": "error", "message": str(e)}


portfolio_tools = [
    search_product,
    propose_product,
    add_product,
    update_product,
    delete_product,
    get_portfolio_summary,
    create_snapshot,
]

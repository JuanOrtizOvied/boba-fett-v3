"""Cascading L1 -> L2 -> L3 product search (`multi-level-search`).

Replaces the single-path `search_catalog` tool lookup with a three-level
cascade that queries the SABBI catalog first, then Claude's own training
knowledge, then Tavily web search — stopping as soon as every field is
populated. Each level only fills fields the previous level left empty, so
catalog data is always authoritative (see `cascading-search.spec.md`).

The cascade never fabricates data: both Claude passes (`_extract_from_claude`,
`_search_tavily`) are prompted to leave a field empty rather than guess, and
`_merge_fields` never overwrites an already-populated field.
"""

from __future__ import annotations

import asyncio
import logging
import os

import asyncpg
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field
from tavily import TavilyClient

from agent.state import ASSET_CLASSES
from db.catalog_normalized import NormalizedCatalogRepository
from db.catalog_repository import CatalogRepository
from db.models import (
    AssetAllocation,
    CatalogSeriesAdminOption,
    CatalogSeriesOption,
    FieldSource,
    SearchResult,
    Source,
)

logger = logging.getLogger("agent.search")

# String fields the cascade searches/returns at every level (field parity
# — `cascading-search.spec.md`, "Search Field Parity").
# List-type fields (underlying, geographic_focus) are handled separately in
# _merge_fields.
FIELD_NAMES = (
    "name",
    "commission",
    "currency",
    "administrator",
    "manager",
    "liquidity",
    "return_rate",
)

# Ficha-patrimonial V2 enrichment fills ONLY product-level string fields from
# L1/L2/L3. The commercial fields (commission, administrator, liquidity,
# return_rate) are never auto-guessed — the admin picks a series/administrator
# in the review table, which supplies them. (List fields asset_class /
# geographic_focus / underlying are product-level and merged separately.)
PRODUCT_FIELD_NAMES = (
    "name",
    "currency",
    "manager",
)

# Rank of trust for each source, lowest = most trusted. `primary_source`
# tracks the LEAST trusted level that contributed any field, so the frontend
# card badge reflects the weakest link in the data ("Catálogo SABBI" only if
# every field came from the catalog).
_SOURCE_RANK: dict[FieldSource, int] = {
    "catalog": 0,
    "claude_knowledge": 1,
    "web_search": 2,
}

# Cheap, fast model for structured extraction — separate from the main agent
# LLM (which is bound to tools and would recurse) per design.md.
EXTRACTION_MODEL_NAME = "claude-haiku-4-5"

# The `asset_class` taxonomy is injected per caller: the chat/portfolio cascade
# uses the portfolio taxonomy, while the ficha-patrimonial web research uses the
# ficha review select's taxonomy (FichaAssetClassKey in reviewTableShared.ts) so
# the returned class maps straight onto that select. `__ASSET_CLASSES__` is a
# literal placeholder (not an f-string) so the braces in the examples stay intact.
_PORTFOLIO_ASSET_CLASSES = (
    "inversiones_directas, mercados_privados, club_deals, mercados_publicos, "
    "otros, cash_y_equivalentes"
)
_FICHA_ASSET_CLASSES = (
    "Inmobiliario Directo, Mercados Publicos - Fijo, Mercados Publicos - Variable, "
    "Mercados Privados, Club Deal, Commodities y Criptos, Cash y Otros"
)

_EXTRACTION_PROMPT_TEMPLATE = """You are a financial product data extraction assistant for SABBI,
an investment portfolio platform.

Extract these fields for the requested product: name, asset_class,
geographic_focus, commission, currency, administrator, manager,
liquidity, return_rate, underlying.

`asset_class` is a list of {name, percentage} objects summing to 100%,
where each name is one of: __ASSET_CLASSES__. Most products
belong to a single asset class (one entry at 100%); only use multiple
entries when the product is genuinely blended across asset classes. Return
an empty list if unknown.

`underlying` is the product's underlying asset composition — a list of
{name, percentage} objects summing to 100%. Each entry names an asset class
or sub-asset (e.g. "Private Debt", "Real Estate", "US Treasuries") and its
weight in the product. Return an empty list if unknown.

`geographic_focus` is the product's geographic allocation — a list of
{name, percentage} objects summing to 100%. Each entry names a region
(e.g. "US", "LatAm", "Europe", "Global") and its weight. Return an empty
list if unknown.

CRITICAL RULE: if you are not confident about a field, or the information was
not given to you, leave that field as an empty string (or empty list for
underlying, geographic_focus, and asset_class). NEVER invent, guess, or
fabricate a value you cannot verify.

`field_confidence` is a map from field name to an integer 0-100 expressing how
confident you are in the value you filled for that field, based ONLY on the
evidence you were given. Include a key ONLY for fields you actually filled with a
non-empty value; omit every field you left empty. Use the field names as keys
(e.g. {"name": 95, "manager": 70, "asset_class": 60}). Be honest: a value well
supported by the sources is high (80-100); a plausible-but-weakly-supported value
is low (30-60)."""


def _build_extraction_system_prompt(asset_class_names: str) -> str:
    return _EXTRACTION_PROMPT_TEMPLATE.replace("__ASSET_CLASSES__", asset_class_names)


_EXTRACTION_SYSTEM_PROMPT = _build_extraction_system_prompt(_PORTFOLIO_ASSET_CLASSES)
# Ficha web research classifies into the ficha select's taxonomy.
_FICHA_EXTRACTION_SYSTEM_PROMPT = _build_extraction_system_prompt(_FICHA_ASSET_CLASSES)


class _ExtractedAllocation(BaseModel):
    name: str = ""
    percentage: float = 0


class ExtractedProduct(BaseModel):
    """Structured-output schema for the L2/L3 Claude extraction passes.
    Mirrors `SearchResult`'s field set minus provenance/primary_source."""

    name: str = ""
    asset_class: list[_ExtractedAllocation] = Field(default_factory=list)
    geographic_focus: list[_ExtractedAllocation] = Field(default_factory=list)
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    underlying: list[_ExtractedAllocation] = Field(default_factory=list)
    # Self-reported confidence (0..100) per field the model actually filled,
    # keyed by field name (e.g. {"name": 92, "manager": 78}). Omit fields left
    # empty. Surfaced only on the web-research path (see `_sanitize_field_confidence`).
    field_confidence: dict[str, int] = Field(default_factory=dict)


def _merge_fields(
    result: SearchResult,
    new_data: dict,
    source: FieldSource,
    fields: tuple[str, ...] = FIELD_NAMES,
) -> SearchResult:
    """Fill only the fields `result` doesn't already have, tagging each
    newly-filled field's provenance with `source`. Never overwrites a field
    that already has a value — this is what keeps catalog (L1) data
    authoritative regardless of what L2/L3 return.

    `fields` restricts which string fields may be filled; the ficha V2 cascade
    passes `PRODUCT_FIELD_NAMES` so commercial fields are never auto-filled.
    The list fields (underlying/geographic_focus/asset_class) are always
    product-level and merged regardless."""
    filled_any = False
    for field in fields:
        current = getattr(result, field)
        new_value = (new_data.get(field) or "").strip()
        if not current and new_value:
            setattr(result, field, new_value)
            result.provenance[field] = source
            filled_any = True
    raw_underlying = new_data.get("underlying") or []
    if not result.underlying and raw_underlying:
        result.underlying = [
            AssetAllocation(**a) if isinstance(a, dict) else a for a in raw_underlying
        ]
        result.provenance["underlying"] = source
        filled_any = True
    raw_geo = new_data.get("geographic_focus") or []
    if not result.geographic_focus and raw_geo:
        result.geographic_focus = [
            AssetAllocation(**a) if isinstance(a, dict) else a for a in raw_geo
        ]
        result.provenance["geographic_focus"] = source
        filled_any = True
    raw_ac = new_data.get("asset_class") or []
    if not result.asset_class and raw_ac:
        result.asset_class = [AssetAllocation(**a) if isinstance(a, dict) else a for a in raw_ac]
        result.provenance["asset_class"] = source
        filled_any = True
    if filled_any and _SOURCE_RANK[source] > _SOURCE_RANK[result.primary_source]:
        result.primary_source = source
    return result


def _is_complete(result: SearchResult) -> bool:
    return (
        all(getattr(result, field) for field in FIELD_NAMES)
        and bool(result.underlying)
        and bool(result.geographic_focus)
        and bool(result.asset_class)
    )


def _is_product_complete(result: SearchResult) -> bool:
    """Completeness for the ficha V2 cascade — only the product-level fields
    (commercial fields come from the admin's pick, so they never gate L2/L3)."""
    return (
        all(getattr(result, field) for field in PRODUCT_FIELD_NAMES)
        and bool(result.underlying)
        and bool(result.geographic_focus)
        and bool(result.asset_class)
    )


def _has_any_data(result: SearchResult) -> bool:
    return (
        any(getattr(result, field) for field in FIELD_NAMES)
        or bool(result.underlying)
        or bool(result.geographic_focus)
        or bool(result.asset_class)
    )


async def _search_catalog(query: str, pool: asyncpg.Pool) -> SearchResult:
    """L1 — authoritative catalog search. Reuses the existing `pg_trgm`
    similarity search and takes the top match, if any."""
    repo = CatalogRepository(pool)
    matches = await repo.search(query, limit=1)
    result = SearchResult()
    if not matches:
        return result
    match = matches[0]
    result.catalog_product_id = match.id
    if match.underlying:
        result.underlying = match.underlying
        result.provenance["underlying"] = "catalog"
    if match.geographic_focus:
        result.geographic_focus = match.geographic_focus
        result.provenance["geographic_focus"] = "catalog"
    if match.asset_class:
        result.asset_class = match.asset_class
        result.provenance["asset_class"] = "catalog"
    catalog_data = {field: getattr(match, field) for field in FIELD_NAMES}
    return _merge_fields(result, catalog_data, "catalog")


async def _run_extraction(
    human_content: str, *, system_prompt: str = _EXTRACTION_SYSTEM_PROMPT
) -> dict:
    llm = ChatAnthropic(model=EXTRACTION_MODEL_NAME, temperature=0)
    structured_llm = llm.with_structured_output(ExtractedProduct)
    extracted = await structured_llm.ainvoke(
        [
            SystemMessage(content=system_prompt),
            HumanMessage(content=human_content),
        ]
    )
    return extracted.model_dump()


async def _extract_from_claude(query: str) -> dict[str, str]:
    """L2 — fills remaining fields from Claude's own training knowledge via a
    separate, non-streaming structured-output call."""
    return await _run_extraction(
        f"Product to research: {query}\n\n"
        "Use only your own knowledge of this financial product. Do not assume "
        "access to the web."
    )


def _format_tavily_context(response: dict) -> str:
    parts: list[str] = []
    answer = response.get("answer")
    if answer:
        parts.append(answer)
    for item in response.get("results") or []:
        title = item.get("title", "")
        content = item.get("content", "")
        if title or content:
            parts.append(f"{title}: {content}")
    return "\n".join(parts).strip()


async def _search_tavily(query: str) -> dict[str, str]:
    """L3 — last-resort web search via Tavily, grounded-extracted into the
    shared field set. Skips gracefully (returns {}) when `TAVILY_API_KEY` is
    unset or the search call fails — never raises."""
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        return {}

    client = TavilyClient(api_key=api_key)
    try:
        response = await asyncio.to_thread(
            client.search, query, search_depth="basic", max_results=3
        )
    except Exception:
        return {}

    context = _format_tavily_context(response)
    if not context:
        return {}

    return await _run_extraction(
        f"Product to research: {query}\n\nWeb search results:\n{context}\n\n"
        "Extract fields ONLY from the web search results above — do not use "
        "outside knowledge."
    )


# Ficha L3 (Slice: ficha-web-tools-enrichment) — Claude's own web_search +
# web_fetch server tools replace Tavily for the ficha cascade only. The chat
# cascade keeps `_search_tavily`.
_WEB_TOOLS = [
    {"type": "web_search_20250305", "name": "web_search", "max_uses": 5},
    {"type": "web_fetch_20250910", "name": "web_fetch", "max_uses": 5},
]
_WEB_FETCH_BETA = "web-fetch-2025-09-10"


def _blocks_to_text(response: object) -> str:
    """Concatenate the text blocks of a chat response, robust to the content
    shape (standard content_blocks, a list of dict blocks, or a plain string)."""
    blocks = getattr(response, "content_blocks", None)
    if blocks:
        text = "\n".join(
            b.get("text", "") for b in blocks if isinstance(b, dict) and b.get("type") == "text"
        )
        if text.strip():
            return text.strip()
    content = getattr(response, "content", "")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        return "\n".join(
            c.get("text", "") for c in content if isinstance(c, dict) and c.get("type") == "text"
        ).strip()
    return ""


def _extract_sources(response: object) -> list[Source]:
    """Collect the web citation annotations (url + title) from a chat response,
    de-duplicated by url, for the ficha "Fuentes" section."""
    blocks = getattr(response, "content_blocks", None) or []
    seen: set[str] = set()
    sources: list[Source] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        for ann in block.get("annotations") or []:
            if not isinstance(ann, dict):
                continue
            url = ann.get("url")
            if url and url not in seen:
                seen.add(url)
                sources.append(Source(url=url, title=ann.get("title") or ""))
    return sources


async def _research_with_claude_web(query: str) -> tuple[str, list[Source]]:
    """Research a financial product with Claude's server-side web_search +
    web_fetch tools; return the grounded assistant text and the cited sources.
    Returns ("", []) when `ANTHROPIC_API_KEY` is unset or the call fails."""
    if not os.environ.get("ANTHROPIC_API_KEY"):
        logger.warning("Claude web research skipped for %r: ANTHROPIC_API_KEY is not set", query)
        return "", []
    try:
        llm = ChatAnthropic(
            model=EXTRACTION_MODEL_NAME,
            temperature=0,
            betas=[_WEB_FETCH_BETA],
        ).bind_tools(_WEB_TOOLS)
        response = await llm.ainvoke(
            "Research this financial product and summarize its factual "
            "attributes (manager, currency, asset class, geographic focus, "
            f"underlying). Use web search and fetch sources as needed.\n\nProduct: {query}"
        )
        text, sources = _blocks_to_text(response), _extract_sources(response)
        if not text and not sources:
            logger.warning(
                "Claude web research returned no text/sources for %r "
                "(model=%s, beta=%s) — check web_search/web_fetch tool access",
                query,
                EXTRACTION_MODEL_NAME,
                _WEB_FETCH_BETA,
            )
        return text, sources
    except Exception:
        logger.exception("Claude web research failed for %r", query)
        return "", []


async def _search_claude_web(query: str) -> tuple[dict[str, str], list[Source]]:
    """L3 for the ficha cascade — Claude web_search + web_fetch research,
    grounded-extracted into the shared field set plus the cited sources
    (replaces Tavily for ficha). Returns ({}, sources) on no data; never raises."""
    context, sources = await _research_with_claude_web(query)
    if not context:
        return {}, sources
    # Classify asset_class into the FICHA taxonomy so the ficha review select
    # auto-populates (the portfolio taxonomy would not map onto it).
    fields = await _run_extraction(
        f"Product to research: {query}\n\nWeb research:\n{context}\n\n"
        "Extract fields ONLY from the web research above — do not use outside "
        "knowledge.",
        system_prompt=_FICHA_EXTRACTION_SYSTEM_PROMPT,
    )
    return fields, sources


_LEGACY_ASSET_CLASS_LABELS: set[str] = {
    "real estate directo",
    "mercados privados",
    "mercados privado",
    "club deals",
    "mercados públicos",
    "cash y equivalentes",
    # Old short keys (legacy aliases)
    "directas",
    "privados",
    "club",
    "publicos",
    "cash",
}


def _is_valid_asset_class(value: str) -> bool:
    v = value.strip().lower()
    for key, info in ASSET_CLASSES.items():
        if v == key.lower() or v == str(info["label"]).lower():
            return True
    return v in _LEGACY_ASSET_CLASS_LABELS


def _sanitize_taxonomy(result: SearchResult) -> None:
    """Drop asset_class allocations whose name doesn't match the SABBI
    taxonomy. Invalid entries (e.g. "Diversificado" from a catalog entry)
    are wiped so _classify can re-attempt auto-classification or the agent
    asks the user.  Catalog-sourced values are kept as-is — that data was
    already reviewed by an admin."""
    if not result.asset_class:
        return
    if result.provenance.get("asset_class") == "catalog":
        return
    valid = [a for a in result.asset_class if _is_valid_asset_class(a.name)]
    if len(valid) != len(result.asset_class):
        result.asset_class = valid
        if not valid:
            result.provenance.pop("asset_class", None)


def _classify(result: SearchResult) -> None:
    """Auto-classify into asset_class from `ASSET_CLASSES` when the
    already-known fields confidently match exactly one taxonomy leaf. Leaves
    asset_class empty on no match or ambiguous (multiple leaf) matches so the
    agent asks the user to classify manually."""
    if result.asset_class:
        return

    haystack = " ".join(
        filter(
            None,
            [
                result.name,
                " ".join(a.name for a in result.geographic_focus),
            ],
        )
    ).lower()
    if not haystack:
        return

    matches: set[tuple[str, str, str]] = set()
    for asset_class_key, info in ASSET_CLASSES.items():
        for group_name, leaves in info["groups"].items():
            for leaf in leaves:
                if leaf and leaf.lower() in haystack:
                    matches.add((asset_class_key, group_name, leaf))

    if len(matches) != 1:
        return

    asset_class_key, group_name, leaf = next(iter(matches))
    del group_name, leaf
    result.asset_class = [AssetAllocation(name=asset_class_key, percentage=100)]
    result.provenance["asset_class"] = result.primary_source


async def cascade_search(query: str, pool: asyncpg.Pool) -> SearchResult | None:
    """L1 -> L2 -> L3 cascade. Returns None only if all levels find nothing."""
    result = await _search_catalog(query, pool)

    if not _is_complete(result):
        claude_data = await _extract_from_claude(query)
        if claude_data:
            _merge_fields(result, claude_data, "claude_knowledge")

    if not _is_complete(result):
        tavily_data = await _search_tavily(query)
        if tavily_data:
            _merge_fields(result, tavily_data, "web_search")

    _sanitize_taxonomy(result)
    _classify(result)

    if not _has_any_data(result):
        return None

    return result


# ---------------------------------------------------------------------------
# Ficha-patrimonial V2 enrichment — normalized catalog (catalog_product*).
# Separate from the chat `cascade_search` above (which stays on the flat V1
# catalog): the only difference is L1 and that L2/L3 may fill PRODUCT fields
# only. Commercial fields come from the admin's series/admin pick, never a
# guess (`odd/tasks/ficha-patrimonial-v2.md`).
# ---------------------------------------------------------------------------


def _series_options(product) -> list[CatalogSeriesOption]:
    """Map the normalized product's nested series/admins into the lightweight
    option models the review-table picker consumes."""
    return [
        CatalogSeriesOption(
            series=s.series,
            management_fee_ter=s.management_fee_ter,
            flows_min=s.flows_min,
            flows_max=s.flows_max,
            return_min=s.return_min,
            return_max=s.return_max,
            administrators=[
                CatalogSeriesAdminOption(
                    administrator=a.administrator,
                    custody_fee=a.custody_fee,
                    buy_commission=a.buy_commission,
                    sell_commission=a.sell_commission,
                    billing_currency=a.billing_currency,
                    minimum_usd=a.minimum_usd,
                    min_commission_usd=a.min_commission_usd,
                )
                for a in s.administrators
            ],
        )
        for s in product.series
    ]


def catalog_result_from_product(product) -> SearchResult:
    """Map a normalized-catalog product to the ficha `SearchResult` shape (product
    level fields + `series_options`). Shared by the fuzzy L1 match and the admin's
    explicit catalog-product pick."""
    result = SearchResult()
    result.catalog_product_code = product.code
    result.series_options = _series_options(product)
    result.ticker_isin = product.ticker_isin
    result.investment_horizon = product.investment_horizon
    result.similarity = product.match_similarity or 0.0
    result.data_asof = product.created_at.date().isoformat() if product.created_at else ""
    product_data = {
        "name": product.name,
        "currency": product.currency,
        "manager": product.manager,
        "asset_class": product.asset_class,
        "geographic_focus": product.geographic_focus,
        "underlying": product.underlying,
    }
    return _merge_fields(result, product_data, "catalog", fields=PRODUCT_FIELD_NAMES)


async def _search_catalog_v2(query: str, pool: asyncpg.Pool) -> SearchResult:
    """L1 for ficha V2 — best fuzzy match in the normalized catalog. Fills
    only product-level fields (plus asset_class/geographic_focus/underlying)
    and attaches `series_options`; commercial fields stay empty for the admin
    to resolve by picking a series/administrator."""
    repo = NormalizedCatalogRepository(pool)
    match = await repo.search_for_enrichment(query)
    if match is None:
        return SearchResult()
    return catalog_result_from_product(match)


# Catalog-match similarity below which confidence is "baja" (a weak fuzzy hit).
_MEDIA_SIMILARITY = 0.4
# Catalog-match similarity below which a Claude web search runs automatically to
# verify the match, even when the product fields already look complete.
_WEB_SEARCH_SIMILARITY = 0.55


def _is_low_confidence_catalog(result: SearchResult) -> bool:
    """A catalog match weak enough to auto-verify with the web (similarity under
    `_WEB_SEARCH_SIMILARITY`). Such a hit triggers a Claude web search even when
    the product fields already look complete, so the admin gets web-grounded
    data + sources to verify it."""
    return bool(result.catalog_product_code) and result.similarity < _WEB_SEARCH_SIMILARITY


_CONFIDENCE_ORDER = ("sin_datos", "baja", "media", "alta")


def _raise_confidence(level: str, floor: str) -> str:
    """Return the higher of ``level`` and ``floor`` on the confidence scale."""
    if _CONFIDENCE_ORDER.index(level) >= _CONFIDENCE_ORDER.index(floor):
        return level
    return floor


def _classify_match(
    similarity: float, has_data: bool, web_verified: bool = False
) -> tuple[str, bool]:
    """Derive ``(confidence_level, catalog_matched)`` for a ficha enrichment
    result. Confidence is gated by the catalog match similarity so a weak fuzzy
    hit is never reported as high confidence; ``catalog_matched`` ("ya estaba en
    la BD") is True only for a real catalog hit (sim >= 0.4). ``web_verified``
    (Claude web search returned cited sources) raises the floor to "media" — a
    weak catalog match corroborated by the web is no longer merely "baja"."""
    if similarity >= 0.6:
        level, matched = "alta", True
    elif similarity >= 0.4:
        level, matched = "media", True
    elif similarity > 0.0 or has_data:
        level, matched = "baja", False
    else:
        level, matched = "sin_datos", False

    if web_verified and has_data:
        level = _raise_confidence(level, "media")
    return level, matched


# Fields that may carry a web self-reported confidence: the product-level string
# fields the web step fills, plus the always-merged list fields.
_CONFIDENCE_FIELDS = PRODUCT_FIELD_NAMES + ("asset_class", "geographic_focus", "underlying")


def _sanitize_field_confidence(raw: object, result: SearchResult) -> dict[str, int]:
    """Clean the web extraction's self-reported ``field_confidence``: keep only
    integer scores clamped to 0..100, for fields actually populated on ``result``.
    Drops unknown keys, empty fields, and non-numeric values — the score is a
    model self-estimate, so its shape is never trusted blindly."""
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, int] = {}
    for field in _CONFIDENCE_FIELDS:
        if field not in raw or not getattr(result, field, None):
            continue
        try:
            score = int(raw[field])
        except (TypeError, ValueError):
            continue
        cleaned[field] = max(0, min(100, score))
    return cleaned


async def research_web_v2(query: str) -> SearchResult:
    """Force a Claude ``web_search`` + ``web_fetch`` research for one product —
    the ficha review card's "Volver a investigar" action. Returns a web-grounded
    ``SearchResult`` (product-level fields filled from the web plus the cited
    sources), independent of the catalog. Confidence is always web-based ("baja"
    with data, "sin_datos" without). Never raises; an empty result when
    ``ANTHROPIC_API_KEY`` is unset or nothing is found."""
    result = SearchResult()
    web_data, web_sources = await _search_claude_web(query)
    if web_data:
        _merge_fields(result, web_data, "web_search", fields=PRODUCT_FIELD_NAMES)
    if web_sources:
        result.sources = web_sources

    _sanitize_taxonomy(result)
    _classify(result)
    result.confidence, result.catalog_matched = _classify_match(
        0.0, _has_any_data(result), web_verified=bool(web_sources)
    )
    # Per-field self-reported confidence, kept only for fields the web step filled.
    result.field_confidence = _sanitize_field_confidence(web_data.get("field_confidence"), result)
    return result


async def cascade_search_v2(query: str, pool: asyncpg.Pool) -> SearchResult | None:
    """Ficha-patrimonial enrichment cascade on the V2 normalized catalog.
    L1 = normalized catalog; L2/L3 fill PRODUCT-level gaps only. Returns None
    only if all levels find nothing."""
    result = await _search_catalog_v2(query, pool)

    if not _is_product_complete(result):
        claude_data = await _extract_from_claude(query)
        if claude_data:
            _merge_fields(result, claude_data, "claude_knowledge", fields=PRODUCT_FIELD_NAMES)

    web_verified = False
    if not _is_product_complete(result) or _is_low_confidence_catalog(result):
        web_data, web_sources = await _search_claude_web(query)
        if web_data:
            _merge_fields(result, web_data, "web_search", fields=PRODUCT_FIELD_NAMES)
        if web_sources:
            result.sources = web_sources
            web_verified = True

    _sanitize_taxonomy(result)
    _classify(result)

    has_data = _has_any_data(result)
    if not has_data:
        return None

    result.confidence, result.catalog_matched = _classify_match(
        result.similarity, has_data, web_verified=web_verified
    )
    return result

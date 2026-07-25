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
import os

import asyncpg
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field
from tavily import TavilyClient

from agent.state import ASSET_CLASSES
from db.catalog_repository import CatalogRepository
from db.models import FieldSource, SearchResult

# String fields the cascade searches/returns at every level (field parity
# — `cascading-search.spec.md`, "Search Field Parity").
# List-type fields (underlying, geographic_focus) are handled separately in
# _merge_fields.
FIELD_NAMES = (
    "name",
    "asset_class",
    "commission",
    "currency",
    "administrator",
    "manager",
    "liquidity",
    "return_rate",
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

_EXTRACTION_SYSTEM_PROMPT = """You are a financial product data extraction assistant for SABBI,
an investment portfolio platform.

Extract these fields for the requested product: name, asset_class,
geographic_focus, commission, currency, administrator, manager,
liquidity, return_rate, underlying.

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
underlying and geographic_focus). NEVER invent, guess, or fabricate a value
you cannot verify."""


class _ExtractedAllocation(BaseModel):
    name: str = ""
    percentage: float = 0


class ExtractedProduct(BaseModel):
    """Structured-output schema for the L2/L3 Claude extraction passes.
    Mirrors `SearchResult`'s field set minus provenance/primary_source."""

    name: str = ""
    asset_class: str = ""
    geographic_focus: list[_ExtractedAllocation] = Field(default_factory=list)
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    underlying: list[_ExtractedAllocation] = Field(default_factory=list)


def _merge_fields(
    result: SearchResult, new_data: dict, source: FieldSource
) -> SearchResult:
    """Fill only the fields `result` doesn't already have, tagging each
    newly-filled field's provenance with `source`. Never overwrites a field
    that already has a value — this is what keeps catalog (L1) data
    authoritative regardless of what L2/L3 return."""
    filled_any = False
    for field in FIELD_NAMES:
        current = getattr(result, field)
        new_value = (new_data.get(field) or "").strip()
        if not current and new_value:
            setattr(result, field, new_value)
            result.provenance[field] = source
            filled_any = True
    from db.models import AssetAllocation
    raw_underlying = new_data.get("underlying") or []
    if not result.underlying and raw_underlying:
        result.underlying = [
            AssetAllocation(**a) if isinstance(a, dict) else a
            for a in raw_underlying
        ]
        result.provenance["underlying"] = source
        filled_any = True
    raw_geo = new_data.get("geographic_focus") or []
    if not result.geographic_focus and raw_geo:
        result.geographic_focus = [
            AssetAllocation(**a) if isinstance(a, dict) else a
            for a in raw_geo
        ]
        result.provenance["geographic_focus"] = source
        filled_any = True
    if filled_any and _SOURCE_RANK[source] > _SOURCE_RANK[result.primary_source]:
        result.primary_source = source
    return result


def _is_complete(result: SearchResult) -> bool:
    return (
        all(getattr(result, field) for field in FIELD_NAMES)
        and bool(result.underlying)
        and bool(result.geographic_focus)
    )


def _has_any_data(result: SearchResult) -> bool:
    return (
        any(getattr(result, field) for field in FIELD_NAMES)
        or bool(result.underlying)
        or bool(result.geographic_focus)
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
    catalog_data = {field: getattr(match, field) for field in FIELD_NAMES}
    return _merge_fields(result, catalog_data, "catalog")


async def _run_extraction(human_content: str) -> dict:
    llm = ChatAnthropic(model=EXTRACTION_MODEL_NAME, temperature=0)
    structured_llm = llm.with_structured_output(ExtractedProduct)
    extracted = await structured_llm.ainvoke(
        [
            SystemMessage(content=_EXTRACTION_SYSTEM_PROMPT),
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
    """Clear asset_class values that don't match the SABBI taxonomy.
    Invalid values (e.g. "Diversificado" from a catalog entry) are wiped so
    _classify can re-attempt auto-classification or the agent asks the user."""
    if result.asset_class and not _is_valid_asset_class(result.asset_class):
        result.asset_class = ""
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
    result.asset_class = asset_class_key
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

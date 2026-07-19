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
from pydantic import BaseModel
from tavily import TavilyClient

from agent.state import CATEGORIES
from db.catalog_repository import CatalogRepository
from db.models import FieldSource, SearchResult

# Same 12-field set the cascade searches/returns at every level (field parity
# — `cascading-search.spec.md`, "Search Field Parity").
FIELD_NAMES = (
    "name",
    "asset_class",
    "geographic_focus",
    "underlying",
    "commission",
    "currency",
    "administrator",
    "manager",
    "liquidity",
    "return_rate",
    "category",
    "subcategory",
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
geographic_focus, underlying, commission, currency, administrator, manager,
liquidity, return_rate, category, subcategory.

CRITICAL RULE: if you are not confident about a field, or the information was
not given to you, leave that field as an empty string. NEVER invent, guess, or
fabricate a value you cannot verify."""


class ExtractedProduct(BaseModel):
    """Structured-output schema for the L2/L3 Claude extraction passes.
    Mirrors `SearchResult`'s field set minus provenance/primary_source."""

    name: str = ""
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    subcategory: str = ""


def _merge_fields(
    result: SearchResult, new_data: dict[str, str], source: FieldSource
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
    if filled_any and _SOURCE_RANK[source] > _SOURCE_RANK[result.primary_source]:
        result.primary_source = source
    return result


def _is_complete(result: SearchResult) -> bool:
    return all(getattr(result, field) for field in FIELD_NAMES)


def _has_any_data(result: SearchResult) -> bool:
    return any(getattr(result, field) for field in FIELD_NAMES)


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
    catalog_data = {field: getattr(match, field) for field in FIELD_NAMES}
    return _merge_fields(result, catalog_data, "catalog")


async def _run_extraction(human_content: str) -> dict[str, str]:
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


_LEGACY_CATEGORY_LABELS: set[str] = {
    "real estate directo",
    "mercados privados",
    "mercados privado",
    "club deals",
    "mercados públicos",
    "cash y equivalentes",
}


def _is_valid_category(value: str) -> bool:
    v = value.strip().lower()
    for key, info in CATEGORIES.items():
        if v == key.lower() or v == str(info["label"]).lower():
            return True
    return v in _LEGACY_CATEGORY_LABELS


def _is_valid_subcategory(value: str) -> bool:
    """Check whether a subcategory string matches a canonical taxonomy leaf."""
    v = value.strip().lower()
    for info in CATEGORIES.values():
        for group_name, leaves in info["groups"].items():
            for leaf in leaves:
                canonical = leaf if leaf == group_name else f"{group_name} {leaf}"
                if canonical.lower() == v:
                    return True
    return False


def _sanitize_taxonomy(result: SearchResult) -> None:
    """Clear category/subcategory values that don't match the SABBI taxonomy.
    Invalid values (e.g. "Diversificado" from a catalog entry) are wiped so
    _classify can re-attempt auto-classification or the agent asks the user."""
    if result.category and not _is_valid_category(result.category):
        result.category = ""
        result.provenance.pop("category", None)
    if result.subcategory and not _is_valid_subcategory(result.subcategory):
        result.subcategory = ""
        result.provenance.pop("subcategory", None)


def _classify(result: SearchResult) -> None:
    """Auto-classify into category/subcategory from `CATEGORIES` when the
    already-known fields confidently match exactly one taxonomy leaf. Leaves
    both empty on no match or ambiguous (multiple leaf) matches so the agent
    asks the user to classify manually."""
    if result.category and result.subcategory:
        return

    haystack = " ".join(
        filter(
            None,
            [
                result.name,
                result.asset_class,
                result.geographic_focus,
                result.underlying,
                result.subcategory,
            ],
        )
    ).lower()
    if not haystack:
        return

    matches: set[tuple[str, str, str]] = set()
    for category_key, info in CATEGORIES.items():
        for group_name, leaves in info["groups"].items():
            for leaf in leaves:
                if leaf and leaf.lower() in haystack:
                    matches.add((category_key, group_name, leaf))

    if len(matches) != 1:
        return

    category_key, group_name, leaf = next(iter(matches))
    result.category = category_key
    result.subcategory = leaf if leaf == group_name else f"{group_name} {leaf}"
    result.provenance["category"] = result.primary_source
    result.provenance["subcategory"] = result.primary_source


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

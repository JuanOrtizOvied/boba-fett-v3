"""Tests for the L1 -> L2 -> L3 cascading search (`agent.search`).

No real Postgres, Anthropic, or Tavily calls are made. `CatalogRepository`,
`ChatAnthropic`, and `TavilyClient` are all replaced with test doubles via
`monkeypatch`, following the pattern in `test_integration.py` /
`test_routes_chat_lifespan.py` (no `pytest-asyncio` in this project — async
code under test is driven with `asyncio.run(...)`).
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from db.models import SearchResult

# --- _merge_fields (pure function) -----------------------------------------


def test_merge_fields_fills_empty_fields_and_tracks_provenance():
    from agent.search import _merge_fields

    result = SearchResult()
    merged = _merge_fields(result, {"name": "Fund X", "commission": "0.5%"}, "claude_knowledge")

    assert merged is result
    assert result.name == "Fund X"
    assert result.commission == "0.5%"
    assert result.provenance == {"name": "claude_knowledge", "commission": "claude_knowledge"}
    assert result.primary_source == "claude_knowledge"


def test_merge_fields_never_overwrites_existing_value():
    from agent.search import _merge_fields

    result = SearchResult(
        commission="0.10%", provenance={"commission": "catalog"}, primary_source="catalog"
    )
    _merge_fields(result, {"commission": "9.99%", "liquidity": "Diaria"}, "web_search")

    assert result.commission == "0.10%"
    assert result.provenance["commission"] == "catalog"
    assert result.liquidity == "Diaria"
    assert result.provenance["liquidity"] == "web_search"
    # primary_source tracks the weakest (least trusted) level that contributed
    assert result.primary_source == "web_search"


def test_merge_fields_ignores_blank_and_whitespace_values():
    from agent.search import _merge_fields

    result = SearchResult()
    _merge_fields(result, {"name": "   ", "commission": ""}, "claude_knowledge")

    assert result.name == ""
    assert result.commission == ""
    assert result.provenance == {}
    assert result.primary_source == "catalog"


# --- L1: _search_catalog -----------------------------------------------------


def test_search_catalog_maps_repository_match_into_search_result(monkeypatch):
    import agent.search as search_module
    from db.models import CatalogProduct

    product = CatalogProduct(
        id=1,
        name="Vanguard Total World Stock ETF",
        asset_class="Renta Variable",
        commission="0.07%",
        category="publicos",
        subcategory="Developed ex-US",
    )

    class _FakeCatalogRepository:
        def __init__(self, pool):
            self.pool = pool

        async def search(self, query, limit=5):
            return [product]

    monkeypatch.setattr(search_module, "CatalogRepository", _FakeCatalogRepository)

    result = asyncio.run(search_module._search_catalog("Vanguard", object()))

    assert result.name == "Vanguard Total World Stock ETF"
    assert result.commission == "0.07%"
    assert result.category == "publicos"
    assert result.provenance["name"] == "catalog"
    assert result.provenance["commission"] == "catalog"
    assert result.primary_source == "catalog"
    # fields the catalog row didn't have stay empty with no provenance entry
    assert result.liquidity == ""
    assert "liquidity" not in result.provenance


def test_search_catalog_returns_empty_result_when_no_matches(monkeypatch):
    import agent.search as search_module

    class _FakeCatalogRepository:
        def __init__(self, pool):
            self.pool = pool

        async def search(self, query, limit=5):
            return []

    monkeypatch.setattr(search_module, "CatalogRepository", _FakeCatalogRepository)

    result = asyncio.run(search_module._search_catalog("Unknown Product XYZ", object()))

    assert result.provenance == {}
    assert result.name == ""


# --- L2: _extract_from_claude -------------------------------------------------


def test_extract_from_claude_returns_structured_dict_with_empty_unknowns(monkeypatch):
    import agent.search as search_module

    expected = search_module.ExtractedProduct(
        name="Vanguard Total World Stock ETF",
        asset_class="Renta Variable",
        currency="USD",
        # every field Claude is unsure about is left "" by the model itself
    )

    class _FakeStructuredLLM:
        async def ainvoke(self, messages):
            _FakeStructuredLLM.received_messages = messages
            return expected

    class _FakeChatAnthropic:
        def __init__(self, *, model, temperature=0):
            self.model = model
            self.temperature = temperature

        def with_structured_output(self, schema):
            assert schema is search_module.ExtractedProduct
            return _FakeStructuredLLM()

    monkeypatch.setattr(search_module, "ChatAnthropic", _FakeChatAnthropic)

    result = asyncio.run(search_module._extract_from_claude("Vanguard Total World Stock ETF"))

    assert result["name"] == "Vanguard Total World Stock ETF"
    assert result["asset_class"] == "Renta Variable"
    assert result["currency"] == "USD"
    assert result["commission"] == ""
    assert result["manager"] == ""


# --- L3: _search_tavily -------------------------------------------------------


def test_search_tavily_returns_empty_dict_without_api_key(monkeypatch):
    import agent.search as search_module

    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    client_factory = MagicMock()
    monkeypatch.setattr(search_module, "TavilyClient", client_factory)

    result = asyncio.run(search_module._search_tavily("Some Fund"))

    assert result == {}
    client_factory.assert_not_called()


def test_search_tavily_builds_context_and_delegates_to_extraction(monkeypatch):
    import agent.search as search_module

    monkeypatch.setenv("TAVILY_API_KEY", "test-tavily-key")

    fake_client = MagicMock()
    fake_client.search.return_value = {
        "answer": "BlackRock Global Bond Fund charges a 0.45% management fee.",
        "results": [{"title": "BlackRock factsheet", "content": "Administered by BlackRock."}],
    }
    client_factory = MagicMock(return_value=fake_client)
    monkeypatch.setattr(search_module, "TavilyClient", client_factory)

    extraction_mock = AsyncMock(return_value={"commission": "0.45%", "administrator": "BlackRock"})
    monkeypatch.setattr(search_module, "_run_extraction", extraction_mock)

    result = asyncio.run(search_module._search_tavily("BlackRock Global Bond Fund"))

    assert result == {"commission": "0.45%", "administrator": "BlackRock"}
    fake_client.search.assert_called_once_with(
        "BlackRock Global Bond Fund", search_depth="basic", max_results=3
    )
    extraction_mock.assert_awaited_once()
    (delegated_content,), _kwargs = extraction_mock.call_args
    assert "BlackRock Global Bond Fund" in delegated_content
    assert "0.45% management fee" in delegated_content
    assert "Administered by BlackRock" in delegated_content


def test_search_tavily_returns_empty_dict_when_search_call_fails(monkeypatch):
    import agent.search as search_module

    monkeypatch.setenv("TAVILY_API_KEY", "test-tavily-key")

    fake_client = MagicMock()
    fake_client.search.side_effect = RuntimeError("network error")
    monkeypatch.setattr(search_module, "TavilyClient", MagicMock(return_value=fake_client))

    result = asyncio.run(search_module._search_tavily("Some Fund"))

    assert result == {}


# --- _classify -----------------------------------------------------------------


def test_classify_sets_confident_taxonomy_match():
    from agent.search import _classify

    result = SearchResult(asset_class="Renta Fija", underlying="US Treasuries")
    _classify(result)

    assert result.category == "publicos"
    assert result.subcategory == "Renta Fija US Treasuries"
    assert result.provenance["category"] == result.primary_source
    assert result.provenance["subcategory"] == result.primary_source


def test_classify_leaves_empty_on_ambiguous_match():
    from agent.search import _classify

    # "Perú" and "Perú Bonds" are two distinct leaves under `publicos` —
    # this text confidently matches neither.
    result = SearchResult(geographic_focus="Perú Bonds")
    _classify(result)

    assert result.category == ""
    assert result.subcategory == ""
    assert "category" not in result.provenance


def test_classify_leaves_empty_when_no_taxonomy_leaf_matches():
    from agent.search import _classify

    result = SearchResult(name="Unknown Widget Corp")
    _classify(result)

    assert result.category == ""
    assert result.subcategory == ""


def test_classify_skips_when_both_fields_already_set():
    from agent.search import _classify

    result = SearchResult(category="cash", subcategory="Depósitos a plazo")
    _classify(result)

    assert result.category == "cash"
    assert result.subcategory == "Depósitos a plazo"


# --- cascade_search --------------------------------------------------------------


def test_cascade_search_stops_after_l1_when_catalog_result_is_complete(monkeypatch):
    import agent.search as search_module

    complete = SearchResult(
        name="Vanguard Total World Stock ETF",
        asset_class="Renta Variable",
        geographic_focus="Global",
        underlying="VT",
        commission="0.07%",
        currency="USD",
        administrator="Vanguard",
        manager="Vanguard",
        liquidity="Diaria",
        return_rate="7%",
        category="publicos",
        subcategory="Developed ex-US",
        primary_source="catalog",
        provenance={field: "catalog" for field in search_module.FIELD_NAMES},
    )

    catalog_mock = AsyncMock(return_value=complete)
    claude_mock = AsyncMock()
    tavily_mock = AsyncMock()

    monkeypatch.setattr(search_module, "_search_catalog", catalog_mock)
    monkeypatch.setattr(search_module, "_extract_from_claude", claude_mock)
    monkeypatch.setattr(search_module, "_search_tavily", tavily_mock)

    result = asyncio.run(search_module.cascade_search("Vanguard", object()))

    assert result is not None
    assert result.primary_source == "catalog"
    assert all(result.provenance[field] == "catalog" for field in search_module.FIELD_NAMES)
    claude_mock.assert_not_awaited()
    tavily_mock.assert_not_awaited()


def test_cascade_search_falls_through_levels_and_keeps_catalog_authoritative(monkeypatch):
    import agent.search as search_module

    partial_catalog = SearchResult(
        name="BlackRock Global Bond Fund",
        commission="0.45%",
        primary_source="catalog",
        provenance={"name": "catalog", "commission": "catalog"},
    )
    catalog_mock = AsyncMock(return_value=partial_catalog)

    # L2 tries to override `commission` (must be ignored) and fills `liquidity`;
    # `currency` stays unknown — never-invent guardrail.
    claude_mock = AsyncMock(
        return_value={"commission": "1.99%", "liquidity": "Mensual", "currency": ""}
    )

    tavily_mock = AsyncMock(
        return_value={"return_rate": "5.2%", "administrator": "BlackRock"}
    )

    monkeypatch.setattr(search_module, "_search_catalog", catalog_mock)
    monkeypatch.setattr(search_module, "_extract_from_claude", claude_mock)
    monkeypatch.setattr(search_module, "_search_tavily", tavily_mock)

    result = asyncio.run(search_module.cascade_search("BlackRock Global Bond Fund", object()))

    assert result is not None
    claude_mock.assert_awaited_once()
    tavily_mock.assert_awaited_once()

    # catalog field is authoritative — never overwritten by L2
    assert result.commission == "0.45%"
    assert result.provenance["commission"] == "catalog"

    # L2 fills what it can
    assert result.liquidity == "Mensual"
    assert result.provenance["liquidity"] == "claude_knowledge"

    # L3 fills what's still missing
    assert result.return_rate == "5.2%"
    assert result.provenance["return_rate"] == "web_search"
    assert result.administrator == "BlackRock"
    assert result.provenance["administrator"] == "web_search"

    # never-invent: nothing populated `currency`, so it stays empty untracked
    assert result.currency == ""
    assert "currency" not in result.provenance

    # never-invent: no taxonomy leaf matched, classification leaves both empty
    assert result.category == ""
    assert result.subcategory == ""

    # field parity — the full 12-field shape is always present
    for field in search_module.FIELD_NAMES:
        assert hasattr(result, field)

    # card-level primary_source reflects the weakest source used
    assert result.primary_source == "web_search"


def test_cascade_search_returns_none_when_all_levels_find_nothing(monkeypatch):
    import agent.search as search_module

    monkeypatch.setattr(search_module, "_search_catalog", AsyncMock(return_value=SearchResult()))
    monkeypatch.setattr(search_module, "_extract_from_claude", AsyncMock(return_value={}))
    monkeypatch.setattr(search_module, "_search_tavily", AsyncMock(return_value={}))

    result = asyncio.run(search_module.cascade_search("Unknown Product XYZ", object()))

    assert result is None


def test_cascade_search_degrades_gracefully_without_tavily_api_key(monkeypatch):
    """`agent.spec.md` delta — Graceful Degradation Without Tavily: exercises
    the REAL `_search_tavily` (not mocked) to confirm the missing-key path is
    genuinely skip-without-crash end-to-end through `cascade_search`."""
    import agent.search as search_module

    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    partial = SearchResult(
        name="Some Fund", primary_source="catalog", provenance={"name": "catalog"}
    )
    monkeypatch.setattr(search_module, "_search_catalog", AsyncMock(return_value=partial))
    monkeypatch.setattr(search_module, "_extract_from_claude", AsyncMock(return_value={}))

    tavily_client_factory = MagicMock()
    monkeypatch.setattr(search_module, "TavilyClient", tavily_client_factory)

    result = asyncio.run(search_module.cascade_search("Some Fund", object()))

    assert result is not None
    assert result.name == "Some Fund"
    assert result.commission == ""
    tavily_client_factory.assert_not_called()

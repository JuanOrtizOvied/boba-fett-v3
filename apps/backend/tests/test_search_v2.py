"""Unit tests for the ficha-patrimonial V2 enrichment cascade
(`agent.search.cascade_search_v2`). The V2 cascade swaps L1 to the normalized
catalog and must NEVER auto-fill commercial fields (commission, administrator,
liquidity, return_rate) — those come from the admin's series/admin pick. The
flat-catalog chat cascade (`cascade_search`) must stay unchanged.
"""

from __future__ import annotations

import pytest

from agent import search as search_mod
from db.catalog_normalized import (
    CatalogProductRow,
    CatalogProductSeries,
    CatalogProductSeriesAdmin,
)
from db.models import AssetAllocation

pytestmark = pytest.mark.asyncio


def _canned_product() -> CatalogProductRow:
    return CatalogProductRow(
        id=1,
        code="BD-00001",
        name="Latam Credit Opportunities Fund",
        manager="Acme Manager",
        currency="USD",
        asset_class=[AssetAllocation(name="mercados_privados", percentage=100)],
        geographic_focus=[AssetAllocation(name="LatAm", percentage=100)],
        underlying=[AssetAllocation(name="Private Debt", percentage=100)],
        series=[
            CatalogProductSeries(
                id=10,
                product_code="BD-00001",
                series="A",
                management_fee_ter=0.0384,
                return_min=0.05,
                return_max=0.08,
                administrators=[
                    CatalogProductSeriesAdmin(
                        id=100,
                        product_code="BD-00001",
                        series="A",
                        administrator="Admin Co",
                        custody_fee=0.001,
                        billing_currency="USD",
                    )
                ],
            )
        ],
    )


async def test_v2_fills_product_fields_and_attaches_series_options(monkeypatch):
    async def fake_search(self, query):
        return _canned_product()

    async def no_claude(query):
        return {}

    async def no_web(query):
        return {}, []

    monkeypatch.setattr(
        search_mod.NormalizedCatalogRepository, "search_for_enrichment", fake_search
    )
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", no_web)

    result = await search_mod.cascade_search_v2("latam credit opportunities", object())

    assert result is not None
    # Product-level fields filled from V2
    assert result.name == "Latam Credit Opportunities Fund"
    assert result.manager == "Acme Manager"
    assert result.currency == "USD"
    assert [a.name for a in result.asset_class] == ["mercados_privados"]
    assert result.catalog_product_code == "BD-00001"
    # Commercial fields NEVER auto-filled — admin picks series/admin
    assert result.commission == ""
    assert result.administrator == ""
    assert result.liquidity == ""
    assert result.return_rate == ""
    # Series options attached for the picker
    assert [s.series for s in result.series_options] == ["A"]
    assert result.series_options[0].management_fee_ter == pytest.approx(0.0384)
    assert [a.administrator for a in result.series_options[0].administrators] == ["Admin Co"]


async def test_v2_carries_catalog_signals(monkeypatch):
    """Slice 2: the V2 cascade surfaces ticker/ISIN, horizon, the match
    similarity, and a data-as-of date from the catalog product."""
    from datetime import datetime, timezone

    product = _canned_product()
    product.ticker_isin = "US12345"
    product.investment_horizon = "Largo plazo"
    product.created_at = datetime(2026, 1, 19, tzinfo=timezone.utc)
    product.match_similarity = 0.73

    async def fake_search(self, query):
        return product

    async def no_claude(query):
        return {}

    monkeypatch.setattr(
        search_mod.NormalizedCatalogRepository, "search_for_enrichment", fake_search
    )
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)

    result = await search_mod.cascade_search_v2("latam credit", object())

    assert result is not None
    assert result.ticker_isin == "US12345"
    assert result.investment_horizon == "Largo plazo"
    assert result.similarity == pytest.approx(0.73)
    assert result.data_asof == "2026-01-19"
    # Slice 2: a strong catalog match (0.73) is high confidence and "ya estaba en la BD".
    assert result.confidence == "alta"
    assert result.catalog_matched is True


async def test_classify_match_threshold_table():
    """Pure classification: confidence gated by similarity, catalog_matched only
    for a real catalog hit (sim >= 0.4). A weak match is NOT 'alta'."""
    classify = search_mod._classify_match
    assert classify(0.73, True) == ("alta", True)
    assert classify(0.60, True) == ("alta", True)
    assert classify(0.59, True) == ("media", True)
    assert classify(0.40, True) == ("media", True)
    assert classify(0.39, True) == ("baja", False)
    assert classify(0.136, True) == ("baja", False)  # the live-probe false positive
    assert classify(0.0, True) == ("baja", False)  # no catalog hit, but web/claude data
    assert classify(0.0, False) == ("sin_datos", False)


async def test_v2_never_fills_commercial_fields_from_claude(monkeypatch):
    """Even when L2 (Claude) returns commercial values, the V2 cascade must
    drop them — only product-level fields get gap-filled."""

    async def no_match(self, query):
        return None

    async def claude_with_commercial(query):
        return {
            "name": "Some Product",
            "manager": "Guessed Manager",
            "commission": "2% mgmt",
            "administrator": "Guessed Admin",
            "liquidity": "Daily",
            "return_rate": "9%",
        }

    monkeypatch.setattr(
        search_mod.NormalizedCatalogRepository, "search_for_enrichment", no_match
    )
    monkeypatch.setattr(search_mod, "_extract_from_claude", claude_with_commercial)

    result = await search_mod.cascade_search_v2("unknown product", object())

    assert result is not None
    assert result.name == "Some Product"
    assert result.manager == "Guessed Manager"
    # Commercial fields stay blank even though Claude returned them
    assert result.commission == ""
    assert result.administrator == ""
    assert result.liquidity == ""
    assert result.return_rate == ""
    assert result.series_options == []


async def test_v2_returns_none_when_no_data(monkeypatch):
    async def no_match(self, query):
        return None

    async def nothing(query):
        return {}

    monkeypatch.setattr(
        search_mod.NormalizedCatalogRepository, "search_for_enrichment", no_match
    )
    monkeypatch.setattr(search_mod, "_extract_from_claude", nothing)
    monkeypatch.setattr(search_mod, "_search_tavily", nothing)

    result = await search_mod.cascade_search_v2("nothing at all", object())
    assert result is None


async def test_v2_l3_uses_claude_web_not_tavily(monkeypatch):
    """The ficha cascade's L3 must use Claude web tools, never Tavily."""

    async def no_catalog(self, query):
        return None

    async def no_claude(query):
        return {}

    async def claude_web(query):
        return {"name": "Researched Fund", "manager": "Web Manager"}, []

    async def tavily_must_not_run(query):
        raise AssertionError("ficha L3 must not call Tavily")

    monkeypatch.setattr(
        search_mod.NormalizedCatalogRepository, "search_for_enrichment", no_catalog
    )
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)
    monkeypatch.setattr(search_mod, "_search_tavily", tavily_must_not_run)

    result = await search_mod.cascade_search_v2("some unknown fund", object())

    assert result is not None
    assert result.name == "Researched Fund"
    assert result.manager == "Web Manager"


async def test_search_claude_web_degrades_without_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert await search_mod._search_claude_web("anything") == ({}, [])


async def test_search_claude_web_extracts_from_research_text(monkeypatch):
    from db.models import Source

    source = Source(url="https://x.com/doc", title="Doc")

    async def fake_research(query):
        return "Acme Fund is a USD fixed-income fund managed by Acme.", [source]

    async def fake_extract(prompt):
        assert "Acme Fund" in prompt
        return {"name": "Acme Fund", "currency": "USD"}

    monkeypatch.setattr(search_mod, "_research_with_claude_web", fake_research)
    monkeypatch.setattr(search_mod, "_run_extraction", fake_extract)

    fields, sources = await search_mod._search_claude_web("acme fund")
    assert fields == {"name": "Acme Fund", "currency": "USD"}
    assert sources == [source]


async def test_search_claude_web_empty_when_no_research(monkeypatch):
    async def no_research(query):
        return "", []

    monkeypatch.setattr(search_mod, "_research_with_claude_web", no_research)
    assert await search_mod._search_claude_web("acme fund") == ({}, [])


def _complete_result(similarity: float):
    from db.models import SearchResult

    return SearchResult(
        name="Fondo X",
        currency="USD",
        manager="Gestor",
        asset_class=[AssetAllocation(name="mercados_publicos", percentage=100)],
        geographic_focus=[AssetAllocation(name="Perú", percentage=100)],
        underlying=[AssetAllocation(name="Acciones", percentage=100)],
        catalog_product_code="BD-00001",
        similarity=similarity,
    )


async def test_v2_low_confidence_catalog_triggers_web_search(monkeypatch):
    """A weak catalog match (low similarity -> 'baja') must trigger the Claude
    web search even when the product fields are already complete."""
    from db.models import Source

    async def weak_catalog(query, pool):
        return _complete_result(0.3)

    called = {"web": False}

    async def claude_web(query):
        called["web"] = True
        return {}, [Source(url="https://x.com", title="X")]

    monkeypatch.setattr(search_mod, "_search_catalog_v2", weak_catalog)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert called["web"] is True
    assert result is not None
    assert result.sources == [Source(url="https://x.com", title="X")]
    # Web verification (cited sources) raises a weak catalog match to "media".
    assert result.confidence == "media"


async def test_v2_low_confidence_catalog_without_web_sources_stays_baja(monkeypatch):
    """A weak catalog match whose web step finds no sources stays 'baja'."""

    async def weak_catalog(query, pool):
        return _complete_result(0.3)

    async def web_no_sources(query):
        return {}, []

    monkeypatch.setattr(search_mod, "_search_catalog_v2", weak_catalog)
    monkeypatch.setattr(search_mod, "_search_claude_web", web_no_sources)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert result is not None
    assert result.confidence == "baja"


async def test_v2_strong_catalog_match_skips_web_search(monkeypatch):
    """A strong, complete catalog match must NOT trigger the web search."""

    async def strong_catalog(query, pool):
        return _complete_result(0.85)

    async def web_must_not_run(query):
        raise AssertionError("web search must not run for a strong catalog match")

    monkeypatch.setattr(search_mod, "_search_catalog_v2", strong_catalog)
    monkeypatch.setattr(search_mod, "_search_claude_web", web_must_not_run)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert result is not None
    assert result.confidence == "alta"


async def test_v2_mid_similarity_below_threshold_triggers_web_search(monkeypatch):
    """A complete catalog match whose similarity is under the 0.55 web-search
    threshold (but above the 0.4 'media' boundary) must still trigger the web
    search."""
    from db.models import Source

    async def mid_catalog(query, pool):
        return _complete_result(0.5)

    called = {"web": False}

    async def claude_web(query):
        called["web"] = True
        return {}, [Source(url="https://x.com", title="X")]

    monkeypatch.setattr(search_mod, "_search_catalog_v2", mid_catalog)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert called["web"] is True
    assert result is not None
    assert result.sources == [Source(url="https://x.com", title="X")]


async def test_v2_similarity_at_or_above_threshold_skips_web_search(monkeypatch):
    """A complete catalog match at or above the 0.55 threshold skips the web
    search."""

    async def strong_catalog(query, pool):
        return _complete_result(0.6)

    async def web_must_not_run(query):
        raise AssertionError("web search must not run at/above the 0.55 threshold")

    monkeypatch.setattr(search_mod, "_search_catalog_v2", strong_catalog)
    monkeypatch.setattr(search_mod, "_search_claude_web", web_must_not_run)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert result is not None


async def test_research_web_v2_fills_fields_and_sources(monkeypatch):
    from db.models import Source

    source = Source(url="https://x.com/doc", title="Doc")

    async def fake_web(query):
        return {"name": "Researched Fund", "manager": "Web Manager"}, [source]

    monkeypatch.setattr(search_mod, "_search_claude_web", fake_web)

    result = await search_mod.research_web_v2("credicorp crecimiento")

    assert result is not None
    assert result.name == "Researched Fund"
    assert result.manager == "Web Manager"
    assert result.sources == [source]
    assert result.primary_source == "web_search"
    # Cited web sources verify the product → "media" (not a weak "baja").
    assert result.confidence == "media"
    assert result.catalog_matched is False


async def test_research_web_v2_sin_datos_when_nothing_found(monkeypatch):
    async def fake_web(query):
        return {}, []

    monkeypatch.setattr(search_mod, "_search_claude_web", fake_web)

    result = await search_mod.research_web_v2("unknown")

    assert result.confidence == "sin_datos"
    assert result.sources == []
    assert result.field_confidence == {}


async def test_research_web_v2_surfaces_self_reported_field_confidence(monkeypatch):
    """The web extraction's self-reported per-field confidence is surfaced on the
    result — clamped to 0..100, and kept only for fields actually populated."""

    async def fake_web(query):
        return (
            {
                "name": "Researched Fund",
                "manager": "Web Manager",
                "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
                "field_confidence": {
                    "name": 92,
                    "manager": 150,  # out of range -> clamped to 100
                    "asset_class": 60,
                    "currency": 50,  # field not populated -> dropped
                    "bogus": 40,  # not a real field -> dropped
                },
            },
            [],
        )

    monkeypatch.setattr(search_mod, "_search_claude_web", fake_web)

    result = await search_mod.research_web_v2("x")

    assert result.field_confidence == {"name": 92, "manager": 100, "asset_class": 60}


async def test_research_web_v2_field_confidence_empty_without_scores(monkeypatch):
    async def fake_web(query):
        return {"name": "Researched Fund"}, []

    monkeypatch.setattr(search_mod, "_search_claude_web", fake_web)

    result = await search_mod.research_web_v2("x")

    assert result.field_confidence == {}


def test_extract_sources_dedupes_by_url():
    class _Resp:
        content_blocks = [
            {
                "type": "text",
                "text": "…",
                "annotations": [
                    {"type": "citation", "url": "https://a.com", "title": "A"},
                    {"type": "citation", "url": "https://a.com", "title": "A dup"},
                    {"type": "citation", "url": "https://b.com", "title": "B"},
                    {"type": "citation", "title": "no url"},
                ],
            }
        ]

    sources = search_mod._extract_sources(_Resp())
    assert [s.url for s in sources] == ["https://a.com", "https://b.com"]
    assert sources[0].title == "A"


async def test_v2_captures_web_sources(monkeypatch):
    from db.models import Source

    async def no_catalog(self, query):
        return None

    async def no_claude(query):
        return {}

    async def claude_web(query):
        return {"name": "Web Fund"}, [Source(url="https://src", title="Src")]

    monkeypatch.setattr(
        search_mod.NormalizedCatalogRepository, "search_for_enrichment", no_catalog
    )
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)

    result = await search_mod.cascade_search_v2("web fund", object())
    assert result is not None
    assert [s.url for s in result.sources] == ["https://src"]


async def test_v1_cascade_still_fills_commercial_fields(monkeypatch):
    """Regression guard: the flat-catalog chat cascade (`cascade_search`) must
    STILL merge commercial fields from Claude (unchanged by the V2 work)."""

    async def empty_catalog(query, pool):
        from db.models import SearchResult

        return SearchResult()

    async def claude_commercial(query):
        return {
            "name": "Chat Product",
            "commission": "1.5% mgmt",
            "administrator": "Chat Admin",
            "liquidity": "Monthly",
            "return_rate": "7%",
        }

    monkeypatch.setattr(search_mod, "_search_catalog", empty_catalog)
    monkeypatch.setattr(search_mod, "_extract_from_claude", claude_commercial)

    result = await search_mod.cascade_search("chat product", object())

    assert result is not None
    assert result.commission == "1.5% mgmt"
    assert result.administrator == "Chat Admin"
    assert result.liquidity == "Monthly"
    assert result.return_rate == "7%"

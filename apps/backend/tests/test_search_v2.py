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
        # A real (strong) fuzzy match: above the 0.4 'matched' floor, so the
        # catalog identity is kept (not stripped by _strip_unconfident_catalog_match).
        match_similarity=0.73,
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


async def test_v2_weak_match_strips_catalog_identity(monkeypatch):
    """A fuzzy catalog hit too weak to be accepted (`catalog_matched` False) must
    NOT be presented as a specific catalog product: its code, series_options and
    catalog-only signals are dropped so the card shows no confident match and the
    admin uses the catalog picker. Product-level field hints are kept."""
    from db.models import CatalogSeriesOption, SearchResult

    weak = SearchResult(
        name="FM Real Estate & Infrastructure",
        currency="USD",
        catalog_product_code="BD-00099",
        series_options=[CatalogSeriesOption(series="A")],
        ticker_isin="US9",
        investment_horizon="Largo plazo",
        data_asof="2026-01-01",
        similarity=0.136,  # the live-probe false positive
    )

    async def weak_catalog(query, pool):
        return weak

    async def no_claude(query):
        return {}

    async def web_no_sources(query):
        return {}, []

    monkeypatch.setattr(search_mod, "_search_catalog_v2", weak_catalog)
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", web_no_sources)

    result = await search_mod.cascade_search_v2("kkr infra", object())

    assert result is not None
    assert result.catalog_matched is False
    assert result.confidence == "baja"
    # The weak/wrong product is no longer attached as a specific catalog product.
    assert result.catalog_product_code == ""
    assert result.series_options == []
    assert result.ticker_isin == ""
    assert result.investment_horizon == ""
    assert result.data_asof == ""
    assert result.similarity == 0.0
    # Field hints are preserved for the admin to see.
    assert result.name == "FM Real Estate & Infrastructure"


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

    async def fake_extract(prompt, *, system_prompt=None):
        assert "Acme Fund" in prompt
        # The ficha web research classifies with the ficha taxonomy prompt.
        assert system_prompt is search_mod._FICHA_EXTRACTION_SYSTEM_PROMPT
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


async def test_research_web_v2_suggests_series_with_administrators(monkeypatch):
    """The web research suggests series (with their administrators and numeric
    commercial values) into `series_options`, each carrying a self-reported
    confidence that marks it as a web suggestion (catalog series carry none)."""

    async def fake_web(query):
        return (
            {
                "name": "Researched Fund",
                "series": [
                    {
                        "series": "A",
                        "management_fee_ter": 0.0384,
                        "flows_min": None,
                        "flows_max": None,
                        "return_min": 0.05,
                        "return_max": 0.08,
                        "confidence": 70,
                        "administrators": [
                            {
                                "administrator": "Admin Co",
                                "custody_fee": 0.001,
                                "buy_commission": None,
                                "sell_commission": None,
                                "billing_currency": "USD",
                                "minimum_usd": 50000,
                                "min_commission_usd": None,
                                "confidence": 60,
                            }
                        ],
                    }
                ],
            },
            [],
        )

    monkeypatch.setattr(search_mod, "_search_claude_web", fake_web)

    result = await search_mod.research_web_v2("x")

    assert [s.series for s in result.series_options] == ["A"]
    series = result.series_options[0]
    assert series.management_fee_ter == pytest.approx(0.0384)
    assert series.return_min == pytest.approx(0.05)
    assert series.return_max == pytest.approx(0.08)
    # Confidence present -> marked as a web suggestion.
    assert series.confidence == 70
    assert [a.administrator for a in series.administrators] == ["Admin Co"]
    admin = series.administrators[0]
    assert admin.custody_fee == pytest.approx(0.001)
    assert admin.minimum_usd == pytest.approx(50000)
    assert admin.billing_currency == "USD"
    assert admin.confidence == 60


async def test_research_web_v2_no_series_when_web_returns_none(monkeypatch):
    async def fake_web(query):
        return {"name": "Researched Fund"}, []

    monkeypatch.setattr(search_mod, "_search_claude_web", fake_web)

    result = await search_mod.research_web_v2("x")

    assert result.series_options == []


async def test_research_web_v2_series_confidence_clamped_and_defaulted(monkeypatch):
    """Series/admin confidence is clamped to 0..100; a series the model returns
    without a confidence still becomes a suggestion (confidence defaults to 0,
    i.e. 'present but unsure'), never None (None is reserved for catalog)."""

    async def fake_web(query):
        return (
            {
                "name": "Researched Fund",
                "series": [
                    {
                        "series": "B",
                        "confidence": 150,  # out of range -> clamped to 100
                        "administrators": [{"administrator": "A1"}],  # no confidence
                    }
                ],
            },
            [],
        )

    monkeypatch.setattr(search_mod, "_search_claude_web", fake_web)

    result = await search_mod.research_web_v2("x")

    series = result.series_options[0]
    assert series.confidence == 100
    assert series.administrators[0].confidence == 0


def test_extracted_product_tolerates_unparseable_series_numbers():
    """A small model often returns fees as unit-laden strings ('3.84%'). The
    extraction schema must NOT reject the whole payload over them — the series
    label survives and the bad numeric is dropped, not fatal."""
    ep = search_mod.ExtractedProduct(
        name="Some Fund",
        series=[
            {
                "series": "A",
                "management_fee_ter": "3.84%",
                "return_min": "5%",
                "confidence": "high",  # non-numeric confidence must not blow up
                "administrators": [{"administrator": "Admin Co", "custody_fee": "0.1%"}],
            }
        ],
    )
    assert ep.series[0].series == "A"


def test_suggested_series_options_coerces_bad_numbers_to_null():
    """`_suggested_series_options` never raises on unit/symbol-laden numbers: a
    value that is not a clean number becomes None (admin fills it); the series
    label and administrators are preserved."""
    opts = search_mod._suggested_series_options(
        {
            "series": [
                {
                    "series": "A",
                    "management_fee_ter": "3.84%",
                    "return_min": "5%",
                    "minimum_usd": "50,000",
                    "confidence": 70,
                    "administrators": [
                        {"administrator": "Admin Co", "custody_fee": "0.1%", "confidence": 60}
                    ],
                }
            ]
        }
    )
    assert [s.series for s in opts] == ["A"]
    assert opts[0].management_fee_ter is None
    assert opts[0].return_min is None
    assert opts[0].confidence == 70
    assert [a.administrator for a in opts[0].administrators] == ["Admin Co"]
    assert opts[0].administrators[0].custody_fee is None
    assert opts[0].administrators[0].confidence == 60


def test_suggested_series_options_keeps_clean_numbers():
    opts = search_mod._suggested_series_options(
        {"series": [{"series": "A", "management_fee_ter": "0.0384", "confidence": 70}]}
    )
    assert opts[0].management_fee_ter == pytest.approx(0.0384)


async def test_research_web_v2_survives_messy_series_numbers(monkeypatch):
    """The research endpoint must not 500 when the model reports series numbers
    as unit-laden strings — it degrades them to null and still returns."""

    async def fake_web(query):
        return (
            {
                "name": "Researched Fund",
                "series": [
                    {
                        "series": "A",
                        "management_fee_ter": "3.84%",
                        "confidence": 65,
                        "administrators": [{"administrator": "Admin Co", "custody_fee": "0.1%"}],
                    }
                ],
            },
            [],
        )

    monkeypatch.setattr(search_mod, "_search_claude_web", fake_web)

    result = await search_mod.research_web_v2("x")

    assert [s.series for s in result.series_options] == ["A"]
    assert result.series_options[0].management_fee_ter is None


async def test_search_claude_web_degrades_when_extraction_raises(monkeypatch):
    """`_search_claude_web` honors its 'never raises' contract: if the structured
    extraction blows up, it returns ({}, sources) (sources-only) instead of
    propagating a 500."""
    from db.models import Source

    async def fake_research(query):
        return "some web context", [Source(url="https://x.com", title="X")]

    async def boom(human_content, *, system_prompt=None):
        raise ValueError("structured output blew up")

    monkeypatch.setattr(search_mod, "_research_with_claude_web", fake_research)
    monkeypatch.setattr(search_mod, "_run_extraction", boom)

    fields, sources = await search_mod._search_claude_web("x")

    assert fields == {}
    assert [s.url for s in sources] == ["https://x.com"]


def _incomplete_catalog_result():
    """A catalog hit missing `manager` (a gap L3 web can fill), with provenance
    recorded for the fields the catalog DID fill. Similarity 0.5 keeps the catalog
    identity (>0.4) while still triggering the web step (<0.55)."""
    from db.models import SearchResult

    return SearchResult(
        name="Fondo X",
        currency="USD",
        asset_class=[AssetAllocation(name="mercados_publicos", percentage=100)],
        geographic_focus=[AssetAllocation(name="Perú", percentage=100)],
        underlying=[AssetAllocation(name="Acciones", percentage=100)],
        catalog_product_code="BD-00001",
        similarity=0.5,
        primary_source="catalog",
        provenance={
            "name": "catalog",
            "currency": "catalog",
            "asset_class": "catalog",
            "geographic_focus": "catalog",
            "underlying": "catalog",
        },
    )


async def test_v2_populates_field_confidence_for_web_filled_gap(monkeypatch):
    """When L3 web fills a gap the catalog left empty, its self-reported per-field
    confidence is surfaced on the result for that field (so the card can show a %
    on the web-sourced field)."""
    from db.models import Source

    async def catalog(query, pool):
        return _incomplete_catalog_result()

    async def no_claude(query):
        return {}

    async def claude_web(query):
        return (
            {"manager": "Web Manager", "field_confidence": {"manager": 77}},
            [Source(url="https://x.com", title="X")],
        )

    monkeypatch.setattr(search_mod, "_search_catalog_v2", catalog)
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert result is not None
    assert result.manager == "Web Manager"
    assert result.provenance["manager"] == "web_search"
    assert result.field_confidence == {"manager": 77}


async def test_v2_field_confidence_excludes_catalog_sourced_fields(monkeypatch):
    """A web score reported for a field the CATALOG already owns must be dropped:
    the per-field % only marks fields whose value actually came from the web, and
    the catalog value is never overwritten."""
    from db.models import Source

    async def catalog(query, pool):
        return _incomplete_catalog_result()

    async def no_claude(query):
        return {}

    async def claude_web(query):
        return (
            {
                "manager": "Web Manager",
                "name": "Should Not Overwrite",
                "field_confidence": {"manager": 80, "name": 95},
            },
            [Source(url="https://x.com", title="X")],
        )

    monkeypatch.setattr(search_mod, "_search_catalog_v2", catalog)
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert result is not None
    assert result.name == "Fondo X"
    assert result.provenance["name"] == "catalog"
    assert result.field_confidence == {"manager": 80}


async def test_v2_field_confidence_empty_when_web_fills_nothing(monkeypatch):
    """A weak catalog match whose web step returns only sources (no field data)
    leaves field_confidence empty — nothing on the card came from the web."""
    from db.models import Source

    async def catalog(query, pool):
        return _incomplete_catalog_result()

    async def no_claude(query):
        return {}

    async def claude_web(query):
        return {}, [Source(url="https://x.com", title="X")]

    monkeypatch.setattr(search_mod, "_search_catalog_v2", catalog)
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert result is not None
    assert result.field_confidence == {}


async def test_v2_web_suggests_series_when_catalog_has_none(monkeypatch):
    """Parse-time cascade: when the catalog match carries no series, the L3 web
    step suggests series (with administrators + confidence) into series_options."""
    from db.models import Source

    async def catalog(query, pool):
        return _incomplete_catalog_result()  # has no series_options

    async def no_claude(query):
        return {}

    async def claude_web(query):
        return (
            {
                "manager": "Web Manager",
                "series": [
                    {
                        "series": "A",
                        "management_fee_ter": 0.02,
                        "confidence": 65,
                        "administrators": [
                            {"administrator": "Admin Co", "confidence": 50}
                        ],
                    }
                ],
            },
            [Source(url="https://x.com", title="X")],
        )

    monkeypatch.setattr(search_mod, "_search_catalog_v2", catalog)
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert result is not None
    assert [s.series for s in result.series_options] == ["A"]
    assert result.series_options[0].confidence == 65
    assert result.series_options[0].management_fee_ter == pytest.approx(0.02)
    assert [a.administrator for a in result.series_options[0].administrators] == ["Admin Co"]
    assert result.series_options[0].administrators[0].confidence == 50


async def test_v2_web_series_never_overwrites_catalog_series(monkeypatch):
    """The catalog is authoritative: when the matched product already carries its
    own series, the web suggestion is ignored (catalog series kept, no confidence)."""
    from db.models import CatalogSeriesAdminOption, CatalogSeriesOption, Source

    def catalog_with_series():
        r = _incomplete_catalog_result()
        r.series_options = [
            CatalogSeriesOption(
                series="Cat-A",
                management_fee_ter=0.01,
                administrators=[CatalogSeriesAdminOption(administrator="Cat Admin")],
            )
        ]
        return r

    async def catalog(query, pool):
        return catalog_with_series()

    async def no_claude(query):
        return {}

    async def claude_web(query):
        return (
            {"series": [{"series": "Web-X", "confidence": 90, "administrators": []}]},
            [Source(url="https://x.com", title="X")],
        )

    monkeypatch.setattr(search_mod, "_search_catalog_v2", catalog)
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)
    monkeypatch.setattr(search_mod, "_search_claude_web", claude_web)

    result = await search_mod.cascade_search_v2("fondo x", object())

    assert result is not None
    # Catalog series kept; the web suggestion did NOT overwrite them.
    assert [s.series for s in result.series_options] == ["Cat-A"]
    # Catalog series carry no confidence (None) — not a web suggestion.
    assert result.series_options[0].confidence is None


def test_ficha_extraction_prompt_uses_the_ficha_asset_class_taxonomy():
    """The ficha web research must classify asset_class into the ficha select's
    taxonomy, not the portfolio one, so the review select auto-populates."""
    ficha = search_mod._FICHA_EXTRACTION_SYSTEM_PROMPT
    assert "Mercados Publicos - Fijo" in ficha
    assert "Mercados Publicos - Variable" in ficha
    assert "Inmobiliario Directo" in ficha
    assert "Commodities y Criptos" in ficha
    assert "inversiones_directas" not in ficha
    # The default (chat/portfolio) prompt keeps the portfolio taxonomy.
    assert "inversiones_directas" in search_mod._EXTRACTION_SYSTEM_PROMPT


async def test_search_claude_web_uses_the_ficha_taxonomy_prompt(monkeypatch):
    captured: dict[str, str] = {}

    async def fake_research(query):
        return "some web research text", []

    async def fake_extract(human_content, *, system_prompt=search_mod._EXTRACTION_SYSTEM_PROMPT):
        captured["system_prompt"] = system_prompt
        return {"name": "X"}

    monkeypatch.setattr(search_mod, "_research_with_claude_web", fake_research)
    monkeypatch.setattr(search_mod, "_run_extraction", fake_extract)

    await search_mod._search_claude_web("gold etf")

    assert captured["system_prompt"] is search_mod._FICHA_EXTRACTION_SYSTEM_PROMPT


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

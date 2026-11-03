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

    monkeypatch.setattr(
        search_mod.NormalizedCatalogRepository, "search_for_enrichment", fake_search
    )
    monkeypatch.setattr(search_mod, "_extract_from_claude", no_claude)

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

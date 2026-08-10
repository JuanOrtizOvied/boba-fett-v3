"""Tests for portfolio tool metadata/schemas (`agent.tools`).

These tests intentionally do NOT exercise the actual DB calls (no Postgres in
unit tests) — they verify the LangChain tool wiring: names, descriptions,
and parameter schemas that the LLM sees. `config: RunnableConfig` is an
injected argument LangChain hides from the LLM-facing schema, so it must
never appear in `.args`.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock


def test_portfolio_tools_exports_eight_tools():
    from agent.tools import portfolio_tools

    assert len(portfolio_tools) == 8
    names = {t.name for t in portfolio_tools}
    assert names == {
        "search_product",
        "propose_product",
        "add_product",
        "update_product",
        "delete_product",
        "get_portfolio_summary",
        "analyze_portfolio_drift",
        "create_snapshot",
    }


def test_add_product_schema():
    from agent.tools import add_product

    assert add_product.name == "add_product"
    assert add_product.description
    args = add_product.args
    assert "name" in args
    assert "amount" in args
    assert "asset_class" in args
    assert "provider" in args
    assert "underlying" in args
    assert "catalog_product_id" in args
    # `config` is an injected RunnableConfig — must not leak into the LLM schema
    assert "config" not in args


def test_update_product_schema():
    from agent.tools import update_product

    assert update_product.name == "update_product"
    assert update_product.description
    args = update_product.args
    assert "product_id" in args
    assert "name" in args
    assert "provider" in args
    assert "amount" in args
    assert "asset_class" in args
    assert "underlying" in args
    assert "config" not in args


def test_delete_product_schema():
    from agent.tools import delete_product

    assert delete_product.name == "delete_product"
    assert delete_product.description
    args = delete_product.args
    assert "product_id" in args
    assert "config" not in args


def test_get_portfolio_summary_schema():
    from agent.tools import get_portfolio_summary

    assert get_portfolio_summary.name == "get_portfolio_summary"
    assert get_portfolio_summary.description
    args = get_portfolio_summary.args
    assert "config" not in args


def test_create_snapshot_schema():
    from agent.tools import create_snapshot

    assert create_snapshot.name == "create_snapshot"
    assert create_snapshot.description
    args = create_snapshot.args
    assert "name" in args
    assert "description" in args
    assert args["description"].get("default") == ""
    assert "config" not in args


def test_user_id_helper_requires_configurable_user_id():
    """agent/agent.spec.md delta — 'Portfolio Identity Resolution': tools
    resolve identity from `configurable.user_id` (JWT subject), not a
    client-supplied `portfolio_id`."""
    import pytest

    from agent.tools import _user_id

    with pytest.raises(ValueError):
        _user_id({"configurable": {}})

    with pytest.raises(ValueError):
        _user_id({})

    assert _user_id({"configurable": {"user_id": "usr_abc"}}) == "usr_abc"


def test_to_allocations_helper_builds_asset_allocations():
    from agent.tools import _to_allocations
    from db.models import AssetAllocation

    result = _to_allocations([{"name": "Cripto", "percentage": 100}])

    assert len(result) == 1
    assert isinstance(result[0], AssetAllocation)
    assert result[0].name == "Cripto"
    assert result[0].percentage == 100


# --- search_product (cascading search tool) --------------------------------


def test_search_product_schema():
    from agent.tools import search_product

    assert search_product.name == "search_product"
    assert search_product.description
    args = search_product.args
    assert "query" in args
    assert "config" not in args


def test_search_product_calls_cascade_search_and_returns_result(monkeypatch):
    import agent.tools as tools_module
    from db.models import SearchResult

    fake_pool = object()
    get_pool_mock = AsyncMock(return_value=fake_pool)
    found = SearchResult(name="Vanguard Total World Stock ETF", provenance={"name": "catalog"})
    cascade_mock = AsyncMock(return_value=found)

    monkeypatch.setattr(tools_module, "get_pool", get_pool_mock)
    monkeypatch.setattr(tools_module, "cascade_search", cascade_mock)

    result = asyncio.run(tools_module.search_product.ainvoke({"query": "vanguard"}))

    get_pool_mock.assert_awaited_once()
    cascade_mock.assert_awaited_once_with("vanguard", fake_pool)
    assert result["status"] == "found"
    assert result["query"] == "vanguard"
    assert result["result"]["name"] == "Vanguard Total World Stock ETF"
    assert result["result"]["provenance"] == {"name": "catalog"}


def test_search_product_returns_not_found_when_cascade_finds_nothing(monkeypatch):
    import agent.tools as tools_module

    monkeypatch.setattr(tools_module, "get_pool", AsyncMock(return_value=object()))
    monkeypatch.setattr(tools_module, "cascade_search", AsyncMock(return_value=None))

    result = asyncio.run(tools_module.search_product.ainvoke({"query": "Unknown Product XYZ"}))

    assert result == {"status": "not_found", "query": "Unknown Product XYZ"}


# --- propose_product enrichment / provenance / reliability tag -------------


def test_propose_product_schema_exposes_enrichment_fields():
    from agent.tools import propose_product

    assert propose_product.name == "propose_product"
    args = propose_product.args
    for field in (
        "name",
        "amount",
        "asset_class",
        "provider",
        "underlying",
        "currency",
        "commission",
        "administrator",
        "manager",
        "liquidity",
        "return_rate",
        "geographic_focus",
        "catalog_product_id",
        "primary_source",
        "provenance",
    ):
        assert field in args, f"missing arg: {field}"
    assert "config" not in args


def test_propose_product_forwards_enrichment_and_provenance():
    from agent.tools import propose_product

    result = asyncio.run(
        propose_product.ainvoke(
            {
                "name": "BlackRock Global Bond Fund",
                "amount": 5000,
                "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
                "commission": "0.45%",
                "administrator": "BlackRock",
                "catalog_product_id": 42,
                "primary_source": "web_search",
                "provenance": {"name": "catalog", "commission": "web_search"},
            }
        )
    )

    product = result["product"]
    assert result["status"] == "proposed"
    assert product["commission"] == "0.45%"
    assert product["administrator"] == "BlackRock"
    assert product["catalog_product_id"] == 42
    assert product["primary_source"] == "web_search"
    assert product["provenance"] == {"name": "catalog", "commission": "web_search"}
    # currency, liquidity, etc. left empty rather than invented (never-invent guardrail)
    assert product["currency"] == ""
    assert product["liquidity"] == ""


def test_propose_product_tag_verified_when_all_fields_are_catalog():
    from agent.tools import propose_product

    result = asyncio.run(
        propose_product.ainvoke(
            {
                "name": "Vanguard Total World Stock ETF",
                "amount": 1000,
                "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
                "provenance": {"name": "catalog", "commission": "catalog"},
            }
        )
    )

    assert result["product"]["reliability_tag"] == "verified"


def test_propose_product_tag_verified_when_identity_is_catalog_even_with_enrichment():
    from agent.tools import propose_product

    result = asyncio.run(
        propose_product.ainvoke(
            {
                "name": "BlackRock Global Bond Fund",
                "amount": 1000,
                "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
                "provenance": {"name": "catalog", "liquidity": "web_search"},
            }
        )
    )

    assert result["product"]["reliability_tag"] == "verified"


def test_propose_product_tag_web_when_identity_is_not_catalog_and_web_contributed():
    from agent.tools import propose_product

    result = asyncio.run(
        propose_product.ainvoke(
            {
                "name": "BlackRock Global Bond Fund",
                "amount": 1000,
                "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
                "provenance": {"name": "claude_knowledge", "liquidity": "web_search"},
            }
        )
    )

    assert result["product"]["reliability_tag"] == "web"


def test_propose_product_tag_unverified_when_no_catalog_or_web_source():
    from agent.tools import propose_product

    result = asyncio.run(
        propose_product.ainvoke(
            {
                "name": "Unknown Widget Corp",
                "amount": 1000,
                "asset_class": [{"name": "otros", "percentage": 100}],
                "provenance": {"name": "claude_knowledge"},
            }
        )
    )

    assert result["product"]["reliability_tag"] == "unverified"


def test_propose_product_tag_unverified_when_provenance_empty():
    from agent.tools import propose_product

    result = asyncio.run(
        propose_product.ainvoke(
            {
                "name": "Unknown Widget Corp",
                "amount": 1000,
                "asset_class": [{"name": "otros", "percentage": 100}],
            }
        )
    )

    assert result["product"]["reliability_tag"] == "unverified"
    assert result["product"]["provenance"] == {}


def test_propose_product_normalizes_legacy_key_to_new_key():
    from agent.tools import propose_product

    result = asyncio.run(
        propose_product.ainvoke(
            {
                "name": "Fondo XYZ",
                "amount": 1000,
                "asset_class": [{"name": "mercados_privados", "percentage": 100}],
            }
        )
    )

    assert result["product"]["asset_class"] == [{"name": "mercados_privados", "percentage": 100}]


def test_propose_product_normalizes_label_to_new_key():
    from agent.tools import propose_product

    result = asyncio.run(
        propose_product.ainvoke(
            {
                "name": "Fondo XYZ",
                "amount": 1000,
                "asset_class": [{"name": "Mercados Privados", "percentage": 100}],
            }
        )
    )

    assert result["product"]["asset_class"] == [{"name": "mercados_privados", "percentage": 100}]


def test_key_to_label_all_keys():
    from agent.tools import _KEY_TO_LABEL

    assert _KEY_TO_LABEL["inversiones_directas"] == "Inversiones directas"
    assert _KEY_TO_LABEL["mercados_privados"] == "Mercados privados"
    assert _KEY_TO_LABEL["club_deals"] == "Club deals"
    assert _KEY_TO_LABEL["mercados_publicos"] == "Mercados públicos"
    assert _KEY_TO_LABEL["otros"] == "Otros"
    assert _KEY_TO_LABEL["cash_y_equivalentes"] == "Cash y equivalentes"
    assert "unknown" not in _KEY_TO_LABEL


def test_derive_card_tag_directly():
    from agent.tools import _derive_card_tag

    assert _derive_card_tag({}) == "unverified"
    assert _derive_card_tag({"name": "catalog", "commission": "catalog"}) == "verified"
    assert _derive_card_tag({"name": "catalog", "commission": "web_search"}) == "verified"
    assert _derive_card_tag({"name": "catalog", "commission": "claude_knowledge"}) == "verified"
    assert _derive_card_tag({"name": "web_search"}) == "web"
    assert _derive_card_tag({"name": "claude_knowledge"}) == "unverified"


# --- analyze_portfolio_drift ------------------------------------------------


def test_analyze_portfolio_drift_schema():
    from agent.tools import analyze_portfolio_drift

    assert analyze_portfolio_drift.name == "analyze_portfolio_drift"
    assert analyze_portfolio_drift.description
    args = analyze_portfolio_drift.args
    assert "targets" in args
    assert "rebalancing_band" in args
    assert args["rebalancing_band"].get("default") == 5.0
    assert "config" not in args


def test_analyze_portfolio_drift_returns_drift_table(monkeypatch):
    import agent.tools as tools_module
    from db.models import AssetAllocation, Product

    products = [
        Product(
            id="prod_1",
            user_id="usr_1",
            name="Fund A",
            provider="Provider A",
            amount=70_000,
            underlying=[],
            asset_class=[AssetAllocation(name="mercados_publicos", percentage=100)],
        ),
        Product(
            id="prod_2",
            user_id="usr_1",
            name="Fund B",
            provider="Provider B",
            amount=30_000,
            underlying=[],
            asset_class=[AssetAllocation(name="mercados_privados", percentage=100)],
        ),
    ]

    fake_repo = AsyncMock()
    fake_repo.list_by_user = AsyncMock(return_value=products)
    monkeypatch.setattr(tools_module, "_repository", AsyncMock(return_value=fake_repo))

    result = asyncio.run(
        tools_module.analyze_portfolio_drift.ainvoke(
            {
                "targets": [
                    {"asset_class": "mercados_publicos", "percentage": 50},
                    {"asset_class": "mercados_privados", "percentage": 50},
                ],
            },
            config={"configurable": {"user_id": "usr_1"}},
        )
    )

    assert result["status"] == "analyzed"
    assert result["total_portfolio"] == 100_000
    assert result["out_of_band_count"] == 2

    drift_by_ac = {d["asset_class"]: d for d in result["drift_table"]}
    assert drift_by_ac["mercados_publicos"]["drift_pct"] == 20.0
    assert drift_by_ac["mercados_privados"]["drift_pct"] == -20.0

    assert len(result["suggestions"]) == 2
    actions = {s["asset_class"]: s["action"] for s in result["suggestions"]}
    assert actions["mercados_publicos"] == "reduce"
    assert actions["mercados_privados"] == "increase"


def test_analyze_portfolio_drift_empty_portfolio(monkeypatch):
    import agent.tools as tools_module

    fake_repo = AsyncMock()
    fake_repo.list_by_user = AsyncMock(return_value=[])
    monkeypatch.setattr(tools_module, "_repository", AsyncMock(return_value=fake_repo))

    result = asyncio.run(
        tools_module.analyze_portfolio_drift.ainvoke(
            {
                "targets": [
                    {"asset_class": "mercados_publicos", "percentage": 100},
                ],
            },
            config={"configurable": {"user_id": "usr_1"}},
        )
    )

    assert result["status"] == "empty"


def test_analyze_portfolio_drift_rejects_bad_targets(monkeypatch):
    import agent.tools as tools_module
    from db.models import AssetAllocation, Product

    products = [
        Product(
            id="prod_1",
            user_id="usr_1",
            name="Fund A",
            provider="",
            amount=10_000,
            underlying=[],
            asset_class=[AssetAllocation(name="otros", percentage=100)],
        ),
    ]

    fake_repo = AsyncMock()
    fake_repo.list_by_user = AsyncMock(return_value=products)
    monkeypatch.setattr(tools_module, "_repository", AsyncMock(return_value=fake_repo))

    result = asyncio.run(
        tools_module.analyze_portfolio_drift.ainvoke(
            {
                "targets": [
                    {"asset_class": "mercados_publicos", "percentage": 60},
                    {"asset_class": "mercados_privados", "percentage": 60},
                ],
            },
            config={"configurable": {"user_id": "usr_1"}},
        )
    )

    assert result["status"] == "error"
    assert "120" in result["message"]

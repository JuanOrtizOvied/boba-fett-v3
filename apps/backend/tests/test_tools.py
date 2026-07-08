"""Tests for portfolio tool metadata/schemas (`agent.tools`).

These tests intentionally do NOT exercise the actual DB calls (no Postgres in
unit tests) — they verify the LangChain tool wiring: names, descriptions,
and parameter schemas that the LLM sees. `config: RunnableConfig` is an
injected argument LangChain hides from the LLM-facing schema, so it must
never appear in `.args`.
"""

from __future__ import annotations


def test_portfolio_tools_exports_four_tools():
    from agent.tools import portfolio_tools

    assert len(portfolio_tools) == 4
    names = {t.name for t in portfolio_tools}
    assert names == {"add_product", "update_product", "delete_product", "get_portfolio_summary"}


def test_add_product_schema():
    from agent.tools import add_product

    assert add_product.name == "add_product"
    assert add_product.description
    args = add_product.args
    assert "name" in args
    assert "amount" in args
    assert "category" in args
    assert "provider" in args
    assert "composition" in args
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
    assert "category" in args
    assert "composition" in args
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


def test_to_composition_helper_builds_asset_allocations():
    from agent.tools import _to_composition
    from db.models import AssetAllocation

    result = _to_composition([{"name": "Cripto", "percentage": 100}])

    assert len(result) == 1
    assert isinstance(result[0], AssetAllocation)
    assert result[0].name == "Cripto"
    assert result[0].percentage == 100

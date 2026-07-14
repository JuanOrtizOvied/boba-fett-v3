"""Integration tests for portfolio agent tools (`agent.tools`) against real
Postgres. Tools are invoked directly via `.ainvoke()` with a crafted
`RunnableConfig` — the LLM and the LangGraph graph are never involved.

Spec: "Agent Tool CRUD Against Real Postgres" (`sdd/sabbi-test-suite/spec`).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agent.tools import add_product, delete_product, get_portfolio_summary, update_product

# ---------------------------------------------------------------------------
# add_product
# ---------------------------------------------------------------------------


async def test_add_product_persists_valid_product(patch_get_pool, tool_config, test_pool):
    result = await add_product.ainvoke(
        {"name": "BlackRock Fund", "amount": 1000, "category": "publicos"},
        config=tool_config,
    )

    assert result["status"] == "added"
    product_id = result["product"]["id"]
    row = await test_pool.fetchrow("SELECT * FROM products WHERE id = $1", product_id)
    assert row is not None
    assert row["name"] == "BlackRock Fund"
    assert float(row["amount"]) == 1000


async def test_add_product_rejects_non_positive_amount(patch_get_pool, tool_config, test_pool):
    """`db/schema.sql` enforces `amount > 0` via a CHECK constraint; the
    `ProductCreate` pydantic model (`Field(gt=0)`) rejects it even earlier,
    before any SQL is issued — either way, no row is ever inserted."""
    with pytest.raises(ValidationError):
        await add_product.ainvoke(
            {"name": "Bad Fund", "amount": 0, "category": "cash"}, config=tool_config
        )

    count = await test_pool.fetchval(
        "SELECT count(*) FROM products WHERE name = $1", "Bad Fund"
    )
    assert count == 0


# ---------------------------------------------------------------------------
# update_product
# ---------------------------------------------------------------------------


async def test_update_product_updates_existing_product(patch_get_pool, tool_config, test_pool):
    created = await add_product.ainvoke(
        {"name": "Fund A", "amount": 1000, "category": "cash"}, config=tool_config
    )
    product_id = created["product"]["id"]

    result = await update_product.ainvoke(
        {"product_id": product_id, "amount": 2500}, config=tool_config
    )

    assert result["status"] == "updated"
    assert result["product"]["amount"] == 2500
    row = await test_pool.fetchrow("SELECT amount FROM products WHERE id = $1", product_id)
    assert float(row["amount"]) == 2500


async def test_update_product_on_nonexistent_id_returns_error(patch_get_pool, tool_config):
    result = await update_product.ainvoke(
        {"product_id": "does_not_exist", "amount": 100}, config=tool_config
    )

    assert result["status"] == "error"
    assert "not found" in result["message"]


# ---------------------------------------------------------------------------
# delete_product
# ---------------------------------------------------------------------------


async def test_delete_product_removes_existing_row(patch_get_pool, tool_config, test_pool):
    created = await add_product.ainvoke(
        {"name": "Fund To Delete", "amount": 500, "category": "cash"}, config=tool_config
    )
    product_id = created["product"]["id"]

    result = await delete_product.ainvoke({"product_id": product_id}, config=tool_config)

    assert result == {"status": "deleted", "product_id": product_id}
    row = await test_pool.fetchrow("SELECT * FROM products WHERE id = $1", product_id)
    assert row is None


async def test_delete_product_on_nonexistent_id_returns_error(patch_get_pool, tool_config):
    result = await delete_product.ainvoke({"product_id": "does_not_exist"}, config=tool_config)

    assert result["status"] == "error"


# ---------------------------------------------------------------------------
# get_portfolio_summary
# ---------------------------------------------------------------------------


async def test_get_portfolio_summary_on_empty_portfolio(patch_get_pool, tool_config):
    result = await get_portfolio_summary.ainvoke({}, config=tool_config)

    assert result["total_amount"] == 0
    assert result["product_count"] == 0
    assert result["largest_position"] is None


async def test_get_portfolio_summary_on_populated_portfolio(patch_get_pool, tool_config):
    """3 products across 2 categories — totals, distribution, and the
    largest position are all computed live from Postgres."""
    await add_product.ainvoke(
        {"name": "Fund A", "amount": 7000, "category": "directas"}, config=tool_config
    )
    await add_product.ainvoke(
        {"name": "Fund B", "amount": 2000, "category": "cash"}, config=tool_config
    )
    await add_product.ainvoke(
        {"name": "Fund C", "amount": 1000, "category": "cash"}, config=tool_config
    )

    result = await get_portfolio_summary.ainvoke({}, config=tool_config)

    assert result["total_amount"] == 10000
    assert result["product_count"] == 3
    assert set(result["categories_used"]) == {"directas", "cash"}
    assert result["largest_position"]["name"] == "Fund A"
    assert result["largest_position"]["percentage"] == 70.0

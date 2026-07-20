"""Integration tests for portfolio agent tools (`agent.tools`) against real
Postgres. Tools are invoked directly via `.ainvoke()` with a crafted
`RunnableConfig` — the LLM and the LangGraph graph are never involved.

Spec: "Agent Tool CRUD Against Real Postgres" (`sdd/sabbi-test-suite/spec`).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from agent.tools import (
    add_product,
    create_snapshot,
    delete_product,
    get_portfolio_summary,
    update_product,
)

# ---------------------------------------------------------------------------
# add_product
# ---------------------------------------------------------------------------


async def test_add_product_persists_valid_product(patch_get_pool, tool_config, test_pool):
    result = await add_product.ainvoke(
        {"name": "BlackRock Fund", "amount": 1000, "category": "mercados_publicos"},
        config=tool_config,
    )

    assert result["status"] == "added"
    product_id = result["product"]["id"]
    row = await test_pool.fetchrow("SELECT * FROM products WHERE id = $1", product_id)
    assert row is not None
    assert row["name"] == "BlackRock Fund"
    assert float(row["amount"]) == 1000


async def test_add_product_persists_source_catalog_product_id(
    patch_get_pool, tool_config, test_pool
):
    result = await add_product.ainvoke(
        {
            "name": "Catalog Fund",
            "amount": 1000,
            "category": "mercados_publicos",
            "catalog_product_id": 123,
        },
        config=tool_config,
    )

    product_id = result["product"]["id"]
    row = await test_pool.fetchrow(
        "SELECT catalog_product_id FROM products WHERE id = $1", product_id
    )
    assert row["catalog_product_id"] == 123
    assert result["product"]["catalog_product_id"] == 123


async def test_add_product_logs_change_with_agent_source(
    patch_get_pool, tool_config, test_pool
):
    """AL-005 — agent tool calls are attributed with `source='agent'` and a
    `metadata.tool` marker so the audit trail can tell them apart from REST
    API and admin mutations (`tasks.md` T-012)."""
    result = await add_product.ainvoke(
        {"name": "Agent-Sourced Fund", "amount": 1000, "category": "mercados_publicos"},
        config=tool_config,
    )

    product_id = result["product"]["id"]
    row = await test_pool.fetchrow(
        "SELECT source, metadata FROM portfolio_changes WHERE product_id = $1", product_id
    )
    assert row is not None
    assert row["source"] == "agent"
    metadata = row["metadata"]
    if isinstance(metadata, str):
        import json

        metadata = json.loads(metadata)
    assert metadata == {"tool": "add_product"}


async def test_add_product_rejects_non_positive_amount(patch_get_pool, tool_config, test_pool):
    """`db/schema.sql` enforces `amount > 0` via a CHECK constraint; the
    `ProductCreate` pydantic model (`Field(gt=0)`) rejects it even earlier,
    before any SQL is issued — either way, no row is ever inserted."""
    with pytest.raises(ValidationError):
        await add_product.ainvoke(
            {"name": "Bad Fund", "amount": 0, "category": "cash_y_equivalentes"}, config=tool_config
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
        {"name": "Fund A", "amount": 1000, "category": "cash_y_equivalentes"}, config=tool_config
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
        {"name": "Fund To Delete", "amount": 500, "category": "cash_y_equivalentes"}, config=tool_config
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
        {"name": "Fund A", "amount": 7000, "category": "inversiones_directas"}, config=tool_config
    )
    await add_product.ainvoke(
        {"name": "Fund B", "amount": 2000, "category": "cash_y_equivalentes"}, config=tool_config
    )
    await add_product.ainvoke(
        {"name": "Fund C", "amount": 1000, "category": "cash_y_equivalentes"}, config=tool_config
    )

    result = await get_portfolio_summary.ainvoke({}, config=tool_config)

    assert result["total_amount"] == 10000
    assert result["product_count"] == 3
    assert set(result["categories_used"]) == {"inversiones_directas", "cash_y_equivalentes"}
    assert result["largest_position"]["name"] == "Fund A"
    assert result["largest_position"]["percentage"] == 70.0


# ---------------------------------------------------------------------------
# create_snapshot
# ---------------------------------------------------------------------------


async def test_create_snapshot_persists_row_for_calling_user(
    patch_get_pool, tool_config, test_pool, test_user_id
):
    await add_product.ainvoke(
        {"name": "Fund A", "amount": 1000, "category": "cash_y_equivalentes"}, config=tool_config
    )

    result = await create_snapshot.ainvoke(
        {"name": "Pre-Q3 Review", "description": "Before rebalancing"},
        config=tool_config,
    )

    assert result["status"] == "created"
    snapshot = result["snapshot"]
    assert snapshot["name"] == "Pre-Q3 Review"
    assert snapshot["product_count"] == 1
    row = await test_pool.fetchrow(
        "SELECT * FROM portfolio_snapshots WHERE id = $1", snapshot["id"]
    )
    assert row is not None
    assert str(row["user_id"]) == test_user_id
    assert row["name"] == "Pre-Q3 Review"
    assert row["description"] == "Before rebalancing"


async def test_create_snapshot_on_empty_portfolio_succeeds(patch_get_pool, tool_config):
    """SNAP-009 — an empty portfolio is a valid snapshot, not an error."""
    result = await create_snapshot.ainvoke({"name": "Empty Snapshot"}, config=tool_config)

    assert result["status"] == "created"
    assert result["snapshot"]["product_count"] == 0
    assert result["snapshot"]["total_amount"] == 0

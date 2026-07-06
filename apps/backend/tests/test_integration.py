"""Integration-style tests for the SABBI portfolio agent.

These tests do NOT invoke the real Claude API and do NOT require a running
Postgres instance:
  - Graph structure/routing is exercised directly against the compiled graph
    and the pure routing functions (`should_continue`, `has_file_attachment`).
  - `ProductRepository` is exercised against a mocked `asyncpg.Pool`
    (`unittest.mock.AsyncMock`) instead of a real database connection.

Async repository methods are driven with `asyncio.run(...)` directly so no
`pytest-asyncio` plugin dependency is required.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest


# ---------------------------------------------------------------------------
# Graph compilation and structure
# ---------------------------------------------------------------------------


def test_graph_compiles_with_expected_nodes():
    from agent.graph import graph

    node_names = set(graph.get_graph().nodes.keys())
    assert {"router", "process_document", "agent", "tools"} <= node_names


def test_graph_edges_include_expected_transitions():
    from agent.graph import graph

    graph_repr = graph.get_graph()
    edges = {(edge.source, edge.target) for edge in graph_repr.edges}

    assert ("__start__", "router") in edges
    assert ("process_document", "agent") in edges
    assert ("tools", "agent") in edges


# ---------------------------------------------------------------------------
# should_continue routing (agent -> tools | END)
# ---------------------------------------------------------------------------


def test_should_continue_routes_to_tools_when_tool_calls_present():
    from langgraph.graph import END

    from agent.graph import should_continue

    message_with_tool_calls = SimpleNamespace(
        tool_calls=[{"name": "add_product", "args": {}, "id": "call_1"}]
    )
    state = {"messages": [message_with_tool_calls]}

    assert should_continue(state) == "tools"
    assert should_continue(state) != END


def test_should_continue_routes_to_end_without_tool_calls():
    from langgraph.graph import END

    from agent.graph import should_continue

    message_without_tool_calls = SimpleNamespace(tool_calls=[])
    state = {"messages": [message_without_tool_calls]}

    assert should_continue(state) == END


def test_should_continue_routes_to_end_when_attribute_missing():
    from langgraph.graph import END

    from agent.graph import should_continue

    message_without_attr = SimpleNamespace()
    state = {"messages": [message_without_attr]}

    assert should_continue(state) == END


# ---------------------------------------------------------------------------
# has_file_attachment routing (router -> process_document | agent)
# ---------------------------------------------------------------------------


def test_has_file_attachment_routes_to_agent_for_text_only_message():
    from agent.nodes import has_file_attachment

    text_message = SimpleNamespace(content="Tengo un fondo de BlackRock por $50,000")
    state = {"messages": [text_message]}

    assert has_file_attachment(state) == "agent"


def test_has_file_attachment_routes_to_process_document_for_image():
    from agent.nodes import has_file_attachment

    image_message = SimpleNamespace(
        content=[
            {"type": "text", "text": "Aquí está mi estado de cuenta"},
            {"type": "image", "source": {"type": "base64", "data": "..."}},
        ]
    )
    state = {"messages": [image_message]}

    assert has_file_attachment(state) == "process_document"


def test_has_file_attachment_routes_to_process_document_for_document_block():
    from agent.nodes import has_file_attachment

    document_message = SimpleNamespace(
        content=[{"type": "document", "source": {"type": "base64", "data": "..."}}]
    )
    state = {"messages": [document_message]}

    assert has_file_attachment(state) == "process_document"


def test_has_file_attachment_ignores_list_content_without_attachment_blocks():
    from agent.nodes import has_file_attachment

    message = SimpleNamespace(content=[{"type": "text", "text": "hola"}])
    state = {"messages": [message]}

    assert has_file_attachment(state) == "agent"


# ---------------------------------------------------------------------------
# ProductRepository against a mocked asyncpg pool
# ---------------------------------------------------------------------------


def _fake_row(**overrides) -> dict:
    row = {
        "id": "prod_abc12345",
        "portfolio_id": "pf_test",
        "name": "Fund A",
        "provider": "Provider A",
        "amount": 10000.0,
        "category": "directas",
        "composition": json.dumps([{"name": "Fund A", "percentage": 100}]),
    }
    row.update(overrides)
    return row


def test_repository_list_by_portfolio_maps_rows_to_products():
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.fetch.return_value = [_fake_row(), _fake_row(id="prod_xyz98765")]

    repo = ProductRepository(pool)
    products = asyncio.run(repo.list_by_portfolio("pf_test"))

    assert len(products) == 2
    assert products[0].id == "prod_abc12345"
    assert products[0].amount == 10000.0
    assert products[0].composition[0].name == "Fund A"
    pool.fetch.assert_awaited_once()


def test_repository_create_inserts_and_returns_product():
    from db.models import ProductCreate
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.execute.return_value = "INSERT 0 1"

    repo = ProductRepository(pool)
    data = ProductCreate(name="New Fund", amount=5000, category="cash")
    product = asyncio.run(repo.create("pf_test", data))

    assert product.name == "New Fund"
    assert product.portfolio_id == "pf_test"
    assert product.id.startswith("prod_")
    pool.execute.assert_awaited_once()


def test_repository_update_returns_updated_product():
    from db.models import ProductUpdate
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = _fake_row(amount=99999.0)

    repo = ProductRepository(pool)
    product = asyncio.run(repo.update("prod_abc12345", ProductUpdate(amount=99999)))

    assert product is not None
    assert product.amount == 99999.0
    pool.fetchrow.assert_awaited_once()


def test_repository_update_returns_none_when_product_missing():
    from db.models import ProductUpdate
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = None

    repo = ProductRepository(pool)
    product = asyncio.run(repo.update("does_not_exist", ProductUpdate(amount=1)))

    assert product is None


def test_repository_update_with_no_fields_falls_back_to_get():
    from db.models import ProductUpdate
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.fetchrow.return_value = _fake_row()

    repo = ProductRepository(pool)
    product = asyncio.run(repo.update("prod_abc12345", ProductUpdate()))

    assert product is not None
    pool.fetchrow.assert_awaited_once_with(
        "SELECT * FROM products WHERE id = $1", "prod_abc12345"
    )


def test_repository_delete_returns_true_on_success():
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.execute.return_value = "DELETE 1"

    repo = ProductRepository(pool)
    deleted = asyncio.run(repo.delete("prod_abc12345"))

    assert deleted is True


def test_repository_delete_returns_false_when_no_rows_affected():
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.execute.return_value = "DELETE 0"

    repo = ProductRepository(pool)
    deleted = asyncio.run(repo.delete("does_not_exist"))

    assert deleted is False


def test_repository_get_summary_computes_totals_and_largest_position():
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.fetch.return_value = [
        _fake_row(id="p1", amount=7000.0, category="directas"),
        _fake_row(id="p2", amount=3000.0, category="cash"),
    ]

    repo = ProductRepository(pool)
    summary = asyncio.run(repo.get_summary("pf_test"))

    assert summary["total_amount"] == 10000.0
    assert summary["product_count"] == 2
    assert set(summary["categories_used"]) == {"directas", "cash"}
    assert summary["largest_position"]["name"] == "Fund A"
    assert summary["largest_position"]["percentage"] == 70.0


def test_repository_get_summary_handles_empty_portfolio():
    from db.repository import ProductRepository

    pool = AsyncMock()
    pool.fetch.return_value = []

    repo = ProductRepository(pool)
    summary = asyncio.run(repo.get_summary("pf_empty"))

    assert summary["total_amount"] == 0
    assert summary["product_count"] == 0
    assert summary["largest_position"] is None

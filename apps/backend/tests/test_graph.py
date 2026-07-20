"""Tests for graph import/compile and state contract (`agent.graph`)."""

from __future__ import annotations


def test_graph_imports_and_compiles_without_credentials(monkeypatch):
    # Import/compile must never require ANTHROPIC_API_KEY — `ChatAnthropic`
    # validates credentials lazily, only when a request is actually made.
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    from agent.graph import graph

    assert graph is not None
    assert hasattr(graph, "invoke")
    assert hasattr(graph, "ainvoke")


def test_graph_has_expected_nodes():
    from agent.graph import graph

    node_names = set(graph.get_graph().nodes.keys())
    assert {"router", "process_document", "agent", "tools"} <= node_names


def test_state_schema_has_messages_reducer():
    from agent.state import AgentState

    assert "messages" in AgentState.__annotations__


def test_categories_taxonomy_has_all_six_sabbi_categories():
    from agent.state import CATEGORIES

    assert set(CATEGORIES.keys()) == {
        "inversiones_directas",
        "mercados_privados",
        "club_deals",
        "mercados_publicos",
        "otros",
        "cash_y_equivalentes",
    }
    for info in CATEGORIES.values():
        assert info["label"]
        assert info["groups"]

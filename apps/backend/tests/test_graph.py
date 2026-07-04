"""Tests for graph import/compile and state contract (`agent.graph`)."""

from __future__ import annotations


def test_graph_imports_and_compiles_without_credentials(monkeypatch):
    # Import/compile must never require provider credentials — the model is
    # created lazily inside the chatbot node, only when actually invoked.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)

    from agent.graph import graph

    assert graph is not None
    assert hasattr(graph, "invoke")
    assert hasattr(graph, "ainvoke")


def test_state_schema_has_messages_reducer():
    from agent.state import AgentState

    assert "messages" in AgentState.__annotations__

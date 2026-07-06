"""Tests for the agent state schema and SABBI category taxonomy (`agent.state`)."""

from __future__ import annotations

EXPECTED_CATEGORIES = {"directas", "privados", "club", "publicos", "otros", "cash"}


def test_agent_state_has_only_messages_field():
    from agent.state import AgentState

    assert "messages" in AgentState.__annotations__
    # Portfolio data lives in Postgres, not in the LangGraph checkpoint —
    # `messages` must be the only field on the state schema.
    assert set(AgentState.__annotations__.keys()) == {"messages"}


def test_categories_has_all_six_sabbi_categories():
    from agent.state import CATEGORIES

    assert set(CATEGORIES.keys()) == EXPECTED_CATEGORIES


def test_each_category_has_label_and_subcategories():
    from agent.state import CATEGORIES

    for key, info in CATEGORIES.items():
        assert isinstance(info["label"], str) and info["label"], f"{key} missing label"
        assert isinstance(info["subcategories"], list) and info["subcategories"], (
            f"{key} missing subcategories"
        )
        assert all(isinstance(s, str) and s for s in info["subcategories"])


def test_categories_labels_are_unique():
    from agent.state import CATEGORIES

    labels = [info["label"] for info in CATEGORIES.values()]
    assert len(labels) == len(set(labels))


def test_directas_subcategories_match_spec():
    from agent.state import CATEGORIES

    assert CATEGORIES["directas"]["subcategories"] == [
        "Accionariado",
        "RE Perú - Residencial",
        "RE Perú - Comercial",
        "RE Perú - Terrenos",
        "RE Extranjero",
    ]


def test_cash_subcategories_match_spec():
    from agent.state import CATEGORIES

    assert CATEGORIES["cash"]["subcategories"] == [
        "Depósitos a plazo",
        "Money market",
        "Cuentas corrientes",
    ]

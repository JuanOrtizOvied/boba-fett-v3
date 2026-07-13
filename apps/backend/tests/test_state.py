"""Tests for the agent state schema and SABBI category taxonomy (`agent.state`)."""

from __future__ import annotations

EXPECTED_CATEGORIES = {"directas", "privados", "club", "publicos", "otros", "cash"}

# category -> group -> leaves, mirrors the table in
# openspec/changes/multi-level-search/specs/taxonomy.spec.md
EXPECTED_TAXONOMY = {
    "directas": {
        "label": "Real Estate Directo",
        "groups": {
            "RE Perú": ["Residencial", "Oficinas", "Comercial/Industrial"],
            "RE Extranjero": ["RE Extranjero"],
        },
    },
    "privados": {
        "label": "Mercados Privados",
        "groups": {
            "Deuda Privada": ["Deuda Privada"],
            "Private Equity": ["Private Equity"],
            "Venture Capital": ["Venture Capital"],
            "Real Estate": ["Real Estate"],
            "Hedge Funds": ["Hedge Funds"],
            "Infraestructura": ["Infraestructura"],
        },
    },
    "club": {
        "label": "Club Deals",
        "groups": {
            "Real Estate": ["Perú", "Extranjero"],
            "Deuda Privada": ["Perú", "Extranjero"],
            "Otros": ["Perú", "Extranjero"],
        },
    },
    "publicos": {
        "label": "Mercados Públicos",
        "groups": {
            "Renta Variable": [
                "US Large Cap",
                "US Mid & Small Cap",
                "Developed ex-US",
                "EM ex-Perú",
                "Perú",
            ],
            "Renta Fija": [
                "US Treasuries",
                "IG Corporates AAA-BBB",
                "High Yield BB-",
                "EM Bonds",
                "LatAm Bonds",
                "Perú Bonds",
            ],
        },
    },
    "otros": {
        "label": "Otros",
        "groups": {
            "Cripto": ["Bitcoin", "Ethereum", "Otras"],
            "Commodities": ["Oro"],
        },
    },
    "cash": {
        "label": "Cash y Equivalentes",
        "groups": {
            "Cash": ["Depósitos a plazo", "Fondos de Money Market"],
        },
    },
}


def test_agent_state_has_only_messages_field():
    from agent.state import AgentState

    assert "messages" in AgentState.__annotations__
    # Portfolio data lives in Postgres, not in the LangGraph checkpoint —
    # `messages` must be the only field on the state schema.
    assert set(AgentState.__annotations__.keys()) == {"messages"}


def test_categories_has_all_six_sabbi_categories():
    from agent.state import CATEGORIES

    assert set(CATEGORIES.keys()) == EXPECTED_CATEGORIES


def test_each_category_has_label_and_groups():
    from agent.state import CATEGORIES

    for key, info in CATEGORIES.items():
        assert isinstance(info["label"], str) and info["label"], f"{key} missing label"
        assert isinstance(info["groups"], dict) and info["groups"], f"{key} missing groups"


def test_categories_labels_are_unique():
    from agent.state import CATEGORIES

    labels = [info["label"] for info in CATEGORIES.values()]
    assert len(labels) == len(set(labels))


def test_every_group_exposes_at_least_one_leaf():
    from agent.state import CATEGORIES

    for category_key, info in CATEGORIES.items():
        for group_name, leaves in info["groups"].items():
            assert isinstance(leaves, list) and leaves, (
                f"{category_key} -> {group_name} missing leaves"
            )
            assert all(isinstance(leaf, str) and leaf for leaf in leaves)


def test_taxonomy_matches_spec_table_exactly():
    from agent.state import CATEGORIES

    assert CATEGORIES == EXPECTED_TAXONOMY


def test_publicos_exposes_renta_fija_group_with_us_treasuries_leaf():
    from agent.state import CATEGORIES

    assert "Renta Fija" in CATEGORIES["publicos"]["groups"]
    assert "US Treasuries" in CATEGORIES["publicos"]["groups"]["Renta Fija"]

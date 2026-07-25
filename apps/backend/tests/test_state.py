"""Tests for the agent state schema and SABBI asset_class taxonomy (`agent.state`)."""

from __future__ import annotations

EXPECTED_ASSET_CLASSES = {
    "inversiones_directas",
    "mercados_privados",
    "club_deals",
    "mercados_publicos",
    "otros",
    "cash_y_equivalentes",
}

# asset_class -> group -> leaves, mirrors the table in
# openspec/changes/multi-level-search/specs/taxonomy.spec.md
EXPECTED_TAXONOMY = {
    "inversiones_directas": {
        "label": "Inversiones directas",
        "groups": {
            "RE Perú": ["Residencial", "Oficinas", "Comercial/Industrial"],
            "RE Extranjero": ["RE Extranjero"],
        },
    },
    "mercados_privados": {
        "label": "Mercados privados",
        "groups": {
            "Deuda Privada": ["Deuda Privada"],
            "Private Equity": ["Private Equity"],
            "Venture Capital": ["Venture Capital"],
            "Real Estate": ["Real Estate"],
            "Hedge Funds": ["Hedge Funds"],
            "Infraestructura": ["Infraestructura"],
        },
    },
    "club_deals": {
        "label": "Club deals",
        "groups": {
            "Real Estate": ["Perú", "Extranjero"],
            "Deuda Privada": ["Perú", "Extranjero"],
            "Otros": ["Perú", "Extranjero"],
        },
    },
    "mercados_publicos": {
        "label": "Mercados públicos",
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
    "cash_y_equivalentes": {
        "label": "Cash y equivalentes",
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


def test_asset_classes_has_all_six_sabbi_asset_classes():
    from agent.state import ASSET_CLASSES

    assert set(ASSET_CLASSES.keys()) == EXPECTED_ASSET_CLASSES


def test_each_asset_class_has_label_and_groups():
    from agent.state import ASSET_CLASSES

    for key, info in ASSET_CLASSES.items():
        assert isinstance(info["label"], str) and info["label"], f"{key} missing label"
        assert isinstance(info["groups"], dict) and info["groups"], f"{key} missing groups"


def test_asset_classes_labels_are_unique():
    from agent.state import ASSET_CLASSES

    labels = [info["label"] for info in ASSET_CLASSES.values()]
    assert len(labels) == len(set(labels))


def test_every_group_exposes_at_least_one_leaf():
    from agent.state import ASSET_CLASSES

    for asset_class_key, info in ASSET_CLASSES.items():
        for group_name, leaves in info["groups"].items():
            assert isinstance(leaves, list) and leaves, (
                f"{asset_class_key} -> {group_name} missing leaves"
            )
            assert all(isinstance(leaf, str) and leaf for leaf in leaves)


def test_taxonomy_matches_spec_table_exactly():
    from agent.state import ASSET_CLASSES

    assert ASSET_CLASSES == EXPECTED_TAXONOMY


def test_publicos_exposes_renta_fija_group_with_us_treasuries_leaf():
    from agent.state import ASSET_CLASSES

    assert "Renta Fija" in ASSET_CLASSES["mercados_publicos"]["groups"]
    assert "US Treasuries" in ASSET_CLASSES["mercados_publicos"]["groups"]["Renta Fija"]

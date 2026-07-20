"""Agent state schema and portfolio category taxonomy.

Portfolio data does NOT live in `AgentState` — it is persisted in PostgreSQL
(see `db.repository.ProductRepository`) so it survives across chat threads,
page reloads, and LangGraph checkpoint resets. The graph state only carries
the conversation itself.
"""

from __future__ import annotations

from typing import Annotated

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict


class AgentState(TypedDict):
    """State threaded through the assistant graph.

    `messages` accumulates the conversation using LangGraph's `add_messages`
    reducer so nodes can append new messages without overwriting history.
    """

    messages: Annotated[list[AnyMessage], add_messages]


# SABBI category taxonomy. Shared by the system prompt, the tools' category
# validation, the cascading search classifier (multi-level-search), and the
# Excel export so there is a single source of truth for valid
# categories/subcategory groups/leaves.
#
# 3-level hierarchy: category -> subcategory group -> leaf. Groups with no
# further breakdown (e.g. "RE Extranjero") use their own name as the single
# leaf, so every group always exposes at least one leaf.
CATEGORIES: dict[str, dict[str, object]] = {
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

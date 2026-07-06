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
# validation, and the Excel export (Phase 4) so there is a single source of
# truth for valid categories/subcategories.
CATEGORIES: dict[str, dict[str, object]] = {
    "directas": {
        "label": "Inversiones directas",
        "subcategories": [
            "Accionariado",
            "RE Perú - Residencial",
            "RE Perú - Comercial",
            "RE Perú - Terrenos",
            "RE Extranjero",
        ],
    },
    "privados": {
        "label": "Mercados privados",
        "subcategories": [
            "Deuda privada",
            "Private equity",
            "Venture capital",
            "Real estate",
            "Hedge funds",
            "Infraestructura",
        ],
    },
    "club": {
        "label": "Club deals",
        "subcategories": ["Real estate", "Deuda privada", "Otros"],
    },
    "publicos": {
        "label": "Mercados públicos",
        "subcategories": [
            "RV US Large Cap",
            "RV US Small Cap",
            "RV International",
            "RV Emerging Markets",
            "RF Government",
            "RF Corporate",
            "RF High Yield",
            "RF Emerging Markets",
        ],
    },
    "otros": {
        "label": "Otros",
        "subcategories": ["Cripto", "Commodities"],
    },
    "cash": {
        "label": "Cash y equivalentes",
        "subcategories": ["Depósitos a plazo", "Money market", "Cuentas corrientes"],
    },
}

"""Input guardrails for the SABBI portfolio assistant.

Three layers — applied in order, cheapest first:
1. Length cap (instant, zero cost)
2. Regex prompt-injection patterns (instant, zero cost)
3. LLM topic/safety classifier (Haiku — fast, cheap, robust to nuance)

On any failure in the LLM layer the guardrail fails OPEN so legitimate
users are never blocked by a transient error.
"""

from __future__ import annotations

import logging
import re

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, HumanMessage

from agent.state import AgentState

logger = logging.getLogger(__name__)

MAX_INPUT_LENGTH = 10_000

_classifier = ChatAnthropic(
    model="claude-haiku-4-5-20251001",
    temperature=0,
    max_tokens=32,
)

_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"ignore\s+(all\s+)?(above|prior)",
    r"disregard\s+(all\s+)?(previous|prior|above)",
    r"you\s+are\s+now\s+a",
    r"forget\s+(everything|all|your)",
    r"new\s+instructions?\s*:",
    r"system\s*prompt\s*:",
    r"override\s+(system|instructions|rules)",
    r"jailbreak",
    r"\bDAN\s+mode\b",
    r"developer\s+mode",
    r"reveal\s+(your|the)\s+(system\s+)?prompt",
    r"print\s+(your|the)\s+instructions",
]

_injection_re = re.compile("|".join(_INJECTION_PATTERNS), re.IGNORECASE)

_CLASSIFICATION_PROMPT = """\
Classify this user message for a Spanish-language investment portfolio assistant.

Categories (respond with ONLY the category name):
- allowed: investments, portfolio, financial products, greetings, thanks, \
help requests, farewells, or any conversational message related to using \
the assistant
- off_topic: clearly unrelated to finance (code generation, recipes, \
creative writing, homework, trivia, etc.)
- unsafe_financial: explicit requests for buy/sell recommendations, market \
predictions with guarantees, or personalized financial advice

User message: {message}"""

_REJECTION_MESSAGES: dict[str, str] = {
    "too_long": (
        "El mensaje es demasiado largo para procesarlo. "
        "¿Podrías resumirlo o enviarlo en partes más cortas?"
    ),
    "prompt_injection": (
        "No puedo procesar ese tipo de solicitud. "
        "Estoy aquí para ayudarte con tu portafolio de inversión. "
        "¿Te gustaría agregar un producto o revisar tu portafolio?"
    ),
    "off_topic": (
        "Soy el asistente de SABBI especializado en portafolios de inversión. "
        "No puedo ayudarte con ese tema, pero con gusto te asisto a construir, "
        "analizar o ajustar tu portafolio. ¿En qué puedo ayudarte?"
    ),
    "unsafe_financial": (
        "Puedo ayudarte a organizar y clasificar tus inversiones, pero no "
        "puedo darte recomendaciones específicas de compra o venta ni "
        "predicciones de mercado. Para asesoramiento personalizado, te "
        "recomiendo consultar con un asesor financiero certificado. "
        "¿Te ayudo a revisar tu portafolio actual?"
    ),
}


_ATTACHMENT_CONTENT_TYPES = ("image_url", "image", "document", "file")


def _has_attachment(message: HumanMessage) -> bool:
    if isinstance(message.content, str):
        return False
    return any(
        isinstance(block, dict) and block.get("type") in _ATTACHMENT_CONTENT_TYPES
        for block in message.content
    )


def _extract_text(message: HumanMessage) -> str:
    if isinstance(message.content, str):
        return message.content
    return " ".join(
        block.get("text", "")
        for block in message.content
        if isinstance(block, dict) and block.get("type") == "text"
    )


async def _classify(text: str) -> str:
    try:
        response = await _classifier.ainvoke(
            [HumanMessage(content=_CLASSIFICATION_PROMPT.format(message=text))]
        )
        category = response.content.strip().lower()
        if category in ("off_topic", "unsafe_financial"):
            return category
    except Exception:
        logger.warning("Guardrail classifier failed — allowing message through", exc_info=True)
    return "allowed"


async def guardrail_node(state: AgentState) -> dict:
    last_human = next(
        (m for m in reversed(state["messages"]) if isinstance(m, HumanMessage)),
        None,
    )
    if last_human is None:
        return {"messages": []}

    text = _extract_text(last_human)
    has_file = _has_attachment(last_human)

    if not text.strip() and not has_file:
        return {"messages": []}

    if len(text) > MAX_INPUT_LENGTH:
        return {"messages": [AIMessage(content=_REJECTION_MESSAGES["too_long"])]}

    if _injection_re.search(text):
        return {"messages": [AIMessage(content=_REJECTION_MESSAGES["prompt_injection"])]}

    if has_file:
        return {"messages": []}

    category = await _classify(text)
    if category in _REJECTION_MESSAGES:
        return {"messages": [AIMessage(content=_REJECTION_MESSAGES[category])]}

    return {"messages": []}


def guardrail_route(state: AgentState) -> str:
    last = state["messages"][-1]
    if isinstance(last, AIMessage):
        return "__end__"
    return "router"

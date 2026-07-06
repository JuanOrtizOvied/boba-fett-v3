"""Graph node functions for the SABBI portfolio assistant.

The model is Anthropic-only and hardcoded on purpose (see design.md — SABBI's
system prompt, tools, and document-extraction pipeline are built specifically
around Claude's capabilities). There is no configurable-provider indirection
here, unlike the original bootstrap's `agent.models` factory.
"""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage

from agent.prompts import SYSTEM_PROMPT
from agent.state import AgentState
from agent.tools import portfolio_tools

MODEL_NAME = "claude-sonnet-4-20250514"

# Instantiating `ChatAnthropic` does not require `ANTHROPIC_API_KEY` to be
# present — credentials are only validated when a request is actually made.
# This keeps graph import/compile safe in environments without the key set
# (e.g. `langgraph dev` schema checks, unit tests).
llm = ChatAnthropic(model=MODEL_NAME, temperature=0, max_tokens=4096)
llm_with_tools = llm.bind_tools(portfolio_tools)

_ATTACHMENT_CONTENT_TYPES = ("image_url", "image", "document", "file")

EXTRACTION_PROMPT = """Analiza el documento adjunto en el mensaje anterior.

Extrae TODOS los productos de inversión que encuentres. Para cada producto identifica:
- nombre del producto o fondo
- institución administradora (provider)
- monto invertido en USD
- categoría (una de: directas, privados, club, publicos, otros, cash)
- composición por asset class si está disponible

Presenta los productos encontrados en una lista clara y luego usa la tool
`add_product` para agregar cada uno al portafolio del usuario."""


def _has_attachment(message: object) -> bool:
    """Return True when a message's content includes a file/image block."""
    content = getattr(message, "content", None)
    if not isinstance(content, list):
        return False
    return any(
        isinstance(block, dict) and block.get("type") in _ATTACHMENT_CONTENT_TYPES
        for block in content
    )


async def router_node(state: AgentState) -> dict:
    """Entry node — routing itself is decided by `has_file_attachment`.

    Kept as an explicit graph node (per design.md) so the routing step is
    visible in LangGraph traces/checkpoints, even though it does not mutate
    state itself.
    """
    del state  # unused — this node is a pass-through, routing happens in the edge function
    return {"messages": []}


def has_file_attachment(state: AgentState) -> str:
    """Conditional-edge function: route to document processing or straight to the agent."""
    last_message = state["messages"][-1]
    return "process_document" if _has_attachment(last_message) else "agent"


async def process_document_node(state: AgentState) -> dict:
    """Inject an extraction prompt so `agent_node` processes the attached
    document (PDF/image, already present as content blocks on the last human
    message) with Claude vision and persists products via `add_product`."""
    del state  # unused — the attachment stays on the last message already in history
    return {"messages": [HumanMessage(content=EXTRACTION_PROMPT)]}


async def agent_node(state: AgentState) -> dict:
    """Main conversational node — invokes Claude with portfolio tools bound."""
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    response = await llm_with_tools.ainvoke(messages)
    return {"messages": [response]}

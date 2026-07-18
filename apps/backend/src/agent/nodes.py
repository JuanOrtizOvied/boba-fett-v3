"""Graph node functions for the SABBI portfolio assistant.

The model is Anthropic-only and hardcoded on purpose (see design.md — SABBI's
system prompt, tools, and document-extraction pipeline are built specifically
around Claude's capabilities). There is no configurable-provider indirection
here, unlike the original bootstrap's `agent.models` factory.
"""

from __future__ import annotations

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, AnyMessage, SystemMessage, ToolMessage

from agent.file_utils import PARSEABLE_MIMES, file_to_text
from agent.prompts import SYSTEM_PROMPT
from agent.state import AgentState
from agent.tools import portfolio_tools

MODEL_NAME = "claude-sonnet-5"

# Instantiating `ChatAnthropic` does not require `ANTHROPIC_API_KEY` to be
# present — credentials are only validated when a request is actually made.
# This keeps graph import/compile safe in environments without the key set
# (e.g. `langgraph dev` schema checks, unit tests).
llm = ChatAnthropic(
    model=MODEL_NAME,
    max_tokens=16000,
    thinking={"type": "adaptive"},
)
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
    message) with Claude vision and persists products via `add_product`.

    Uses SystemMessage so the instruction doesn't render as a user bubble
    in the chat UI — the user already sees their own attachment message."""
    del state  # unused — the attachment stays on the last message already in history
    return {"messages": [SystemMessage(content=EXTRACTION_PROMPT)]}


def _strip_thinking(msg: AIMessage) -> AIMessage:
    """Remove thinking blocks from a previous assistant message so they don't
    get re-sent to the API (the checkpoint often drops the inner `thinking`
    text field, which causes a 400 on the next turn)."""
    if not isinstance(msg.content, list):
        return msg
    cleaned = [b for b in msg.content if not (isinstance(b, dict) and b.get("type") == "thinking")]
    if len(cleaned) == len(msg.content):
        return msg
    return msg.model_copy(update={"content": cleaned})


def _normalize_file_blocks(msg: AnyMessage) -> AnyMessage:
    """Convert non-API-safe content blocks so checkpointed messages don't
    cause 400 errors.  Only ``application/pdf`` is valid for ``document``
    blocks; everything else is parsed to text or converted to ``image``."""
    content = getattr(msg, "content", None)
    if not isinstance(content, list):
        return msg
    needs_fix = any(
        isinstance(b, dict)
        and (
            b.get("type") == "file"
            or (b.get("type") == "image" and "title" in b)
            or (
                b.get("type") == "document"
                and b.get("source", {}).get("media_type", "") != "application/pdf"
            )
        )
        for b in content
    )
    if not needs_fix:
        return msg
    fixed = []
    for block in content:
        if not isinstance(block, dict):
            fixed.append(block)
        elif block.get("type") == "file":
            mime = block.get("mime_type", "application/octet-stream")
            data = block.get("data", "")
            parsed = file_to_text(data, mime)
            if parsed is not None:
                fixed.append({"type": "text", "text": parsed})
            elif mime.startswith("image/"):
                fixed.append({
                    "type": "image",
                    "source": {"type": "base64", "media_type": mime, "data": data},
                })
            elif mime == "application/pdf":
                fixed.append({
                    "type": "document",
                    "source": {"type": "base64", "media_type": mime, "data": data},
                })
            else:
                fixed.append({"type": "text", "text": "[Archivo adjunto]"})
        elif block.get("type") == "document":
            source = block.get("source", {})
            mime = source.get("media_type", "")
            if mime == "application/pdf":
                fixed.append(block)
            else:
                parsed = file_to_text(source.get("data", ""), mime)
                fixed.append({"type": "text", "text": parsed or "[Archivo vacío]"})
        elif block.get("type") == "image" and "title" in block:
            fixed.append({k: v for k, v in block.items() if k != "title"})
        else:
            fixed.append(block)
    return msg.model_copy(update={"content": fixed})


def _get_tool_use_ids(msg: AIMessage) -> set[str]:
    """Extract tool_use IDs from an AIMessage's content blocks."""
    if not isinstance(msg.content, list):
        return set()
    return {
        b["id"]
        for b in msg.content
        if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("id")
    }


def _patch_orphan_tool_calls(conversation: list[AnyMessage]) -> list[AnyMessage]:
    """Ensure every tool_use block has a matching tool_result immediately after.
    Orphaned tool calls (from interrupted runs or checkpoint corruption) cause
    Anthropic API 400 errors."""
    result: list[AnyMessage] = []
    for i, msg in enumerate(conversation):
        result.append(msg)
        if not isinstance(msg, AIMessage):
            continue
        tool_ids = _get_tool_use_ids(msg)
        if not tool_ids:
            continue
        answered: set[str] = set()
        for following in conversation[i + 1 :]:
            if isinstance(following, ToolMessage):
                answered.add(following.tool_call_id)
            else:
                break
        orphans = tool_ids - answered
        for tool_id in orphans:
            result.append(
                ToolMessage(
                    content="[interrupted — no result available]",
                    tool_call_id=tool_id,
                )
            )
    return result


async def agent_node(state: AgentState) -> dict:
    """Main conversational node — invokes Claude with portfolio tools bound."""
    system_parts = [SYSTEM_PROMPT]
    conversation = []
    for msg in state["messages"]:
        if isinstance(msg, SystemMessage):
            system_parts.append(msg.content)
        elif isinstance(msg, AIMessage):
            conversation.append(_strip_thinking(msg))
        else:
            conversation.append(_normalize_file_blocks(msg))
    conversation = _patch_orphan_tool_calls(conversation)
    messages = [SystemMessage(content="\n\n".join(system_parts)), *conversation]
    response = await llm_with_tools.ainvoke(messages)
    return {"messages": [response]}

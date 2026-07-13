"""Chat endpoints backed by LangGraph with Postgres persistence.

These endpoints provide the conversational interface with checkpointed
thread history. Unlike the LangGraph dev server (in-memory), this uses
`AsyncPostgresSaver`/`AsyncPostgresStore` (wired up in `api/routes.py`'s
lifespan) for durable persistence across restarts.

Every route requires a valid `sabbi_access` session (`get_current_user`),
matching the guard pattern used by `api/routes.py` and `api/admin_routes.py`.
`user_id` is passed to the graph via `config["configurable"]["user_id"]` so
`agent.tools` can scope portfolio mutations to the authenticated user, same
as the LangGraph dev server flow.
"""

from __future__ import annotations

import inspect
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import AnyMessage, HumanMessage
from pydantic import BaseModel, Field

from auth.dependencies import get_current_user

router = APIRouter(prefix="/chat", tags=["chat"])

_NODE_LABELS: dict[str, str] = {
    "router": "Analizando solicitud",
    "process_document": "Procesando documento",
    "agent": "Consultando al modelo",
    "tools": "Ejecutando herramientas",
}


class ChatMessageRequest(BaseModel):
    message: str = Field(min_length=1)
    attachments: list[dict[str, Any]] | None = None


class ApiMessage(BaseModel):
    id: str
    type: str
    content: Any
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None


class ThreadStateResponse(BaseModel):
    thread_id: str
    messages: list[ApiMessage]


def _graph_config(thread_id: str) -> dict[str, Any]:
    return {"configurable": {"thread_id": thread_id}}


def _serialize_message(msg: AnyMessage) -> dict[str, Any]:
    """Convert a LangChain message to a JSON-serializable dict."""
    result: dict[str, Any] = {
        "id": getattr(msg, "id", "") or "",
        "type": getattr(msg, "type", "unknown"),
        "content": msg.content,
    }
    tool_call_id = getattr(msg, "tool_call_id", None)
    if tool_call_id:
        result["tool_call_id"] = tool_call_id
    tool_calls = getattr(msg, "tool_calls", None)
    if tool_calls:
        result["tool_calls"] = [
            {"id": tc["id"], "name": tc["name"], "args": tc["args"]} for tc in tool_calls
        ]
    return result


def _state_messages(state: Any) -> list[AnyMessage]:
    if isinstance(state, dict):
        return state.get("messages", [])
    values = getattr(state, "values", state)
    if isinstance(values, dict):
        return values.get("messages", [])
    return []


def _content_to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part if isinstance(part, str) else str(part.get("text", ""))
            for part in content
            if isinstance(part, (str, dict))
            and not (isinstance(part, dict) and part.get("type") == "thinking")
        )
    return ""


def _stream_event_text(event: Any) -> str:
    if not isinstance(event, dict):
        return ""
    if event.get("event") not in {"on_chat_model_stream", "on_llm_stream"}:
        return ""
    data = event.get("data", {})
    if not isinstance(data, dict):
        return ""
    chunk = data.get("chunk") or data.get("output")
    if chunk is None:
        return ""
    content = getattr(chunk, "content", None)
    if content is not None:
        return _content_to_text(content)
    return ""


def _stream_event_reasoning(event: Any) -> str:
    """Extract thinking/reasoning content from a stream event chunk."""
    if not isinstance(event, dict):
        return ""
    if event.get("event") not in {"on_chat_model_stream", "on_llm_stream"}:
        return ""
    data = event.get("data", {})
    if not isinstance(data, dict):
        return ""
    chunk = data.get("chunk") or data.get("output")
    if chunk is None:
        return ""
    content = getattr(chunk, "content", None)
    if not isinstance(content, list):
        return ""
    for part in content:
        if isinstance(part, dict) and part.get("type") == "thinking":
            thinking = part.get("thinking", "")
            if thinking:
                return thinking
    return ""


def _stream_event_progress(event: Any) -> dict[str, str] | None:
    """Detect graph node/tool transitions and return a progress step."""
    if not isinstance(event, dict):
        return None
    ev_type = event.get("event", "")
    name = event.get("name", "")
    if ev_type == "on_chain_start" and name in _NODE_LABELS:
        return {"step": name, "label": _NODE_LABELS[name]}
    if ev_type == "on_tool_start" and name:
        return {"step": f"tool_{name}", "label": f"Ejecutando: {name}"}
    return None


def _normalize_attachment(att: dict[str, Any]) -> dict[str, Any]:
    """Convert frontend ``{type: "file"}`` blocks to Anthropic API format.

    The API expects ``type: "image"`` for images and ``type: "document"``
    for everything else (PDFs, spreadsheets, etc.), each with a nested
    ``source`` object carrying the base64 payload.
    """
    if att.get("type") != "file":
        return att
    mime = att.get("mime_type", "application/octet-stream")
    data = att.get("data", "")
    block_type = "image" if mime.startswith("image/") else "document"
    result: dict[str, Any] = {
        "type": block_type,
        "source": {"type": "base64", "media_type": mime, "data": data},
    }
    metadata = att.get("metadata")
    if block_type == "document" and isinstance(metadata, dict) and metadata.get("filename"):
        result["title"] = metadata["filename"]
    return result


def _sse_event(event: str, data: Any) -> str:
    payload = data if isinstance(data, str) else json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


@router.get("/threads/{thread_id}/state", response_model=ThreadStateResponse)
async def get_thread_state(
    thread_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    graph = request.app.state.chat_graph
    if graph is None:
        raise HTTPException(status_code=503, detail="Chat graph not initialized")

    try:
        state = await graph.aget_state(config=_graph_config(thread_id))
    except Exception:
        return ThreadStateResponse(thread_id=thread_id, messages=[])

    messages = _state_messages(state)
    return ThreadStateResponse(
        thread_id=thread_id,
        messages=[_serialize_message(m) for m in messages],
    )


@router.post("/threads/{thread_id}/messages/stream")
async def stream_message(
    thread_id: str,
    body: ChatMessageRequest,
    request: Request,
    user: dict = Depends(get_current_user),
):
    graph = request.app.state.chat_graph
    if graph is None:
        raise HTTPException(status_code=503, detail="Chat graph not initialized")

    user_id = user["id"]
    message_text = body.message.strip()
    if not message_text:
        raise HTTPException(status_code=422, detail="message is required")

    if body.attachments:
        content: list[dict[str, Any]] = [{"type": "text", "text": message_text}]
        content.extend(_normalize_attachment(a) for a in body.attachments)
        input_message = HumanMessage(content=content)
    else:
        input_message = HumanMessage(content=message_text)

    input_data = {"messages": [input_message]}
    config = _graph_config(thread_id)
    config["configurable"]["user_id"] = user_id

    async def events() -> AsyncIterator[str]:
        yield _sse_event("progress", {"step": "loading_context", "label": "Cargando contexto"})
        has_emitted_text = False
        try:
            if hasattr(graph, "astream_events"):
                stream = graph.astream_events(input_data, config=config, version="v2")
                if inspect.isawaitable(stream):
                    stream = await stream
                async for event in stream:
                    progress = _stream_event_progress(event)
                    if progress:
                        yield _sse_event("progress", progress)

                    reasoning = _stream_event_reasoning(event)
                    if reasoning:
                        yield _sse_event("reasoning", {"content": reasoning})

                    text = _stream_event_text(event)
                    if text:
                        if not has_emitted_text:
                            yield _sse_event(
                                "progress",
                                {"step": "streaming", "label": "Generando respuesta"},
                            )
                            has_emitted_text = True
                        yield _sse_event("text", {"content": text})
            else:
                await graph.ainvoke(input_data, config=config)

            yield _sse_event("progress", {"step": "finalizing", "label": "Finalizando"})

            final_state = await graph.aget_state(config=_graph_config(thread_id))
            messages = _state_messages(final_state)
            final = ThreadStateResponse(
                thread_id=thread_id,
                messages=[_serialize_message(m) for m in messages],
            )
            yield _sse_event("final", final.model_dump())
            yield _sse_event("done", "[DONE]")

        except Exception as exc:
            yield _sse_event("error", {"detail": str(exc) or "Streaming failed"})

    return StreamingResponse(events(), media_type="text/event-stream")


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread(
    thread_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
) -> None:
    return None

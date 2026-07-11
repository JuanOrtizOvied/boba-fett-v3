"""Tests for `api/chat_routes.py` — chat endpoints backed by a
Postgres-checkpointed LangGraph graph (`app.state.chat_graph`).

Covers message serialization helpers (pure functions) plus the three routes:
`GET /chat/threads/{id}/state`, `POST /chat/threads/{id}/messages/stream`,
`DELETE /chat/threads/{id}`. The graph itself is a lightweight test double
(not a mock) so `astream_events` can be a real async generator, matching
LangGraph's actual API shape — `unittest.mock.AsyncMock` cannot fake an
async-generator method.

No real Postgres or LangGraph checkpointer is involved — `app.state.chat_graph`
is fully replaced by the test double.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from auth.dependencies import get_current_user


class FakeChatGraph:
    """Minimal async-generator-based test double for a compiled LangGraph graph."""

    def __init__(self, *, events: list[dict[str, Any]] | None = None, final_messages=None):
        self.events = events or []
        self.final_messages = final_messages or []
        self.aget_state_calls: list[dict[str, Any]] = []
        self.astream_events_calls: list[dict[str, Any]] = []

    async def aget_state(self, config):
        self.aget_state_calls.append(config)
        return SimpleNamespace(values={"messages": self.final_messages})

    async def astream_events(self, input_data, config, version="v2"):
        self.astream_events_calls.append({"input": input_data, "config": config})
        for event in self.events:
            yield event


@pytest.fixture
def app_client():
    from api.chat_routes import router

    app = FastAPI()
    app.include_router(router)
    app.state.chat_graph = None
    client = TestClient(app)
    yield app, client
    app.dependency_overrides.clear()


def _authenticate(app, *, user_id: str = "usr_owner") -> None:
    app.dependency_overrides[get_current_user] = lambda: {
        "id": user_id,
        "email": f"{user_id}@sabbi.com",
        "role": "user",
    }


# ---------------------------------------------------------------------------
# Pure serialization helpers
# ---------------------------------------------------------------------------


def test_serialize_message_includes_tool_calls():
    from api.chat_routes import _serialize_message

    msg = AIMessage(
        content="Let me check that",
        id="msg_1",
        tool_calls=[{"id": "call_1", "name": "add_product", "args": {"amount": 100}}],
    )

    result = _serialize_message(msg)

    assert result == {
        "id": "msg_1",
        "type": "ai",
        "content": "Let me check that",
        "tool_calls": [{"id": "call_1", "name": "add_product", "args": {"amount": 100}}],
    }


def test_serialize_message_includes_tool_call_id_for_tool_message():
    from api.chat_routes import _serialize_message

    msg = ToolMessage(content="done", tool_call_id="call_1", id="msg_2")

    result = _serialize_message(msg)

    assert result["tool_call_id"] == "call_1"
    assert result["type"] == "tool"
    assert "tool_calls" not in result


def test_serialize_message_omits_tool_fields_when_absent():
    from api.chat_routes import _serialize_message

    msg = HumanMessage(content="hola", id="msg_3")

    result = _serialize_message(msg)

    assert result == {"id": "msg_3", "type": "human", "content": "hola"}


def test_state_messages_extracts_from_dict():
    from api.chat_routes import _state_messages

    state = {"messages": [HumanMessage(content="hi")]}

    result = _state_messages(state)

    assert len(result) == 1
    assert result[0].content == "hi"


def test_state_messages_extracts_from_state_snapshot_values():
    from api.chat_routes import _state_messages

    snapshot = SimpleNamespace(values={"messages": [HumanMessage(content="hi from snapshot")]})

    result = _state_messages(snapshot)

    assert len(result) == 1
    assert result[0].content == "hi from snapshot"


def test_state_messages_returns_empty_list_for_unrecognized_shape():
    from api.chat_routes import _state_messages

    assert _state_messages(SimpleNamespace(values="not-a-dict")) == []


def test_content_to_text_returns_plain_string_unchanged():
    from api.chat_routes import _content_to_text

    assert _content_to_text("plain text") == "plain text"


def test_content_to_text_joins_text_blocks_from_list():
    from api.chat_routes import _content_to_text

    content = [{"type": "text", "text": "Hola "}, {"type": "text", "text": "mundo"}]

    assert _content_to_text(content) == "Hola mundo"


def test_stream_event_text_extracts_chat_model_stream_chunk():
    from api.chat_routes import _stream_event_text

    event = {
        "event": "on_chat_model_stream",
        "data": {"chunk": SimpleNamespace(content="partial token")},
    }

    assert _stream_event_text(event) == "partial token"


def test_stream_event_text_returns_empty_for_non_stream_event():
    from api.chat_routes import _stream_event_text

    event = {"event": "on_chain_start", "data": {}}

    assert _stream_event_text(event) == ""


# ---------------------------------------------------------------------------
# GET /chat/threads/{thread_id}/state
# ---------------------------------------------------------------------------


def test_get_thread_state_requires_authentication(app_client):
    _app, client = app_client

    response = client.get("/chat/threads/thread_1/state")

    assert response.status_code == 401


def test_get_thread_state_graph_not_initialized_returns_503(app_client):
    app, client = app_client
    _authenticate(app)
    app.state.chat_graph = None

    response = client.get("/chat/threads/thread_1/state")

    assert response.status_code == 503


def test_get_thread_state_returns_serialized_messages(app_client):
    app, client = app_client
    _authenticate(app)
    app.state.chat_graph = FakeChatGraph(
        final_messages=[HumanMessage(content="Hola", id="msg_1")]
    )

    response = client.get("/chat/threads/thread_1/state")

    assert response.status_code == 200
    body = response.json()
    assert body["thread_id"] == "thread_1"
    # response_model=ThreadStateResponse always includes the optional
    # tool_call_id/tool_calls keys (as null) — only content fields are
    # asserted here; `_serialize_message` itself is covered directly above.
    assert len(body["messages"]) == 1
    assert body["messages"][0]["id"] == "msg_1"
    assert body["messages"][0]["type"] == "human"
    assert body["messages"][0]["content"] == "Hola"
    assert app.state.chat_graph.aget_state_calls[0]["configurable"]["thread_id"] == "thread_1"


# ---------------------------------------------------------------------------
# POST /chat/threads/{thread_id}/messages/stream
# ---------------------------------------------------------------------------


def test_stream_message_requires_authentication(app_client):
    _app, client = app_client

    response = client.post("/chat/threads/thread_1/messages/stream", json={"message": "hi"})

    assert response.status_code == 401


def test_stream_message_empty_message_returns_422(app_client):
    app, client = app_client
    _authenticate(app)
    app.state.chat_graph = FakeChatGraph()

    response = client.post("/chat/threads/thread_1/messages/stream", json={"message": "   "})

    assert response.status_code == 422


def test_stream_message_graph_not_initialized_returns_503(app_client):
    app, client = app_client
    _authenticate(app)
    app.state.chat_graph = None

    response = client.post("/chat/threads/thread_1/messages/stream", json={"message": "hi"})

    assert response.status_code == 503


def test_stream_message_happy_path_streams_text_and_final_event(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    fake_graph = FakeChatGraph(
        events=[
            {"event": "on_chat_model_stream", "data": {"chunk": SimpleNamespace(content="Hola")}},
            {"event": "on_chat_model_stream", "data": {"chunk": SimpleNamespace(content=" mundo")}},
            {"event": "on_chain_start", "data": {}},
        ],
        final_messages=[
            HumanMessage(content="hi", id="msg_1"),
            AIMessage(content="Hola mundo", id="msg_2"),
        ],
    )
    app.state.chat_graph = fake_graph

    response = client.post(
        "/chat/threads/thread_1/messages/stream", json={"message": "hi"}
    )

    assert response.status_code == 200
    body = response.text
    assert 'event: text\ndata: {"content": "Hola"}' in body
    assert 'event: text\ndata: {"content": " mundo"}' in body
    assert "event: final" in body
    assert '"content": "Hola mundo"' in body
    assert "event: done" in body
    # user_id must reach the graph config so tools can scope mutations
    call_config = fake_graph.astream_events_calls[0]["config"]
    assert call_config["configurable"]["user_id"] == "usr_owner"
    assert call_config["configurable"]["thread_id"] == "thread_1"


def test_stream_message_error_during_streaming_emits_error_event(app_client):
    app, client = app_client
    _authenticate(app)

    class ExplodingGraph(FakeChatGraph):
        async def astream_events(self, input_data, config, version="v2"):
            raise RuntimeError("boom")
            yield {}  # pragma: no cover — makes this an async generator

    app.state.chat_graph = ExplodingGraph()

    response = client.post(
        "/chat/threads/thread_1/messages/stream", json={"message": "hi"}
    )

    assert response.status_code == 200
    assert "event: error" in response.text
    assert "boom" in response.text


# ---------------------------------------------------------------------------
# DELETE /chat/threads/{thread_id}
# ---------------------------------------------------------------------------


def test_delete_thread_requires_authentication(app_client):
    _app, client = app_client

    response = client.delete("/chat/threads/thread_1")

    assert response.status_code == 401


def test_delete_thread_returns_204(app_client):
    app, client = app_client
    _authenticate(app)

    response = client.delete("/chat/threads/thread_1")

    assert response.status_code == 204

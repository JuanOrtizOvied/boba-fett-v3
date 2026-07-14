"""Integration tests for chat thread persistence (`api/chat_routes.py`)
against a real Postgres-backed `AsyncPostgresSaver` checkpointer. The LLM
node (`agent.nodes.llm_with_tools`) is mocked to a canned `AIMessage` — no
Anthropic API call is ever made.

Spec: "Chat Thread Persistence" (`sdd/sabbi-test-suite/spec`).

`AsyncPostgresSaver` uses its own `psycopg` connection (separate from the
`asyncpg` savepoint-isolated `test_pool`), so checkpoint rows are not rolled
back by `tests/conftest.py`'s `_rollback` fixture — each test uses a unique
`thread_id` to stay isolated regardless.
"""

from __future__ import annotations

import os
import uuid
from contextlib import AsyncExitStack
from typing import Any, AsyncIterator

import httpx
import pytest_asyncio
from fastapi import FastAPI
from langchain_core.messages import AIMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from auth.dependencies import get_current_user


class _FakeLLM:
    """Stand-in for `agent.nodes.llm_with_tools` — returns a fixed
    `AIMessage` with no tool calls, so the graph routes straight to `END`
    after one `agent` node pass."""

    def __init__(self, content: str = "Canned assistant response"):
        self._content = content

    async def ainvoke(self, messages: Any) -> AIMessage:
        del messages
        return AIMessage(content=self._content, id=f"ai_{uuid.uuid4().hex[:8]}")


def _thread_id() -> str:
    return f"thread_{uuid.uuid4().hex[:8]}"


@pytest_asyncio.fixture
async def chat_client(
    test_pool, test_user_id, monkeypatch
) -> AsyncIterator[tuple[FastAPI, httpx.AsyncClient]]:
    """Real compiled chat graph (`agent.graph.builder`) with a real
    `AsyncPostgresSaver` checkpointer and a mocked LLM node, served through
    `api/chat_routes.py`'s router via `httpx.AsyncClient`
    (`sdd/sabbi-test-suite/design.md` — "Chat history tests -- real
    checkpointer, mocked LLM node")."""
    del test_pool  # depending on it triggers the TEST_DATABASE_URL skip guard
    database_url = os.environ["TEST_DATABASE_URL"]

    import agent.nodes as nodes_module
    from agent.graph import builder as graph_builder
    from api.chat_routes import router as chat_router

    monkeypatch.setattr(nodes_module, "llm_with_tools", _FakeLLM())

    app = FastAPI()
    app.include_router(chat_router)
    app.dependency_overrides[get_current_user] = lambda: {
        "id": test_user_id,
        "email": f"{test_user_id}@sabbi.test",
        "role": "user",
    }

    async with AsyncExitStack() as stack:
        checkpointer = await stack.enter_async_context(
            AsyncPostgresSaver.from_conn_string(database_url)
        )
        await checkpointer.setup()
        app.state.chat_graph = graph_builder.compile(checkpointer=checkpointer)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield app, client

    app.dependency_overrides.clear()


async def test_new_thread_returns_empty_messages(chat_client):
    _app, client = chat_client
    thread_id = _thread_id()

    response = await client.get(f"/chat/threads/{thread_id}/state")

    assert response.status_code == 200
    assert response.json() == {"thread_id": thread_id, "messages": []}


async def test_message_round_trips_through_postgres(chat_client):
    _app, client = chat_client
    thread_id = _thread_id()

    stream_response = await client.post(
        f"/chat/threads/{thread_id}/messages/stream", json={"message": "Hola SABBI"}
    )
    assert stream_response.status_code == 200
    assert "event: final" in stream_response.text
    assert "Canned assistant response" in stream_response.text

    state_response = await client.get(f"/chat/threads/{thread_id}/state")

    assert state_response.status_code == 200
    body = state_response.json()
    assert body["thread_id"] == thread_id
    assert len(body["messages"]) == 2
    assert body["messages"][0]["type"] == "human"
    assert body["messages"][0]["content"] == "Hola SABBI"
    assert body["messages"][1]["type"] == "ai"
    assert body["messages"][1]["content"] == "Canned assistant response"


async def test_multi_message_thread_loads_full_history_in_order(chat_client):
    _app, client = chat_client
    thread_id = _thread_id()

    for i in range(3):
        response = await client.post(
            f"/chat/threads/{thread_id}/messages/stream",
            json={"message": f"Mensaje {i}"},
        )
        assert response.status_code == 200

    state_response = await client.get(f"/chat/threads/{thread_id}/state")
    messages = state_response.json()["messages"]

    assert len(messages) == 6
    assert [m["type"] for m in messages] == ["human", "ai", "human", "ai", "human", "ai"]
    human_contents = [m["content"] for m in messages if m["type"] == "human"]
    assert human_contents == ["Mensaje 0", "Mensaje 1", "Mensaje 2"]


async def test_empty_message_returns_422(chat_client):
    _app, client = chat_client
    thread_id = _thread_id()

    response = await client.post(
        f"/chat/threads/{thread_id}/messages/stream", json={"message": ""}
    )

    assert response.status_code == 422

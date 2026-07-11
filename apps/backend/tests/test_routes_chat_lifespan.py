"""Tests for the chat-graph wiring in `api/routes.py`'s lifespan.

Covers `_init_chat_graph`: the helper that builds the Postgres-backed
LangGraph checkpointer/store and compiles `app.state.chat_graph`. No real
Postgres connection is made — `AsyncPostgresSaver`/`AsyncPostgresStore` and
the graph builder are all replaced with test doubles via monkeypatching the
`api.routes` module namespace.
"""

from __future__ import annotations

import asyncio
from contextlib import AsyncExitStack
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import FastAPI


class FakeAsyncCtxManager:
    """A minimal async context manager double for `.from_conn_string(...)`."""

    def __init__(self, resource):
        self._resource = resource

    async def __aenter__(self):
        return self._resource

    async def __aexit__(self, *exc_info):
        return False


def test_init_chat_graph_stays_none_without_postgres_uri(monkeypatch):
    import api.routes as routes_module

    monkeypatch.delenv("POSTGRES_URI", raising=False)
    saver_from_conn = AsyncMock()
    monkeypatch.setattr(
        routes_module.AsyncPostgresSaver, "from_conn_string", saver_from_conn
    )

    app = FastAPI()

    async def _run():
        async with AsyncExitStack() as stack:
            await routes_module._init_chat_graph(app, stack)

    asyncio.run(_run())

    assert app.state.chat_graph is None
    saver_from_conn.assert_not_called()


def test_init_chat_graph_compiles_graph_when_postgres_uri_set(monkeypatch):
    import api.routes as routes_module

    monkeypatch.setenv("POSTGRES_URI", "postgresql://test/db")

    checkpointer = AsyncMock()
    store = AsyncMock()
    compiled_graph = SimpleNamespace(name="compiled-chat-graph")

    monkeypatch.setattr(
        routes_module.AsyncPostgresSaver,
        "from_conn_string",
        lambda uri: FakeAsyncCtxManager(checkpointer),
    )
    monkeypatch.setattr(
        routes_module.AsyncPostgresStore,
        "from_conn_string",
        lambda uri: FakeAsyncCtxManager(store),
    )
    monkeypatch.setattr(
        routes_module.graph_builder,
        "compile",
        lambda **kwargs: compiled_graph if kwargs.get("checkpointer") is checkpointer
        and kwargs.get("store") is store
        else None,
    )

    app = FastAPI()

    async def _run():
        async with AsyncExitStack() as stack:
            await routes_module._init_chat_graph(app, stack)

    asyncio.run(_run())

    assert app.state.chat_graph is compiled_graph
    checkpointer.setup.assert_awaited_once()
    store.setup.assert_awaited_once()


def test_chat_router_is_included_in_app():
    """The chat router must be mounted on the app — hitting its routes
    without auth should 401 (route matched, guard rejected), not 404
    (route missing). Uses `TestClient` without entering it as a context
    manager, so the real lifespan (which opens a Postgres pool) never runs,
    matching the pattern in `test_routes_guarded.py`."""
    from fastapi.testclient import TestClient

    from api.routes import app

    client = TestClient(app)

    assert client.get("/chat/threads/thread_1/state").status_code == 401
    assert (
        client.post("/chat/threads/thread_1/messages/stream", json={"message": "hi"}).status_code
        == 401
    )
    assert client.delete("/chat/threads/thread_1").status_code == 401

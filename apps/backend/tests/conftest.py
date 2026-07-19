"""Shared pytest fixtures for the SABBI backend test suite.

Sets deterministic auth secrets/admin credentials for the whole session so
`auth.tokens` and `auth.seed` behave predictably regardless of what a local
`.env` file (loaded via `python-dotenv` in `db.connection`) contains.

Also provides real-Postgres fixtures (`test_pool`, `test_user_id`,
`patch_get_pool`, `tool_config`) for `tests/integration/` —
`sdd/sabbi-test-suite/spec` — "Test Database Fixture Isolation". These
fixtures connect to `TEST_DATABASE_URL`; when it is not set, any test that
(directly or transitively via the autouse `_rollback` fixture) needs a real
database is skipped rather than failing the whole suite.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any, AsyncIterator

os.environ["JWT_SECRET"] = "test-access-secret-at-least-32-bytes-long"
os.environ["JWT_REFRESH_SECRET"] = "test-refresh-secret-at-least-32-bytes-long"
os.environ["ADMIN_EMAIL"] = "admin@sabbi.test"
os.environ["ADMIN_PASSWORD"] = "test-admin-password-123"

import asyncpg
import pytest
import pytest_asyncio
from langchain_core.runnables import RunnableConfig

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
_SCHEMA_PATH = Path(__file__).parent.parent / "src" / "db" / "schema.sql"


def require_test_database_url() -> str:
    """Return `TEST_DATABASE_URL` or skip the current test when unset."""
    if not TEST_DATABASE_URL:
        pytest.skip("TEST_DATABASE_URL not set")
    return TEST_DATABASE_URL


class _FakeAcquireContext:
    """Async context manager mimicking `asyncpg.Pool.acquire()`'s shape.

    Since `_session_conn` (and, inside `tests/integration/`, the per-test
    SAVEPOINT wrapping it via the autouse `_rollback` fixture) is already a
    single connection shared for the whole test, `acquire()` just hands back
    that same connection — no separate locking/pooling logic is needed
    (`tasks.md` — T-001)."""

    def __init__(self, conn: asyncpg.Connection):
        self._conn = conn

    async def __aenter__(self) -> asyncpg.Connection:
        return self._conn

    async def __aexit__(self, *exc_info: Any) -> None:
        return None


class FakePool:
    """Minimal `asyncpg.Pool`-shaped wrapper around a single connection.

    `ProductRepository` and `UserRepository` call `fetch`, `fetchrow`,
    `fetchval`, and `execute` directly on the pool they receive, and
    transactional repository code (`sdd/portfolio-versioning/design.md` —
    ADR-1) calls `acquire()` to get a connection it can wrap in
    `conn.transaction()`. Forwarding all of these to one connection held
    inside a per-test SAVEPOINT is enough to drive real repository code
    against Postgres without a real connection pool (design.md —
    "Test DB isolation via savepoints"). Nested `conn.transaction()` calls
    on top of the outer session transaction / per-test savepoint are safe —
    asyncpg creates a further SAVEPOINT for each nested transaction rather
    than raising.
    """

    def __init__(self, conn: asyncpg.Connection):
        self._conn = conn

    async def fetch(self, query: str, *args: Any) -> list[asyncpg.Record]:
        return await self._conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> asyncpg.Record | None:
        return await self._conn.fetchrow(query, *args)

    async def fetchval(self, query: str, *args: Any) -> Any:
        return await self._conn.fetchval(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        return await self._conn.execute(query, *args)

    def acquire(self) -> _FakeAcquireContext:
        return _FakeAcquireContext(self._conn)


@pytest_asyncio.fixture(scope="session")
async def _session_conn() -> AsyncIterator[asyncpg.Connection]:
    """Session-scoped raw connection: applies `schema.sql` once, then stays
    open inside one never-committed outer transaction for the whole session
    so the per-test `_rollback` fixture can nest real SAVEPOINTs on top of it
    (`sdd/sabbi-test-suite/spec` — "Schema applied once per session")."""
    database_url = require_test_database_url()
    conn = await asyncpg.connect(database_url)
    await conn.execute(_SCHEMA_PATH.read_text())
    outer_transaction = conn.transaction()
    await outer_transaction.start()
    try:
        yield conn
    finally:
        await outer_transaction.rollback()
        await conn.close()



@pytest_asyncio.fixture
async def test_pool(_session_conn: asyncpg.Connection) -> FakePool:
    """`asyncpg.Pool`-shaped object backed by the savepoint-isolated session
    connection — safe to hand to `ProductRepository`/`UserRepository`."""
    return FakePool(_session_conn)


@pytest_asyncio.fixture
async def test_user_id(test_pool: FakePool) -> str:
    """Insert a deterministic test user so FK-constrained `products` rows
    have a valid `user_id` to reference."""
    user_id = str(uuid.uuid4())
    await test_pool.execute(
        "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)",
        user_id,
        f"{user_id}@sabbi.test",
        "not-a-real-hash",
        "user",
    )
    return user_id


@pytest.fixture
def patch_get_pool(test_pool: FakePool, monkeypatch: pytest.MonkeyPatch) -> FakePool:
    """Monkeypatch `db.connection.get_pool` (and the name as already bound
    inside `agent.tools`, which imports it via `from db.connection import
    get_pool`) to resolve to the test pool — design.md — "Agent tool test
    boundary -- patch `get_pool` only"."""
    import agent.tools as tools_module
    import db.connection as connection_module

    async def _fake_get_pool() -> FakePool:
        return test_pool

    monkeypatch.setattr(connection_module, "get_pool", _fake_get_pool)
    monkeypatch.setattr(tools_module, "get_pool", _fake_get_pool)
    return test_pool


@pytest.fixture
def tool_config(test_user_id: str) -> RunnableConfig:
    """`RunnableConfig` shaped like the `configurable.user_id` LangGraph
    injects per-run, for direct `.ainvoke()` calls against portfolio
    tools (`agent.tools._user_id`)."""
    return {"configurable": {"user_id": test_user_id}}

"""Integration-specific fixtures — drive the real FastAPI app
(`api.routes.app`) over real async HTTP against the savepoint-isolated test
Postgres connection (`tests/conftest.py` — `test_pool`).

`sdd/sabbi-test-suite/design.md` — "FastAPI test client -- httpx.AsyncClient
+ dependency override for auth": the app's own `lifespan` (which opens a
real production Postgres pool) is never entered — `ASGITransport(app=app)`
does not run Starlette lifespan by default — so `app.state.repo` is set
directly to a `ProductRepository` bound to the test pool, and
`get_current_user` is overridden so no real JWT cookie is needed.
"""

from __future__ import annotations

from typing import Any, AsyncIterator

import asyncpg
import httpx
import pytest_asyncio

from auth.dependencies import get_current_user
from db.repository import ProductRepository
from tests.conftest import FakePool


@pytest_asyncio.fixture(autouse=True)
async def _rollback(_session_conn: asyncpg.Connection) -> AsyncIterator[None]:
    """Wrap every integration test in a SAVEPOINT and roll it back afterward.
    Scoped to tests/integration/ only — non-integration tests are unaffected."""
    savepoint = _session_conn.transaction()
    await savepoint.start()
    try:
        yield
    finally:
        await savepoint.rollback()


def fake_user(user_id: str, *, role: str = "user") -> dict[str, Any]:
    """Build the `get_current_user`-shaped dict used to bypass real JWT auth
    in integration tests — matches the shape `auth.dependencies.get_current_user`
    returns from a decoded access token."""
    return {"id": user_id, "email": f"{user_id}@sabbi.test", "role": role}


@pytest_asyncio.fixture
async def api_client(
    test_pool: FakePool, test_user_id: str
) -> AsyncIterator[tuple[Any, httpx.AsyncClient]]:
    """`httpx.AsyncClient` bound to the real `api.routes.app` via
    `ASGITransport`, authenticated as `test_user_id` by default. Tests that
    need a second identity (e.g. ownership checks) can reassign
    `app.dependency_overrides[get_current_user]` mid-test using `fake_user`."""
    from api.routes import app

    app.state.repo = ProductRepository(test_pool)
    app.dependency_overrides[get_current_user] = lambda: fake_user(test_user_id)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield app, client

    app.dependency_overrides.pop(get_current_user, None)


@pytest_asyncio.fixture
async def unauthenticated_client(test_pool: FakePool) -> AsyncIterator[httpx.AsyncClient]:
    """`httpx.AsyncClient` against the real app with no auth override — used
    to assert routes reject requests without a valid session
    (`sdd/sabbi-test-suite/spec` — "Unauthenticated request is rejected")."""
    from api.routes import app

    app.state.repo = ProductRepository(test_pool)
    app.dependency_overrides.pop(get_current_user, None)

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client

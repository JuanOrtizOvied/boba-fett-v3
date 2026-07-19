"""Tests for `api/admin_routes.py` — user CRUD, portfolio viewing, thread
listing, all gated by `require_admin`.

Covers `user-management/spec.md` ("Admin creates a user", "Non-admin cannot
create users", "Duplicate email rejected", "Admin lists users"),
`admin-panel/spec.md` ("Admin views a user's portfolio", "Admin lists all
portfolios", "Admin views a user's chat thread", "Admin browses a user's
thread list"), and `access-control/spec.md` ("User role blocked from admin
routes").
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from langchain_core.messages import HumanMessage

from auth.tokens import create_access_token


class FakeChatGraph:
    def __init__(self, final_messages=None):
        self.final_messages = final_messages or []
        self.aget_state_calls: list[dict[str, Any]] = []

    async def aget_state(self, config):
        self.aget_state_calls.append(config)
        return SimpleNamespace(values={"messages": self.final_messages})


def _admin_token() -> str:
    return create_access_token(user_id="usr_admin", email="admin@sabbi.com", role="admin")


def _user_token() -> str:
    return create_access_token(user_id="usr_regular", email="u@sabbi.com", role="user")


@pytest.fixture
def app_client():
    from api.admin_routes import router

    app = FastAPI()
    app.include_router(router)
    app.state.user_repo = AsyncMock()
    app.state.repo = AsyncMock()
    app.state.versioning_repo = AsyncMock()
    app.state.chat_graph = None
    return app, TestClient(app)


# ---------------------------------------------------------------------------
# Role gate — shared across all /admin/* routes
# ---------------------------------------------------------------------------


def test_non_admin_blocked_from_admin_users_list(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.get("/admin/users")

    assert response.status_code == 403


def test_unauthenticated_blocked_from_admin_users_list(app_client):
    _app, client = app_client

    response = client.get("/admin/users")

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------


def test_admin_lists_users_excluding_password_hash(app_client):
    app, client = app_client
    app.state.user_repo.list_all.return_value = [
        {
            "id": "usr_1",
            "email": "a@sabbi.com",
            "password_hash": "$2b$secret",
            "role": "user",
            "created_at": "2026-01-01T00:00:00Z",
        }
    ]
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/users")

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {
            "id": "usr_1",
            "email": "a@sabbi.com",
            "role": "user",
            "created_at": "2026-01-01T00:00:00Z",
        }
    ]
    assert "password_hash" not in body[0]


def test_admin_creates_user_sets_created_by(app_client):
    app, client = app_client
    app.state.user_repo.get_by_email.return_value = None
    app.state.user_repo.create.return_value = {
        "id": "usr_new",
        "email": "new@sabbi.com",
        "password_hash": "$2b$hashed",
        "role": "user",
        "created_by": "usr_admin",
    }
    client.cookies.set("sabbi_access", _admin_token())

    response = client.post(
        "/admin/users",
        json={"email": "new@sabbi.com", "password": "supersecret1", "role": "user"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new@sabbi.com"
    assert "password_hash" not in body
    create_call = app.state.user_repo.create.call_args
    assert create_call.kwargs["created_by"] == "usr_admin"
    assert create_call.kwargs["email"] == "new@sabbi.com"


def test_non_admin_cannot_create_users(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.post(
        "/admin/users",
        json={"email": "x@sabbi.com", "password": "supersecret1", "role": "user"},
    )

    assert response.status_code == 403


def test_duplicate_email_rejected_with_409(app_client):
    app, client = app_client
    app.state.user_repo.get_by_email.return_value = {"id": "usr_existing", "email": "a@sabbi.com"}
    client.cookies.set("sabbi_access", _admin_token())

    response = client.post(
        "/admin/users",
        json={"email": "a@sabbi.com", "password": "supersecret1", "role": "user"},
    )

    assert response.status_code == 409
    app.state.user_repo.create.assert_not_awaited()


# ---------------------------------------------------------------------------
# Portfolio viewing (read-only)
# ---------------------------------------------------------------------------


def test_admin_lists_all_portfolios(app_client):
    app, client = app_client
    app.state.user_repo.list_all.return_value = [
        {"id": "usr_1", "email": "a@sabbi.com", "password_hash": "x", "role": "user"},
        {"id": "usr_2", "email": "b@sabbi.com", "password_hash": "x", "role": "user"},
    ]
    app.state.repo.get_summary.side_effect = [
        {"total_amount": 5000.0, "product_count": 2},
        {"total_amount": 0.0, "product_count": 0},
    ]
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/portfolios")

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {"user_id": "usr_1", "email": "a@sabbi.com", "product_count": 2, "total": 5000.0},
        {"user_id": "usr_2", "email": "b@sabbi.com", "product_count": 0, "total": 0.0},
    ]


def test_admin_views_specific_user_portfolio(app_client):
    app, client = app_client
    app.state.repo.list_by_user.return_value = [
        AsyncMock(model_dump=lambda: {"id": "prod_1", "name": "Fund A"})
    ]
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/portfolios/usr_1")

    assert response.status_code == 200
    assert response.json() == {"products": [{"id": "prod_1", "name": "Fund A"}]}
    app.state.repo.list_by_user.assert_awaited_once_with("usr_1")


def test_non_admin_cannot_view_admin_portfolios_list(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.get("/admin/portfolios")

    assert response.status_code == 403


# ---------------------------------------------------------------------------
# Portfolio versioning — read-only change log + snapshots
# (`sdd/portfolio-versioning/tasks.md` T-018, AL-007, SNAP-010)
# ---------------------------------------------------------------------------


def test_admin_views_client_change_history(app_client):
    app, client = app_client
    app.state.versioning_repo.list_changes.return_value = {
        "changes": [{"id": "chg_1", "operation": "create"}],
        "total": 1,
        "has_more": False,
    }
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/portfolios/usr_client/changes")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    app.state.versioning_repo.list_changes.assert_awaited_once_with(
        "usr_client", limit=50, offset=0, operation=None
    )


def test_admin_views_client_change_history_filters_by_operation(app_client):
    app, client = app_client
    app.state.versioning_repo.list_changes.return_value = {
        "changes": [],
        "total": 0,
        "has_more": False,
    }
    client.cookies.set("sabbi_access", _admin_token())

    client.get("/admin/portfolios/usr_client/changes?operation=delete")

    app.state.versioning_repo.list_changes.assert_awaited_once_with(
        "usr_client", limit=50, offset=0, operation="delete"
    )


def test_non_admin_cannot_view_client_change_history(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.get("/admin/portfolios/usr_client/changes")

    assert response.status_code == 403


def test_admin_views_client_snapshots(app_client):
    app, client = app_client
    app.state.versioning_repo.list_snapshots.return_value = [
        {"id": "snap_1", "name": "Q2 Review"}
    ]
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/portfolios/usr_client/snapshots")

    assert response.status_code == 200
    body = response.json()
    assert body["snapshots"][0]["name"] == "Q2 Review"
    app.state.versioning_repo.list_snapshots.assert_awaited_once_with(
        "usr_client", limit=50, offset=0
    )


def test_non_admin_cannot_view_client_snapshots(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.get("/admin/portfolios/usr_client/snapshots")

    assert response.status_code == 403


def test_admin_versioning_routes_are_read_only(app_client):
    """No admin route allows creating/mutating a snapshot or change log
    entry for another user — only `GET` routes are registered under
    `/admin/portfolios/{user_id}/changes` and `/admin/portfolios/{user_id}/snapshots`."""
    app, client = app_client
    client.cookies.set("sabbi_access", _admin_token())

    response = client.post("/admin/portfolios/usr_client/snapshots", json={"name": "x"})

    assert response.status_code in (404, 405)
    app.state.versioning_repo.create_snapshot.assert_not_called()


# ---------------------------------------------------------------------------
# Thread listing (read-only, via FastAPI chat graph)
# ---------------------------------------------------------------------------


def test_admin_lists_threads(app_client):
    app, client = app_client
    app.state.user_repo.list_active_threads.return_value = [
        {
            "id": "usr_1",
            "email": "a@sabbi.com",
            "active_thread_id": "th_1",
            "updated_at": "2026-01-01T00:00:00Z",
        },
        {
            "id": "usr_2",
            "email": "b@sabbi.com",
            "active_thread_id": "th_2",
            "updated_at": "2026-01-02T00:00:00Z",
        },
    ]
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/threads")

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {
            "thread_id": "th_1",
            "user_id": "usr_1",
            "email": "a@sabbi.com",
            "created_at": "2026-01-01T00:00:00Z",
        },
        {
            "thread_id": "th_2",
            "user_id": "usr_2",
            "email": "b@sabbi.com",
            "created_at": "2026-01-02T00:00:00Z",
        },
    ]
    app.state.user_repo.list_active_threads.assert_awaited_once()


def test_admin_views_specific_thread_messages(app_client):
    app, client = app_client
    app.state.chat_graph = FakeChatGraph(
        final_messages=[HumanMessage(content="hola", id="msg_1")]
    )
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/threads/th_1")

    assert response.status_code == 200
    body = response.json()
    assert body["messages"][0]["id"] == "msg_1"
    assert body["messages"][0]["type"] == "human"
    assert body["messages"][0]["content"] == "hola"
    assert app.state.chat_graph.aget_state_calls[0]["configurable"]["thread_id"] == "th_1"


def test_admin_view_thread_graph_not_initialized_returns_503(app_client):
    app, client = app_client
    app.state.chat_graph = None
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/threads/th_1")

    assert response.status_code == 503

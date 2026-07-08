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

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.tokens import create_access_token


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
# Thread listing (read-only, via LangGraph SDK)
# ---------------------------------------------------------------------------


def test_admin_lists_threads(app_client, monkeypatch):
    app, client = app_client

    fake_client = AsyncMock()
    fake_client.threads.search.return_value = [
        {
            "thread_id": "th_1",
            "created_at": "2026-01-01T00:00:00Z",
            "metadata": {"owner_user_id": "usr_1"},
        },
        {
            "thread_id": "th_2",
            "created_at": "2026-01-02T00:00:00Z",
            "metadata": {},  # pre-auth thread — no owner metadata
        },
    ]

    import api.admin_routes as admin_routes_module

    monkeypatch.setattr(admin_routes_module, "_get_langgraph_client", lambda: fake_client)
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/threads")

    assert response.status_code == 200
    body = response.json()
    assert body == [
        {"thread_id": "th_1", "user_id": "usr_1", "created_at": "2026-01-01T00:00:00Z"},
        {"thread_id": "th_2", "user_id": None, "created_at": "2026-01-02T00:00:00Z"},
    ]


def test_admin_views_specific_thread_messages(app_client, monkeypatch):
    app, client = app_client

    fake_client = AsyncMock()
    fake_client.threads.get_state.return_value = {
        "values": {"messages": [{"type": "human", "content": "hola"}]}
    }

    import api.admin_routes as admin_routes_module

    monkeypatch.setattr(admin_routes_module, "_get_langgraph_client", lambda: fake_client)
    client.cookies.set("sabbi_access", _admin_token())

    response = client.get("/admin/threads/th_1")

    assert response.status_code == 200
    assert response.json() == {"messages": [{"type": "human", "content": "hola"}]}
    fake_client.threads.get_state.assert_awaited_once_with("th_1")

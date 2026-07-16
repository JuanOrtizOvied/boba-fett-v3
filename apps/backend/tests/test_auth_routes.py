"""Tests for `api/auth_routes.py` — login, logout, refresh, me.

Uses a FastAPI `TestClient` against a minimal app that only mounts the auth
router, with `app.state.user_repo` mocked (`unittest.mock.AsyncMock`) — no
real Postgres required. Covers `user-auth/spec.md` scenarios: "Successful
login", "Invalid credentials", "Refresh issues new access token", "Invalid
or expired refresh token forces re-login", "Logout clears session", "Fetch
current user".
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.passwords import hash_password
from auth.tokens import create_access_token, create_refresh_token, hash_refresh_token


def _fake_user_row(**overrides) -> dict:
    row = {
        "id": "usr_abc123",
        "email": "investor@sabbi.com",
        "password_hash": hash_password("correct-horse-battery"),
        "role": "user",
        "created_by": None,
    }
    row.update(overrides)
    return row


@pytest.fixture
def app_client():
    from api.auth_routes import router

    app = FastAPI()
    app.include_router(router)
    app.state.user_repo = AsyncMock()
    return app, TestClient(app)


def test_login_success_sets_cookies_and_returns_user(app_client):
    app, client = app_client
    app.state.user_repo.get_by_email.return_value = _fake_user_row()

    response = client.post(
        "/auth/login",
        json={"email": "investor@sabbi.com", "password": "correct-horse-battery"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["user"] == {"id": "usr_abc123", "email": "investor@sabbi.com", "role": "user"}
    assert "password_hash" not in body["user"]
    assert "sabbi_access" in response.cookies
    assert "sabbi_refresh" in response.cookies
    app.state.user_repo.store_refresh_token.assert_awaited_once()


def test_login_wrong_password_returns_401(app_client):
    app, client = app_client
    app.state.user_repo.get_by_email.return_value = _fake_user_row()

    response = client.post(
        "/auth/login",
        json={"email": "investor@sabbi.com", "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert "sabbi_access" not in response.cookies


def test_login_unknown_email_returns_401_without_revealing(app_client):
    app, client = app_client
    app.state.user_repo.get_by_email.return_value = None

    response = client.post(
        "/auth/login",
        json={"email": "nobody@sabbi.com", "password": "whatever"},
    )

    assert response.status_code == 401
    # Same generic message as wrong-password case — do not leak existence
    assert response.json()["detail"] == "Invalid email or password"


def test_logout_clears_cookies_and_deletes_token(app_client):
    app, client = app_client
    refresh_token = create_refresh_token(user_id="usr_abc123")
    client.cookies.set("sabbi_refresh", refresh_token)

    response = client.post("/auth/logout")

    assert response.status_code == 200
    app.state.user_repo.delete_refresh_token.assert_awaited_once_with(
        hash_refresh_token(refresh_token)
    )
    set_cookie_headers = response.headers.get_list("set-cookie")

    def _is_cleared(name: str) -> bool:
        return any(
            f"{name}=" in h and ("Max-Age=0" in h or "expires=" in h.lower())
            for h in set_cookie_headers
        )

    assert _is_cleared("sabbi_access")
    assert _is_cleared("sabbi_refresh")


def test_refresh_rotates_tokens(app_client):
    app, client = app_client
    old_refresh = create_refresh_token(user_id="usr_abc123")
    app.state.user_repo.get_refresh_token.return_value = {
        "id": "rt_1",
        "user_id": "usr_abc123",
        "token_hash": hash_refresh_token(old_refresh),
    }
    app.state.user_repo.get_by_id.return_value = _fake_user_row()
    client.cookies.set("sabbi_refresh", old_refresh)

    response = client.post("/auth/refresh")

    assert response.status_code == 200
    app.state.user_repo.delete_refresh_token.assert_awaited_once_with(
        hash_refresh_token(old_refresh)
    )
    app.state.user_repo.store_refresh_token.assert_awaited_once()
    assert "sabbi_access" in response.cookies
    assert "sabbi_refresh" in response.cookies
    # rotation-on-use: the old token row is deleted (by hash) and a brand
    # new row is persisted for the new refresh token — this is what makes
    # the old refresh token single-use, not textual difference from the
    # new JWT (two tokens minted in the same second for the same user are
    # byte-identical since HS256 signing is deterministic over identical
    # claims — the DB row swap, asserted above, is the actual rotation).
    stored_call = app.state.user_repo.store_refresh_token.call_args
    assert stored_call.kwargs["user_id"] == "usr_abc123"


def test_refresh_missing_cookie_returns_401(app_client):
    app, client = app_client

    response = client.post("/auth/refresh")

    assert response.status_code == 401


def test_refresh_revoked_token_not_in_db_returns_401(app_client):
    app, client = app_client
    old_refresh = create_refresh_token(user_id="usr_abc123")
    app.state.user_repo.get_refresh_token.return_value = None
    client.cookies.set("sabbi_refresh", old_refresh)

    response = client.post("/auth/refresh")

    assert response.status_code == 401


def test_me_returns_current_user_from_access_cookie(app_client):
    app, client = app_client
    token = create_access_token(user_id="usr_abc123", email="investor@sabbi.com", role="user")
    app.state.user_repo.get_active_thread_id.return_value = "thread_abc"
    client.cookies.set("sabbi_access", token)

    response = client.get("/auth/me")

    assert response.status_code == 200
    assert response.json() == {
        "id": "usr_abc123",
        "email": "investor@sabbi.com",
        "role": "user",
        "active_thread_id": "thread_abc",
    }


def test_me_without_cookie_returns_401(app_client):
    app, client = app_client

    response = client.get("/auth/me")

    assert response.status_code == 401

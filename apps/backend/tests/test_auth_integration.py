"""End-to-end integration tests across the full `api.routes.app` (auth +
admin + guarded portfolio routes wired together), proving cookies set by
`/auth/login` are honored by subsequent authenticated requests on the same
client session. Mocks `app.state.repo` / `app.state.user_repo` — no real
Postgres — but exercises the REAL dependency graph (`get_current_user`,
`require_admin`, ownership checks) end to end, per `design.md` — "Testing
Strategy" → Integration: "Login → cookie set → authenticated request → data
scoped to user".
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from auth.passwords import hash_password


def _fake_user_row(**overrides) -> dict:
    row = {
        "id": "usr_owner",
        "email": "owner@sabbi.com",
        "password_hash": hash_password("correct-horse-battery"),
        "role": "user",
        "created_by": None,
    }
    row.update(overrides)
    return row


@pytest.fixture
def app_client():
    from api.routes import app

    app.state.repo = AsyncMock()
    app.state.user_repo = AsyncMock()
    client = TestClient(app)
    yield app, client
    app.dependency_overrides.clear()


def test_login_then_authenticated_request_returns_scoped_data(app_client):
    app, client = app_client
    app.state.user_repo.get_by_email.return_value = _fake_user_row()

    login_response = client.post(
        "/auth/login",
        json={"email": "owner@sabbi.com", "password": "correct-horse-battery"},
    )
    assert login_response.status_code == 200

    product = MagicMock()
    product.user_id = "usr_owner"
    product.model_dump.return_value = {"id": "prod_1", "user_id": "usr_owner", "name": "Fund A"}
    app.state.repo.list_by_user.return_value = [product]

    portfolio_response = client.get("/portfolio/me")

    assert portfolio_response.status_code == 200
    assert portfolio_response.json() == {
        "products": [{"id": "prod_1", "user_id": "usr_owner", "name": "Fund A"}]
    }
    # The user_id passed to the repo comes from the JWT set during login,
    # not from any client-supplied path parameter.
    app.state.repo.list_by_user.assert_awaited_once_with("usr_owner")


def test_login_then_admin_route_returns_403_for_non_admin(app_client):
    app, client = app_client
    app.state.user_repo.get_by_email.return_value = _fake_user_row(role="user")

    client.post(
        "/auth/login",
        json={"email": "owner@sabbi.com", "password": "correct-horse-battery"},
    )

    response = client.get("/admin/users")

    assert response.status_code == 403


def test_login_then_cross_user_product_mutation_returns_403(app_client):
    app, client = app_client
    app.state.user_repo.get_by_email.return_value = _fake_user_row(id="usr_intruder")

    client.post(
        "/auth/login",
        json={"email": "owner@sabbi.com", "password": "correct-horse-battery"},
    )

    other_users_product = MagicMock()
    other_users_product.user_id = "usr_victim"
    app.state.repo.get.return_value = other_users_product

    response = client.patch("/products/prod_victim", json={"amount": 999})

    assert response.status_code == 403
    app.state.repo.update.assert_not_awaited()


def test_no_login_blocks_portfolio_access(app_client):
    _app, client = app_client

    response = client.get("/portfolio/me")

    assert response.status_code == 401

"""Tests for the guarded `api/routes.py` portfolio/product endpoints.

Covers `product-management` delta spec ("Authenticated edit via REST API",
"Authenticated delete via REST API", "Unauthenticated request is rejected",
"User cannot edit another user's product") and `dashboard` delta spec
("Dashboard loads current user's portfolio" — `/portfolio/me`).

`app.state.repo` is mocked (`unittest.mock.AsyncMock`) — no real Postgres
required. The app's real `lifespan` (which opens a Postgres pool) is never
triggered because these tests call `TestClient(app)` without entering it as
a context manager (Starlette only runs lifespan on `__enter__`).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from auth.dependencies import get_current_user


def _fake_product(user_id: str = "usr_owner", product_id: str = "prod_1"):
    product = MagicMock()
    product.user_id = user_id
    product.model_dump.return_value = {"id": product_id, "user_id": user_id, "name": "Fund A"}
    return product


@pytest.fixture
def app_client():
    from api.routes import app

    app.state.repo = AsyncMock()
    client = TestClient(app)
    yield app, client
    app.dependency_overrides.clear()


def _authenticate(app, *, user_id: str = "usr_owner", role: str = "user") -> None:
    app.dependency_overrides[get_current_user] = lambda: {
        "id": user_id,
        "email": f"{user_id}@sabbi.com",
        "role": role,
    }


# ---------------------------------------------------------------------------
# Authentication guard
# ---------------------------------------------------------------------------


def test_list_products_requires_authentication(app_client):
    _app, client = app_client

    response = client.get("/portfolio/me")

    assert response.status_code == 401


def test_export_requires_authentication(app_client):
    _app, client = app_client

    response = client.get("/portfolio/me/export")

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# /portfolio/me — scoped to authenticated user, no path param leaking user id
# ---------------------------------------------------------------------------


def test_list_products_scoped_to_authenticated_user(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.repo.list_by_user.return_value = [_fake_product()]

    response = client.get("/portfolio/me")

    assert response.status_code == 200
    expected_product = {"id": "prod_1", "user_id": "usr_owner", "name": "Fund A"}
    assert response.json() == {"products": [expected_product]}
    app.state.repo.list_by_user.assert_awaited_once_with("usr_owner")


def test_create_product_scoped_to_authenticated_user(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.repo.create.return_value = _fake_product()

    response = client.post(
        "/portfolio/me/products",
        json={"name": "Fund A", "amount": 1000, "category": "cash_y_equivalentes"},
    )

    assert response.status_code == 201
    create_call = app.state.repo.create.call_args
    assert create_call.args[0] == "usr_owner"


def test_summary_scoped_to_authenticated_user(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.repo.get_summary.return_value = {"total_amount": 0, "product_count": 0}

    response = client.get("/portfolio/me/summary")

    assert response.status_code == 200
    app.state.repo.get_summary.assert_awaited_once_with("usr_owner")


# ---------------------------------------------------------------------------
# Ownership enforcement on product mutation
# ---------------------------------------------------------------------------


def test_owner_can_update_own_product(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.repo.get.return_value = _fake_product(user_id="usr_owner")
    app.state.repo.update.return_value = _fake_product(user_id="usr_owner")

    response = client.patch("/products/prod_1", json={"amount": 2000})

    assert response.status_code == 200
    app.state.repo.update.assert_awaited_once()


def test_non_owner_cannot_update_product(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_intruder")
    app.state.repo.get.return_value = _fake_product(user_id="usr_owner")

    response = client.patch("/products/prod_1", json={"amount": 2000})

    assert response.status_code == 403
    app.state.repo.update.assert_not_awaited()


def test_admin_cannot_mutate_another_users_product(app_client):
    """access-control/spec.md — 'Admin denied mutation on another user's
    resource': admin read-only oversight does not extend to writes."""
    app, client = app_client
    _authenticate(app, user_id="usr_admin", role="admin")
    app.state.repo.get.return_value = _fake_product(user_id="usr_owner")

    response = client.patch("/products/prod_1", json={"amount": 2000})

    assert response.status_code == 403
    app.state.repo.update.assert_not_awaited()


def test_owner_can_delete_own_product(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.repo.get.return_value = _fake_product(user_id="usr_owner")
    app.state.repo.delete.return_value = True

    response = client.delete("/products/prod_1")

    assert response.status_code == 204
    app.state.repo.delete.assert_awaited_once_with("prod_1")


def test_non_owner_cannot_delete_product(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_intruder")
    app.state.repo.get.return_value = _fake_product(user_id="usr_owner")

    response = client.delete("/products/prod_1")

    assert response.status_code == 403
    app.state.repo.delete.assert_not_awaited()


def test_update_missing_product_returns_404(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.repo.get.return_value = None

    response = client.patch("/products/does_not_exist", json={"amount": 2000})

    assert response.status_code == 404

"""Integration tests for `api/routes.py` portfolio/product REST endpoints
against real Postgres, driven end-to-end via `httpx.AsyncClient`.

Spec: "REST API CRUD With Ownership and Auth Enforcement"
(`sdd/sabbi-test-suite/spec`).
"""

from __future__ import annotations

import uuid

from auth.dependencies import get_current_user
from tests.integration.conftest import fake_user


async def _insert_user(test_pool, *, role: str = "user") -> str:
    user_id = str(uuid.uuid4())
    await test_pool.execute(
        "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)",
        user_id,
        f"{user_id}@sabbi.test",
        "not-a-real-hash",
        role,
    )
    return user_id


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


async def test_create_product_with_valid_payload_persists_in_postgres(api_client, test_pool):
    _app, client = api_client

    response = await client.post(
        "/portfolio/me/products",
        json={"name": "BlackRock Fund", "amount": 1000, "category": "publicos"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "BlackRock Fund"

    row = await test_pool.fetchrow("SELECT * FROM products WHERE id = $1", body["id"])
    assert row is not None
    assert row["name"] == "BlackRock Fund"
    assert float(row["amount"]) == 1000


async def test_create_product_with_invalid_amount_returns_422_and_no_insert(
    api_client, test_pool
):
    _app, client = api_client

    response = await client.post(
        "/portfolio/me/products",
        json={"name": "Bad Fund", "amount": -5, "category": "publicos"},
    )

    assert response.status_code == 422
    count = await test_pool.fetchval(
        "SELECT count(*) FROM products WHERE name = $1", "Bad Fund"
    )
    assert count == 0


async def test_create_product_missing_required_field_returns_422(api_client):
    _app, client = api_client

    response = await client.post(
        "/portfolio/me/products",
        json={"amount": 1000, "category": "publicos"},  # missing "name"
    )

    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Auth guard
# ---------------------------------------------------------------------------


async def test_unauthenticated_request_is_rejected(unauthenticated_client):
    response = await unauthenticated_client.get("/portfolio/me")

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Ownership enforcement
# ---------------------------------------------------------------------------


async def test_update_rejects_non_owner(api_client, test_pool):
    app, client = api_client

    create_response = await client.post(
        "/portfolio/me/products",
        json={"name": "Owner Fund", "amount": 500, "category": "cash"},
    )
    product_id = create_response.json()["id"]

    intruder_id = await _insert_user(test_pool)
    app.dependency_overrides[get_current_user] = lambda: fake_user(intruder_id)

    response = await client.patch(f"/products/{product_id}", json={"amount": 999})

    assert response.status_code == 403
    row = await test_pool.fetchrow("SELECT amount FROM products WHERE id = $1", product_id)
    assert float(row["amount"]) == 500


async def test_update_rejects_non_owner_admin(api_client, test_pool):
    """access-control — admin's read-only oversight does not extend to
    writes on another user's product."""
    app, client = api_client

    create_response = await client.post(
        "/portfolio/me/products",
        json={"name": "Owner Fund", "amount": 500, "category": "cash"},
    )
    product_id = create_response.json()["id"]

    admin_id = await _insert_user(test_pool, role="admin")
    app.dependency_overrides[get_current_user] = lambda: fake_user(admin_id, role="admin")

    response = await client.patch(f"/products/{product_id}", json={"amount": 999})

    assert response.status_code == 403
    row = await test_pool.fetchrow("SELECT amount FROM products WHERE id = $1", product_id)
    assert float(row["amount"]) == 500


# ---------------------------------------------------------------------------
# Delete
# ---------------------------------------------------------------------------


async def test_delete_nonexistent_product_returns_404(api_client):
    _app, client = api_client

    response = await client.delete("/products/does_not_exist")

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# List / summary scoping
# ---------------------------------------------------------------------------


async def test_list_and_summary_scoped_to_caller_only(api_client, test_pool):
    app, client = api_client

    await client.post(
        "/portfolio/me/products",
        json={"name": "User A Fund", "amount": 1000, "category": "cash"},
    )

    user_b_id = await _insert_user(test_pool)
    app.dependency_overrides[get_current_user] = lambda: fake_user(user_b_id)
    await client.post(
        "/portfolio/me/products",
        json={"name": "User B Fund", "amount": 2000, "category": "cash"},
    )

    list_response = await client.get("/portfolio/me")
    summary_response = await client.get("/portfolio/me/summary")

    assert list_response.status_code == 200
    products = list_response.json()["products"]
    assert len(products) == 1
    assert products[0]["name"] == "User B Fund"

    assert summary_response.status_code == 200
    assert summary_response.json()["total_amount"] == 2000

"""Integration tests for `/admin/products`, `/admin/catalog/*` routes
against real Postgres, driven end-to-end via `httpx.AsyncClient`.

Covers `sdd/product-catalog-approval/spec` — "Approve Portfolio Product to
Catalog", "Duplicate Detection Before Catalog Insertion", "Catalog
Listing", "Catalog Entry Deletion".
"""

from __future__ import annotations

import uuid

from auth.dependencies import get_current_user
from tests.integration.conftest import fake_user


def _approve_payload(**overrides) -> dict:
    payload = {
        "name": "Bono Soberano",
        "category": "mercados_publicos",
        "asset_class": "bonos",
        "commission": "1.5%",
    }
    payload.update(overrides)
    return payload


# ---------------------------------------------------------------------------
# POST /admin/catalog/approve
# ---------------------------------------------------------------------------


async def test_approve_creates_catalog_entry(admin_api_client, test_pool):
    _app, client = admin_api_client

    response = await client.post("/admin/catalog/approve", json=_approve_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Bono Soberano"
    row = await test_pool.fetchrow(
        "SELECT * FROM product_catalog WHERE id = $1", body["id"]
    )
    assert row is not None
    assert row["category"] == "mercados_publicos"


async def test_approve_missing_required_field_returns_422_and_no_insert(
    admin_api_client, test_pool
):
    _app, client = admin_api_client

    response = await client.post(
        "/admin/catalog/approve", json={"category": "mercados_publicos"}  # missing "name"
    )

    assert response.status_code == 422
    count = await test_pool.fetchval(
        "SELECT count(*) FROM product_catalog WHERE category = $1", "mercados_publicos"
    )
    assert count == 0


async def test_approve_duplicate_returns_409(admin_api_client):
    _app, client = admin_api_client
    await client.post("/admin/catalog/approve", json=_approve_payload())

    response = await client.post(
        "/admin/catalog/approve", json=_approve_payload(name="  bono soberano  ")
    )

    assert response.status_code == 409


async def test_approve_full_flow_create_then_repeat_rejected(admin_api_client, test_pool):
    """Full flow: create a portfolio product -> approve -> verify row ->
    repeat approval -> 409 (task 4.3)."""
    app, client = admin_api_client

    user_id = str(uuid.uuid4())
    await test_pool.execute(
        "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)",
        user_id,
        f"{user_id}@sabbi.test",
        "not-a-real-hash",
        "user",
    )
    product_id = "prod_test0001"
    await test_pool.execute(
        """INSERT INTO products (id, user_id, name, amount, category)
           VALUES ($1, $2, $3, $4, $5)""",
        product_id,
        user_id,
        "Fondo Renta",
        1000,
        "mercados_publicos",
    )

    first = await client.post(
        "/admin/catalog/approve",
        json=_approve_payload(
            name="Fondo Renta",
            approved_from_product_id=product_id,
        ),
    )
    assert first.status_code == 201
    assert first.json()["approved_from_product_id"] == product_id

    repeat = await client.post(
        "/admin/catalog/approve",
        json=_approve_payload(name="Fondo Renta"),
    )
    assert repeat.status_code == 409


async def test_approve_replaces_existing_catalog_entry_when_product_has_catalog_id(
    admin_api_client, test_pool
):
    _app, client = admin_api_client
    created = await client.post(
        "/admin/catalog/approve",
        json=_approve_payload(name="Catalog Fund", commission="1.5%"),
    )
    catalog_id = created.json()["id"]

    response = await client.post(
        "/admin/catalog/approve",
        json=_approve_payload(
            name="Catalog Fund Updated",
            commission="2.0%",
            catalog_product_id=catalog_id,
            approved_from_product_id="prod_catalog_source",
        ),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == catalog_id
    assert body["name"] == "Catalog Fund Updated"
    assert body["commission"] == "2.0%"
    assert body["approved_from_product_id"] == "prod_catalog_source"
    count = await test_pool.fetchval("SELECT count(*) FROM product_catalog")
    assert count == 1


async def test_approve_without_admin_role_returns_403(admin_api_client):
    app, client = admin_api_client
    non_admin_id = str(uuid.uuid4())
    app.dependency_overrides[get_current_user] = lambda: fake_user(non_admin_id, role="user")

    response = await client.post("/admin/catalog/approve", json=_approve_payload())

    assert response.status_code == 403


# ---------------------------------------------------------------------------
# GET /admin/catalog/entries
# ---------------------------------------------------------------------------


async def test_list_catalog_entries_returns_all_fields(admin_api_client):
    _app, client = admin_api_client
    await client.post("/admin/catalog/approve", json=_approve_payload())

    response = await client.get("/admin/catalog/entries")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["name"] == "Bono Soberano"
    assert body[0]["commission"] == "1.5%"


# ---------------------------------------------------------------------------
# DELETE /admin/catalog/entries/{id}
# ---------------------------------------------------------------------------


async def test_delete_catalog_entry_removes_from_listing(admin_api_client):
    _app, client = admin_api_client
    created = await client.post("/admin/catalog/approve", json=_approve_payload())
    catalog_id = created.json()["id"]

    delete_response = await client.delete(f"/admin/catalog/entries/{catalog_id}")
    list_response = await client.get("/admin/catalog/entries")

    assert delete_response.status_code == 204
    assert list_response.json() == []


async def test_delete_nonexistent_catalog_entry_returns_404(admin_api_client):
    _app, client = admin_api_client

    response = await client.delete("/admin/catalog/entries/999999")

    assert response.status_code == 404


# ---------------------------------------------------------------------------
# GET /admin/products (cross-list)
# ---------------------------------------------------------------------------


async def test_admin_lists_all_products_across_users_with_email(admin_api_client, test_pool):
    _app, client = admin_api_client
    user_id = str(uuid.uuid4())
    await test_pool.execute(
        "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)",
        user_id,
        "owner@sabbi.test",
        "not-a-real-hash",
        "user",
    )
    await test_pool.execute(
        """INSERT INTO products (id, user_id, name, amount, category)
           VALUES ($1, $2, $3, $4, $5)""",
        "prod_cross0001",
        user_id,
        "Cross Fund",
        500,
        "cash_y_equivalentes",
    )

    response = await client.get("/admin/products")

    assert response.status_code == 200
    body = response.json()
    matches = [p for p in body if p["id"] == "prod_cross0001"]
    assert len(matches) == 1
    assert matches[0]["user_email"] == "owner@sabbi.test"
    assert matches[0]["name"] == "Cross Fund"

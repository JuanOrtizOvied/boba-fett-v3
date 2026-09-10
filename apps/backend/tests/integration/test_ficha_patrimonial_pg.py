"""Integration tests for `POST /admin/ficha-patrimonial/confirm` against
real Postgres, driven end-to-end via `httpx.AsyncClient`
(`sdd/admin-ficha-patrimonial/spec` — "Ficha Confirm Endpoint", "Confirm
creates all products", "Unknown email hard-fails", "One invalid row rejects
the whole batch").
"""

from __future__ import annotations

import uuid


def _confirm_row(**overrides) -> dict:
    row = {
        "name": "Fondo XYZ - BlackRock",
        "provider": "",
        "amount": 50000.0,
        "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
        "geographic_focus": [],
        "underlying": [],
        "commission": "1.5%",
        "currency": "USD",
        "administrator": "BlackRock",
        "manager": "",
        "liquidity": "Diaria",
        "return_rate": "7.5",
        "catalog_product_id": None,
    }
    row.update(overrides)
    return row


async def _create_target_user(test_pool) -> str:
    user_id = str(uuid.uuid4())
    await test_pool.execute(
        "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)",
        user_id,
        f"{user_id}@sabbi.test",
        "not-a-real-hash",
        "user",
    )
    return user_id


async def test_confirm_creates_all_products_with_ficha_import_source(
    admin_api_client, test_pool
):
    _app, client = admin_api_client
    target_user_id = await _create_target_user(test_pool)

    response = await client.post(
        "/admin/ficha-patrimonial/confirm",
        json={
            "user_id": target_user_id,
            "products": [
                _confirm_row(name="Fondo A", amount=1000),
                _confirm_row(name="Fondo B", amount=2000),
                _confirm_row(name="Fondo C", amount=3000),
            ],
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["created_count"] == 3
    assert len(body["product_ids"]) == 3

    rows = await test_pool.fetch(
        "SELECT id, user_id FROM products WHERE user_id = $1", target_user_id
    )
    assert len(rows) == 3

    change_rows = await test_pool.fetch(
        "SELECT source FROM portfolio_changes WHERE user_id = $1", target_user_id
    )
    assert all(r["source"] == "admin_ficha_import" for r in change_rows)


async def test_confirm_unknown_user_returns_404_and_creates_nothing(
    admin_api_client, test_pool
):
    _app, client = admin_api_client
    bogus_user_id = str(uuid.uuid4())

    response = await client.post(
        "/admin/ficha-patrimonial/confirm",
        json={"user_id": bogus_user_id, "products": [_confirm_row()]},
    )

    assert response.status_code == 404
    count = await test_pool.fetchval(
        "SELECT count(*) FROM products WHERE user_id = $1", bogus_user_id
    )
    assert count == 0


async def test_confirm_invalid_row_rejects_whole_batch(admin_api_client, test_pool):
    _app, client = admin_api_client
    target_user_id = await _create_target_user(test_pool)

    response = await client.post(
        "/admin/ficha-patrimonial/confirm",
        json={
            "user_id": target_user_id,
            "products": [
                _confirm_row(name="Fondo Valid", amount=1000),
                # asset_class percentages don't sum to 100 -> ProductCreate
                # validation fails, whole batch must roll back.
                _confirm_row(
                    name="Fondo Invalid",
                    amount=2000,
                    asset_class=[{"name": "mercados_publicos", "percentage": 40}],
                ),
            ],
        },
    )

    assert response.status_code == 422
    count = await test_pool.fetchval(
        "SELECT count(*) FROM products WHERE user_id = $1", target_user_id
    )
    assert count == 0


async def test_non_admin_blocked_from_confirm(api_client):
    _app, client = api_client

    response = await client.post(
        "/admin/ficha-patrimonial/confirm",
        json={"user_id": str(uuid.uuid4()), "products": [_confirm_row()]},
    )

    assert response.status_code == 403

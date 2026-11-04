"""Route-level integration tests for the `/admin/normalized-catalog/*` CRUD
against real Postgres (savepoint-isolated), via the admin-authenticated client."""

from __future__ import annotations

BASE = "/admin/normalized-catalog"


async def _mk_product(client, code="BD-1", **extra):
    r = await client.post(f"{BASE}/products", json={"code": code, "name": "Fund", **extra})
    assert r.status_code == 201, r.text
    return r.json()


async def _mk_series(client, code="BD-1", series="A", **extra):
    r = await client.post(
        f"{BASE}/series", json={"product_code": code, "series": series, **extra}
    )
    assert r.status_code == 201, r.text
    return r.json()


async def _mk_admin(client, code="BD-1", series="A", administrator="Adm", **extra):
    r = await client.post(
        f"{BASE}/admins",
        json={"product_code": code, "series": series, "administrator": administrator, **extra},
    )
    assert r.status_code == 201, r.text
    return r.json()


# --- products ---------------------------------------------------------------


async def test_create_product_and_get_detail_nested(admin_api_client):
    _app, client = admin_api_client
    created = await _mk_product(
        client,
        manager="Mgr",
        asset_class=[{"name": "mercados_publicos", "percentage": 100}],
    )
    assert created["code"] == "BD-1"
    assert created["asset_class"] == [{"name": "mercados_publicos", "percentage": 100}]
    await _mk_series(client, management_fee_ter=0.0384)
    await _mk_admin(client, custody_fee=0.001)

    r = await client.get(f"{BASE}/products/BD-1")
    assert r.status_code == 200
    body = r.json()
    assert body["manager"] == "Mgr"
    assert body["series"][0]["series"] == "A"
    assert body["series"][0]["administrators"][0]["administrator"] == "Adm"


async def test_list_products_with_search(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client, code="ZZ-ONE")
    await _mk_product(client, code="YY-TWO")
    r = await client.get(f"{BASE}/products", params={"search": "zz-"})
    assert r.status_code == 200
    assert [p["code"] for p in r.json()] == ["ZZ-ONE"]
    assert "series" in r.json()[0] and r.json()[0]["series"] == []


async def test_duplicate_product_code_returns_409(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client)
    r = await client.post(f"{BASE}/products", json={"code": "BD-1", "name": "Other"})
    assert r.status_code == 409


async def test_get_missing_product_404(admin_api_client):
    _app, client = admin_api_client
    assert (await client.get(f"{BASE}/products/NOPE")).status_code == 404


async def test_empty_required_string_rejected_422(admin_api_client):
    _app, client = admin_api_client
    r = await client.post(f"{BASE}/products", json={"code": "  ", "name": "x"})
    assert r.status_code == 422
    r = await client.post(f"{BASE}/series", json={"product_code": "BD-1", "series": ""})
    assert r.status_code == 422
    r = await client.post(
        f"{BASE}/admins", json={"product_code": "BD-1", "series": "A", "administrator": " "}
    )
    assert r.status_code == 422


async def test_patch_product_updates_only_provided_fields(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client, manager="Mgr", currency="USD")
    r = await client.patch(f"{BASE}/products/BD-1", json={"name": "Renamed"})
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Renamed"
    assert body["manager"] == "Mgr"
    assert body["currency"] == "USD"


async def test_patch_missing_product_404(admin_api_client):
    _app, client = admin_api_client
    r = await client.patch(f"{BASE}/products/NOPE", json={"name": "x"})
    assert r.status_code == 404


async def _active(test_pool, table, where="product_code = 'BD-1'"):
    return await test_pool.fetchval(
        f"SELECT count(*) FROM {table} WHERE {where} AND NOT is_deleted"
    )


async def _all(test_pool, table, where="product_code = 'BD-1'"):
    return await test_pool.fetchval(f"SELECT count(*) FROM {table} WHERE {where}")


async def test_delete_product_cascades(admin_api_client, test_pool):
    _app, client = admin_api_client
    await _mk_product(client)
    await _mk_series(client)
    await _mk_admin(client)
    r = await client.delete(f"{BASE}/products/BD-1")
    assert r.status_code == 204
    assert await _active(test_pool, "catalog_product_series") == 0
    assert await _active(test_pool, "catalog_product_series_admin") == 0
    # Flagged, not removed.
    assert await _all(test_pool, "catalog_product", "code = 'BD-1'") == 1
    assert await _all(test_pool, "catalog_product_series") == 1
    assert await _all(test_pool, "catalog_product_series_admin") == 1
    assert await test_pool.fetchval(
        "SELECT deleted_at IS NOT NULL FROM catalog_product WHERE code = 'BD-1'"
    )


async def test_delete_missing_product_404(admin_api_client):
    _app, client = admin_api_client
    assert (await client.delete(f"{BASE}/products/NOPE")).status_code == 404


# --- series -----------------------------------------------------------------


async def test_series_create_missing_product_404(admin_api_client):
    _app, client = admin_api_client
    r = await client.post(f"{BASE}/series", json={"product_code": "NOPE", "series": "A"})
    assert r.status_code == 404


async def test_series_duplicate_409(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client)
    await _mk_series(client)
    r = await client.post(f"{BASE}/series", json={"product_code": "BD-1", "series": "A"})
    assert r.status_code == 409


async def test_patch_series_only_provided_fields(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client)
    s = await _mk_series(client, management_fee_ter=0.01, flows_min=5)
    r = await client.patch(f"{BASE}/series/{s['id']}", json={"return_max": 0.2})
    assert r.status_code == 200
    body = r.json()
    assert body["return_max"] == 0.2
    assert body["management_fee_ter"] == 0.01
    assert body["flows_min"] == 5


async def test_patch_missing_series_404(admin_api_client):
    _app, client = admin_api_client
    r = await client.patch(f"{BASE}/series/999999", json={"return_max": 0.2})
    assert r.status_code == 404


async def test_delete_series_cascades_admins(admin_api_client, test_pool):
    _app, client = admin_api_client
    await _mk_product(client)
    s = await _mk_series(client)
    await _mk_admin(client)
    assert (await client.delete(f"{BASE}/series/{s['id']}")).status_code == 204
    assert await _active(test_pool, "catalog_product_series_admin") == 0
    assert await _all(test_pool, "catalog_product_series_admin") == 1
    assert await _active(test_pool, "catalog_product", "code = 'BD-1'") == 1


async def test_delete_missing_series_404(admin_api_client):
    _app, client = admin_api_client
    assert (await client.delete(f"{BASE}/series/999999")).status_code == 404


# --- admins -----------------------------------------------------------------


async def test_admin_create_missing_series_404(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client)
    r = await client.post(
        f"{BASE}/admins",
        json={"product_code": "BD-1", "series": "ZZ", "administrator": "Adm"},
    )
    assert r.status_code == 404


async def test_admin_duplicate_409(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client)
    await _mk_series(client)
    await _mk_admin(client)
    r = await client.post(
        f"{BASE}/admins",
        json={"product_code": "BD-1", "series": "A", "administrator": "Adm"},
    )
    assert r.status_code == 409


async def test_patch_admin_only_provided_fields(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client)
    await _mk_series(client)
    a = await _mk_admin(client, custody_fee=0.001, billing_currency="USD")
    r = await client.patch(f"{BASE}/admins/{a['id']}", json={"buy_commission": 0.02})
    assert r.status_code == 200
    body = r.json()
    assert body["buy_commission"] == 0.02
    assert body["custody_fee"] == 0.001
    assert body["billing_currency"] == "USD"


async def test_patch_missing_admin_404(admin_api_client):
    _app, client = admin_api_client
    r = await client.patch(f"{BASE}/admins/999999", json={"buy_commission": 0.02})
    assert r.status_code == 404


async def test_delete_admin_and_missing(admin_api_client):
    _app, client = admin_api_client
    await _mk_product(client)
    await _mk_series(client)
    a = await _mk_admin(client)
    assert (await client.delete(f"{BASE}/admins/{a['id']}")).status_code == 204
    assert (await client.delete(f"{BASE}/admins/{a['id']}")).status_code == 404

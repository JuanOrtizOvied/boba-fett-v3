"""Tests for `POST /admin/ficha-patrimonial/parse` — base64 decode, Excel
parsing, target-user resolution, and bounded-concurrency enrichment via a
mocked `cascade_search` (`sdd/admin-ficha-patrimonial/spec` — "Ficha Parse
Endpoint", "Invalid or corrupt file rejected", "Missing Sabbi sheet",
"Non-admin blocked", "Batch Enrichment via cascade_search").

The confirm endpoint (`POST /admin/ficha-patrimonial/confirm`) is covered
against a real Postgres instance in
`tests/integration/test_ficha_patrimonial_pg.py` since it exercises
`ProductRepository.create()` and transactional atomicity.
"""

from __future__ import annotations

import asyncio
import base64
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.admin_routes as admin_routes
from auth.tokens import create_access_token
from db.ficha_repository import Ficha, FichaListItem
from db.models import SearchResult


def _admin_token() -> str:
    return create_access_token(user_id="usr_admin", email="admin@sabbi.com", role="admin")


def _user_token() -> str:
    return create_access_token(user_id="usr_regular", email="u@sabbi.com", role="user")


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


@pytest.fixture
def app_client():
    from api.admin_routes import router

    app = FastAPI()
    app.include_router(router)
    app.state.user_repo = AsyncMock()
    app.state.repo = AsyncMock()
    app.state.repo.pool = object()
    app.state.ficha_repo = AsyncMock()
    app.state.ficha_repo.create.return_value = 1
    app.state.normalized_catalog_repo = AsyncMock()
    app.state.history_repo = AsyncMock()
    return app, TestClient(app)


def _admin_client(app_client):
    app, client = app_client
    client.cookies.set("sabbi_access", _admin_token())
    return app, client


# ---------------------------------------------------------------------------
# Auth gate — inherited from the router-level `require_admin` dependency
# ---------------------------------------------------------------------------


def test_non_admin_blocked_from_parse(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.post("/admin/ficha-patrimonial/parse", json={"file_data": "x"})

    assert response.status_code == 403


def test_unauthenticated_blocked_from_parse(app_client):
    _app, client = app_client

    response = client.post("/admin/ficha-patrimonial/parse", json={"file_data": "x"})

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Invalid input handling
# ---------------------------------------------------------------------------


def test_invalid_base64_returns_400(app_client):
    app, client = _admin_client(app_client)

    response = client.post(
        "/admin/ficha-patrimonial/parse",
        json={"file_data": "not-valid-base64!!"},
    )

    assert response.status_code == 400
    app.state.user_repo.get_by_email.assert_not_awaited()


def test_corrupt_xlsx_returns_400(app_client):
    app, client = _admin_client(app_client)

    response = client.post(
        "/admin/ficha-patrimonial/parse",
        json={"file_data": _b64(b"this is not an xlsx file")},
    )

    assert response.status_code == 400
    app.state.user_repo.get_by_email.assert_not_awaited()


def test_missing_sabbi_sheet_returns_400(app_client, build_ficha_workbook):
    app, client = _admin_client(app_client)
    workbook_bytes = build_ficha_workbook(
        [{"name": "Fondo A", "amount": 1000}], sheet_name="OtraHoja"
    )

    response = client.post(
        "/admin/ficha-patrimonial/parse",
        json={"file_data": _b64(workbook_bytes)},
    )

    assert response.status_code == 400
    assert "Sabbi" in response.json()["detail"]


def test_unknown_client_email_still_succeeds(app_client, build_ficha_workbook, monkeypatch):
    app, client = _admin_client(app_client)
    app.state.user_repo.get_by_email.return_value = None

    async def fake_cascade_search(name, pool):
        return SearchResult(name=name)

    monkeypatch.setattr(admin_routes, "cascade_search_v2", fake_cascade_search)

    workbook_bytes = build_ficha_workbook(
        [{"name": "Fondo A", "amount": 1000}], client_email="ghost@example.com"
    )

    response = client.post(
        "/admin/ficha-patrimonial/parse",
        json={"file_data": _b64(workbook_bytes)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["client"]["user_id"] == ""
    assert body["client"]["email"] == "ghost@example.com"
    app.state.user_repo.get_by_email.assert_awaited_once_with("ghost@example.com")


# ---------------------------------------------------------------------------
# Successful parse + enrichment
# ---------------------------------------------------------------------------


def test_valid_ficha_returns_enriched_rows(app_client, build_ficha_workbook, monkeypatch):
    app, client = _admin_client(app_client)
    app.state.user_repo.get_by_email.return_value = {"id": "usr_123"}

    async def fake_cascade_search(name, pool):
        return SearchResult(
            name=f"{name} - Enriched",
            commission="1.5%",
            currency="PEN",
            primary_source="catalog",
        )

    monkeypatch.setattr(admin_routes, "cascade_search_v2", fake_cascade_search)

    workbook_bytes = build_ficha_workbook(
        [
            {"name": "Fondo A", "tipo_activo": "Cuenta ahorros", "amount": 1000, "currency": "USD"},
            {"name": "Fondo B", "tipo_activo": "Fondos mutuos", "amount": 2000, "currency": "USD"},
        ]
    )

    response = client.post(
        "/admin/ficha-patrimonial/parse",
        json={"file_data": _b64(workbook_bytes)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["client"]["user_id"] == "usr_123"
    assert len(body["rows"]) == 2
    row = body["rows"][0]
    assert row["raw_name"] == "Fondo A"
    assert row["mapped_asset_class"] == "cash_y_equivalentes"
    assert row["enrichment_failed"] is False
    assert row["enriched"]["name"] == "Fondo A - Enriched"
    # Excel currency wins over the enrichment-supplied currency.
    assert row["enriched"]["currency"] == "USD"


def test_enrichment_bounded_by_semaphore_of_three(
    app_client, build_ficha_workbook, monkeypatch
):
    app, client = _admin_client(app_client)
    app.state.user_repo.get_by_email.return_value = {"id": "usr_123"}

    in_flight = 0
    max_in_flight = 0
    lock = asyncio.Lock()

    async def fake_cascade_search(name, pool):
        nonlocal in_flight, max_in_flight
        async with lock:
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
        await asyncio.sleep(0.01)
        async with lock:
            in_flight -= 1
        return SearchResult(name=name)

    monkeypatch.setattr(admin_routes, "cascade_search_v2", fake_cascade_search)

    products = [
        {"name": f"Fondo {i}", "amount": 1000 + i} for i in range(8)
    ]
    workbook_bytes = build_ficha_workbook(products)

    response = client.post(
        "/admin/ficha-patrimonial/parse",
        json={"file_data": _b64(workbook_bytes)},
    )

    assert response.status_code == 200
    assert len(response.json()["rows"]) == 8
    assert max_in_flight <= 3


def test_per_row_enrichment_failure_is_isolated(
    app_client, build_ficha_workbook, monkeypatch
):
    app, client = _admin_client(app_client)
    app.state.user_repo.get_by_email.return_value = {"id": "usr_123"}

    async def flaky_cascade_search(name, pool):
        if name == "Fondo Fails":
            raise RuntimeError("boom")
        return SearchResult(name=f"{name} - OK")

    monkeypatch.setattr(admin_routes, "cascade_search_v2", flaky_cascade_search)

    workbook_bytes = build_ficha_workbook(
        [
            {"name": "Fondo Fails", "amount": 1000},
            {"name": "Fondo OK", "amount": 2000},
        ]
    )

    response = client.post(
        "/admin/ficha-patrimonial/parse",
        json={"file_data": _b64(workbook_bytes)},
    )

    assert response.status_code == 200
    rows = response.json()["rows"]
    failed_row = next(r for r in rows if r["raw_name"] == "Fondo Fails")
    ok_row = next(r for r in rows if r["raw_name"] == "Fondo OK")
    assert failed_row["enrichment_failed"] is True
    assert failed_row["enriched"] is None
    assert ok_row["enrichment_failed"] is False
    assert ok_row["enriched"]["name"] == "Fondo OK - OK"


# ---------------------------------------------------------------------------
# Slice 3a T-3 — persistence endpoints
# ---------------------------------------------------------------------------


def test_parse_autosaves_the_ficha(app_client, build_ficha_workbook, monkeypatch):
    app, client = _admin_client(app_client)
    app.state.user_repo.get_by_email.return_value = {"id": "usr_123"}
    app.state.ficha_repo.create.return_value = 77

    async def fake_cascade(name, pool):
        return SearchResult(name=name)

    monkeypatch.setattr(admin_routes, "cascade_search_v2", fake_cascade)
    workbook_bytes = build_ficha_workbook([{"name": "Fondo A", "amount": 1000}])

    response = client.post(
        "/admin/ficha-patrimonial/parse", json={"file_data": _b64(workbook_bytes)}
    )

    assert response.status_code == 200
    assert response.json()["ficha_id"] == 77
    app.state.ficha_repo.create.assert_awaited_once()


def test_parse_stores_the_uploaded_file(app_client, build_ficha_workbook, monkeypatch):
    app, client = _admin_client(app_client)
    app.state.user_repo.get_by_email.return_value = None
    app.state.ficha_repo.create.return_value = 5

    async def fake_cascade(name, pool):
        return SearchResult(name=name)

    monkeypatch.setattr(admin_routes, "cascade_search_v2", fake_cascade)
    workbook_bytes = build_ficha_workbook([{"name": "Fondo A", "amount": 1000}])

    response = client.post(
        "/admin/ficha-patrimonial/parse",
        json={"file_data": _b64(workbook_bytes), "file_name": "mi-ficha.xlsx"},
    )

    assert response.status_code == 200
    kwargs = app.state.ficha_repo.create.await_args.kwargs
    assert kwargs["file_data"] == workbook_bytes
    assert kwargs["file_name"] == "mi-ficha.xlsx"


def test_download_ficha_file_returns_the_stored_xlsx(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.get_file.return_value = ("ficha-ana.xlsx", b"PK\x03\x04xlsx")

    response = client.get("/admin/ficha-patrimonial/fichas/5/file")

    assert response.status_code == 200
    assert response.content == b"PK\x03\x04xlsx"
    assert (
        response.headers["content-type"]
        == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "ficha-ana.xlsx" in response.headers["content-disposition"]
    app.state.ficha_repo.get_file.assert_awaited_once_with(5)


def test_download_ficha_file_404_when_no_stored_file(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.get_file.return_value = None

    response = client.get("/admin/ficha-patrimonial/fichas/9/file")

    assert response.status_code == 404


def test_download_ficha_file_blocked_for_non_admin(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.get("/admin/ficha-patrimonial/fichas/5/file")

    assert response.status_code == 403


def test_list_fichas(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.list.return_value = [
        FichaListItem(id=1, client_name="Ana", status="por_validar")
    ]

    response = client.get("/admin/ficha-patrimonial/fichas")

    assert response.status_code == 200
    assert response.json()[0]["id"] == 1
    assert response.json()[0]["status"] == "por_validar"
    app.state.ficha_repo.list.assert_awaited_once_with(None)


def test_list_fichas_filters_by_status(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.list.return_value = []

    client.get("/admin/ficha-patrimonial/fichas?status=validada")

    app.state.ficha_repo.list.assert_awaited_once_with("validada")


def test_get_ficha_returns_404_when_missing(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.get.return_value = None

    response = client.get("/admin/ficha-patrimonial/fichas/123")

    assert response.status_code == 404


def test_get_ficha_returns_the_ficha(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.get.return_value = Ficha(id=5, client_name="Ana", status="en_proceso")

    response = client.get("/admin/ficha-patrimonial/fichas/5")

    assert response.status_code == 200
    assert response.json()["id"] == 5
    assert response.json()["status"] == "en_proceso"


def test_update_line_status(app_client):
    app, client = _admin_client(app_client)

    response = client.patch(
        "/admin/ficha-patrimonial/lines/5", json={"status": "approved"}
    )

    assert response.status_code == 200
    app.state.ficha_repo.update_line_status.assert_awaited_once_with(5, "approved")


def test_update_line_status_rejects_invalid(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.update_line_status.side_effect = ValueError("invalid")

    response = client.patch(
        "/admin/ficha-patrimonial/lines/5", json={"status": "bogus"}
    )

    assert response.status_code == 422


def test_mark_ficha_confirmed(app_client):
    app, client = _admin_client(app_client)

    response = client.post("/admin/ficha-patrimonial/fichas/9/confirm")

    assert response.status_code == 200
    app.state.ficha_repo.mark_confirmed.assert_awaited_once_with(9)


def test_confirm_empty_user_id_returns_400_without_db_call(app_client):
    """A ficha with no associated user sends `user_id: ""`. The endpoint must
    reject it with a 400 BEFORE querying the UUID `users.id` column, which
    would otherwise raise and surface as a 500."""
    app, client = _admin_client(app_client)

    response = client.post(
        "/admin/ficha-patrimonial/confirm",
        json={"user_id": "", "products": []},
    )

    assert response.status_code == 400
    app.state.user_repo.get_by_id.assert_not_awaited()


def test_confirm_whitespace_user_id_returns_400(app_client):
    app, client = _admin_client(app_client)

    response = client.post(
        "/admin/ficha-patrimonial/confirm",
        json={"user_id": "   ", "products": []},
    )

    assert response.status_code == 400
    app.state.user_repo.get_by_id.assert_not_awaited()


def test_confirm_new_client_with_existing_email_returns_409(app_client):
    app, client = _admin_client(app_client)
    app.state.user_repo.get_by_email.return_value = {"id": "existing"}

    response = client.post(
        "/admin/ficha-patrimonial/confirm",
        json={
            "new_client": {
                "email": "dup@sabbi.com",
                "first_name": "Ana",
                "last_name": "Perez",
                "password": "supersecret1",
            },
            "products": [],
        },
    )

    assert response.status_code == 409
    app.state.user_repo.create.assert_not_awaited()
    app.state.user_repo.get_by_id.assert_not_awaited()


def test_delete_ficha(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.delete.return_value = True

    response = client.delete("/admin/ficha-patrimonial/fichas/9")

    assert response.status_code == 200
    app.state.ficha_repo.delete.assert_awaited_once_with(9)


def test_delete_ficha_404_when_missing(app_client):
    app, client = _admin_client(app_client)
    app.state.ficha_repo.delete.return_value = False

    response = client.delete("/admin/ficha-patrimonial/fichas/123")

    assert response.status_code == 404


# --- Approve: curate catalog + create client holding -------------------------


def test_approve_curates_catalog_without_creating_holding(app_client, monkeypatch):
    app, client = _admin_client(app_client)
    app.state.repo.create = AsyncMock()

    async def fake_curation(*args, **kwargs):
        return {"name": {"old": "A", "new": "B"}}

    monkeypatch.setattr(admin_routes, "apply_catalog_curation", fake_curation)

    body = {
        "user_id": "u1",
        "product": {
            "name": "Fondo X",
            "amount": 1000,
            "asset_class": [{"name": "mercados_privados", "percentage": 100}],
            "catalog_product_id": 7,
        },
        "catalog_product_code": "BD-1",
        "catalog_update": {"name": "B"},
        "series": [],
        "admins": [],
    }
    response = client.post("/admin/ficha-patrimonial/approve", json=body)

    assert response.status_code == 201
    assert response.json()["catalog_product_code"] == "BD-1"
    assert response.json()["catalog_changes"]["name"]["new"] == "B"
    # Approve only curates the catalog; the client holding is created at confirm.
    app.state.repo.create.assert_not_awaited()


def test_approve_blank_user_id_curates_without_500(app_client, monkeypatch):
    """A ficha with no associated client sends `user_id: ""`. Approve must curate
    the catalog with the admin session and NOT try to insert a portfolio holding
    (a blank UUID in `products.user_id` raised asyncpg DataError → 500)."""
    app, client = _admin_client(app_client)
    app.state.repo.create = AsyncMock()

    async def fake_curation(*args, **kwargs):
        return {"name": {"old": "A", "new": "B"}}

    monkeypatch.setattr(admin_routes, "apply_catalog_curation", fake_curation)

    body = {
        "user_id": "",
        "product": {
            "name": "Fondo X",
            "amount": 1000,
            "asset_class": [{"name": "mercados_privados", "percentage": 100}],
        },
        "catalog_product_code": "BD-00155",
        "catalog_update": {"name": "B"},
    }
    response = client.post("/admin/ficha-patrimonial/approve", json=body)

    assert response.status_code == 201
    assert response.json()["catalog_product_code"] == "BD-00155"
    app.state.repo.create.assert_not_awaited()


def test_get_catalog_product_history(app_client):
    from db.catalog_history import CatalogHistoryEntry

    app, client = _admin_client(app_client)
    app.state.history_repo.list_for_product.return_value = [
        CatalogHistoryEntry(
            id=1,
            product_code="BD-1",
            action="update",
            source="ficha",
            changes={"name": {"old": "A", "new": "B"}},
        )
    ]

    response = client.get("/admin/catalog/products/BD-1/history")

    assert response.status_code == 200
    body = response.json()
    assert body[0]["action"] == "update"
    assert body[0]["changes"]["name"]["new"] == "B"
    app.state.history_repo.list_for_product.assert_awaited_once_with("BD-1")


def test_approve_without_catalog_code_creates_new_catalog_product(app_client, monkeypatch):
    from types import SimpleNamespace

    app, client = _admin_client(app_client)
    app.state.repo.create = AsyncMock()

    async def fake_create(*args, **kwargs):
        return SimpleNamespace(id=9, code="BD-00099")

    monkeypatch.setattr(admin_routes, "create_catalog_product_from_ficha", fake_create)

    body = {
        "user_id": "u1",
        "product": {
            "name": "New",
            "amount": 500,
            "asset_class": [{"name": "otros", "percentage": 100}],
        },
        "catalog_product_code": "",
    }
    response = client.post("/admin/ficha-patrimonial/approve", json=body)

    assert response.status_code == 201
    assert response.json()["catalog_product_code"] == "BD-00099"
    assert response.json()["catalog_changes"] == {"created": "BD-00099"}
    app.state.repo.create.assert_not_awaited()


# ---------------------------------------------------------------------------
# POST /ficha-patrimonial/research — per-product Claude web re-investigation
# ---------------------------------------------------------------------------


def test_research_endpoint_returns_web_result(app_client, monkeypatch):
    app, client = _admin_client(app_client)

    async def fake_research(query):
        assert query == "Credicorp Crecimiento"
        return SearchResult(name="Credicorp Crecimiento VCS", manager="Credicorp")

    monkeypatch.setattr(admin_routes, "research_web_v2", fake_research)

    response = client.post(
        "/admin/ficha-patrimonial/research",
        json={"name": "Credicorp Crecimiento"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Credicorp Crecimiento VCS"
    assert body["manager"] == "Credicorp"


def test_research_endpoint_requires_admin(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.post("/admin/ficha-patrimonial/research", json={"name": "x"})

    assert response.status_code in (401, 403)


# ---------------------------------------------------------------------------
# GET /admin/ficha-patrimonial/catalog-product/{code}
# ---------------------------------------------------------------------------


def _fake_catalog_product():
    from db.catalog_normalized import (
        CatalogProductRow,
        CatalogProductSeries,
        CatalogProductSeriesAdmin,
    )

    admin = CatalogProductSeriesAdmin(
        id=1,
        product_code="BD-00352",
        series="A",
        administrator="Sabbi AGF",
        custody_fee=0.1,
        buy_commission=0.5,
        billing_currency="USD",
    )
    series = CatalogProductSeries(
        id=1,
        product_code="BD-00352",
        series="A",
        management_fee_ter=1.2,
        administrators=[admin],
    )
    return CatalogProductRow(
        id=1,
        code="BD-00352",
        name="Fondo Prueba",
        ticker_isin="CL0001",
        manager="Gestora X",
        currency="USD",
        investment_horizon="largo",
        series=[series],
    )


def test_get_ficha_catalog_product_returns_search_result(app_client):
    app, client = _admin_client(app_client)
    app.state.normalized_catalog_repo.get_product_detail.return_value = _fake_catalog_product()

    response = client.get("/admin/ficha-patrimonial/catalog-product/BD-00352")

    assert response.status_code == 200
    body = response.json()
    assert body["catalog_product_code"] == "BD-00352"
    assert body["confidence"] == "alta"
    assert body["catalog_matched"] is True
    assert body["similarity"] == 1.0
    assert body["name"] == "Fondo Prueba"
    assert len(body["series_options"]) == 1
    assert body["series_options"][0]["series"] == "A"


def test_get_ficha_catalog_product_404_when_missing(app_client):
    app, client = _admin_client(app_client)
    app.state.normalized_catalog_repo.get_product_detail.return_value = None

    response = client.get("/admin/ficha-patrimonial/catalog-product/NOPE")

    assert response.status_code == 404


def test_non_admin_blocked_from_catalog_product(app_client):
    _app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.get("/admin/ficha-patrimonial/catalog-product/BD-00352")

    assert response.status_code == 403

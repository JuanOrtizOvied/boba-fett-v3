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

    monkeypatch.setattr(admin_routes, "cascade_search", fake_cascade_search)

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

    monkeypatch.setattr(admin_routes, "cascade_search", fake_cascade_search)

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

    monkeypatch.setattr(admin_routes, "cascade_search", fake_cascade_search)

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

    monkeypatch.setattr(admin_routes, "cascade_search", flaky_cascade_search)

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

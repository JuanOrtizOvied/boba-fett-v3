"""Tests for `api/properties_routes.py` — the on-demand slug backfill, gated by
`require_admin`."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from auth.tokens import create_access_token

URL = "/admin/properties/backfill-slugs"


def _admin_token() -> str:
    return create_access_token(user_id="usr_admin", email="admin@sabbi.com", role="admin")


def _user_token() -> str:
    return create_access_token(user_id="usr_regular", email="u@sabbi.com", role="user")


@pytest.fixture
def app_client():
    from api.properties_routes import router

    app = FastAPI()
    app.include_router(router)
    app.state.property_repo = AsyncMock()
    return app, TestClient(app)


def test_admin_backfill_returns_counts_and_total(app_client):
    app, client = app_client
    app.state.property_repo.backfill_allocation_slugs.return_value = {
        "asset_class": 2,
        "geographic_focus": 0,
        "underlying": 1,
    }
    client.cookies.set("sabbi_access", _admin_token())

    response = client.post(URL)

    assert response.status_code == 200
    assert response.json() == {
        "updated": {"asset_class": 2, "geographic_focus": 0, "underlying": 1},
        "total": 3,
    }
    app.state.property_repo.backfill_allocation_slugs.assert_awaited_once()


def test_non_admin_blocked_from_backfill(app_client):
    app, client = app_client
    client.cookies.set("sabbi_access", _user_token())

    response = client.post(URL)

    assert response.status_code == 403
    app.state.property_repo.backfill_allocation_slugs.assert_not_awaited()


def test_unauthenticated_blocked_from_backfill(app_client):
    app, client = app_client

    response = client.post(URL)

    assert response.status_code == 401
    app.state.property_repo.backfill_allocation_slugs.assert_not_awaited()

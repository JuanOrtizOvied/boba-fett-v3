"""Tests for the versioning REST routes added to `api/routes.py` in PR5
(`sdd/portfolio-versioning/tasks.md` T-015..T-018): snapshot create/list/
detail, comparison, and the paginated change log.

Covers `snapshots.spec.md` (SNAP-001, SNAP-003, SNAP-004, SNAP-005,
SNAP-009, SNAP-010), `comparison.spec.md` (CMP-001, CMP-005, CMP-006,
CMP-007), and `audit-log.spec.md` (AL-006, AL-007).

`app.state.versioning_repo` is mocked (`unittest.mock.AsyncMock`) — no real
Postgres required, following the same `app_client` pattern as
`test_routes_guarded.py`. The app's real `lifespan` is never triggered
because `TestClient(app)` is used without entering it as a context manager.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from auth.dependencies import get_current_user
from db.versioning import SnapshotAccessError, SnapshotNotFoundError


@pytest.fixture
def app_client():
    from api.routes import app

    app.state.repo = AsyncMock()
    app.state.versioning_repo = AsyncMock()
    client = TestClient(app)
    yield app, client
    app.dependency_overrides.clear()


def _authenticate(app, *, user_id: str = "usr_owner", role: str = "user") -> None:
    app.dependency_overrides[get_current_user] = lambda: {
        "id": user_id,
        "email": f"{user_id}@sabbi.com",
        "role": role,
    }


def _uuid() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# SNAP-001 — create snapshot
# ---------------------------------------------------------------------------


def test_create_snapshot_requires_authentication(app_client):
    _app, client = app_client

    response = client.post("/portfolio/me/snapshots", json={"name": "Pre-meeting Q3"})

    assert response.status_code == 401


def test_create_snapshot_happy_path(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    snapshot_id = _uuid()
    app.state.versioning_repo.create_snapshot.return_value = {
        "id": snapshot_id,
        "user_id": "usr_owner",
        "name": "Pre-meeting Q3",
        "description": "",
        "product_count": 8,
        "total_amount": 500000.0,
        "created_at": "2026-07-19T00:00:00+00:00",
    }

    response = client.post("/portfolio/me/snapshots", json={"name": "Pre-meeting Q3"})

    assert response.status_code == 201
    body = response.json()
    assert body["id"] == snapshot_id
    assert body["product_count"] == 8
    app.state.versioning_repo.create_snapshot.assert_awaited_once_with(
        "usr_owner", "Pre-meeting Q3", ""
    )


def test_create_snapshot_rejects_empty_name(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")

    response = client.post("/portfolio/me/snapshots", json={"name": ""})

    assert response.status_code == 422
    app.state.versioning_repo.create_snapshot.assert_not_awaited()


def test_create_snapshot_rejects_missing_name(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")

    response = client.post("/portfolio/me/snapshots", json={})

    assert response.status_code == 422
    app.state.versioning_repo.create_snapshot.assert_not_awaited()


def test_create_snapshot_description_defaults_to_empty_string(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.create_snapshot.return_value = {
        "id": _uuid(),
        "name": "Baseline",
        "description": "",
        "product_count": 0,
        "total_amount": 0.0,
    }

    response = client.post("/portfolio/me/snapshots", json={"name": "Baseline"})

    assert response.status_code == 201
    app.state.versioning_repo.create_snapshot.assert_awaited_once_with(
        "usr_owner", "Baseline", ""
    )


def test_create_snapshot_on_empty_portfolio_succeeds(app_client):
    """SNAP-009 — route-level pass-through: the repository is the source of
    truth for the empty-portfolio-succeeds behavior (already covered at the
    repository level in PR2); this confirms the route doesn't add its own
    empty-portfolio rejection."""
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.create_snapshot.return_value = {
        "id": _uuid(),
        "name": "Starting point",
        "description": "",
        "product_count": 0,
        "total_amount": 0.0,
    }

    response = client.post("/portfolio/me/snapshots", json={"name": "Starting point"})

    assert response.status_code == 201
    assert response.json()["product_count"] == 0


# ---------------------------------------------------------------------------
# SNAP-003 — list snapshots
# ---------------------------------------------------------------------------


def test_list_snapshots_requires_authentication(app_client):
    _app, client = app_client

    response = client.get("/portfolio/me/snapshots")

    assert response.status_code == 401


def test_list_snapshots_scoped_to_authenticated_user(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.list_snapshots.return_value = [
        {"id": _uuid(), "name": "C"},
        {"id": _uuid(), "name": "B"},
        {"id": _uuid(), "name": "A"},
    ]

    response = client.get("/portfolio/me/snapshots")

    assert response.status_code == 200
    body = response.json()
    assert [s["name"] for s in body["snapshots"]] == ["C", "B", "A"]
    app.state.versioning_repo.list_snapshots.assert_awaited_once_with(
        "usr_owner", limit=50, offset=0
    )


def test_list_snapshots_empty_for_new_user(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.list_snapshots.return_value = []

    response = client.get("/portfolio/me/snapshots")

    assert response.status_code == 200
    assert response.json() == {"snapshots": []}


# ---------------------------------------------------------------------------
# SNAP-004 / SNAP-005 / SNAP-010 — snapshot detail
# ---------------------------------------------------------------------------


def test_get_snapshot_requires_authentication(app_client):
    _app, client = app_client

    response = client.get(f"/portfolio/me/snapshots/{_uuid()}")

    assert response.status_code == 401


def test_get_snapshot_detail_returns_full_product_list(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    snapshot_id = _uuid()
    app.state.versioning_repo.get_snapshot.return_value = {
        "id": snapshot_id,
        "name": "Q2 Review",
        "description": "",
        "product_count": 12,
        "total_amount": 1000.0,
        "created_at": "2026-07-19T00:00:00+00:00",
        "products": [{"id": f"prod_{i}"} for i in range(12)],
    }

    response = client.get(f"/portfolio/me/snapshots/{snapshot_id}")

    assert response.status_code == 200
    body = response.json()
    assert len(body["products"]) == 12
    app.state.versioning_repo.get_snapshot.assert_awaited_once_with(snapshot_id, "usr_owner")


def test_get_snapshot_not_found_returns_404(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.get_snapshot.return_value = None

    response = client.get(f"/portfolio/me/snapshots/{_uuid()}")

    assert response.status_code == 404


def test_get_snapshot_non_owner_returns_404(app_client):
    """SNAP-010 — `get_snapshot` collapses missing-id and not-owned into
    the same `None` result, so the route uniformly 404s without disclosing
    existence to a non-owner."""
    app, client = app_client
    _authenticate(app, user_id="usr_intruder")
    app.state.versioning_repo.get_snapshot.return_value = None

    response = client.get(f"/portfolio/me/snapshots/{_uuid()}")

    assert response.status_code == 404


def test_no_update_route_exists_for_snapshots(app_client):
    """SNAP-005 — no `PATCH`/`PUT` route is registered for snapshots."""
    app, client = app_client
    _authenticate(app, user_id="usr_owner")

    response = client.patch(f"/portfolio/me/snapshots/{_uuid()}", json={"name": "New name"})

    assert response.status_code in (404, 405)
    app.state.versioning_repo.get_snapshot.assert_not_awaited()


# ---------------------------------------------------------------------------
# CMP-001 / CMP-005 / CMP-006 / CMP-007 — compare
# ---------------------------------------------------------------------------


def test_compare_requires_authentication(app_client):
    _app, client = app_client

    response = client.get(f"/portfolio/me/compare?a={_uuid()}&b={_uuid()}")

    assert response.status_code == 401


def test_compare_two_owned_snapshots(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    a, b = _uuid(), _uuid()
    app.state.versioning_repo.compare_snapshots.return_value = {
        "snapshot_a": a,
        "snapshot_b": b,
        "added": [],
        "removed": [],
        "modified": [],
        "summary": {
            "added_count": 0,
            "removed_count": 0,
            "modified_count": 0,
            "total_amount_delta": 0.0,
            "product_count_delta": 0,
        },
    }

    response = client.get(f"/portfolio/me/compare?a={a}&b={b}")

    assert response.status_code == 200
    body = response.json()
    assert body["added"] == []
    assert body["removed"] == []
    assert body["modified"] == []
    app.state.versioning_repo.compare_snapshots.assert_awaited_once_with(a, b, "usr_owner")


def test_compare_missing_query_param_returns_422(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")

    response = client.get(f"/portfolio/me/compare?a={_uuid()}")

    assert response.status_code == 422
    app.state.versioning_repo.compare_snapshots.assert_not_awaited()


def test_compare_malformed_id_returns_422(app_client):
    """CMP-005 — a syntactically invalid UUID never reaches the
    repository/asyncpg layer."""
    app, client = app_client
    _authenticate(app, user_id="usr_owner")

    response = client.get(f"/portfolio/me/compare?a=not-a-uuid&b={_uuid()}")

    assert response.status_code == 422
    app.state.versioning_repo.compare_snapshots.assert_not_awaited()


def test_compare_cross_user_access_returns_403(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_a")
    app.state.versioning_repo.compare_snapshots.side_effect = SnapshotAccessError(
        "Snapshot is not owned by this user"
    )

    response = client.get(f"/portfolio/me/compare?a={_uuid()}&b={_uuid()}")

    assert response.status_code == 403


def test_compare_non_existent_snapshot_returns_404(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.compare_snapshots.side_effect = SnapshotNotFoundError(
        "Snapshot not found"
    )

    response = client.get(f"/portfolio/me/compare?a={_uuid()}&b={_uuid()}")

    assert response.status_code == 404


def test_compare_snapshot_to_itself_returns_no_op_diff(app_client):
    """CMP-006 — self-comparison is a valid, non-error input; the route
    passes `a == b` straight through to the repository."""
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    s = _uuid()
    app.state.versioning_repo.compare_snapshots.return_value = {
        "snapshot_a": s,
        "snapshot_b": s,
        "added": [],
        "removed": [],
        "modified": [],
        "summary": {
            "added_count": 0,
            "removed_count": 0,
            "modified_count": 0,
            "total_amount_delta": 0.0,
            "product_count_delta": 0,
        },
    }

    response = client.get(f"/portfolio/me/compare?a={s}&b={s}")

    assert response.status_code == 200
    body = response.json()
    assert body["added"] == body["removed"] == body["modified"] == []


def test_compare_order_forwards_a_as_baseline(app_client):
    """CMP-007 — the route never reorders `a`/`b`; whichever id is passed
    as `a` is forwarded as the baseline regardless of chronological order."""
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    newer, older = _uuid(), _uuid()
    app.state.versioning_repo.compare_snapshots.return_value = {
        "snapshot_a": newer,
        "snapshot_b": older,
        "added": [],
        "removed": [],
        "modified": [],
        "summary": {},
    }

    response = client.get(f"/portfolio/me/compare?a={newer}&b={older}")

    assert response.status_code == 200
    app.state.versioning_repo.compare_snapshots.assert_awaited_once_with(
        newer, older, "usr_owner"
    )


# ---------------------------------------------------------------------------
# AL-006 / AL-007 — change log
# ---------------------------------------------------------------------------


def test_list_changes_requires_authentication(app_client):
    _app, client = app_client

    response = client.get("/portfolio/me/changes")

    assert response.status_code == 401


def test_list_changes_default_page_size(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.list_changes.return_value = {
        "changes": [{"id": _uuid(), "operation": "create"}],
        "total": 150,
        "has_more": True,
    }

    response = client.get("/portfolio/me/changes")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 150
    assert body["has_more"] is True
    app.state.versioning_repo.list_changes.assert_awaited_once_with(
        "usr_owner", limit=50, offset=0, operation=None
    )


def test_list_changes_explicit_pagination(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.list_changes.return_value = {
        "changes": [],
        "total": 150,
        "has_more": True,
    }

    response = client.get("/portfolio/me/changes?limit=20&offset=40")

    assert response.status_code == 200
    app.state.versioning_repo.list_changes.assert_awaited_once_with(
        "usr_owner", limit=20, offset=40, operation=None
    )


def test_list_changes_empty_log_returns_200(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.list_changes.return_value = {
        "changes": [],
        "total": 0,
        "has_more": False,
    }

    response = client.get("/portfolio/me/changes")

    assert response.status_code == 200
    assert response.json()["changes"] == []


def test_list_changes_filter_by_operation_type(app_client):
    app, client = app_client
    _authenticate(app, user_id="usr_owner")
    app.state.versioning_repo.list_changes.return_value = {
        "changes": [{"id": _uuid(), "operation": "delete"}],
        "total": 1,
        "has_more": False,
    }

    response = client.get("/portfolio/me/changes?operation=delete")

    assert response.status_code == 200
    body = response.json()
    assert all(c["operation"] == "delete" for c in body["changes"])
    app.state.versioning_repo.list_changes.assert_awaited_once_with(
        "usr_owner", limit=50, offset=0, operation="delete"
    )


def test_list_changes_scoped_to_authenticated_user(app_client):
    """AL-007 — the route always passes the authenticated user's own id,
    never a client-supplied one (no `user_id` path/query param exists on
    this route)."""
    app, client = app_client
    _authenticate(app, user_id="usr_a")
    app.state.versioning_repo.list_changes.return_value = {
        "changes": [],
        "total": 0,
        "has_more": False,
    }

    client.get("/portfolio/me/changes")

    call_args = app.state.versioning_repo.list_changes.call_args
    assert call_args.args[0] == "usr_a"

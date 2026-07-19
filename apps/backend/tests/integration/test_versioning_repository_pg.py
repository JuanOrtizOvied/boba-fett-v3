"""Integration tests for `db/versioning.py`'s `VersioningRepository`.

Covers `sdd/portfolio-versioning/specs/snapshot-lifecycle.spec.md` —
SNAP-001, SNAP-002, SNAP-003, SNAP-004, SNAP-005, SNAP-009, SNAP-010,
SNAP-011 (`tasks.md` T-005..T-008, PR2 — Snapshot Repository) — plus
`specs/comparison.spec.md` (CMP-001, CMP-002, CMP-003, CMP-006, CMP-007) and
`specs/audit-log.spec.md` (AL-006, AL-007) for `compare_snapshots` and
`list_changes` (`tasks.md` T-009..T-011, PR3 — Comparison + Change Log
Repository).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from db.models import ProductCreate, ProductUpdate
from db.repository import ProductRepository
from db.versioning import (
    SnapshotAccessError,
    SnapshotNotFoundError,
    VersioningRepository,
)


def _create_data(**overrides: Any) -> ProductCreate:
    data: dict[str, Any] = {
        "name": "BlackRock Private Credit Fund",
        "provider": "SABBI",
        "amount": 150000,
        "category": "privados",
        "subcategory": "Mercados Privados",
    }
    data.update(overrides)
    return ProductCreate(**data)


def _enriched_data(**overrides: Any) -> ProductCreate:
    """Full enrichment fields set — SNAP-002's "every field survives"
    scenario needs more than id/name/amount to be meaningful."""
    data: dict[str, Any] = {
        "name": "iShares Global Bond ETF",
        "provider": "BlackRock",
        "amount": 87500,
        "category": "publicos",
        "subcategory": "Renta Fija Global",
        "composition": [
            {"name": "Deuda privada", "percentage": 60},
            {"name": "Deuda soberana", "percentage": 40},
        ],
        "asset_class": "Renta Fija",
        "geographic_focus": "Global",
        "underlying": "AGGU",
        "commission": "0.10%",
        "currency": "USD",
        "administrator": "BlackRock",
        "manager": "iShares",
        "liquidity": "Diaria",
        "return_rate": "4.2%",
    }
    data.update(overrides)
    return ProductCreate(**data)


async def _new_user(test_pool: Any) -> str:
    """Insert a second deterministic user — used by SNAP-010's cross-user
    ownership tests, which need a snapshot owned by someone other than
    `test_user_id`."""
    user_id = str(uuid.uuid4())
    await test_pool.execute(
        "INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4)",
        user_id,
        f"{user_id}@sabbi.test",
        "not-a-real-hash",
        "user",
    )
    return user_id


async def _materialized_count(test_pool: Any, snapshot_id: str) -> int:
    return await test_pool.fetchval(
        "SELECT count(*) FROM snapshot_products WHERE snapshot_id = $1", snapshot_id
    )


async def _backdate(test_pool: Any, snapshot_id: str, when: datetime) -> None:
    """Force a specific `created_at` on a snapshot row for ordering
    assertions only.

    `now()` is frozen for the lifetime of the outer per-session transaction
    that wraps every test (`tests/conftest.py`'s `_session_conn`), the same
    tie behavior `test_repository_audit_pg.py`'s `_fetch_change` helper
    documents for `portfolio_changes`. Snapshots created back-to-back within
    one test therefore share an identical DB-assigned `created_at`, which
    would make an `ORDER BY created_at DESC` assertion meaningless. This
    helper only mutates test data for the assertion — `VersioningRepository
    .list_snapshots`'s query itself is untouched."""
    await test_pool.execute(
        "UPDATE portfolio_snapshots SET created_at = $2 WHERE id = $1",
        snapshot_id,
        when,
    )


async def _assert_consistent(test_pool: Any, snapshot: dict) -> None:
    """SNAP-011: `product_count` on the snapshot header must always match
    the number of materialized `snapshot_products` rows — never a
    partial/inconsistent state."""
    materialized = await _materialized_count(test_pool, snapshot["id"])
    assert snapshot["product_count"] == materialized


# ---------------------------------------------------------------------------
# T-005 / SNAP-001, SNAP-002, SNAP-009 — create_snapshot
# ---------------------------------------------------------------------------


async def test_create_snapshot_materializes_full_product_fields(test_pool, test_user_id):
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    product = await repo.create(test_user_id, _enriched_data())

    snapshot = await versioning.create_snapshot(test_user_id, "Pre-Q3 Review")

    assert snapshot["product_count"] == 1
    assert snapshot["total_amount"] == 87500
    await _assert_consistent(test_pool, snapshot)

    detail = await versioning.get_snapshot(snapshot["id"], test_user_id)
    assert len(detail["products"]) == 1
    materialized = detail["products"][0]
    assert materialized["id"] == product.id
    assert materialized["name"] == "iShares Global Bond ETF"
    assert materialized["asset_class"] == "Renta Fija"
    assert materialized["commission"] == "0.10%"
    assert materialized["geographic_focus"] == "Global"
    assert materialized["composition"] == [
        {"name": "Deuda privada", "percentage": 60},
        {"name": "Deuda soberana", "percentage": 40},
    ]


async def test_create_snapshot_unaffected_by_later_product_edit(test_pool, test_user_id):
    from db.models import ProductUpdate

    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    product = await repo.create(test_user_id, _create_data(amount=150000))

    snapshot = await versioning.create_snapshot(test_user_id, "Before edit")
    await repo.update(product.id, ProductUpdate(amount=999999))

    detail = await versioning.get_snapshot(snapshot["id"], test_user_id)
    assert detail["products"][0]["amount"] == 150000
    assert detail["total_amount"] == 150000


async def test_create_snapshot_unaffected_by_later_product_delete(test_pool, test_user_id):
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    product = await repo.create(test_user_id, _create_data())

    snapshot = await versioning.create_snapshot(test_user_id, "Before delete")
    await repo.delete(product.id)

    detail = await versioning.get_snapshot(snapshot["id"], test_user_id)
    assert detail["product_count"] == 1
    assert detail["products"][0]["id"] == product.id


async def test_create_snapshot_on_empty_portfolio_succeeds(test_pool, test_user_id):
    """SNAP-009 — the spec (not `design.md`'s stale example) is the
    acceptance criteria: an empty portfolio snapshot succeeds with
    `product_count=0` and no `snapshot_products` rows, it does not raise."""
    versioning = VersioningRepository(test_pool)

    snapshot = await versioning.create_snapshot(test_user_id, "Empty portfolio")

    assert snapshot["product_count"] == 0
    assert snapshot["total_amount"] == 0
    materialized = await _materialized_count(test_pool, snapshot["id"])
    assert materialized == 0


# ---------------------------------------------------------------------------
# T-006 / SNAP-003, SNAP-004, SNAP-005, SNAP-010 — list_snapshots, get_snapshot
# ---------------------------------------------------------------------------


async def test_list_snapshots_orders_newest_first(test_pool, test_user_id):
    versioning = VersioningRepository(test_pool)
    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    snap_a = await versioning.create_snapshot(test_user_id, "A")
    await _backdate(test_pool, snap_a["id"], base)
    snap_b = await versioning.create_snapshot(test_user_id, "B")
    await _backdate(test_pool, snap_b["id"], base + timedelta(minutes=1))
    snap_c = await versioning.create_snapshot(test_user_id, "C")
    await _backdate(test_pool, snap_c["id"], base + timedelta(minutes=2))

    snapshots = await versioning.list_snapshots(test_user_id)

    assert [s["id"] for s in snapshots] == [snap_c["id"], snap_b["id"], snap_a["id"]]


async def test_list_snapshots_summary_omits_products_payload(test_pool, test_user_id):
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    await repo.create(test_user_id, _create_data())
    await versioning.create_snapshot(test_user_id, "Summary only")

    snapshots = await versioning.list_snapshots(test_user_id)

    assert "products" not in snapshots[0]


async def test_list_snapshots_empty_for_new_user(test_pool, test_user_id):
    versioning = VersioningRepository(test_pool)

    snapshots = await versioning.list_snapshots(test_user_id)

    assert snapshots == []


async def test_list_snapshots_respects_limit_and_offset(test_pool, test_user_id):
    versioning = VersioningRepository(test_pool)
    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    for i, name in enumerate(("A", "B", "C")):
        snap = await versioning.create_snapshot(test_user_id, name)
        await _backdate(test_pool, snap["id"], base + timedelta(minutes=i))

    page = await versioning.list_snapshots(test_user_id, limit=1, offset=1)

    assert len(page) == 1
    assert page[0]["name"] == "B"


async def test_get_snapshot_missing_id_returns_none(test_pool, test_user_id):
    versioning = VersioningRepository(test_pool)

    result = await versioning.get_snapshot(str(uuid.uuid4()), test_user_id)

    assert result is None


async def test_get_snapshot_non_owner_returns_none(test_pool, test_user_id):
    """SNAP-010 — cross-user access returns `None` (non-disclosing), not
    an exception, so the future route can uniformly 404 without revealing
    whether the id exists for another user."""
    versioning = VersioningRepository(test_pool)
    other_user_id = await _new_user(test_pool)
    snapshot = await versioning.create_snapshot(other_user_id, "Not yours")

    result = await versioning.get_snapshot(snapshot["id"], test_user_id)

    assert result is None


async def test_get_snapshot_repeated_reads_are_identical(test_pool, test_user_id):
    """SNAP-005 — reading the same snapshot twice, with an intervening
    unrelated product mutation, returns byte-identical data (snapshots are
    immutable after creation)."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    await repo.create(test_user_id, _create_data())
    snapshot = await versioning.create_snapshot(test_user_id, "Stable")

    first_read = await versioning.get_snapshot(snapshot["id"], test_user_id)
    await repo.create(test_user_id, _create_data(name="Unrelated addition"))
    second_read = await versioning.get_snapshot(snapshot["id"], test_user_id)

    assert first_read == second_read


# ---------------------------------------------------------------------------
# T-007 / SNAP-011 — create_snapshot isolation under concurrent mutation
# ---------------------------------------------------------------------------


async def test_create_snapshot_product_count_matches_materialized_rows(
    test_pool, test_user_id
):
    """SNAP-011 — regardless of which operation "wins" a race with a
    concurrent product mutation, the resulting snapshot's `product_count`
    must always match its materialized `snapshot_products` row count
    (never a partial/inconsistent state).

    Simplification note: `test_pool` wraps a single `asyncpg.Connection`
    inside a per-test SAVEPOINT nested in a session-scoped, never-committed
    outer transaction (`tests/conftest.py`). A second, truly independent
    `asyncpg.connect()` would run in its own transaction and would not see
    this test's uncommitted `test_user_id` row (FK violation), and issuing
    overlapping commands concurrently on the *same* connection raises
    asyncpg's "another operation is in progress" error rather than
    exercising real Postgres row-lock contention. True concurrent-connection
    testing of the `SELECT ... FOR SHARE` lock (`design.md` ADR-5) is out of
    reach of this fixture (`tasks.md` T-001's note); this test instead
    drives both possible interleavings *sequentially* and asserts
    consistency holds for each resulting snapshot, per T-007's documented
    simplification.
    """
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    await repo.create(test_user_id, _create_data(name="Seed"))

    # Interleaving 1: the concurrent mutation (an add) commits *before* the
    # snapshot's REPEATABLE READ transaction begins — the snapshot must
    # include it.
    await repo.create(test_user_id, _create_data(name="Added before snapshot"))
    snapshot_after_add = await versioning.create_snapshot(test_user_id, "after-add")
    await _assert_consistent(test_pool, snapshot_after_add)
    assert snapshot_after_add["product_count"] == 2

    # Interleaving 2: the concurrent mutation (a delete) commits *after* the
    # snapshot transaction has already completed — the already-created
    # snapshot must be unaffected, and the count must still be internally
    # consistent.
    products = await repo.list_by_user(test_user_id)
    await repo.delete(products[0].id)
    await _assert_consistent(test_pool, snapshot_after_add)
    assert snapshot_after_add["product_count"] == 2

    # A snapshot taken after the delete reflects the now-smaller live set,
    # and is itself internally consistent too.
    snapshot_after_delete = await versioning.create_snapshot(test_user_id, "after-delete")
    await _assert_consistent(test_pool, snapshot_after_delete)
    assert snapshot_after_delete["product_count"] == 1


async def test_create_snapshot_isolation_transaction_falls_back_in_test_fixture(
    test_pool, test_user_id
):
    """Smoke test for the `_repeatable_read_transaction` fallback
    (`db/versioning.py`): `FakePool.acquire()` hands back a connection
    already inside an outer `read committed` transaction, so requesting
    `isolation="repeatable_read"` for the nested transaction must not raise
    — it should transparently fall back to a plain nested transaction
    (savepoint) instead."""
    versioning = VersioningRepository(test_pool)

    snapshot = await versioning.create_snapshot(test_user_id, "fallback-smoke")

    assert snapshot["product_count"] == 0


# ---------------------------------------------------------------------------
# T-009 / CMP-001, CMP-002, CMP-003, CMP-006, CMP-007 — compare_snapshots
# ---------------------------------------------------------------------------


async def test_compare_snapshots_classifies_added_removed_modified(
    test_pool, test_user_id
):
    """CMP-002 — a product only in "b" is `added`, a product only in "a" is
    `removed`, a product in both with a differing field is `modified`, and
    an identical product in both is excluded entirely."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)

    unchanged = await repo.create(test_user_id, _create_data(name="Unchanged Fund"))
    to_modify = await repo.create(test_user_id, _create_data(name="Amount Fund", amount=100000))
    to_remove = await repo.create(test_user_id, _create_data(name="Removed Fund"))

    snapshot_a = await versioning.create_snapshot(test_user_id, "a")

    await repo.delete(to_remove.id)
    await repo.update(to_modify.id, ProductUpdate(amount=130000))
    added_product = await repo.create(test_user_id, _create_data(name="New Fund"))

    snapshot_b = await versioning.create_snapshot(test_user_id, "b")

    diff = await versioning.compare_snapshots(snapshot_a["id"], snapshot_b["id"], test_user_id)

    assert {p["id"] for p in diff["added"]} == {added_product.id}
    assert {p["id"] for p in diff["removed"]} == {to_remove.id}
    assert {m["product_id"] for m in diff["modified"]} == {to_modify.id}
    assert {p["id"] for p in diff["added"] + diff["removed"]}.isdisjoint(
        {unchanged.id}
    )
    for m in diff["modified"]:
        assert m["product_id"] != unchanged.id


async def test_compare_snapshots_same_name_recreation_is_removed_and_added(
    test_pool, test_user_id
):
    """CMP-002 "Same-name re-creation is not treated as a modification" —
    diffing is by stable `product_id`, never by name."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)

    original = await repo.create(test_user_id, _create_data(name="Fund X"))
    snapshot_a = await versioning.create_snapshot(test_user_id, "a")

    await repo.delete(original.id)
    recreated = await repo.create(test_user_id, _create_data(name="Fund X"))
    snapshot_b = await versioning.create_snapshot(test_user_id, "b")

    diff = await versioning.compare_snapshots(snapshot_a["id"], snapshot_b["id"], test_user_id)

    assert original.id != recreated.id
    assert {p["id"] for p in diff["removed"]} == {original.id}
    assert {p["id"] for p in diff["added"]} == {recreated.id}
    assert diff["modified"] == []


async def test_compare_snapshots_per_field_delta_amount_only(test_pool, test_user_id):
    """CMP-003 "Amount-only change" — the delta shows only the field that
    actually differs, no unrelated fields."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)

    product = await repo.create(test_user_id, _create_data(amount=100000))
    snapshot_a = await versioning.create_snapshot(test_user_id, "a")
    await repo.update(product.id, ProductUpdate(amount=130000))
    snapshot_b = await versioning.create_snapshot(test_user_id, "b")

    diff = await versioning.compare_snapshots(snapshot_a["id"], snapshot_b["id"], test_user_id)

    assert len(diff["modified"]) == 1
    changes = diff["modified"][0]["changes"]
    assert changes == {"amount": {"before": 100000.0, "after": 130000.0}}


async def test_compare_snapshots_per_field_delta_composition(test_pool, test_user_id):
    """CMP-003 "Composition change" — the delta includes the before/after
    allocation lists."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)

    product = await repo.create(
        test_user_id,
        _create_data(composition=[{"name": "Debt", "percentage": 100}]),
    )
    snapshot_a = await versioning.create_snapshot(test_user_id, "a")
    await repo.update(
        product.id,
        ProductUpdate(
            composition=[
                {"name": "Debt", "percentage": 60},
                {"name": "Equity", "percentage": 40},
            ]
        ),
    )
    snapshot_b = await versioning.create_snapshot(test_user_id, "b")

    diff = await versioning.compare_snapshots(snapshot_a["id"], snapshot_b["id"], test_user_id)

    composition_delta = diff["modified"][0]["changes"]["composition"]
    assert composition_delta["before"] == [{"name": "Debt", "percentage": 100}]
    assert composition_delta["after"] == [
        {"name": "Debt", "percentage": 60},
        {"name": "Equity", "percentage": 40},
    ]


async def test_compare_snapshots_per_field_delta_category(test_pool, test_user_id):
    """CMP-003 "Category change moves a product across sections"."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)

    product = await repo.create(test_user_id, _create_data(category="privados"))
    snapshot_a = await versioning.create_snapshot(test_user_id, "a")
    await repo.update(product.id, ProductUpdate(category="club"))
    snapshot_b = await versioning.create_snapshot(test_user_id, "b")

    diff = await versioning.compare_snapshots(snapshot_a["id"], snapshot_b["id"], test_user_id)

    assert diff["modified"][0]["changes"]["category"] == {
        "before": "privados",
        "after": "club",
    }


async def test_compare_snapshots_per_field_delta_multiple_fields(test_pool, test_user_id):
    """CMP-003 "Multiple simultaneous field changes" — every differing field
    appears in the delta."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)

    product = await repo.create(
        test_user_id, _create_data(amount=100000, provider="SABBI")
    )
    snapshot_a = await versioning.create_snapshot(test_user_id, "a")
    await repo.update(
        product.id, ProductUpdate(amount=150000, provider="BlackRock")
    )
    snapshot_b = await versioning.create_snapshot(test_user_id, "b")

    diff = await versioning.compare_snapshots(snapshot_a["id"], snapshot_b["id"], test_user_id)

    changes = diff["modified"][0]["changes"]
    assert set(changes.keys()) == {"amount", "provider"}
    assert changes["amount"] == {"before": 100000.0, "after": 150000.0}
    assert changes["provider"] == {"before": "SABBI", "after": "BlackRock"}


async def test_compare_snapshots_cross_user_raises_access_error(test_pool, test_user_id):
    """CMP-001 "Comparing a snapshot the user does not own" — raises a
    distinguishable exception so the future route can map it to `403`."""
    versioning = VersioningRepository(test_pool)
    other_user_id = await _new_user(test_pool)
    other_snapshot = await versioning.create_snapshot(other_user_id, "not yours")
    own_snapshot = await versioning.create_snapshot(test_user_id, "mine")

    with pytest.raises(SnapshotAccessError):
        await versioning.compare_snapshots(own_snapshot["id"], other_snapshot["id"], test_user_id)


async def test_compare_snapshots_missing_id_raises_not_found_error(test_pool, test_user_id):
    """CMP-001 "Comparing a non-existent snapshot id" — raises a
    distinguishable exception so the future route can map it to `404`,
    separately from the cross-user `403` case."""
    versioning = VersioningRepository(test_pool)
    own_snapshot = await versioning.create_snapshot(test_user_id, "mine")

    with pytest.raises(SnapshotNotFoundError):
        await versioning.compare_snapshots(own_snapshot["id"], str(uuid.uuid4()), test_user_id)


async def test_compare_snapshots_self_comparison_is_empty_diff(test_pool, test_user_id):
    """CMP-006 — comparing a snapshot to itself succeeds with empty
    `added`/`removed`/`modified` lists, falling out naturally from the
    set-difference algorithm rather than a special case."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    await repo.create(test_user_id, _create_data())
    snapshot = await versioning.create_snapshot(test_user_id, "solo")

    diff = await versioning.compare_snapshots(snapshot["id"], snapshot["id"], test_user_id)

    assert diff["added"] == []
    assert diff["removed"] == []
    assert diff["modified"] == []
    assert diff["summary"] == {
        "added_count": 0,
        "removed_count": 0,
        "modified_count": 0,
        "total_amount_delta": 0.0,
        "product_count_delta": 0,
    }


async def test_compare_snapshots_baseline_is_always_a_regardless_of_order(
    test_pool, test_user_id
):
    """CMP-007 — `a` is always the baseline for `before`/`after` labeling,
    even when `a` is chronologically newer than `b`."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)

    product = await repo.create(test_user_id, _create_data(amount=100000))
    snapshot_q2 = await versioning.create_snapshot(test_user_id, "Q2")
    await repo.update(product.id, ProductUpdate(amount=130000))
    snapshot_q3 = await versioning.create_snapshot(test_user_id, "Q3")

    # Request the newer snapshot (Q3) as the baseline ("a") — reversed from
    # chronological order.
    diff = await versioning.compare_snapshots(snapshot_q3["id"], snapshot_q2["id"], test_user_id)

    changes = diff["modified"][0]["changes"]
    assert changes["amount"] == {"before": 130000.0, "after": 100000.0}


# ---------------------------------------------------------------------------
# T-010 / AL-006, AL-007 — list_changes
# ---------------------------------------------------------------------------


async def test_list_changes_default_page_size(test_pool, test_user_id):
    """AL-006 "Default page size" — no query params returns up to the
    default page size (50) with pagination metadata."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    for i in range(55):
        await repo.create(test_user_id, _create_data(name=f"Fund {i}"))

    result = await versioning.list_changes(test_user_id)

    assert len(result["changes"]) == 50
    assert result["total"] == 55
    assert result["has_more"] is True


async def test_list_changes_explicit_pagination(test_pool, test_user_id):
    """AL-006 "Explicit pagination" — `limit`/`offset` slice the
    reverse-chronological list."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    created = []
    base = datetime(2024, 1, 1, tzinfo=timezone.utc)
    for i in range(5):
        product = await repo.create(test_user_id, _create_data(name=f"Fund {i}"))
        created.append(product)
        await test_pool.execute(
            "UPDATE portfolio_changes SET created_at = $2 WHERE product_id = $1",
            product.id,
            base + timedelta(minutes=i),
        )

    result = await versioning.list_changes(test_user_id, limit=2, offset=1)

    assert result["total"] == 5
    assert [c["product_id"] for c in result["changes"]] == [
        created[3].id,
        created[2].id,
    ]
    assert result["has_more"] is True


async def test_list_changes_empty_for_new_user(test_pool, test_user_id):
    """AL-006 "Empty change log" — returns an empty list, not an error."""
    versioning = VersioningRepository(test_pool)

    result = await versioning.list_changes(test_user_id)

    assert result["changes"] == []
    assert result["total"] == 0
    assert result["has_more"] is False


async def test_list_changes_filters_by_product_id(test_pool, test_user_id):
    """`tasks.md` T-010 — optional `product_id` filter returns only that
    product's entries."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    product_a = await repo.create(test_user_id, _create_data(name="A"))
    product_b = await repo.create(test_user_id, _create_data(name="B"))
    await repo.update(product_a.id, ProductUpdate(amount=999999))

    result = await versioning.list_changes(test_user_id, product_id=product_a.id)

    assert result["total"] == 2
    assert all(c["product_id"] == product_a.id for c in result["changes"])
    assert product_b.id not in {c["product_id"] for c in result["changes"]}


async def test_list_changes_scoped_to_user(test_pool, test_user_id):
    """AL-007 "User sees only their own changes" — ownership scoping."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    other_user_id = await _new_user(test_pool)
    await repo.create(test_user_id, _create_data(name="Mine"))
    await repo.create(other_user_id, _create_data(name="Theirs"))

    result = await versioning.list_changes(test_user_id)

    assert result["total"] == 1
    assert result["changes"][0]["user_id"] == test_user_id


async def test_list_changes_admin_reuses_same_method_for_target_user(
    test_pool, test_user_id
):
    """AL-007 "Admin views a client's change history read-only" —
    `list_changes` is reused unmodified for the admin-scoped read path
    (PR5's route calls this same method with the target client's
    `user_id`, never a forked query)."""
    repo = ProductRepository(test_pool)
    versioning = VersioningRepository(test_pool)
    client_user_id = await _new_user(test_pool)
    await repo.create(client_user_id, _create_data(name="Client Fund"), source="admin")

    result = await versioning.list_changes(client_user_id)

    assert result["total"] == 1
    assert result["changes"][0]["source"] == "admin"
    assert result["changes"][0]["user_id"] == client_user_id

"""Integration tests for transactional audit logging in
`db/repository.py` (`ProductRepository.create`/`.update`/`.delete`).

Covers `sdd/portfolio-versioning/specs/audit-log.spec.md` — AL-001
("Change Log Entry on Product Create"), AL-002 ("... on Product Update"),
AL-003 ("... on Product Delete"), AL-004 ("Change Log Atomicity"), and
AL-005 ("Change Log Source Attribution").

Also includes a smoke test for `tasks.md` T-001's acceptance criteria:
`FakePool.acquire()` must support `async with ... as conn: async with
conn.transaction(): ...` against a real `TEST_DATABASE_URL`.
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg
import pytest

from db.models import ProductCreate, ProductUpdate
from db.repository import ProductRepository


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


def _jsonb(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


async def _fetch_changes(test_pool: Any, user_id: str) -> list[asyncpg.Record]:
    return await test_pool.fetch(
        "SELECT * FROM portfolio_changes WHERE user_id = $1 ORDER BY created_at",
        user_id,
    )


async def _fetch_change(test_pool: Any, product_id: str, operation: str) -> asyncpg.Record:
    """Fetch a single `portfolio_changes` row by `product_id`/`operation`.

    Nested transactions (`FakePool.acquire()` savepoints) share the outer
    per-test transaction's snapshot, so `now()` — and therefore
    `created_at` — is identical across every mutation logged within one
    test. Filtering by `product_id` + `operation` avoids relying on
    `created_at` ordering to disambiguate rows within a single test.
    """
    rows = await test_pool.fetch(
        "SELECT * FROM portfolio_changes WHERE product_id = $1 AND operation = $2",
        product_id,
        operation,
    )
    assert len(rows) == 1, f"expected exactly one {operation!r} row for {product_id!r}"
    return rows[0]


# ---------------------------------------------------------------------------
# T-001 smoke test — FakePool.acquire() + conn.transaction()
# ---------------------------------------------------------------------------


async def test_fake_pool_acquire_supports_transaction(test_pool, test_user_id):
    async with test_pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE users SET active_thread_id = $1 WHERE id = $2",
                "smoke-thread",
                test_user_id,
            )

    row = await test_pool.fetchrow(
        "SELECT active_thread_id FROM users WHERE id = $1", test_user_id
    )
    assert row["active_thread_id"] == "smoke-thread"


# ---------------------------------------------------------------------------
# AL-001 — create
# ---------------------------------------------------------------------------


async def test_create_logs_operation_create_with_null_before_state(test_pool, test_user_id):
    repo = ProductRepository(test_pool)

    product = await repo.create(test_user_id, _create_data())

    changes = await _fetch_changes(test_pool, test_user_id)
    assert len(changes) == 1
    change = changes[0]
    assert change["operation"] == "create"
    assert change["product_id"] == product.id
    assert change["before_state"] is None
    after = _jsonb(change["after_state"])
    assert after["name"] == "BlackRock Private Credit Fund"
    assert after["amount"] == 150000


async def test_create_source_defaults_to_api(test_pool, test_user_id):
    repo = ProductRepository(test_pool)

    await repo.create(test_user_id, _create_data())

    changes = await _fetch_changes(test_pool, test_user_id)
    assert changes[0]["source"] == "api"


async def test_create_source_is_overridden_when_passed(test_pool, test_user_id):
    repo = ProductRepository(test_pool)

    await repo.create(test_user_id, _create_data(), source="agent")

    changes = await _fetch_changes(test_pool, test_user_id)
    assert changes[0]["source"] == "agent"


async def test_create_metadata_round_trips_as_jsonb(test_pool, test_user_id):
    repo = ProductRepository(test_pool)

    await repo.create(test_user_id, _create_data(), metadata={"tool": "add_product"})

    changes = await _fetch_changes(test_pool, test_user_id)
    metadata = _jsonb(changes[0]["metadata"])
    assert metadata == {"tool": "add_product"}


# ---------------------------------------------------------------------------
# AL-002 — update
# ---------------------------------------------------------------------------


async def test_update_logs_full_before_after_state(test_pool, test_user_id):
    repo = ProductRepository(test_pool)
    product = await repo.create(test_user_id, _create_data(amount=150000))

    await repo.update(product.id, ProductUpdate(amount=175000))

    update_change = await _fetch_change(test_pool, product.id, "update")
    before = _jsonb(update_change["before_state"])
    after = _jsonb(update_change["after_state"])
    assert before["amount"] == 150000
    assert after["amount"] == 175000


async def test_update_partial_field_only_changes_touched_field_in_after_state(
    test_pool, test_user_id
):
    repo = ProductRepository(test_pool)
    product = await repo.create(
        test_user_id, _create_data(category="privados", provider="SABBI")
    )

    await repo.update(product.id, ProductUpdate(category="club"))

    update_change = await _fetch_change(test_pool, product.id, "update")
    after = _jsonb(update_change["after_state"])
    assert after["category"] == "club"
    assert after["provider"] == "SABBI"


async def test_update_missing_product_returns_none_and_does_not_log(test_pool, test_user_id):
    repo = ProductRepository(test_pool)

    result = await repo.update("prod_doesnotexist", ProductUpdate(amount=1))

    assert result is None
    changes = await _fetch_changes(test_pool, test_user_id)
    assert changes == []


# ---------------------------------------------------------------------------
# AL-003 — delete
# ---------------------------------------------------------------------------


async def test_delete_logs_before_state_with_null_after_state(test_pool, test_user_id):
    repo = ProductRepository(test_pool)
    product = await repo.create(test_user_id, _create_data(amount=125000))

    deleted = await repo.delete(product.id)

    assert deleted is True
    delete_change = await _fetch_change(test_pool, product.id, "delete")
    before = _jsonb(delete_change["before_state"])
    assert before["amount"] == 125000
    assert delete_change["after_state"] is None


async def test_delete_missing_product_returns_false_and_does_not_log(test_pool, test_user_id):
    repo = ProductRepository(test_pool)

    deleted = await repo.delete("prod_doesnotexist")

    assert deleted is False
    changes = await _fetch_changes(test_pool, test_user_id)
    assert changes == []


# ---------------------------------------------------------------------------
# AL-004 — atomicity
# ---------------------------------------------------------------------------


async def test_log_change_failure_rolls_back_create(test_pool, test_user_id, monkeypatch):
    repo = ProductRepository(test_pool)

    async def _boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("simulated change-log failure")

    monkeypatch.setattr(repo, "_log_change", _boom)

    with pytest.raises(RuntimeError):
        await repo.create(test_user_id, _create_data())

    products = await repo.list_by_user(test_user_id)
    assert products == []


async def test_log_change_failure_rolls_back_update(test_pool, test_user_id, monkeypatch):
    repo = ProductRepository(test_pool)
    product = await repo.create(test_user_id, _create_data(amount=150000))

    async def _boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("simulated change-log failure")

    monkeypatch.setattr(repo, "_log_change", _boom)

    with pytest.raises(RuntimeError):
        await repo.update(product.id, ProductUpdate(amount=999999))

    unchanged = await repo.get(product.id)
    assert unchanged is not None
    assert unchanged.amount == 150000


async def test_log_change_failure_rolls_back_delete(test_pool, test_user_id, monkeypatch):
    repo = ProductRepository(test_pool)
    product = await repo.create(test_user_id, _create_data())

    async def _boom(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("simulated change-log failure")

    monkeypatch.setattr(repo, "_log_change", _boom)

    with pytest.raises(RuntimeError):
        await repo.delete(product.id)

    still_there = await repo.get(product.id)
    assert still_there is not None

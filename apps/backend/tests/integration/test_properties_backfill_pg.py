"""Integration test for `PropertyRepository.backfill_allocation_slugs` against
real Postgres (savepoint-isolated via the shared conftest)."""

from __future__ import annotations

import json

from db.properties import PropertyRepository


async def _holding(pool, code: str, asset_class: list[dict]) -> None:
    await pool.execute(
        "INSERT INTO property_holding (code, client, asset_class) VALUES ($1, 'Client', $2::jsonb)",
        code,
        json.dumps(asset_class),
    )


async def test_backfill_fills_missing_slugs_and_is_idempotent(test_pool):
    await _holding(test_pool, "PR-1", [{"name": "Renta Fija", "percentage": 100}])
    repo = PropertyRepository(test_pool)

    first = await repo.backfill_allocation_slugs()

    assert first["asset_class"] >= 1
    stored = await test_pool.fetchval(
        "SELECT asset_class FROM property_holding WHERE code = 'PR-1'"
    )
    items = json.loads(stored) if isinstance(stored, str) else stored
    assert items[0]["slugs"] == ["renta-fija"]

    second = await repo.backfill_allocation_slugs()

    assert second["asset_class"] == 0

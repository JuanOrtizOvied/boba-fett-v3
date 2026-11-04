"""Integration tests for the catalog change history (ficha-catalog-curation
T-1) against real Postgres."""

from __future__ import annotations

from db.catalog_history import CatalogHistoryRepository


async def test_record_and_list_for_product(test_pool, test_user_id):
    repo = CatalogHistoryRepository(test_pool)

    await repo.record(
        "BD-00001",
        "update",
        test_user_id,
        "ficha",
        {"name": {"old": "A", "new": "B"}},
    )
    await repo.record("BD-00001", "create", None, "ficha", {})

    entries = await repo.list_for_product("BD-00001")
    assert len(entries) == 2
    # Newest first.
    assert entries[0].action == "create"
    assert entries[1].action == "update"
    assert entries[1].changes["name"]["new"] == "B"
    assert entries[1].source == "ficha"
    assert entries[1].changed_by == test_user_id
    assert entries[0].changed_by is None


async def test_list_for_product_empty(test_pool):
    repo = CatalogHistoryRepository(test_pool)
    assert await repo.list_for_product("BD-DOES-NOT-EXIST") == []

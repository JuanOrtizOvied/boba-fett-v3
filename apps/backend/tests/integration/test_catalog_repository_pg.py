"""Integration tests for `db/catalog_repository.py` admin methods
(`list_all`, `insert_if_not_duplicate`, `delete`) against real Postgres.

Covers `sdd/product-catalog-approval/spec` — "Duplicate Detection Before
Catalog Insertion" ("Exact duplicate rejected regardless of case or
spacing", "Entry differing in one field is not a duplicate"), "Catalog
Listing", and "Catalog Entry Deletion" ("Deleted entries drop out of
cascade search").
"""

from __future__ import annotations

from db.catalog_repository import CatalogRepository
from db.models import CatalogProductCreate


def _entry(**overrides) -> CatalogProductCreate:
    data = {
        "name": "Bono Soberano",
        "category": "publicos",
        "subcategory": "renta_fija",
        "asset_class": "bonos",
        "geographic_focus": "LatAm",
        "underlying": "USD",
        "commission": "1.5%",
        "currency": "USD",
        "administrator": "Admin Co",
        "manager": "Manager Co",
        "liquidity": "T+2",
        "return_rate": "8%",
    }
    data.update(overrides)
    return CatalogProductCreate(**data)


# ---------------------------------------------------------------------------
# insert_if_not_duplicate — duplicate detection
# ---------------------------------------------------------------------------


async def test_insert_if_not_duplicate_rejects_exact_duplicate_case_and_spacing(test_pool):
    repo = CatalogRepository(test_pool)
    first = await repo.insert_if_not_duplicate(_entry())
    assert first is not None

    duplicate = await repo.insert_if_not_duplicate(
        _entry(name="  bono soberano  ", category="PUBLICOS", subcategory=" Renta_Fija ")
    )

    assert duplicate is None


async def test_insert_if_not_duplicate_allows_entry_differing_in_asset_class(test_pool):
    """`design.md` scopes the duplicate identity key to
    name + category + subcategory + asset_class (enrichment fields like
    `commission` are intentionally excluded — see deviation note in the
    apply-progress report). An entry differing in `asset_class`, which IS
    part of the key, must be inserted rather than rejected."""
    repo = CatalogRepository(test_pool)
    first = await repo.insert_if_not_duplicate(_entry())
    assert first is not None

    second = await repo.insert_if_not_duplicate(_entry(asset_class="acciones"))

    assert second is not None
    assert second.id != first.id
    assert second.asset_class == "acciones"


async def test_insert_if_not_duplicate_persists_provenance_fields(test_pool):
    repo = CatalogRepository(test_pool)

    created = await repo.insert_if_not_duplicate(
        _entry(approved_from_product_id="prod_abc123")
    )

    assert created is not None
    assert created.approved_from_product_id == "prod_abc123"
    assert created.approved_at is not None


async def test_replace_from_approval_updates_existing_entry(test_pool):
    repo = CatalogRepository(test_pool)
    created = await repo.insert_if_not_duplicate(
        _entry(commission="1.5%", alternative_names=["Bono Alias"])
    )

    replaced = await repo.replace_from_approval(
        created.id,
        _entry(commission="2.0%", approved_from_product_id="prod_updated"),
    )

    assert replaced is not None
    assert replaced.id == created.id
    assert replaced.commission == "2.0%"
    assert replaced.alternative_names == ["Bono Alias"]
    assert replaced.approved_from_product_id == "prod_updated"
    assert replaced.approved_at is not None


# ---------------------------------------------------------------------------
# list_all
# ---------------------------------------------------------------------------


async def test_list_all_returns_inserted_entries_ordered_by_id(test_pool):
    repo = CatalogRepository(test_pool)
    first = await repo.insert_if_not_duplicate(_entry(name="Fund A"))
    second = await repo.insert_if_not_duplicate(_entry(name="Fund B", commission="9%"))

    entries = await repo.list_all()

    ids = [e.id for e in entries]
    assert first.id in ids
    assert second.id in ids
    assert ids.index(first.id) < ids.index(second.id)


# ---------------------------------------------------------------------------
# delete
# ---------------------------------------------------------------------------


async def test_delete_removes_entry_and_returns_true(test_pool):
    repo = CatalogRepository(test_pool)
    created = await repo.insert_if_not_duplicate(_entry())

    deleted = await repo.delete(created.id)

    assert deleted is True
    remaining_ids = [e.id for e in await repo.list_all()]
    assert created.id not in remaining_ids


async def test_delete_nonexistent_entry_returns_false(test_pool):
    repo = CatalogRepository(test_pool)

    deleted = await repo.delete(999999)

    assert deleted is False


async def test_deleted_entry_drops_out_of_cascade_search(test_pool):
    repo = CatalogRepository(test_pool)
    created = await repo.insert_if_not_duplicate(_entry(name="UniqueSearchableFund"))

    await repo.delete(created.id)

    results = await repo.search("UniqueSearchableFund")
    assert all(r.id != created.id for r in results)

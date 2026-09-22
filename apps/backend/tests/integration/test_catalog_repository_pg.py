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
        "asset_class": [{"name": "mercados_publicos", "percentage": 100}],
        "geographic_focus": [{"name": "LatAm", "percentage": 100}],
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
        _entry(name="  bono soberano  ")
    )

    assert duplicate is None


async def test_insert_if_not_duplicate_allows_entry_differing_in_asset_class(test_pool):
    """`design.md` scopes the duplicate identity key to
    name + asset_class (enrichment fields like `commission` are
    intentionally excluded — see deviation note in the apply-progress
    report). An entry differing in `asset_class`, which IS part of the key,
    must be inserted rather than rejected."""
    repo = CatalogRepository(test_pool)
    first = await repo.insert_if_not_duplicate(_entry())
    assert first is not None

    second = await repo.insert_if_not_duplicate(_entry(asset_class=[{"name": "acciones", "percentage": 100}]))

    assert second is not None
    assert second.id != first.id
    assert second.asset_class[0].name == "acciones"


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
# get_catalog — search against `slugs`
# ---------------------------------------------------------------------------


async def test_get_catalog_search_matches_name_ignoring_accents(test_pool):
    """`slugs` normalizes with unaccent, so an unaccented query must still
    find an accented name — the old `name ILIKE` branch didn't unaccent."""
    repo = CatalogRepository(test_pool)
    created = await repo.insert_if_not_duplicate(_entry(name="Múltiplo Fund"))

    results = await repo.get_catalog("multiplo", 50, 0)

    assert any(r["id"] == created.id for r in results)


async def test_get_catalog_search_matches_alternative_name(test_pool):
    repo = CatalogRepository(test_pool)
    created = await repo.insert_if_not_duplicate(
        _entry(name="Fondo XYZ", alternative_names=["Alias Buscable"])
    )

    results = await repo.get_catalog("Alias Buscable", 50, 0)

    assert any(r["id"] == created.id for r in results)


async def test_get_catalog_search_ranks_exact_name_match_before_partial(test_pool):
    repo = CatalogRepository(test_pool)
    exact = await repo.insert_if_not_duplicate(_entry(name="Renta Fija"))
    partial = await repo.insert_if_not_duplicate(
        _entry(name="Fondo de Renta Fija Plus", commission="2%")
    )

    results = await repo.get_catalog("Renta Fija", 50, 0)

    ids = [r["id"] for r in results]
    assert ids.index(exact.id) < ids.index(partial.id)


async def test_get_catalog_search_excludes_non_matching_entries(test_pool):
    repo = CatalogRepository(test_pool)
    await repo.insert_if_not_duplicate(_entry(name="Unrelated Fund"))

    results = await repo.get_catalog("NoSuchSlugAnywhere", 50, 0)

    assert results == []


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


# ---------------------------------------------------------------------------
# get_catalog — field filters (openspec/changes/catalog-export-and-filters)
# ---------------------------------------------------------------------------


async def test_get_catalog_filters_by_single_scalar_value(test_pool):
    repo = CatalogRepository(test_pool)
    soles = await repo.insert_if_not_duplicate(_entry(name="Fondo Soles", currency="Soles"))
    await repo.insert_if_not_duplicate(_entry(name="Fondo Dolares", currency="Dólares"))

    results = await repo.get_catalog(None, 50, 0, currency=["Soles"])

    ids = [r["id"] for r in results]
    assert soles.id in ids
    assert all(r["currency"] == "Soles" for r in results)


async def test_get_catalog_filters_are_case_and_whitespace_insensitive(test_pool):
    """`currency` (and `administrator`/`manager`) are free text with no
    format enforcement on create, so legacy rows can carry inconsistent
    casing (e.g. `"dólares"` saved lowercase) while the filter UI only
    offers the canonically-cased option (`"Dólares"`, from
    `CURRENCY_OPTIONS`). The filter must still match (confirmed against
    real data: 2026-09-22)."""
    repo = CatalogRepository(test_pool)
    lowercase = await repo.insert_if_not_duplicate(
        _entry(name="Fondo Minusculas", currency="dólares")
    )
    padded = await repo.insert_if_not_duplicate(
        _entry(name="Fondo Espacios", currency="  Dólares  ")
    )

    results = await repo.get_catalog(None, 50, 0, currency=["Dólares"])

    ids = {r["id"] for r in results}
    assert lowercase.id in ids
    assert padded.id in ids


async def test_get_catalog_filters_by_multiple_values_on_same_field_combine_with_or(test_pool):
    """Values within one field combine with OR — filtering by
    Soles+Dólares must return entries in either currency, excluding a
    third currency (design.md ADR-4)."""
    repo = CatalogRepository(test_pool)
    soles = await repo.insert_if_not_duplicate(_entry(name="Fondo Soles", currency="Soles"))
    dolares = await repo.insert_if_not_duplicate(_entry(name="Fondo Dolares", currency="Dólares"))
    euros = await repo.insert_if_not_duplicate(_entry(name="Fondo Euros", currency="Euros"))

    results = await repo.get_catalog(None, 50, 0, currency=["Soles", "Dólares"])

    ids = {r["id"] for r in results}
    assert soles.id in ids
    assert dolares.id in ids
    assert euros.id not in ids


async def test_get_catalog_filters_by_allocation_field_ignores_percentage(test_pool):
    """An allocation filter matches any entry with a matching element
    `name`, regardless of its `percentage` or the presence of other
    elements in the same array (design.md ADR-5)."""
    repo = CatalogRepository(test_pool)
    mixed = await repo.insert_if_not_duplicate(
        _entry(
            name="Fondo Mixto",
            asset_class=[
                {"name": "mercados_publicos", "percentage": 60},
                {"name": "mercados_privados", "percentage": 40},
            ],
        )
    )
    unrelated = await repo.insert_if_not_duplicate(
        _entry(name="Fondo Otro", asset_class=[{"name": "club_deals", "percentage": 100}])
    )

    results = await repo.get_catalog(None, 50, 0, asset_class=["mercados_publicos"])

    ids = {r["id"] for r in results}
    assert mixed.id in ids
    assert unrelated.id not in ids


async def test_get_catalog_filters_combine_across_fields_with_and(test_pool):
    """Different filter fields combine with AND — an entry must match both
    to be included (design.md ADR-6)."""
    repo = CatalogRepository(test_pool)
    match = await repo.insert_if_not_duplicate(
        _entry(name="Fondo Match", currency="Soles", manager="Gestor XYZ")
    )
    wrong_manager = await repo.insert_if_not_duplicate(
        _entry(name="Fondo Otro Gestor", currency="Soles", manager="Otro Gestor")
    )
    wrong_currency = await repo.insert_if_not_duplicate(
        _entry(name="Fondo Otra Moneda", currency="Dólares", manager="Gestor XYZ")
    )

    results = await repo.get_catalog(
        None, 50, 0, currency=["Soles"], manager=["Gestor XYZ"]
    )

    ids = {r["id"] for r in results}
    assert match.id in ids
    assert wrong_manager.id not in ids
    assert wrong_currency.id not in ids


async def test_get_catalog_filters_combine_with_search(test_pool):
    repo = CatalogRepository(test_pool)
    match = await repo.insert_if_not_duplicate(
        _entry(name="Bono Especial", currency="Soles")
    )
    await repo.insert_if_not_duplicate(_entry(name="Bono Especial Dos", currency="Dólares"))

    results = await repo.get_catalog("Bono Especial", 50, 0, currency=["Soles"])

    ids = {r["id"] for r in results}
    assert ids == {match.id}


async def test_get_catalog_no_filter_matches_returns_empty_list(test_pool):
    repo = CatalogRepository(test_pool)
    await repo.insert_if_not_duplicate(_entry(name="Fondo Cualquiera", currency="Soles"))

    results = await repo.get_catalog(None, 50, 0, currency=["Yenes"])

    assert results == []


# ---------------------------------------------------------------------------
# get_by_ids — selective Excel export
# ---------------------------------------------------------------------------


async def test_get_by_ids_returns_matching_entries_only(test_pool):
    repo = CatalogRepository(test_pool)
    first = await repo.insert_if_not_duplicate(_entry(name="Fondo Uno"))
    second = await repo.insert_if_not_duplicate(_entry(name="Fondo Dos", commission="2%"))
    await repo.insert_if_not_duplicate(_entry(name="Fondo Tres", commission="3%"))

    results = await repo.get_by_ids([first.id, second.id])

    ids = {e.id for e in results}
    assert ids == {first.id, second.id}


async def test_get_by_ids_ignores_nonexistent_ids(test_pool):
    repo = CatalogRepository(test_pool)
    created = await repo.insert_if_not_duplicate(_entry(name="Fondo Existente"))

    results = await repo.get_by_ids([created.id, 999999])

    ids = {e.id for e in results}
    assert ids == {created.id}


async def test_get_by_ids_empty_list_returns_empty_list(test_pool):
    repo = CatalogRepository(test_pool)

    results = await repo.get_by_ids([])

    assert results == []

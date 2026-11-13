"""Per-item `slugs` on normalized catalog allocations (no DB)."""

from __future__ import annotations

import json

import pytest

from db.catalog_normalized import (
    CatalogAllocation,
    CatalogProductCreate,
    CatalogProductRow,
    CatalogProductUpdate,
    _allocations,
    _db_value,
    slugify_name,
)
from db.models import AssetAllocation

_RAW = [{"name": "Mercados Públicos - Variable", "percentage": 100}]
_FIELDS = ("asset_class", "geographic_focus", "underlying")


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Mercados Públicos", "mercados-publicos"),
        ("A - B / C", "a-b-c"),
        ("  --Renta   Fija!! ", "renta-fija"),
        ("Multiple    spaces", "multiple-spaces"),
        ("", ""),
        ("   ", ""),
        ("—", ""),
    ],
)
def test_slugify_name(name: str, expected: str) -> None:
    assert slugify_name(name) == expected


def test_allocation_computes_slug_from_name() -> None:
    alloc = CatalogAllocation(name="Mercados Públicos - Variable", percentage=100)
    assert alloc.slugs == ["mercados-publicos-variable"]


def test_allocation_ignores_client_slugs() -> None:
    alloc = CatalogAllocation(name="Renta Fija", percentage=100, slugs=["hacker"])
    assert alloc.slugs == ["renta-fija"]


def test_allocation_empty_name_has_no_slugs() -> None:
    assert CatalogAllocation(name="—", percentage=0).slugs == []


def test_shared_asset_allocation_unchanged() -> None:
    assert "slugs" not in AssetAllocation(name="X", percentage=1).model_dump()


@pytest.mark.parametrize("field", _FIELDS)
def test_create_row_update_models_dump_slugs(field: str) -> None:
    create = CatalogProductCreate(code="C", name="N", **{field: _RAW})
    row = CatalogProductRow(id=1, code="C", name="N", **{field: _RAW})
    update = CatalogProductUpdate(**{field: _RAW})
    for model in (create, row, update):
        dumped = getattr(model, field)[0].model_dump()
        assert dumped["slugs"] == ["mercados-publicos-variable"]
    assert json.loads(_db_value(field, create_items(create, field)))[0]["slugs"] == [
        "mercados-publicos-variable"
    ]


def create_items(model: object, field: str) -> list[CatalogAllocation]:
    return getattr(model, field)


def test_read_recomputes_slugs_for_legacy_json() -> None:
    items = _allocations('[{"name":"Deuda Privada","percentage":100}]')
    assert items[0].slugs == ["deuda-privada"]


def test_models_accept_shared_asset_allocation_instances() -> None:
    row = CatalogProductRow(
        id=1,
        code="C",
        name="N",
        asset_class=[AssetAllocation(name="Cash y Otros", percentage=100)],
    )
    assert row.asset_class[0].slugs == ["cash-y-otros"]

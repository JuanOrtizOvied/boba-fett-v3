"""Unit tests for the ficha→catalog curation service
(`db.catalog_curation.apply_catalog_product_update`). Repos are mocked — no DB.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from types import SimpleNamespace

from db.catalog_curation import (
    AdminUpdateInput,
    SeriesUpdateInput,
    apply_catalog_curation,
    apply_catalog_product_update,
    create_catalog_product_from_ficha,
)
from db.catalog_normalized import (
    CatalogProductRow,
    CatalogProductSeries,
    CatalogProductSeriesAdmin,
    CatalogProductUpdate,
)
from db.models import AssetAllocation

pytestmark = pytest.mark.asyncio


def _current(**kw) -> CatalogProductRow:
    base = dict(id=1, code="BD-1", name="Old Name", manager="Old Mgr", currency="USD")
    base.update(kw)
    return CatalogProductRow(**base)


async def test_updates_changed_fields_and_records_history():
    catalog = AsyncMock()
    catalog.get_product_detail.return_value = _current()
    history = AsyncMock()

    update = CatalogProductUpdate(name="New Name", manager="Old Mgr", currency="PEN")
    changes = await apply_catalog_product_update(catalog, history, "BD-1", update, "user-1")

    assert set(changes) == {"name", "currency"}  # manager unchanged
    assert changes["name"] == {"old": "Old Name", "new": "New Name"}
    assert changes["currency"] == {"old": "USD", "new": "PEN"}
    catalog.update_product.assert_awaited_once()
    history.record.assert_awaited_once()
    args = history.record.await_args.args
    assert args[0] == "BD-1" and args[1] == "update" and args[2] == "user-1"


async def test_diffs_allocation_lists():
    catalog = AsyncMock()
    catalog.get_product_detail.return_value = _current(
        asset_class=[AssetAllocation(name="Cash y Otros", percentage=100)]
    )
    history = AsyncMock()

    update = CatalogProductUpdate(
        asset_class=[AssetAllocation(name="Mercados Privados", percentage=100)]
    )
    changes = await apply_catalog_product_update(catalog, history, "BD-1", update, None)

    assert "asset_class" in changes
    catalog.update_product.assert_awaited_once()


async def test_no_update_when_nothing_changed():
    catalog = AsyncMock()
    catalog.get_product_detail.return_value = _current()
    history = AsyncMock()

    update = CatalogProductUpdate(name="Old Name", manager="Old Mgr", currency="USD")
    changes = await apply_catalog_product_update(catalog, history, "BD-1", update, "user-1")

    assert changes == {}
    catalog.update_product.assert_not_awaited()
    history.record.assert_not_awaited()


def _product_with_series() -> CatalogProductRow:
    admin = CatalogProductSeriesAdmin(
        id=100, product_code="BD-1", series="A", administrator="Core", custody_fee=0.001
    )
    series = CatalogProductSeries(
        id=10,
        product_code="BD-1",
        series="A",
        management_fee_ter=0.0236,
        return_min=0.12,
        return_max=0.14,
        administrators=[admin],
    )
    return _current(series=[series])


async def test_updates_changed_series_and_admins():
    catalog = AsyncMock()
    catalog.get_product_detail.return_value = _product_with_series()
    history = AsyncMock()

    series_in = [
        SeriesUpdateInput(series="A", management_fee_ter=0.03, return_min=0.12, return_max=0.14)
    ]  # only TER changed
    admin_in = [AdminUpdateInput(series="A", administrator="Core", custody_fee=0.002)]

    changes = await apply_catalog_curation(
        catalog, history, "BD-1", CatalogProductUpdate(), series_in, admin_in, "user-1"
    )

    assert "management_fee_ter" in changes["series"]["A"]
    assert "return_min" not in changes["series"]["A"]  # unchanged
    assert "administrators" in changes
    catalog.update_series.assert_awaited_once()
    catalog.update_admin.assert_awaited_once()
    history.record.assert_awaited_once()


async def test_series_unchanged_no_update():
    catalog = AsyncMock()
    catalog.get_product_detail.return_value = _product_with_series()
    history = AsyncMock()

    # Same values → no writes.
    series_in = [SeriesUpdateInput(series="A", management_fee_ter=0.0236)]
    changes = await apply_catalog_curation(
        catalog, history, "BD-1", CatalogProductUpdate(), series_in, [], "user-1"
    )

    assert changes == {}
    catalog.update_series.assert_not_awaited()
    history.record.assert_not_awaited()


async def test_create_new_catalog_product_from_ficha():
    catalog = AsyncMock()
    catalog.next_product_code.return_value = "BD-00042"
    catalog.create_product.return_value = SimpleNamespace(id=5, code="BD-00042")
    history = AsyncMock()

    created = await create_catalog_product_from_ficha(
        catalog,
        history,
        CatalogProductUpdate(name="New Fund", manager="Mgr"),
        "Fallback Name",
        "user-1",
    )

    assert created.code == "BD-00042"
    create_arg = catalog.create_product.await_args.args[0]
    assert create_arg.code == "BD-00042"
    assert create_arg.name == "New Fund"
    assert create_arg.manager == "Mgr"
    history.record.assert_awaited_once()
    assert history.record.await_args.args[1] == "create"


async def test_create_uses_name_fallback_when_missing():
    catalog = AsyncMock()
    catalog.next_product_code.return_value = "BD-00043"
    catalog.create_product.return_value = SimpleNamespace(id=6, code="BD-00043")
    history = AsyncMock()

    await create_catalog_product_from_ficha(
        catalog, history, CatalogProductUpdate(), "Fallback Name", None
    )

    assert catalog.create_product.await_args.args[0].name == "Fallback Name"


async def test_returns_empty_when_product_missing():
    catalog = AsyncMock()
    catalog.get_product_detail.return_value = None
    history = AsyncMock()

    changes = await apply_catalog_product_update(
        catalog, history, "MISSING", CatalogProductUpdate(name="Y"), None
    )

    assert changes == {}
    catalog.update_product.assert_not_awaited()
    history.record.assert_not_awaited()

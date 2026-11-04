"""Unit tests for the ficha→catalog curation service
(`db.catalog_curation.apply_catalog_product_update`). Repos are mocked — no DB.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from db.catalog_curation import apply_catalog_product_update
from db.catalog_normalized import CatalogProductRow, CatalogProductUpdate
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

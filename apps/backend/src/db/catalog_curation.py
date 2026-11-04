"""Ficha → V2 catalog curation (ficha-catalog-curation).

Applies an admin-reviewed edit to an existing `catalog_product`, recording only
the fields that actually changed into the catalog change history. Series/admin
updates are a follow-up (T-2b).
"""

from __future__ import annotations

from typing import Any

from db.catalog_history import CatalogHistoryRepository
from db.catalog_normalized import (
    CatalogProductUpdate,
    NormalizedCatalogRepository,
)

_PRODUCT_STR_FIELDS = (
    "name",
    "manager",
    "currency",
    "ticker_isin",
    "investment_horizon",
)
_PRODUCT_LIST_FIELDS = ("asset_class", "geographic_focus", "underlying")


async def apply_catalog_product_update(
    catalog_repo: NormalizedCatalogRepository,
    history_repo: CatalogHistoryRepository,
    code: str,
    update: CatalogProductUpdate,
    changed_by: str | None,
) -> dict[str, Any]:
    """Update the product-level fields of a catalog product that actually
    changed vs. its current values, and append a history row. Returns the diff
    ({field: {old, new}}); empty (and no writes) when nothing changed or the
    product is missing."""
    current = await catalog_repo.get_product_detail(code)
    if current is None:
        return {}

    changes: dict[str, Any] = {}
    for field in _PRODUCT_STR_FIELDS:
        new = getattr(update, field)
        if new is None:
            continue
        old = getattr(current, field) or ""
        if new != old:
            changes[field] = {"old": old, "new": new}

    for field in _PRODUCT_LIST_FIELDS:
        new = getattr(update, field)
        if new is None:
            continue
        old_list = [a.model_dump() for a in getattr(current, field)]
        new_list = [a.model_dump() for a in new]
        if new_list != old_list:
            changes[field] = {"old": old_list, "new": new_list}

    if not changes:
        return {}

    await catalog_repo.update_product(code, update)
    await history_repo.record(code, "update", changed_by, "ficha", changes)
    return changes

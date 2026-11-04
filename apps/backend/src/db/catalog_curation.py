"""Ficha → V2 catalog curation (ficha-catalog-curation).

Applies an admin-reviewed edit to an existing `catalog_product` (product-level
fields + its series and administrators), recording only the fields that actually
changed into the catalog change history.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from db.catalog_history import CatalogHistoryRepository
from db.catalog_normalized import (
    CatalogProductRow,
    CatalogProductSeriesAdminUpdate,
    CatalogProductSeriesUpdate,
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
_SERIES_FIELDS = (
    "management_fee_ter",
    "flows_min",
    "flows_max",
    "return_min",
    "return_max",
)
_ADMIN_FIELDS = (
    "custody_fee",
    "buy_commission",
    "sell_commission",
    "minimum_usd",
    "min_commission_usd",
)


class SeriesUpdateInput(BaseModel):
    series: str
    management_fee_ter: float | None = None
    flows_min: float | None = None
    flows_max: float | None = None
    return_min: float | None = None
    return_max: float | None = None


class AdminUpdateInput(BaseModel):
    series: str
    administrator: str
    custody_fee: float | None = None
    buy_commission: float | None = None
    sell_commission: float | None = None
    minimum_usd: float | None = None
    min_commission_usd: float | None = None


def _num_changed(new: Any, old: Any) -> bool:
    if isinstance(new, (int, float)) and isinstance(old, (int, float)):
        return abs(float(new) - float(old)) > 1e-9
    return new != old


def _diff_product(current: CatalogProductRow, update: CatalogProductUpdate) -> dict[str, Any]:
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
    return changes


async def _apply_series(
    catalog_repo: NormalizedCatalogRepository,
    current: CatalogProductRow,
    series_updates: list[SeriesUpdateInput],
) -> dict[str, Any]:
    by_name = {s.series: s for s in current.series}
    changes: dict[str, Any] = {}
    for su in series_updates:
        cur = by_name.get(su.series)
        if cur is None:
            continue
        field_changes = {
            f: {"old": getattr(cur, f), "new": getattr(su, f)}
            for f in _SERIES_FIELDS
            if getattr(su, f) is not None and _num_changed(getattr(su, f), getattr(cur, f))
        }
        if field_changes:
            await catalog_repo.update_series(
                cur.id,
                CatalogProductSeriesUpdate(**{f: getattr(su, f) for f in _SERIES_FIELDS}),
            )
            changes[su.series] = field_changes
    return changes


async def _apply_admins(
    catalog_repo: NormalizedCatalogRepository,
    current: CatalogProductRow,
    admin_updates: list[AdminUpdateInput],
) -> dict[str, Any]:
    by_key = {(s.series, a.administrator): a for s in current.series for a in s.administrators}
    changes: dict[str, Any] = {}
    for au in admin_updates:
        cur = by_key.get((au.series, au.administrator))
        if cur is None:
            continue
        field_changes = {
            f: {"old": getattr(cur, f), "new": getattr(au, f)}
            for f in _ADMIN_FIELDS
            if getattr(au, f) is not None and _num_changed(getattr(au, f), getattr(cur, f))
        }
        if field_changes:
            await catalog_repo.update_admin(
                cur.id,
                CatalogProductSeriesAdminUpdate(**{f: getattr(au, f) for f in _ADMIN_FIELDS}),
            )
            changes[f"{au.administrator} / {au.series}"] = field_changes
    return changes


async def apply_catalog_curation(
    catalog_repo: NormalizedCatalogRepository,
    history_repo: CatalogHistoryRepository,
    code: str,
    product: CatalogProductUpdate,
    series: list[SeriesUpdateInput],
    admins: list[AdminUpdateInput],
    changed_by: str | None,
) -> dict[str, Any]:
    """Update a catalog product's changed product-level fields, series, and
    administrators, recording one combined history row. Returns the combined
    diff; empty (no writes) when nothing changed or the product is missing."""
    current = await catalog_repo.get_product_detail(code)
    if current is None:
        return {}

    changes = _diff_product(current, product)
    if changes:
        await catalog_repo.update_product(code, product)

    series_changes = await _apply_series(catalog_repo, current, series)
    if series_changes:
        changes["series"] = series_changes
    admin_changes = await _apply_admins(catalog_repo, current, admins)
    if admin_changes:
        changes["administrators"] = admin_changes

    if not changes:
        return {}

    await history_repo.record(code, "update", changed_by, "ficha", changes)
    return changes


async def apply_catalog_product_update(
    catalog_repo: NormalizedCatalogRepository,
    history_repo: CatalogHistoryRepository,
    code: str,
    update: CatalogProductUpdate,
    changed_by: str | None,
) -> dict[str, Any]:
    """Product-level-only convenience wrapper over `apply_catalog_curation`."""
    return await apply_catalog_curation(
        catalog_repo, history_repo, code, update, [], [], changed_by
    )

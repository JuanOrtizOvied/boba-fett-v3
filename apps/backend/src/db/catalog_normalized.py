"""Read models and repository for the normalized product catalog.

Three levels: product -> product x series -> product x series x administrator.
Fee, commission, flow and return values are FRACTIONS as in the source Excel
(0.0384 = 3.84%), not percentages.
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg
from pydantic import BaseModel, Field

from db.models import AssetAllocation


def _to_float(value: Any) -> float | None:
    return None if value is None else float(value)


def _allocations(raw: Any) -> list[AssetAllocation]:
    data = json.loads(raw) if isinstance(raw, str) else (raw or [])
    return [AssetAllocation(**item) for item in data]


class CatalogProductSeriesAdmin(BaseModel):
    id: int
    product_code: str
    series: str
    administrator: str
    custody_fee: float | None = None
    buy_commission: float | None = None
    sell_commission: float | None = None
    billing_currency: str = ""
    minimum_usd: float | None = None
    min_commission_usd: float | None = None


class CatalogProductSeries(BaseModel):
    id: int
    product_code: str
    series: str
    management_fee_ter: float | None = None
    flows_min: float | None = None
    flows_max: float | None = None
    return_min: float | None = None
    return_max: float | None = None
    administrators: list[CatalogProductSeriesAdmin] = Field(default_factory=list)


class CatalogProductRow(BaseModel):
    id: int
    code: str
    name: str
    ticker_isin: str = ""
    manager: str = ""
    asset_class: list[AssetAllocation] = Field(default_factory=list)
    geographic_focus: list[AssetAllocation] = Field(default_factory=list)
    underlying: list[AssetAllocation] = Field(default_factory=list)
    currency: str = ""
    investment_horizon: str = ""
    series: list[CatalogProductSeries] = Field(default_factory=list)


_PRODUCT_COLS = (
    "id, code, name, ticker_isin, manager, asset_class, geographic_focus, "
    "underlying, currency, investment_horizon"
)


def _product_from_record(r: asyncpg.Record) -> CatalogProductRow:
    return CatalogProductRow(
        id=r["id"],
        code=r["code"],
        name=r["name"],
        ticker_isin=r["ticker_isin"] or "",
        manager=r["manager"] or "",
        asset_class=_allocations(r["asset_class"]),
        geographic_focus=_allocations(r["geographic_focus"]),
        underlying=_allocations(r["underlying"]),
        currency=r["currency"] or "",
        investment_horizon=r["investment_horizon"] or "",
    )


def _series_from_record(r: asyncpg.Record) -> CatalogProductSeries:
    return CatalogProductSeries(
        id=r["id"],
        product_code=r["product_code"],
        series=r["series"],
        management_fee_ter=_to_float(r["management_fee_ter"]),
        flows_min=_to_float(r["flows_min"]),
        flows_max=_to_float(r["flows_max"]),
        return_min=_to_float(r["return_min"]),
        return_max=_to_float(r["return_max"]),
    )


def _admin_from_record(r: asyncpg.Record) -> CatalogProductSeriesAdmin:
    return CatalogProductSeriesAdmin(
        id=r["id"],
        product_code=r["product_code"],
        series=r["series"],
        administrator=r["administrator"],
        custody_fee=_to_float(r["custody_fee"]),
        buy_commission=_to_float(r["buy_commission"]),
        sell_commission=_to_float(r["sell_commission"]),
        billing_currency=r["billing_currency"] or "",
        minimum_usd=_to_float(r["minimum_usd"]),
        min_commission_usd=_to_float(r["min_commission_usd"]),
    )


class NormalizedCatalogRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def list_products(self) -> list[CatalogProductRow]:
        """Products only (no nested series), ordered by code."""
        rows = await self._pool.fetch(f"SELECT {_PRODUCT_COLS} FROM catalog_product ORDER BY code")
        return [_product_from_record(r) for r in rows]

    async def get_product_detail(self, code: str) -> CatalogProductRow | None:
        """Product with nested series and, under each series, its administrators."""
        row = await self._pool.fetchrow(
            f"SELECT {_PRODUCT_COLS} FROM catalog_product WHERE code = $1", code
        )
        if row is None:
            return None
        product = _product_from_record(row)

        series_rows = await self._pool.fetch(
            "SELECT * FROM catalog_product_series WHERE product_code = $1 ORDER BY series, id",
            code,
        )
        admin_rows = await self._pool.fetch(
            "SELECT * FROM catalog_product_series_admin WHERE product_code = $1 "
            "ORDER BY series, administrator, id",
            code,
        )
        by_series = {s.series: s for s in map(_series_from_record, series_rows)}
        for admin_row in admin_rows:
            by_series[admin_row["series"]].administrators.append(_admin_from_record(admin_row))
        product.series = list(by_series.values())
        return product

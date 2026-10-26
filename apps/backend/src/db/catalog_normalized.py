"""Read models and repository for the normalized product catalog.

Three levels: product -> product x series -> product x series x administrator.
Fee, commission, flow and return values are FRACTIONS as in the source Excel
(0.0384 = 3.84%), not percentages.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import asyncpg
from pydantic import BaseModel, Field, field_validator

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


@dataclass(frozen=True)
class NormalizedSnapshot:
    """Every row of the three tables, flat (series and administrators are not
    nested), for the SharePoint sync to compare against the workbook."""

    products: list[CatalogProductRow]
    series: list[CatalogProductSeries]
    admins: list[CatalogProductSeriesAdmin]


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


def _require_text(value: str) -> str:
    if not value or not value.strip():
        raise ValueError("must not be empty")
    return value


class CatalogProductCreate(BaseModel):
    code: str
    name: str
    ticker_isin: str = ""
    manager: str = ""
    asset_class: list[AssetAllocation] = Field(default_factory=list)
    geographic_focus: list[AssetAllocation] = Field(default_factory=list)
    underlying: list[AssetAllocation] = Field(default_factory=list)
    currency: str = ""
    investment_horizon: str = ""

    _check = field_validator("code", "name")(_require_text)


class CatalogProductUpdate(BaseModel):
    name: str | None = None
    ticker_isin: str | None = None
    manager: str | None = None
    asset_class: list[AssetAllocation] | None = None
    geographic_focus: list[AssetAllocation] | None = None
    underlying: list[AssetAllocation] | None = None
    currency: str | None = None
    investment_horizon: str | None = None

    @field_validator("name")
    @classmethod
    def _name_not_empty(cls, v: str | None) -> str | None:
        return v if v is None else _require_text(v)


class CatalogProductSeriesCreate(BaseModel):
    product_code: str
    series: str
    management_fee_ter: float | None = None
    flows_min: float | None = None
    flows_max: float | None = None
    return_min: float | None = None
    return_max: float | None = None

    _check = field_validator("product_code", "series")(_require_text)


class CatalogProductSeriesUpdate(BaseModel):
    management_fee_ter: float | None = None
    flows_min: float | None = None
    flows_max: float | None = None
    return_min: float | None = None
    return_max: float | None = None


class CatalogProductSeriesAdminCreate(BaseModel):
    product_code: str
    series: str
    administrator: str
    custody_fee: float | None = None
    buy_commission: float | None = None
    sell_commission: float | None = None
    billing_currency: str = ""
    minimum_usd: float | None = None
    min_commission_usd: float | None = None

    _check = field_validator("product_code", "series", "administrator")(_require_text)


class CatalogProductSeriesAdminUpdate(BaseModel):
    custody_fee: float | None = None
    buy_commission: float | None = None
    sell_commission: float | None = None
    billing_currency: str | None = None
    minimum_usd: float | None = None
    min_commission_usd: float | None = None


_JSON_COLS = {"asset_class", "geographic_focus", "underlying"}


def _db_value(col: str, value: Any) -> Any:
    if col in _JSON_COLS:
        return json.dumps([a.model_dump() for a in value])
    return value


def _insert_sql(table: str, cols: list[str]) -> str:
    placeholders = ", ".join(
        f"${i}::jsonb" if c in _JSON_COLS else f"${i}" for i, c in enumerate(cols, 1)
    )
    return f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({placeholders}) RETURNING *"


class NormalizedCatalogRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def list_products(self, search: str | None = None) -> list[CatalogProductRow]:
        """Products only (no nested series), ordered by code. `search` filters
        by code/name (case-insensitive substring)."""
        if search:
            rows = await self._pool.fetch(
                f"SELECT {_PRODUCT_COLS} FROM catalog_product "
                "WHERE code ILIKE $1 OR name ILIKE $1 ORDER BY code",
                f"%{search}%",
            )
        else:
            rows = await self._pool.fetch(
                f"SELECT {_PRODUCT_COLS} FROM catalog_product ORDER BY code"
            )
        return [_product_from_record(r) for r in rows]

    async def list_for_sync(self) -> NormalizedSnapshot:
        """All products, series and administrators in three plain queries."""
        products = await self.list_products()
        series_rows = await self._pool.fetch(
            "SELECT * FROM catalog_product_series ORDER BY product_code, series"
        )
        admin_rows = await self._pool.fetch(
            "SELECT * FROM catalog_product_series_admin "
            "ORDER BY product_code, series, administrator"
        )
        return NormalizedSnapshot(
            products=products,
            series=[_series_from_record(r) for r in series_rows],
            admins=[_admin_from_record(r) for r in admin_rows],
        )

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

    async def list_with_children(self) -> list[CatalogProductRow]:
        """Every product with its series and their administrators, in three
        queries (not one per product), ordered by code."""
        products = await self.list_products()
        series_rows = await self._pool.fetch(
            "SELECT * FROM catalog_product_series ORDER BY product_code, series, id"
        )
        admin_rows = await self._pool.fetch(
            "SELECT * FROM catalog_product_series_admin "
            "ORDER BY product_code, series, administrator, id"
        )
        by_code = {p.code: p for p in products}
        by_series: dict[tuple[str, str], CatalogProductSeries] = {}
        for row in series_rows:
            series = _series_from_record(row)
            by_code[series.product_code].series.append(series)
            by_series[(series.product_code, series.series)] = series
        for row in admin_rows:
            by_series[(row["product_code"], row["series"])].administrators.append(
                _admin_from_record(row)
            )
        return products

    # --- writes -------------------------------------------------------------
    # Constraint violations (asyncpg UniqueViolationError / ForeignKeyViolationError)
    # propagate to the caller; the route layer maps them to HTTP errors.

    async def _insert(self, table: str, data: BaseModel) -> asyncpg.Record:
        values = data.model_dump(exclude_unset=False)
        cols = list(values)
        args = [_db_value(c, getattr(data, c)) for c in cols]
        return await self._pool.fetchrow(_insert_sql(table, cols), *args)

    async def _update(
        self, table: str, key_col: str, key: Any, data: BaseModel
    ) -> asyncpg.Record | None:
        changes = data.model_dump(exclude_none=True)
        if not changes:
            return await self._pool.fetchrow(f"SELECT * FROM {table} WHERE {key_col} = $1", key)
        cols = list(changes)
        sets = ", ".join(
            f"{c} = ${i}::jsonb" if c in _JSON_COLS else f"{c} = ${i}"
            for i, c in enumerate(cols, 1)
        )
        args = [_db_value(c, getattr(data, c)) for c in cols]
        return await self._pool.fetchrow(
            f"UPDATE {table} SET {sets} WHERE {key_col} = ${len(cols) + 1} RETURNING *",
            *args,
            key,
        )

    async def _delete(self, table: str, key_col: str, key: Any) -> bool:
        row = await self._pool.fetchrow(
            f"DELETE FROM {table} WHERE {key_col} = $1 RETURNING 1", key
        )
        return row is not None

    async def create_product(self, data: CatalogProductCreate) -> CatalogProductRow:
        return _product_from_record(await self._insert("catalog_product", data))

    async def update_product(
        self, code: str, data: CatalogProductUpdate
    ) -> CatalogProductRow | None:
        row = await self._update("catalog_product", "code", code, data)
        return None if row is None else _product_from_record(row)

    async def delete_product(self, code: str) -> bool:
        return await self._delete("catalog_product", "code", code)

    async def create_series(self, data: CatalogProductSeriesCreate) -> CatalogProductSeries:
        return _series_from_record(await self._insert("catalog_product_series", data))

    async def update_series(
        self, series_id: int, data: CatalogProductSeriesUpdate
    ) -> CatalogProductSeries | None:
        row = await self._update("catalog_product_series", "id", series_id, data)
        return None if row is None else _series_from_record(row)

    async def delete_series(self, series_id: int) -> bool:
        return await self._delete("catalog_product_series", "id", series_id)

    async def create_admin(
        self, data: CatalogProductSeriesAdminCreate
    ) -> CatalogProductSeriesAdmin:
        return _admin_from_record(await self._insert("catalog_product_series_admin", data))

    async def update_admin(
        self, admin_id: int, data: CatalogProductSeriesAdminUpdate
    ) -> CatalogProductSeriesAdmin | None:
        row = await self._update("catalog_product_series_admin", "id", admin_id, data)
        return None if row is None else _admin_from_record(row)

    async def delete_admin(self, admin_id: int) -> bool:
        return await self._delete("catalog_product_series_admin", "id", admin_id)

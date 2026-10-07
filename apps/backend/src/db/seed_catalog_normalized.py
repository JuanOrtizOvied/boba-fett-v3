"""Seed the normalized catalog tables from the v2 products Excel file.

Usage:
    python -m db.seed_catalog_normalized /path/to/BD_Productos_Sabbi_v2.xlsx

Reads three sheets by name ("1. Productos", "2. Producto x Serie",
"3. Producto x Administrador") and loads catalog_product,
catalog_product_series and catalog_product_series_admin in dependency order
inside one transaction. Numeric values are stored as fractions exactly as in
the Excel (0.0384 = 3.84%).
"""

from __future__ import annotations

import asyncio
import sys
from typing import Any, Sequence

from openpyxl import load_workbook

from db.connection import close_pool, get_pool
from db.seed_catalog import _clean, _parse_pct_list

SHEET_PRODUCTS = "1. Productos"
SHEET_SERIES = "2. Producto x Serie"
SHEET_ADMINS = "3. Producto x Administrador"


def _num(value: Any) -> float | None:
    """Coerce a cell to float. None/blank -> None; '3.84%' -> 3.84; junk -> None."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = _clean(value).replace("%", "").replace(",", ".").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _cell(row: Sequence[Any], idx: int) -> Any:
    return row[idx] if idx < len(row) else None


def product_row_to_params(row: Sequence[Any]) -> tuple | None:
    code = _clean(_cell(row, 0))
    if not code:
        return None
    return (
        code,
        _clean(_cell(row, 1)),
        _clean(_cell(row, 2)),
        _clean(_cell(row, 3)),
        _parse_pct_list(_cell(row, 4), fallback_100=True),
        _parse_pct_list(_cell(row, 5)),
        _parse_pct_list(_cell(row, 6), fallback_100=True),
        _clean(_cell(row, 7)),
        _clean(_cell(row, 8)),
    )


def series_row_to_params(row: Sequence[Any]) -> tuple | None:
    code = _clean(_cell(row, 0))
    series = _clean(_cell(row, 1))
    if not code or not series:
        return None
    return (
        code,
        series,
        _num(_cell(row, 4)),
        _num(_cell(row, 5)),
        _num(_cell(row, 6)),
        _num(_cell(row, 7)),
        _num(_cell(row, 8)),
    )


def admin_row_to_params(row: Sequence[Any]) -> tuple | None:
    code = _clean(_cell(row, 0))
    administrator = _clean(_cell(row, 1))
    series = _clean(_cell(row, 2))
    if not code or not administrator or not series:
        return None
    return (
        code,
        series,
        administrator,
        _num(_cell(row, 5)),
        _num(_cell(row, 6)),
        _num(_cell(row, 7)),
        _clean(_cell(row, 8)),
        _num(_cell(row, 9)),
        _num(_cell(row, 10)),
    )


def _read_sheet(wb: Any, name: str, mapper: Any) -> list[tuple]:
    ws = wb[name]
    mapped = (mapper(r) for r in ws.iter_rows(min_row=2, values_only=True))
    return [p for p in mapped if p is not None]


_UPSERT_PRODUCT = """
INSERT INTO catalog_product
    (code, name, ticker_isin, manager, asset_class, geographic_focus,
     underlying, currency, investment_horizon)
VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name, ticker_isin = EXCLUDED.ticker_isin,
    manager = EXCLUDED.manager, asset_class = EXCLUDED.asset_class,
    geographic_focus = EXCLUDED.geographic_focus, underlying = EXCLUDED.underlying,
    currency = EXCLUDED.currency, investment_horizon = EXCLUDED.investment_horizon
"""

_UPSERT_SERIES = """
INSERT INTO catalog_product_series
    (product_code, series, management_fee_ter, flows_min, flows_max,
     return_min, return_max)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (product_code, series) DO UPDATE SET
    management_fee_ter = EXCLUDED.management_fee_ter,
    flows_min = EXCLUDED.flows_min, flows_max = EXCLUDED.flows_max,
    return_min = EXCLUDED.return_min, return_max = EXCLUDED.return_max
"""

_UPSERT_ADMIN = """
INSERT INTO catalog_product_series_admin
    (product_code, series, administrator, custody_fee, buy_commission,
     sell_commission, billing_currency, minimum_usd, min_commission_usd)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (product_code, administrator, series) DO UPDATE SET
    custody_fee = EXCLUDED.custody_fee, buy_commission = EXCLUDED.buy_commission,
    sell_commission = EXCLUDED.sell_commission,
    billing_currency = EXCLUDED.billing_currency,
    minimum_usd = EXCLUDED.minimum_usd,
    min_commission_usd = EXCLUDED.min_commission_usd
"""


async def seed(path: str) -> tuple[int, int, int]:
    wb = load_workbook(path, read_only=True, data_only=True)
    try:
        products = _read_sheet(wb, SHEET_PRODUCTS, product_row_to_params)
        series = _read_sheet(wb, SHEET_SERIES, series_row_to_params)
        admins = _read_sheet(wb, SHEET_ADMINS, admin_row_to_params)
    finally:
        wb.close()

    pool = await get_pool()
    try:
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute(
                "TRUNCATE catalog_product_series_admin, catalog_product_series, "
                "catalog_product RESTART IDENTITY CASCADE"
            )
            await conn.executemany(_UPSERT_PRODUCT, products)
            await conn.executemany(_UPSERT_SERIES, series)
            await conn.executemany(_UPSERT_ADMIN, admins)
    finally:
        await close_pool()
    return len(products), len(series), len(admins)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m db.seed_catalog_normalized <path-to-excel>")
        sys.exit(1)
    n_products, n_series, n_admins = asyncio.run(seed(sys.argv[1]))
    print(f"Seeded {n_products} products, {n_series} series, {n_admins} administrators")

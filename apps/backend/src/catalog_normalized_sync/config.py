"""Static configuration for the normalized catalog sync: the three sheets of
the workbook, the Excel header each column is read from, and the
environment-driven settings.

Columns are located by header text, never by position, so they may move as
the sheet grows. A header that is not listed here is ignored (the key
columns `Llave (...)`, the repeated `Nombre de Producto` and the counters
`N° de series` / `N° de tenencias` are derived data, not synced).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

SHEET_PRODUCTS = "1. Productos"
SHEET_SERIES = "2. Producto x Serie"
SHEET_ADMINS = "3. Producto x Administrador"

LEVEL_PRODUCT = "product"
LEVEL_SERIES = "series"
LEVEL_ADMIN = "admin"

ColumnType = Literal["text", "number", "allocations"]


@dataclass(frozen=True)
class Column:
    """One synced column. `required` means the header must exist and the
    value must not be blank (a row that breaks it is skipped, not synced).
    `allow_blank` keeps the header requirement but lets the value be blank:
    the row is synced with an empty value so the observations can flag it,
    instead of dropping it and hiding the gap from the owners."""

    field: str
    headers: tuple[str, ...]
    type: ColumnType
    required: bool = False
    allow_blank: bool = False
    fallback_100: bool = False


@dataclass(frozen=True)
class SheetSpec:
    level: str
    sheet_name: str
    columns: tuple[Column, ...]
    key_fields: tuple[str, ...]


PRODUCT_COLUMNS = (
    Column("code", ("Código", "Codigo"), "text", required=True),
    Column("name", ("Nombre de Producto",), "text", required=True),
    Column("ticker_isin", ("Ticker / ISIN", "Ticker / ISIN (si aplica)"), "text"),
    Column("manager", ("Nombre Gestor",), "text"),
    Column("asset_class", ("Clase de Activo",), "allocations", fallback_100=True),
    Column("geographic_focus", ("Foco Geográfico",), "allocations"),
    Column("underlying", ("Subyacente",), "allocations", fallback_100=True),
    Column("currency", ("Moneda",), "text"),
    Column("investment_horizon", ("Horizonte de inversión",), "text"),
)

SERIES_COLUMNS = (
    Column("product_code", ("Código", "Codigo"), "text", required=True),
    Column("series", ("Serie / Clase",), "text", required=True, allow_blank=True),
    Column("management_fee_ter", ("Comisión de Gestión (TER) con IGV",), "number"),
    Column("flows_min", ("Flujos Min",), "number"),
    Column("flows_max", ("Flujos Max",), "number"),
    Column("return_min", ("Rentabilidad Min",), "number"),
    Column("return_max", ("Rentabilidad Max",), "number"),
)

ADMIN_COLUMNS = (
    Column("product_code", ("Código", "Codigo"), "text", required=True),
    Column("administrator", ("Administrador",), "text", required=True),
    Column("series", ("Serie / Clase",), "text", required=True, allow_blank=True),
    Column("custody_fee", ("Custodia con IGV",), "number"),
    Column("buy_commission", ("Comisión de Compra",), "number"),
    Column("sell_commission", ("Comisión de Venta",), "number"),
    Column("billing_currency", ("Moneda de Cobro",), "text"),
    Column("minimum_usd", ("Mínimo (USD)",), "number"),
    Column("min_commission_usd", ("Comisión Mín. (USD)",), "number"),
)

# Parents first: the diff and a later apply step both rely on this order.
SHEETS = (
    SheetSpec(LEVEL_PRODUCT, SHEET_PRODUCTS, PRODUCT_COLUMNS, ("code",)),
    SheetSpec(LEVEL_SERIES, SHEET_SERIES, SERIES_COLUMNS, ("product_code", "series")),
    SheetSpec(
        LEVEL_ADMIN,
        SHEET_ADMINS,
        ADMIN_COLUMNS,
        ("product_code", "series", "administrator"),
    ),
)


@dataclass(frozen=True)
class NormalizedSettings:
    """Settings of this sync on top of the Azure and site ones that
    `catalog_sync.config.Settings` already reads. The flag is its own so that
    turning this sync on never turns on the one for `product_catalog`."""

    sync_enabled: bool
    file_path: str | None = None

    @classmethod
    def from_env(cls) -> NormalizedSettings:
        return cls(
            sync_enabled=os.environ.get("SHAREPOINT_NORMALIZED_SYNC_ENABLED", "false")
            .strip()
            .lower()
            == "true",
            file_path=os.environ.get("SHAREPOINT_NORMALIZED_FILE_PATH"),
        )

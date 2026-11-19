"""Static configuration for the properties sync: the one sheet of the workbook
that feeds it and the Excel header each column is read from.

Columns are located by header text, never by position, so they may move as the
sheet grows. A header that is not listed here is ignored (a column without a
header, or one nobody asked for). Header matching ignores case, accents and
spacing.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Literal

SHEET_PROPERTIES = "6. Propiedades"

# Deletes are held back when more than this share of the active rows would go at
# once: that points to a wrong or truncated file, not to an edit.
MAX_DELETE_RATIO = 0.35

ColumnType = Literal["text", "number", "allocations"]


@dataclass(frozen=True)
class Column:
    """One synced column. `required` means the header must exist and the value must
    not be blank (a row that breaks it is skipped). `fallback_100` makes an
    allocation cell with a name and no percentage count as 100%."""

    field: str
    headers: tuple[str, ...]
    type: ColumnType
    required: bool = False
    fallback_100: bool = False


PROPERTY_COLUMNS = (
    Column("code", ("Código",), "text", required=True),
    Column("client", ("Cliente",), "text", required=True),
    Column("name", ("Nombre / Descripción",), "text"),
    Column("manager", ("Nombre Gestor",), "text"),
    Column("administrator", ("Nombre Administrador",), "text"),
    Column("asset_class", ("Clase de Activo",), "allocations", fallback_100=True),
    Column("geographic_focus", ("Foco Geográfico",), "allocations"),
    Column("underlying", ("Subyacente",), "allocations", fallback_100=True),
    Column("currency", ("Moneda",), "text"),
    Column("investment_horizon", ("Horizonte de inversión",), "text"),
    Column("flows_min", ("Flujos Min (renta anual)",), "number"),
    Column("flows_max", ("Flujos Max (renta anual)",), "number"),
    Column("return_min", ("Rentabilidad Min",), "number"),
    Column("return_max", ("Rentabilidad Max",), "number"),
    Column("ownership_pct", ("% de Pertenencia",), "number"),
    Column("estimated_value_usd", ("Valor Estimado (USD)",), "number"),
    Column("monthly_rent_usd", ("Alquiler Mensual (USD)",), "number"),
    Column("usage", ("Uso",), "text"),
)

# One row per client and property: the key of a row.
KEY_FIELDS = ("code", "client")


@dataclass(frozen=True)
class PropertiesSettings:
    """Settings of this sync on top of the Azure and site ones that
    `catalog_sync.config.Settings` already reads.

    It has no flag and no variable of its own: the sheet is in the same workbook
    the normalized catalog sync reads, so this sync runs when
    `SHAREPOINT_NORMALIZED_SYNC_ENABLED` is true and uses the same
    `SHAREPOINT_NORMALIZED_FILE_PATH`. Only the variables are read; no settings
    class of the catalog is imported."""

    sync_enabled: bool
    file_path: str | None = None

    @classmethod
    def from_env(cls) -> PropertiesSettings:
        return cls(
            sync_enabled=os.environ.get("SHAREPOINT_NORMALIZED_SYNC_ENABLED", "false")
            .strip()
            .lower()
            == "true",
            file_path=os.environ.get("SHAREPOINT_NORMALIZED_FILE_PATH"),
        )

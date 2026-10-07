"""Configuration of the v2 catalog sync (`openspec/changes/catalog-v2-sharepoint-sync`).

The workbook is the source of truth, so the official names below are the ones it
uses today. The column mapping is explicit and never inferred: adding a column
means adding one entry here. Nothing in this module reads the database or Graph.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# --- Sheets and columns -----------------------------------------------------

SHEET_PRODUCTS = "1. Productos"
SHEET_SERIES = "2. Producto x Serie"
SHEET_ADMINISTRATORS = "3. Producto x Administrador"

# What a column holds. `KEY` columns identify a row, `ENTITY_*` columns name a
# manager or an administrator, `CONTROL` is the delete flag.
KEY = "key"
TEXT = "text"
ENTITY_MANAGER = "entity_manager"
ENTITY_ADMINISTRATOR = "entity_administrator"
COMPOSITE = "composite"
CURRENCY = "currency"
HORIZON = "horizon"
NUMBER = "number"
CONTROL = "control"

DELETE_FIELD = "is_deleted"
# The value that stands for "not defined yet" in several columns.
PENDING_VALUE = "Por confirmar"


@dataclass(frozen=True)
class Column:
    """One workbook column: its header, the field it fills and what it holds."""

    header: str
    field: str
    kind: str


@dataclass(frozen=True)
class SheetSpec:
    """A sheet: its name, the fields that identify a row, its mapped columns and
    the headers the workbook computes (never read, never stored)."""

    name: str
    key_fields: tuple[str, ...]
    columns: tuple[Column, ...]
    ignored_headers: tuple[str, ...] = ()

    def column_by_field(self, field_name: str) -> Column:
        return next(c for c in self.columns if c.field == field_name)


PRODUCTS_SHEET = SheetSpec(
    name=SHEET_PRODUCTS,
    key_fields=("codigo",),
    columns=(
        Column("Código", "codigo", KEY),
        Column("Nombre de Producto", "name", TEXT),
        Column("Ticker / ISIN", "isin", TEXT),
        Column("Nombre Gestor", "manager", ENTITY_MANAGER),
        Column("Clase de Activo", "asset_class", COMPOSITE),
        Column("Foco Geográfico", "geographic_focus", COMPOSITE),
        Column("Subyacente", "underlying", COMPOSITE),
        Column("Moneda", "currency", CURRENCY),
        Column("Horizonte de inversión", "investment_horizon", HORIZON),
        Column("Eliminar", DELETE_FIELD, CONTROL),
    ),
    ignored_headers=("N° de series", "N° de tenencias"),
)

SERIES_SHEET = SheetSpec(
    name=SHEET_SERIES,
    key_fields=("codigo", "series"),
    columns=(
        Column("Código", "codigo", KEY),
        Column("Serie / Clase", "series", KEY),
        Column("Comisión de Gestión (TER) con IGV", "ter", NUMBER),
        Column("Flujos Min", "flows_min", NUMBER),
        Column("Flujos Max", "flows_max", NUMBER),
        Column("Rentabilidad Min", "return_min", NUMBER),
        Column("Rentabilidad Max", "return_max", NUMBER),
        Column("Eliminar", DELETE_FIELD, CONTROL),
    ),
    ignored_headers=("Llave (Código|Serie)", "Nombre de Producto"),
)

ADMINISTRATORS_SHEET = SheetSpec(
    name=SHEET_ADMINISTRATORS,
    key_fields=("codigo", "series", "administrator"),
    columns=(
        Column("Código", "codigo", KEY),
        Column("Administrador", "administrator", ENTITY_ADMINISTRATOR),
        Column("Serie / Clase", "series", KEY),
        Column("Custodia con IGV", "custody", NUMBER),
        Column("Comisión de Compra", "buy_commission", NUMBER),
        Column("Comisión de Venta", "sell_commission", NUMBER),
        Column("Mínimo (USD)", "minimum_usd", NUMBER),
        Column("Comisión Mín. (USD)", "min_commission_usd", NUMBER),
        Column("Eliminar", DELETE_FIELD, CONTROL),
    ),
    ignored_headers=("Llave (Código|Administrador|Serie)", "Nombre de Producto", "Moneda de Cobro"),
)

SHEETS = (PRODUCTS_SHEET, SERIES_SHEET, ADMINISTRATORS_SHEET)

# `Eliminar` values that mean "delete", compared after normalization. A real
# boolean True is handled by the parser.
DELETE_FLAG_VALUES = frozenset({"true", "verdadero", "si", "1"})

# --- Official values --------------------------------------------------------

CURRENCY_OPTIONS = ("Dólares", "Soles", PENDING_VALUE)

# Spellings accepted for a currency, keyed by their normalized form.
CURRENCY_ALIASES = {
    "dolares": "Dólares",
    "dolar": "Dólares",
    "usd": "Dólares",
    "us$": "Dólares",
    "soles": "Soles",
    "sol": "Soles",
    "pen": "Soles",
    "nuevos soles": "Soles",
    "por confirmar": PENDING_VALUE,
}

HORIZON_OPTIONS = (
    "Corto plazo",
    "Mediano plazo",
    "Mediano-largo plazo",
    "Largo plazo",
    PENDING_VALUE,
)

ASSET_CLASS_OPTIONS = (
    "Mercados Públicos – Variable",
    "Mercados Públicos – Fijo",
    "Cash y Otros",
    "Club Deals",
    "Mercados Privados",
    "Criptos y Commodities",
)

GEOGRAPHIC_FOCUS_OPTIONS = (
    "EEUU",
    "Perú",
    "Desarrollados ex-US",
    "Emergentes ex-Perú",
    "Latam ex-Perú",
)

UNDERLYING_OPTIONS = (
    "Cash",
    "US Large Cap",
    "Bonos Corporativos Investment Grade (AAA–BBB)",
    "Bonos Perú",
    "Mercados Emergentes ex Perú",
    "Acciones Peru",
    "Desarrollados ex US",
    "Private Credit Senior",
    "Club Deals Otros Peru",
    "Hedge Funds",
    "Bonos Latinoamérica",
    "Real Estate Privado (Fondos)",
    "Bonos High Yield",
    "Bonos Mercados Emergentes (Global)",
    "Club Deals Real Estate Peru",
    "Private Equity",
    "Club Deals Deuda Privada Peru",
    "Infrastructure Privada",
    "US Treasuries Corto Plazo",
    "US Treasuries – Largo Plazo",
    "Club Deals Real Estate USA y Otros",
    "US Mid & Small Cap",
    "Venture Capital",
    "Club Deals Deuda Privada Usa y otros",
    "Commodities",
    "Cripto",
    "Oro",
    "REITs Públicos",
)

# Official names of the composite fields, by field.
COMPOSITE_OPTIONS = {
    "asset_class": ASSET_CLASS_OPTIONS,
    "geographic_focus": GEOGRAPHIC_FOCUS_OPTIONS,
    "underlying": UNDERLYING_OPTIONS,
}

# --- Entity names -----------------------------------------------------------

# Words ignored when looking for possible duplicates (never when matching).
ARTICLES = frozenset({"de", "del", "la", "el", "los", "las", "y", "e"})
# Legal forms: two names that differ only by one of these are different
# entities on purpose (for example a SAB and a SAF of the same group).
LEGAL_FORMS = frozenset({"sa", "saa", "sac", "saf", "sab", "sat", "eirl", "srl", "sca"})

# --- Settings ---------------------------------------------------------------

DEFAULT_SYNC_INTERVAL_MINUTES = 360


def _positive_int_from_env(name: str, default: int) -> int:
    """A positive integer from the environment; anything else falls back to
    `default` so a typo never stops the job."""
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


@dataclass(frozen=True)
class Settings:
    """Environment-driven settings of the v2 sync. Every field is optional so
    importing this module, or building `Settings` with nothing set, never fails
    in local dev, CI or tests; `sync_enabled` defaults to `False` and gates every
    Graph-dependent code path. The Azure credentials, the site id and the sync
    interval are shared with the current sync; the flag, the file path and the
    notification URL are specific to v2."""

    sync_enabled: bool
    azure_client_id: str | None = field(default=None, repr=False)
    azure_tenant_id: str | None = field(default=None, repr=False)
    azure_client_secret: str | None = field(default=None, repr=False)
    sharepoint_site_id: str | None = None
    sharepoint_file_path: str | None = None
    graph_notification_url: str | None = None
    sync_interval_minutes: int = DEFAULT_SYNC_INTERVAL_MINUTES

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            sync_enabled=os.environ.get("SHAREPOINT_V2_SYNC_ENABLED", "false").strip().lower()
            == "true",
            azure_client_id=os.environ.get("AZURE_CLIENT_ID"),
            azure_tenant_id=os.environ.get("AZURE_TENANT_ID"),
            azure_client_secret=os.environ.get("AZURE_CLIENT_SECRET"),
            sharepoint_site_id=os.environ.get("SHAREPOINT_SITE_ID"),
            sharepoint_file_path=os.environ.get("SHAREPOINT_V2_FILE_PATH"),
            graph_notification_url=os.environ.get("GRAPH_V2_NOTIFICATION_URL"),
            sync_interval_minutes=_positive_int_from_env(
                "SHAREPOINT_SYNC_INTERVAL_MINUTES", DEFAULT_SYNC_INTERVAL_MINUTES
            ),
        )

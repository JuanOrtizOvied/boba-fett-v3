"""Static configuration for the SharePoint catalog sync: the Excel-to-DB
field mapping, the alias table used for tolerant value matching, the target
sheet name, and the sync's environment-driven settings
(`openspec/changes/catalog-sharepoint-sync` — design.md ADR-2, ADR-7,
ADR-12; arquitectura.md section 3).

Adding a new Excel column means adding one entry to `FIELD_MAPPING` — the
mapping is never auto-inferred (CLAUDE.md, "Prohibiciones").
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal, TypedDict

FieldType = Literal["key", "text", "finite_set", "composite", "normalized", "control"]

# `FieldType` values that `parser.py` and `diff.py` both special-case rather
# than treat as a plain mapped column: `codigo` is the match key, `Eliminar`
# is the delete control flag.
KEY_FIELD_TYPE: FieldType = "key"
CONTROL_FIELD_TYPE: FieldType = "control"


class FieldMapping(TypedDict):
    db_field: str
    type: FieldType
    db_type: str
    required: bool


# Excel header (exact text, row 1) -> DB field. Headers are located by name,
# never by column position, so columns may shift as the sheet grows
# (CLAUDE.md, "Prohibiciones"). Matches arquitectura.md section 3 exactly.
FIELD_MAPPING: dict[str, FieldMapping] = {
    "Codigo": {"db_field": "codigo", "type": "key", "db_type": "varchar(20)", "required": True},
    "Nombre de Producto": {
        "db_field": "name",
        "type": "text",
        "db_type": "text",
        "required": True,
    },
    "Ticker / ISIN (si aplica)": {
        "db_field": "isin",
        "type": "text",
        "db_type": "text",
        "required": False,
    },
    "Nombre Gestor": {
        "db_field": "manager",
        "type": "finite_set",
        "db_type": "text",
        "required": False,
    },
    "Clase de Activo": {
        "db_field": "asset_class",
        "type": "composite",
        "db_type": "jsonb",
        "required": False,
    },
    "Foco Geografico": {
        "db_field": "geographic_focus",
        "type": "composite",
        "db_type": "jsonb",
        "required": False,
    },
    "Subyacente": {
        "db_field": "underlying",
        "type": "composite",
        "db_type": "jsonb",
        "required": False,
    },
    "Moneda Base": {
        "db_field": "currency",
        "type": "normalized",
        "db_type": "text",
        "required": False,
    },
    "Liquidez": {
        "db_field": "liquidity",
        "type": "text",
        "db_type": "text",
        "required": False,
    },
    "Rentabilidad Estimada": {
        "db_field": "return_rate",
        "type": "text",
        "db_type": "text",
        "required": False,
    },
    "Flujos": {
        "db_field": "cash_flows",
        "type": "text",
        "db_type": "text",
        "required": False,
    },
    "Eliminar": {
        "db_field": "is_deleted",
        "type": "control",
        "db_type": "boolean",
        "required": False,
    },
}

def excel_managed_fields() -> list[str]:
    """DB fields that have a column in the Excel, in `FIELD_MAPPING` order,
    excluding the delete control flag (`is_deleted`). The admin edit modal
    shows these read-only for entries that have a `codigo`
    (catalog-excel-managed-fields spec, EM-06); derived from the mapping so a
    new Excel column protects its field with no frontend change (EM-04)."""
    return [
        spec["db_field"]
        for spec in FIELD_MAPPING.values()
        if spec["type"] != CONTROL_FIELD_TYPE
    ]


# The delete-flag column is looked up by this header name (never by
# position) — proposal.md, "Delete column header is `Eliminar`".
DELETE_FLAG_HEADER = "Eliminar"

# Excel strings that `parser.py` treats as Eliminar = TRUE (case-insensitive;
# design.md ADR-5). Blank and anything else, including "FALSE", mean no
# delete signal.
DELETE_FLAG_TRUE_VALUES = {"TRUE", "VERDADERO", "SI", "SÍ", "1"}

# Only sheet `parser.py` reads; a missing sheet aborts the run with no
# changes (design.md ADR-5). Other sheets in the workbook are out of scope.
SHEET_NAME = "1. Productos (maestra)"

# Alias table for finite-set values (manager, administrator, currency,
# geographic_focus, underlying, asset_class) that don't match the official
# list even after tolerant normalization (case/accents/dashes/whitespace via
# `normalize.normalize_key`) — a genuine spelling variant, not just
# formatting. One entry per alias; a hit stores the official spelling
# (design.md ADR-7). Keys/values here are the raw, non-normalized strings —
# `normalize.py` normalizes both sides before matching.
ALIAS_TABLE: dict[str, str] = {
    "Mercado publico variable": "Mercados Publicos - Variable",
    "Club deal": "Club deals",
}

# Currency aliases beyond case/accent tolerance, which already covers
# "soles", "Dolares", "dólares" (design.md ADR-7).
CURRENCY_ALIAS_TABLE: dict[str, str] = {
    "PEN": "Soles",
    "Nuevos soles": "Soles",
    "USD": "Dólares",
}


@dataclass(frozen=True)
class Settings:
    """Environment-driven settings for the SharePoint sync (design.md
    ADR-12). Every field is optional so importing this module, or
    constructing `Settings` with no environment variables set, never fails
    in local dev, CI, or tests — `sync_enabled` defaults to `False` and
    gates every Graph-dependent code path (`SHAREPOINT_SYNC_ENABLED`)."""

    sync_enabled: bool
    azure_client_id: str | None = field(default=None, repr=False)
    azure_tenant_id: str | None = field(default=None, repr=False)
    azure_client_secret: str | None = field(default=None, repr=False)
    sharepoint_site_id: str | None = None
    sharepoint_file_path: str | None = None
    sharepoint_sheet_name: str = SHEET_NAME
    graph_notification_url: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            sync_enabled=os.environ.get("SHAREPOINT_SYNC_ENABLED", "false").strip().lower()
            == "true",
            azure_client_id=os.environ.get("AZURE_CLIENT_ID"),
            azure_tenant_id=os.environ.get("AZURE_TENANT_ID"),
            azure_client_secret=os.environ.get("AZURE_CLIENT_SECRET"),
            sharepoint_site_id=os.environ.get("SHAREPOINT_SITE_ID"),
            sharepoint_file_path=os.environ.get("SHAREPOINT_FILE_PATH"),
            sharepoint_sheet_name=os.environ.get("SHAREPOINT_SHEET_NAME", SHEET_NAME),
            graph_notification_url=os.environ.get("GRAPH_NOTIFICATION_URL"),
        )

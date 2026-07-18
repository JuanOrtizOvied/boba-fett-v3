"""Helpers for converting uploaded file attachments into content blocks
that the Anthropic API accepts.  Claude's ``document`` type only supports
``application/pdf``; spreadsheets must be parsed server-side and sent as text.
"""

from __future__ import annotations

import base64
import csv
import io

SPREADSHEET_MIMES = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "text/csv",
}


def spreadsheet_to_text(data_b64: str, mime: str) -> str | None:
    """Parse a base64-encoded spreadsheet and return a text representation.
    Returns None for unsupported formats."""
    if mime not in SPREADSHEET_MIMES:
        return None
    raw = base64.b64decode(data_b64)

    if mime == "text/csv":
        text = raw.decode("utf-8", errors="replace")
        return f"[Contenido del archivo CSV]\n\n{text}"

    try:
        from openpyxl import load_workbook
    except ImportError:
        return "[Error: openpyxl not installed — cannot parse Excel file]"

    wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    parts: list[str] = []
    for sheet in wb.worksheets:
        rows: list[str] = []
        for row in sheet.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            parts.append(f"--- Hoja: {sheet.title} ---\n" + "\n".join(rows))
    wb.close()
    return (
        "[Contenido del archivo Excel]\n\n" + "\n\n".join(parts)
        if parts
        else "[Archivo Excel vacío]"
    )

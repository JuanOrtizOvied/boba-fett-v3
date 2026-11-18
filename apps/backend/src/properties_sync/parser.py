"""Excel workbook parser for the properties sync: bytes -> typed rows of the sheet
`6. Propiedades`, keyed by DB field name.

Pure module: no network, no database. A row that cannot be trusted (a blank key
part, a number that is not a number, an unreadable allocation, a repeated key) is
skipped and reported instead of raising, so one bad row never blocks the rest. A
missing sheet or a missing required column does raise: the file is not the
workbook this sync understands and nothing should be applied.

A skipped row carries its row number and the reason, which names the column but
never the text found in the cell. Its key holds a client name: use it to compare
rows, never to log it.
"""

from __future__ import annotations

import io
import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Any

from openpyxl import load_workbook

from properties_sync.config import KEY_FIELDS, PROPERTY_COLUMNS, SHEET_PROPERTIES, Column


class MissingSheetError(ValueError):
    """The sheet this sync needs is not in the workbook."""


class MissingColumnError(ValueError):
    """A required column is not in the header row of the sheet."""


_ZERO_WIDTH = re.compile("[​‌‍﻿]")
_ALLOCATION_ITEM = re.compile(r"(.+?):?\s+([\d.]+)\s*%")
_DASHES = {"–": "-", "—": "-", "−": "-"}

# A number cell with just this text means "no value", like an empty cell.
_EMPTY_MARK = "-"


@dataclass(frozen=True)
class ParsedRow:
    """One data row. `key` is `(code, client)` and `values` holds every synced column
    present in the sheet (keys included): text as `str`, numbers as `float | None`,
    allocations as a tuple of `(name, percentage)`."""

    row_number: int
    key: tuple[str, str]
    values: dict[str, Any]


@dataclass(frozen=True)
class SkippedRow:
    """`key` is the row's `(code, client)` when both could be read. The diff counts
    such a row as still in the workbook, so a row that only has a bad value never
    gets its database row soft deleted. `reason` names the column, not the cell."""

    row_number: int
    reason: str
    key: tuple[str, str] | None = None


@dataclass(frozen=True)
class ParsedProperties:
    rows: tuple[ParsedRow, ...]
    skipped: tuple[SkippedRow, ...]


class _InvalidRowError(ValueError):
    """The row is skipped; the message is the reason."""


def _normalize_key(value: str) -> str:
    """Comparison key for headers: lower case, no accents, dash variants unified,
    spacing collapsed."""
    text = value.strip()
    for variant, dash in _DASHES.items():
        text = text.replace(variant, dash)
    decomposed = unicodedata.normalize("NFKD", text.lower())
    without_accents = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(without_accents.split())


def _clean(value: object) -> str:
    if value is None:
        return ""
    return _ZERO_WIDTH.sub("", str(value).strip())


def _text(value: object) -> str:
    """Cell as trimmed text; a whole float drops the trailing `.0`."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return _clean(value)


def _number(value: object) -> float | None:
    """Empty, or just a `-`, is `None`. Text that is not a plain number (for example
    `3.84%`) is rejected instead of guessed: the database stores fractions."""
    if isinstance(value, bool):
        raise ValueError("boolean")
    if value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    else:
        text = _clean(value)
        if text in ("", _EMPTY_MARK):
            return None
        number = float(text.replace(",", "."))
    if not math.isfinite(number):
        raise ValueError("not finite")
    return number


def _allocations(value: object, *, fallback_100: bool) -> tuple[tuple[str, float], ...]:
    """Parse `Name1 60%, Name2 40%` into `(name, percentage)` pairs. Items may be
    separated by a comma, a new line, a run of spaces, ` y ` or a period after the
    percentage; a colon before the percentage is allowed. With `fallback_100`, a
    cell that holds a name and no percentage counts as that name at 100%."""
    cleaned = _text(value)
    if not cleaned:
        return ()
    normalized = cleaned.replace("\n", ",").replace("\r", ",")
    normalized = re.sub(r"%\s{2,}", "%, ", normalized)
    normalized = re.sub(r"%\s+y\s+", "%, ", normalized)
    normalized = re.sub(r"%\.(\s+|$)", "%, ", normalized)
    items: list[tuple[str, float]] = []
    for part in re.split(r",(?![^(]*\))", normalized):
        match = _ALLOCATION_ITEM.match(part.strip().rstrip(","))
        if match:
            name = match.group(1).strip().rstrip(",").rstrip(":")
            items.append((name, float(match.group(2))))
    if not items and fallback_100:
        items = [(cleaned, 100.0)]
    return tuple(items)


def _convert(column: Column, raw: object) -> Any:
    if column.type == "number":
        return _number(raw)
    if column.type == "allocations":
        return _allocations(raw, fallback_100=column.fallback_100)
    return _text(raw)


def _header_index(header_row: tuple) -> dict[str, int]:
    """DB field -> 0-based column position, matching headers by their normalized
    text. A header that is not listed is ignored."""
    lookup: dict[str, int] = {}
    for position, cell in enumerate(header_row):
        if cell not in (None, ""):
            lookup.setdefault(_normalize_key(str(cell)), position)

    index: dict[str, int] = {}
    missing: list[str] = []
    for column in PROPERTY_COLUMNS:
        position = next(
            (lookup[key] for key in map(_normalize_key, column.headers) if key in lookup), None
        )
        if position is not None:
            index[column.field] = position
        elif column.required:
            missing.append(column.headers[0])
    if missing:
        raise MissingColumnError(f"Sheet {SHEET_PROPERTIES!r} has no column: {', '.join(missing)}")
    return index


def _row_is_blank(row: tuple) -> bool:
    return all(cell is None or str(cell).strip() == "" for cell in row)


def _row_values(row: tuple, index: dict[str, int]) -> dict[str, Any]:
    """The typed values of a row, or `_InvalidRowError` naming the first bad column."""
    values: dict[str, Any] = {}
    for column in PROPERTY_COLUMNS:
        position = index.get(column.field)
        if position is None:
            continue
        raw = row[position] if position < len(row) else None
        header = column.headers[0]
        try:
            value = _convert(column, raw)
        except ValueError:
            kind = "non-numeric value" if column.type == "number" else "unreadable value"
            raise _InvalidRowError(f"{kind} in {header!r}") from None
        if column.required and not value:
            raise _InvalidRowError(f"blank {header!r}")
        values[column.field] = value
    return values


def _raw_key(row: tuple, index: dict[str, int]) -> tuple[str, str] | None:
    """The `(code, client)` of a row that failed validation, or None when a part is
    missing or blank."""
    parts: list[str] = []
    for field in KEY_FIELDS:
        position = index.get(field)
        if position is None:
            return None
        value = _text(row[position]) if position < len(row) else ""
        if not value:
            return None
        parts.append(value)
    return (parts[0], parts[1])


def parse_workbook(data: bytes) -> ParsedProperties:
    """Parse `data` (an `.xlsx` file's bytes) into the rows of the properties sheet."""
    workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        if SHEET_PROPERTIES not in workbook.sheetnames:
            raise MissingSheetError(
                f"Sheet {SHEET_PROPERTIES!r} not found in workbook "
                f"(available: {workbook.sheetnames!r})"
            )
        rows = workbook[SHEET_PROPERTIES].iter_rows(min_row=1, values_only=True)
        header = next(rows, None)
        if header is None:
            return ParsedProperties((), ())
        index = _header_index(header)

        parsed: list[ParsedRow] = []
        skipped: list[SkippedRow] = []
        seen: set[tuple[str, str]] = set()
        for row_number, row in enumerate(rows, start=2):
            if _row_is_blank(row):
                continue
            try:
                values = _row_values(row, index)
            except _InvalidRowError as exc:
                skipped.append(SkippedRow(row_number, str(exc), _raw_key(row, index)))
                continue
            key = (values["code"], values["client"])
            if key in seen:
                skipped.append(SkippedRow(row_number, "duplicate key", key))
                continue
            seen.add(key)
            parsed.append(ParsedRow(row_number, key, values))
    finally:
        workbook.close()
    return ParsedProperties(tuple(parsed), tuple(skipped))

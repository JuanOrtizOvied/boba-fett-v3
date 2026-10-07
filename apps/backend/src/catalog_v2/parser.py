"""Reads the three sheets of the v2 workbook into plain rows.

Pure: it takes the bytes of the file and returns rows plus a report, with no
database and no Graph. Columns are found by header name (case, accents and
spacing do not matter), the columns the workbook computes are never read, a blank
cell is simply absent from the row (so it can never overwrite a stored value),
and a value that cannot be read is reported instead of rejected. A missing sheet
or a missing key column aborts before anything is returned.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass, field

from openpyxl import load_workbook

from catalog_v2.composite import EMPTY, PENDING, Composite, apply_official_names, parse_composite
from catalog_v2.config import (
    ADMINISTRATORS_SHEET,
    COMPOSITE,
    COMPOSITE_OPTIONS,
    CONTROL,
    CURRENCY,
    DELETE_FLAG_VALUES,
    ENTITY_ADMINISTRATOR,
    ENTITY_MANAGER,
    HORIZON,
    NUMBER,
    PENDING_VALUE,
    PRODUCTS_SHEET,
    SERIES_SHEET,
    TEXT,
    Column,
    SheetSpec,
)
from catalog_v2.normalize import clean_text, normalize_currency, normalize_horizon, normalize_key


class MissingSheetError(ValueError):
    """A sheet the sync needs is not in the workbook. Nothing is read."""


class MissingColumnError(ValueError):
    """A column that identifies the rows of a sheet is not there."""


@dataclass(frozen=True)
class ParsedRow:
    """One data row. `key` identifies it (the administrator as typed), `fields`
    holds only the cells that had a value, and `delete` is the `Eliminar` flag."""

    sheet: str
    row_number: int
    key: tuple[str, ...]
    fields: dict[str, object]
    delete: bool = False


@dataclass
class ParseReport:
    """Everything the parser noticed and did not reject. The first three lists
    hold rows that were not used."""

    skipped_blank_key: list[tuple[str, int]] = field(default_factory=list)
    duplicates: list[tuple[str, int, tuple[str, ...]]] = field(default_factory=list)
    non_numeric: list[tuple[str, int, str, str]] = field(default_factory=list)
    pending: list[tuple[str, int, str]] = field(default_factory=list)
    unrecognized: list[tuple[str, int, str, str]] = field(default_factory=list)
    unmatched_names: list[tuple[str, int, str, str]] = field(default_factory=list)
    missing_columns: list[tuple[str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class ParseResult:
    products: tuple[ParsedRow, ...]
    series: tuple[ParsedRow, ...]
    links: tuple[ParsedRow, ...]
    report: ParseReport


def _text(value: object) -> str:
    """A cell as text; a whole number read as a float ("5.0") loses the ".0"."""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return clean_text(value)


def _is_delete(value: object) -> bool:
    if isinstance(value, bool):
        return value
    return normalize_key(value) in DELETE_FLAG_VALUES


def _number(value: object) -> float | None:
    """A numeric cell, or numeric text; anything else raises `ValueError`."""
    if isinstance(value, bool):
        raise ValueError("boolean")
    if isinstance(value, (int, float)):
        return float(value)
    return float(clean_text(value).replace(",", "."))


def _find_sheet(workbook, name: str):
    names = {sheet.title: sheet for sheet in workbook.worksheets}
    if name in names:
        return names[name]
    by_key = {normalize_key(title): sheet for title, sheet in names.items()}
    sheet = by_key.get(normalize_key(name))
    if sheet is None:
        raise MissingSheetError(f"The workbook has no sheet named {name!r}")
    return sheet


def _header_index(header_row: tuple, spec: SheetSpec, report: ParseReport) -> dict[str, int]:
    """Position of each mapped column, by normalized header name."""
    positions: dict[str, int] = {}
    for index, cell in enumerate(header_row):
        key = normalize_key(cell)
        if key and key not in positions:
            positions[key] = index
    found: dict[str, int] = {}
    for column in spec.columns:
        index = positions.get(normalize_key(column.header))
        if index is not None:
            found[column.field] = index
            continue
        if column.field in spec.key_fields:
            raise MissingColumnError(f"Sheet {spec.name!r} has no column {column.header!r}")
        report.missing_columns.append((spec.name, column.header))
    return found


def _read_field(
    column: Column, raw: object, spec: SheetSpec, row_number: int, report: ParseReport
) -> object | None:
    """The value of one cell, or `None` when it must be left out of the row."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    where = (spec.name, row_number)
    if column.kind == TEXT or column.kind in (ENTITY_MANAGER, ENTITY_ADMINISTRATOR):
        return _text(raw)
    if column.kind == COMPOSITE:
        composite = parse_composite(raw)
        if composite.status == PENDING:
            report.pending.append((*where, column.field))
        composite, unmatched = apply_official_names(composite, COMPOSITE_OPTIONS[column.field])
        report.unmatched_names.extend((*where, column.field, name) for name in unmatched)
        return composite
    if column.kind in (CURRENCY, HORIZON):
        normalize = normalize_currency if column.kind == CURRENCY else normalize_horizon
        value, matched = normalize(raw)
        if not matched:
            report.unrecognized.append((*where, column.field, value))
        elif value == PENDING_VALUE:
            report.pending.append((*where, column.field))
        return value
    if column.kind == NUMBER:
        try:
            return _number(raw)
        except ValueError:
            report.non_numeric.append((*where, column.header, clean_text(raw)))
            return None
    return None


def _read_sheet(workbook, spec: SheetSpec, report: ParseReport) -> list[ParsedRow]:
    sheet = _find_sheet(workbook, spec.name)
    rows = sheet.iter_rows(values_only=True)
    header_row = next(rows, None)
    if header_row is None:
        raise MissingColumnError(f"Sheet {spec.name!r} is empty")
    index = _header_index(header_row, spec, report)

    parsed: list[ParsedRow] = []
    seen: set[tuple[str, ...]] = set()
    for row_number, row in enumerate(rows, start=2):
        if all(cell is None or (isinstance(cell, str) and not cell.strip()) for cell in row):
            continue

        def cell(field_name: str, row=row) -> object:
            position = index.get(field_name)
            return row[position] if position is not None and position < len(row) else None

        key_parts: list[str] = []
        for field_name in spec.key_fields:
            text = _text(cell(field_name))
            key_parts.append(text.upper() if field_name == "codigo" else text)
        if not all(key_parts):
            report.skipped_blank_key.append((spec.name, row_number))
            continue
        key = tuple(key_parts)
        identity = tuple(normalize_key(part) for part in key)
        if identity in seen:
            report.duplicates.append((spec.name, row_number, key))
            continue
        seen.add(identity)

        fields: dict[str, object] = {}
        delete = False
        for column in spec.columns:
            if column.field in spec.key_fields:
                continue
            if column.kind == CONTROL:
                delete = _is_delete(cell(column.field))
                continue
            value = _read_field(column, cell(column.field), spec, row_number, report)
            if value is None or (isinstance(value, Composite) and value.status == EMPTY):
                continue
            fields[column.field] = value
        parsed.append(ParsedRow(spec.name, row_number, key, fields, delete))
    return parsed


def parse_workbook(data: bytes) -> ParseResult:
    """Read the three sheets of the v2 workbook. Raises `MissingSheetError` or
    `MissingColumnError` before returning anything if the file cannot be used."""
    report = ParseReport()
    # openpyxl warns about extensions it does not support (such as the data
    # validations of the real file), both on load and while reading each sheet.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        workbook = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        try:
            products = _read_sheet(workbook, PRODUCTS_SHEET, report)
            series = _read_sheet(workbook, SERIES_SHEET, report)
            links = _read_sheet(workbook, ADMINISTRATORS_SHEET, report)
        finally:
            workbook.close()
    return ParseResult(tuple(products), tuple(series), tuple(links), report)

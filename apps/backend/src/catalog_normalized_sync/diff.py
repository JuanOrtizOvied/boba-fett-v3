"""Diff engine for the normalized catalog: current DB rows + parsed workbook
-> the inserts and updates that make the DB match the workbook.

Pure module: no network, no database. Rows are matched by business key
(`code`; `(product_code, series)`; `(product_code, series, administrator)`),
never by `id` or name. Only the columns present in the workbook are compared,
so a column that is missing from a sheet leaves that field untouched.

An administrator whose series is missing from the series sheet creates that
series empty, so it is flagged by the observations and not lost.

Deletes are not computed yet. A DB row that is absent from the workbook is
only counted (`not_in_workbook`), never reported as a change.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from catalog_normalized_sync.config import (
    LEVEL_ADMIN,
    LEVEL_PRODUCT,
    LEVEL_SERIES,
    SHEETS,
    SheetSpec,
)
from catalog_normalized_sync.parser import ParsedRow, ParsedWorkbook
from db.catalog_normalized import NormalizedSnapshot


@dataclass(frozen=True)
class FieldChange:
    field: str
    old: Any
    new: Any


@dataclass(frozen=True)
class Insert:
    level: str
    key: tuple[str, ...]
    values: dict[str, Any]


@dataclass(frozen=True)
class Update:
    level: str
    key: tuple[str, ...]
    changes: tuple[FieldChange, ...]


@dataclass(frozen=True)
class IgnoredRow:
    level: str
    row_number: int
    key: tuple[str, ...]
    reason: str


@dataclass(frozen=True)
class ChangeSet:
    inserts: tuple[Insert, ...] = ()
    updates: tuple[Update, ...] = ()
    ignored: tuple[IgnoredRow, ...] = ()
    unchanged: dict[str, int] = field(default_factory=dict)
    not_in_workbook: dict[str, int] = field(default_factory=dict)


def _allocations(items: list[Any]) -> tuple[tuple[str, float], ...]:
    return tuple((a.name, float(a.percentage)) for a in items)


def _same(old: Any, new: Any) -> bool:
    """Equality that tolerates float noise (`0.0384` vs `0.038400000000000004`)."""
    if old is None or new is None:
        return old is None and new is None
    if isinstance(old, tuple) and isinstance(new, tuple):
        return len(old) == len(new) and all(_same(o, n) for o, n in zip(old, new, strict=True))
    if isinstance(old, float) and isinstance(new, float):
        return math.isclose(old, new, rel_tol=1e-9, abs_tol=1e-9)
    return old == new


def _existing_values(row: Any, spec: SheetSpec) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for column in spec.columns:
        value = getattr(row, column.field)
        values[column.field] = _allocations(value) if column.type == "allocations" else value
    return values


def _index_existing(rows: list[Any], spec: SheetSpec) -> dict[tuple, dict[str, Any]]:
    return {
        tuple(getattr(row, f) for f in spec.key_fields): _existing_values(row, spec) for row in rows
    }


def _diff_level(
    level: str,
    parsed: tuple[ParsedRow, ...],
    existing: dict[tuple, dict[str, Any]],
    key_fields: tuple[str, ...],
    parent_known: Any,
) -> tuple[list[Insert], list[Update], list[IgnoredRow], int]:
    inserts: list[Insert] = []
    updates: list[Update] = []
    ignored: list[IgnoredRow] = []
    unchanged = 0
    for row in parsed:
        if not parent_known(row):
            ignored.append(IgnoredRow(level, row.row_number, row.key, "parent not found"))
            continue
        current = existing.get(row.key)
        if current is None:
            inserts.append(Insert(level, row.key, dict(row.values)))
            continue
        changes = tuple(
            FieldChange(name, current.get(name), value)
            for name, value in row.values.items()
            if name not in key_fields and not _same(current.get(name), value)
        )
        if changes:
            updates.append(Update(level, row.key, changes))
        else:
            unchanged += 1
    return inserts, updates, ignored, unchanged


def diff_workbook(snapshot: NormalizedSnapshot, parsed: ParsedWorkbook) -> ChangeSet:
    """Compare the parsed workbook with the current DB rows."""
    specs = {spec.level: spec for spec in SHEETS}
    existing = {
        LEVEL_PRODUCT: _index_existing(snapshot.products, specs[LEVEL_PRODUCT]),
        LEVEL_SERIES: _index_existing(snapshot.series, specs[LEVEL_SERIES]),
        LEVEL_ADMIN: _index_existing(snapshot.admins, specs[LEVEL_ADMIN]),
    }
    sheet_rows = {
        LEVEL_PRODUCT: parsed.products,
        LEVEL_SERIES: parsed.series,
        LEVEL_ADMIN: parsed.admins,
    }

    product_codes = {key[0] for key in existing[LEVEL_PRODUCT]} | {
        row.key[0] for row in parsed.products
    }
    series_keys = set(existing[LEVEL_SERIES]) | {row.key for row in parsed.series}
    # An administrator whose series is not in the series sheet (a typo, or a
    # series the owners forgot) still reaches the table: its series is created
    # empty so the observations flag it, instead of dropping the administrator.
    sheet_series = {row.key for row in parsed.series}
    implicit_series = list(
        dict.fromkeys(
            row.key[:2]
            for row in parsed.admins
            if row.key[0] in product_codes and row.key[:2] not in sheet_series
        )
    )
    series_keys |= set(implicit_series)
    parent_checks = {
        LEVEL_PRODUCT: lambda row: True,
        LEVEL_SERIES: lambda row: row.key[0] in product_codes,
        LEVEL_ADMIN: lambda row: (row.key[0], row.key[1]) in series_keys,
    }

    inserts: list[Insert] = []
    updates: list[Update] = []
    ignored: list[IgnoredRow] = []
    unchanged: dict[str, int] = {}
    not_in_workbook: dict[str, int] = {}
    for spec in SHEETS:
        level = spec.level
        new_inserts, new_updates, new_ignored, same = _diff_level(
            level, sheet_rows[level], existing[level], spec.key_fields, parent_checks[level]
        )
        inserts += new_inserts
        if level == LEVEL_SERIES:
            inserts += [
                Insert(level, key, {"product_code": key[0], "series": key[1]})
                for key in implicit_series
                if key not in existing[LEVEL_SERIES]
            ]
        updates += new_updates
        ignored += new_ignored
        unchanged[level] = same
        in_workbook = {row.key for row in sheet_rows[level]}
        if level == LEVEL_SERIES:
            in_workbook |= set(implicit_series)
        not_in_workbook[level] = sum(1 for key in existing[level] if key not in in_workbook)

    return ChangeSet(
        inserts=tuple(inserts),
        updates=tuple(updates),
        ignored=tuple(ignored),
        unchanged=unchanged,
        not_in_workbook=not_in_workbook,
    )

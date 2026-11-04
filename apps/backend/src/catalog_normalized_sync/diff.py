"""Diff engine for the normalized catalog: current DB rows + parsed workbook
-> the inserts, updates, restores and soft-deletes that make the DB match the
workbook.

Pure module: no network, no database. Rows are matched by business key
(`code`; `(product_code, series)`; `(product_code, series, administrator)`),
never by `id` or name. Only the columns present in the workbook are compared,
so a column that is missing from a sheet leaves that field untouched.

An administrator whose series is missing from the series sheet creates that
series empty, so it is flagged by the observations and not lost.

The workbook is the source of truth. An active DB row whose key is not in it is
soft-deleted, and deleting a product or a series deletes what hangs from it. A
soft-deleted row whose exact key comes back is restored; a new code is always a
new row, even with the same data. A row that is in the workbook but could not be
read (a bad value) still counts as present, so it is never deleted for that.

Deletes are held back, and reported in `ChangeSet.deletes_blocked`, when a
level would lose more than `MAX_DELETE_RATIO` of its active rows at once: that
is a wrong or truncated file, not an edit.
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

MAX_DELETE_RATIO = 0.25


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
class Delete:
    """Soft-delete the active row with this key."""

    level: str
    key: tuple[str, ...]


@dataclass(frozen=True)
class Restore:
    """Clear the soft-delete of the row with this key."""

    level: str
    key: tuple[str, ...]


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
    deletes: tuple[Delete, ...] = ()
    restores: tuple[Restore, ...] = ()
    ignored: tuple[IgnoredRow, ...] = ()
    unchanged: dict[str, int] = field(default_factory=dict)
    # Active DB rows whose key is not in the workbook (cascaded children not
    # included); they are in `deletes` unless the delete guard held them back.
    not_in_workbook: dict[str, int] = field(default_factory=dict)
    deletes_blocked: str | None = None


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


def _key(row: Any, spec: SheetSpec) -> tuple:
    return tuple(getattr(row, f) for f in spec.key_fields)


def _index_existing(rows: list[Any], spec: SheetSpec) -> dict[tuple, dict[str, Any]]:
    return {_key(row, spec): _existing_values(row, spec) for row in rows}


def _diff_level(
    level: str,
    parsed: tuple[ParsedRow, ...],
    existing: dict[tuple, dict[str, Any]],
    deleted: set[tuple],
    key_fields: tuple[str, ...],
    parent_known: Any,
) -> tuple[list[Insert], list[Update], list[Restore], list[IgnoredRow], int]:
    inserts: list[Insert] = []
    updates: list[Update] = []
    restores: list[Restore] = []
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
        restored = row.key in deleted
        if restored:
            restores.append(Restore(level, row.key))
        changes = tuple(
            FieldChange(name, current.get(name), value)
            for name, value in row.values.items()
            if name not in key_fields and not _same(current.get(name), value)
        )
        if changes:
            updates.append(Update(level, row.key, changes))
        elif not restored:
            unchanged += 1
    return inserts, updates, restores, ignored, unchanged


def _delete_guard(active: dict[str, set[tuple]], missing: dict[str, set[tuple]]) -> str | None:
    """Why the deletes must not run, or None when they may."""
    for spec in SHEETS:
        total = len(active[spec.level])
        gone = len(missing[spec.level])
        if total and gone / total > MAX_DELETE_RATIO:
            return (
                f"{gone} of {total} active {spec.level} rows are missing from the workbook "
                f"(more than {MAX_DELETE_RATIO:.0%}); nothing was deleted"
            )
    return None


def diff_workbook(snapshot: NormalizedSnapshot, parsed: ParsedWorkbook) -> ChangeSet:
    """Compare the parsed workbook with the current DB rows."""
    specs = {spec.level: spec for spec in SHEETS}
    rows = {
        LEVEL_PRODUCT: snapshot.products,
        LEVEL_SERIES: snapshot.series,
        LEVEL_ADMIN: snapshot.admins,
    }
    existing = {level: _index_existing(rows[level], specs[level]) for level in rows}
    deleted = {
        level: {_key(row, specs[level]) for row in rows[level] if row.is_deleted} for level in rows
    }
    active = {level: set(existing[level]) - deleted[level] for level in rows}
    sheet_rows = {
        LEVEL_PRODUCT: parsed.products,
        LEVEL_SERIES: parsed.series,
        LEVEL_ADMIN: parsed.admins,
    }
    # Rows that are in the sheet but failed validation: still present.
    skipped = {
        spec.level: {
            row.key
            for row in parsed.skipped
            if row.sheet == spec.sheet_name and row.key is not None
        }
        for spec in SHEETS
    }

    # A parent is known when the workbook (or a row of it that only had a bad
    # value, for something already active) has it. A product that left the
    # product sheet is gone, so its rows in the other sheets have no parent.
    product_codes = {row.key[0] for row in parsed.products} | {
        key[0] for key in skipped[LEVEL_PRODUCT] if key in active[LEVEL_PRODUCT]
    }
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
    series_keys = (
        {key for key in sheet_series if key[0] in product_codes}
        | set(implicit_series)
        | {
            key
            for key in skipped[LEVEL_SERIES]
            if key in active[LEVEL_SERIES] and key[0] in product_codes
        }
    )
    parent_checks = {
        LEVEL_PRODUCT: lambda row: True,
        LEVEL_SERIES: lambda row: row.key[0] in product_codes,
        LEVEL_ADMIN: lambda row: row.key[:2] in series_keys,
    }

    inserts: list[Insert] = []
    updates: list[Update] = []
    restores: list[Restore] = []
    ignored: list[IgnoredRow] = []
    unchanged: dict[str, int] = {}
    missing: dict[str, set[tuple]] = {}
    for spec in SHEETS:
        level = spec.level
        new_inserts, new_updates, new_restores, new_ignored, same = _diff_level(
            level,
            sheet_rows[level],
            existing[level],
            deleted[level],
            spec.key_fields,
            parent_checks[level],
        )
        inserts += new_inserts
        restores += new_restores
        if level == LEVEL_SERIES:
            for key in implicit_series:
                if key not in existing[level]:
                    inserts.append(Insert(level, key, {"product_code": key[0], "series": key[1]}))
                elif key in deleted[level]:
                    restores.append(Restore(level, key))
        updates += new_updates
        ignored += new_ignored
        unchanged[level] = same
        # Rows that are in the sheet count as present even when they were
        # ignored (no parent): the parent's delete takes them below.
        present = {row.key for row in sheet_rows[level]} | skipped[level]
        if level == LEVEL_SERIES:
            present |= set(implicit_series)
        missing[level] = active[level] - present

    gone_products = {key[0] for key in missing[LEVEL_PRODUCT]}
    gone_series = missing[LEVEL_SERIES] | {
        key for key in active[LEVEL_SERIES] if key[0] in gone_products
    }
    gone_admins = missing[LEVEL_ADMIN] | {
        key for key in active[LEVEL_ADMIN] if key[0] in gone_products or key[:2] in gone_series
    }
    blocked = _delete_guard(active, missing)
    deletes: list[Delete] = []
    if blocked is None:
        for level, keys in (
            (LEVEL_PRODUCT, missing[LEVEL_PRODUCT]),
            (LEVEL_SERIES, gone_series),
            (LEVEL_ADMIN, gone_admins),
        ):
            deletes += [Delete(level, key) for key in sorted(keys)]

    return ChangeSet(
        inserts=tuple(inserts),
        updates=tuple(updates),
        deletes=tuple(deletes),
        restores=tuple(restores),
        ignored=tuple(ignored),
        unchanged=unchanged,
        not_in_workbook={level: len(keys) for level, keys in missing.items()},
        deletes_blocked=blocked,
    )

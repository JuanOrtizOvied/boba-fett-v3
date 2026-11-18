"""Diff engine for the properties sync: the rows now in the database + the parsed
sheet -> the inserts, updates, restores and soft deletes that make the database
match the sheet.

Pure module: no network, no database. Rows are matched by business key
`(code, client)`, never by `id`. Only the columns present in the sheet are
compared, so a column missing from the sheet leaves that field untouched.

The sheet is the source of truth. An active database row whose key is not in it is
soft deleted. A soft deleted row whose exact key comes back is restored. A row that
is in the sheet but could not be read (a bad value) still counts as present, so it
is never deleted for that.

Deletes are held back, and reported in `ChangeSet.deletes_blocked`, when more than
`MAX_DELETE_RATIO` of the active rows would go at once: that is a wrong or
truncated file, not an edit.

`ExistingRow.values` must be typed like the parser's values (text as `str`,
numbers as `float | None`, allocations as a tuple of `(name, percentage)`); turning
database values (`Decimal`, JSON) into those types is the job of the repository.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from properties_sync.config import KEY_FIELDS, MAX_DELETE_RATIO
from properties_sync.parser import ParsedProperties


@dataclass(frozen=True)
class ExistingRow:
    """A row of `property_holding` as the diff needs it."""

    key: tuple[str, str]
    values: dict[str, Any]
    is_deleted: bool = False


@dataclass(frozen=True)
class FieldChange:
    field: str
    old: Any
    new: Any


@dataclass(frozen=True)
class Insert:
    key: tuple[str, str]
    values: dict[str, Any]


@dataclass(frozen=True)
class Update:
    key: tuple[str, str]
    changes: tuple[FieldChange, ...]


@dataclass(frozen=True)
class SoftDelete:
    key: tuple[str, str]


@dataclass(frozen=True)
class Restore:
    key: tuple[str, str]


@dataclass(frozen=True)
class ChangeSet:
    inserts: tuple[Insert, ...] = ()
    updates: tuple[Update, ...] = ()
    soft_deletes: tuple[SoftDelete, ...] = ()
    restores: tuple[Restore, ...] = ()
    unchanged: int = 0
    deletes_blocked: str | None = None


def _same(old: Any, new: Any) -> bool:
    """Equality that tolerates float noise (`0.0384` vs `0.038400000000000004`)."""
    if old is None or new is None:
        return old is None and new is None
    if isinstance(old, tuple) and isinstance(new, tuple):
        return len(old) == len(new) and all(_same(o, n) for o, n in zip(old, new, strict=True))
    if isinstance(old, float) and isinstance(new, float):
        return math.isclose(old, new, rel_tol=1e-9, abs_tol=1e-9)
    return old == new


def _delete_guard(active: int, gone: int) -> str | None:
    """Why the deletes must not run, or None when they may. Names no row."""
    if active and gone / active > MAX_DELETE_RATIO:
        return (
            f"{gone} of {active} active property rows are missing from the workbook "
            f"(more than {MAX_DELETE_RATIO:.0%}); nothing was deleted"
        )
    return None


def diff_properties(existing: Iterable[ExistingRow], parsed: ParsedProperties) -> ChangeSet:
    """Compare the parsed sheet with the current database rows."""
    by_key = {row.key: row for row in existing}
    active = {key for key, row in by_key.items() if not row.is_deleted}

    inserts: list[Insert] = []
    updates: list[Update] = []
    restores: list[Restore] = []
    unchanged = 0
    for row in parsed.rows:
        current = by_key.get(row.key)
        if current is None:
            inserts.append(Insert(row.key, dict(row.values)))
            continue
        restored = current.is_deleted
        if restored:
            restores.append(Restore(row.key))
        changes = tuple(
            FieldChange(name, current.values.get(name), value)
            for name, value in row.values.items()
            if name not in KEY_FIELDS and not _same(current.values.get(name), value)
        )
        if changes:
            updates.append(Update(row.key, changes))
        elif not restored:
            unchanged += 1

    # Rows that are in the sheet but failed validation are still present.
    present = {row.key for row in parsed.rows} | {
        row.key for row in parsed.skipped if row.key is not None
    }
    missing = sorted(active - present)
    blocked = _delete_guard(len(active), len(missing))
    return ChangeSet(
        inserts=tuple(inserts),
        updates=tuple(updates),
        soft_deletes=() if blocked else tuple(SoftDelete(key) for key in missing),
        restores=tuple(restores),
        unchanged=unchanged,
        deletes_blocked=blocked,
    )

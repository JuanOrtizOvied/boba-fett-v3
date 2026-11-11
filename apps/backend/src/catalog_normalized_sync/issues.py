"""Rows of the workbook that a sync run could not apply, kept until it is fixed.

A row is skipped by the parser (a number column with text, a blank required cell, a
repeated key) or ignored by the diff (its product or series parent does not
exist). Either way the database keeps what it had for it and, until now, nothing
said so. Each such row becomes one *issue* in `normalized_sync_issue`: opened the
first time a run sees it, refreshed while it stays, and resolved (not deleted)
when a run no longer finds it among the unread rows.

The rules (`issues_from_run`, `diff_issues`) are pure. The writes take the
connection of the run's transaction, so the issues land together with the data and
the history events or not at all.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

import asyncpg

from catalog_normalized_sync.config import (
    LEVEL_ADMIN,
    LEVEL_SERIES,
    SHEETS,
)
from catalog_normalized_sync.diff import ChangeSet
from catalog_normalized_sync.parser import KIND_DUPLICATE_KEY, ParsedWorkbook

KIND_NO_PARENT = "no_parent"

_LEVEL_OF_SHEET = {spec.sheet_name: spec.level for spec in SHEETS}
_SHEET_OF_LEVEL = {spec.level: spec.sheet_name for spec in SHEETS}


@dataclass(frozen=True)
class Issue:
    """One unread row of the current workbook. `row_key` is its identity inside the
    sheet: the key fields joined with `|`, `dup:<key>` for a repeated key (so it
    never collides with the first row of that key) and `row:<number>` when the key
    could not be read. `problems` lists the row's bad cells."""

    sheet: str
    level: str
    row_key: str
    row_number: int
    product_code: str | None
    series: str | None
    administrator: str | None
    problems: tuple[dict[str, str], ...]


@dataclass(frozen=True)
class OpenIssue:
    """An issue already stored and still open."""

    id: int
    sheet: str
    row_key: str


@dataclass(frozen=True)
class IssueDelta:
    """What a run does to the table: open the new ones, refresh the ones still
    present (their problems, row number and last seen time) and resolve the rest."""

    opened: tuple[Issue, ...] = ()
    still_open: tuple[tuple[int, Issue], ...] = ()
    resolved: tuple[int, ...] = ()

    @property
    def changes_state(self) -> bool:
        """True when something opened or resolved: that is when it is worth asking
        who saved the workbook."""
        return bool(self.opened or self.resolved)

    def __bool__(self) -> bool:
        return bool(self.opened or self.still_open or self.resolved)


def _parts(level: str, key: tuple[str, ...]) -> tuple[str | None, str | None, str | None]:
    """(product_code, series, administrator) of a key at its level."""
    product_code = key[0] if key else None
    series = key[1] if level in (LEVEL_SERIES, LEVEL_ADMIN) and len(key) > 1 else None
    administrator = key[2] if level == LEVEL_ADMIN and len(key) > 2 else None
    return product_code, series, administrator


def _problem(kind: str, column: str = "", field: str = "", value: str = "") -> dict[str, str]:
    return {"kind": kind, "column": column, "field": field, "value": value}


def issues_from_run(parsed: ParsedWorkbook, changeset: ChangeSet) -> dict[tuple[str, str], Issue]:
    """The unread rows of this workbook, by `(sheet, row_key)`: the rows the parser
    skipped and the rows the diff ignored for want of a parent. If two of them end
    up with the same identity (two bad rows with one key) they are merged into one
    issue that lists the problems of both."""
    found: dict[tuple[str, str], Issue] = {}

    def add(issue: Issue) -> None:
        identity = (issue.sheet, issue.row_key)
        previous = found.get(identity)
        if previous is None:
            found[identity] = issue
            return
        found[identity] = Issue(
            sheet=previous.sheet,
            level=previous.level,
            row_key=previous.row_key,
            row_number=previous.row_number,
            product_code=previous.product_code,
            series=previous.series,
            administrator=previous.administrator,
            problems=previous.problems + issue.problems,
        )

    for row in parsed.skipped:
        level = _LEVEL_OF_SHEET.get(row.sheet)
        if level is None:
            continue
        problems = tuple(_problem(p.kind, p.column, p.field, p.value) for p in row.problems) or (
            _problem("unreadable", value=row.reason),
        )
        if row.key is None:
            row_key, parts = f"row:{row.row_number}", (None, None, None)
        elif any(p.kind == KIND_DUPLICATE_KEY for p in row.problems):
            row_key, parts = f"dup:{'|'.join(row.key)}", _parts(level, row.key)
        else:
            row_key, parts = "|".join(row.key), _parts(level, row.key)
        add(Issue(row.sheet, level, row_key, row.row_number, *parts, problems))

    for row in changeset.ignored:
        sheet = _SHEET_OF_LEVEL.get(row.level)
        if sheet is None:
            continue
        add(
            Issue(
                sheet,
                row.level,
                "|".join(row.key),
                row.row_number,
                *_parts(row.level, row.key),
                (_problem(KIND_NO_PARENT),),
            )
        )
    return found


def diff_issues(open_issues: list[OpenIssue], current: dict[tuple[str, str], Issue]) -> IssueDelta:
    """Compare the stored open issues with the unread rows of this run. An issue
    that is still there stays open (with its problems as of now, so fixing one of
    two bad cells shrinks the list); one that is no longer there was fixed, or its
    row left the workbook, and is resolved."""
    stored = {(i.sheet, i.row_key): i for i in open_issues}
    opened = tuple(issue for identity, issue in current.items() if identity not in stored)
    still_open = tuple(
        (stored[identity].id, issue) for identity, issue in current.items() if identity in stored
    )
    resolved = tuple(i.id for identity, i in stored.items() if identity not in current)
    return IssueDelta(opened=opened, still_open=still_open, resolved=resolved)


# -- storage ----------------------------------------------------------------


async def load_open_issues(pool: asyncpg.Pool) -> list[OpenIssue]:
    rows = await pool.fetch(
        "SELECT id, sheet, row_key FROM normalized_sync_issue WHERE resolved_at IS NULL ORDER BY id"
    )
    return [OpenIssue(id=r["id"], sheet=r["sheet"], row_key=r["row_key"]) for r in rows]


def _problems_json(problems: tuple[dict[str, Any], ...]) -> str:
    return json.dumps(list(problems))


async def write_issue_delta(
    conn: asyncpg.Connection, delta: IssueDelta, *, changed_by: str | None
) -> None:
    """Write `delta` on `conn`, which is the connection of the run's transaction.
    `now()` is the start of that transaction, so everything the run writes shares
    one instant. `changed_by` is who saved the workbook (an email, the unknown
    marker, or None for a run from a local file) and is kept on the issues the run
    opens and on the ones it resolves."""
    if delta.opened:
        await conn.executemany(
            "INSERT INTO normalized_sync_issue "
            "(sheet, level, row_key, product_code, series, administrator, row_number, "
            "problems, first_seen_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)",
            [
                (
                    i.sheet,
                    i.level,
                    i.row_key,
                    i.product_code,
                    i.series,
                    i.administrator,
                    i.row_number,
                    _problems_json(i.problems),
                    changed_by,
                )
                for i in delta.opened
            ],
        )
    if delta.still_open:
        await conn.executemany(
            "UPDATE normalized_sync_issue SET row_number = $2, problems = $3::jsonb, "
            "last_seen_at = now() WHERE id = $1",
            [(id_, i.row_number, _problems_json(i.problems)) for id_, i in delta.still_open],
        )
    if delta.resolved:
        await conn.execute(
            "UPDATE normalized_sync_issue SET resolved_at = now(), resolved_by = $2 "
            "WHERE id = ANY($1::bigint[]) AND resolved_at IS NULL",
            list(delta.resolved),
            changed_by,
        )


def describe(current: dict[tuple[str, str], Issue], limit: int = 10) -> str:
    """The unread rows as one line for the log: sheet, row and key. Never a name or
    an email of a person; keys are catalog codes and administrator names."""
    items = [f"{i.sheet} row {i.row_number} ({i.row_key})" for i in current.values()]
    shown = "; ".join(items[:limit])
    return shown + (f"; and {len(items) - limit} more" if len(items) > limit else "")

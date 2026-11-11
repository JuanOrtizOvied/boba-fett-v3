"""Read side of the unread rows of the normalized catalog sync.

The issues are written by `catalog_normalized_sync.issues` inside the run's
transaction; this module only reads them. A row of the workbook that the sync could
not apply is an *issue*: opened the first time a run sees it, resolved (not
deleted) when the workbook is fixed.

A day is 00:00 to 24:00 in `America/Lima`, computed by the database with its own
time zone data (no fixed offset in Python), like the day summary of the sync
history. The name of a product comes from a join that ignores `is_deleted`.
"""

from __future__ import annotations

import datetime
import json
from typing import Any

import asyncpg
from pydantic import BaseModel


class IssueRow(BaseModel):
    id: int
    sheet: str
    level: str
    row_key: str
    product_code: str | None = None
    product_name: str | None = None
    series: str | None = None
    administrator: str | None = None
    row_number: int
    # The row's bad cells as of the last run: kind, column, field and the text found.
    problems: list[dict[str, Any]] = []
    first_seen_at: datetime.datetime
    last_seen_at: datetime.datetime
    resolved_at: datetime.datetime | None = None
    # Who saved the workbook when the issue opened and when it was resolved, as
    # stored: an email, the marker `unknown`, or None (a run from a local file).
    first_seen_by: str | None = None
    resolved_by: str | None = None


class IssueDayReport(BaseModel):
    """What happened to the unread rows on one Lima day: the issues opened that day,
    the ones resolved that day, and the ones still open when the day ended (opened
    that day or before). An issue opened and resolved the same day is in the first
    two lists and not in the third."""

    date: datetime.date
    opened: list[IssueRow]
    resolved: list[IssueRow]
    open: list[IssueRow]


_SELECT = """
    SELECT i.*, p.name AS product_name
    FROM normalized_sync_issue i
    LEFT JOIN catalog_product p ON p.code = i.product_code
"""

# The day as a range on the table's own timestamps, so their indexes are used.
_DAY_START = "($1::date)::timestamp AT TIME ZONE 'America/Lima'"
_DAY_END = "(($1::date) + 1)::timestamp AT TIME ZONE 'America/Lima'"


def _from_record(r: asyncpg.Record) -> IssueRow:
    problems = r["problems"]
    if isinstance(problems, str):
        problems = json.loads(problems)
    return IssueRow(
        id=r["id"],
        sheet=r["sheet"],
        level=r["level"],
        row_key=r["row_key"],
        product_code=r["product_code"],
        product_name=r["product_name"],
        series=r["series"],
        administrator=r["administrator"],
        row_number=r["row_number"],
        problems=problems or [],
        first_seen_at=r["first_seen_at"],
        last_seen_at=r["last_seen_at"],
        resolved_at=r["resolved_at"],
        first_seen_by=r["first_seen_by"],
        resolved_by=r["resolved_by"],
    )


class NormalizedSyncIssueRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def list_open(self) -> list[IssueRow]:
        """The issues that are open now, the most recent first."""
        rows = await self._pool.fetch(
            f"{_SELECT} WHERE i.resolved_at IS NULL ORDER BY i.first_seen_at DESC, i.id DESC"
        )
        return [_from_record(r) for r in rows]

    async def day_report(self, day: datetime.date | None = None) -> IssueDayReport:
        """The report of `day` (today in Lima when None)."""
        if day is None:
            day = await self._pool.fetchval("SELECT (now() AT TIME ZONE 'America/Lima')::date")
        opened = await self._pool.fetch(
            f"{_SELECT} WHERE i.first_seen_at >= {_DAY_START} AND i.first_seen_at < {_DAY_END} "
            "ORDER BY i.first_seen_at DESC, i.id DESC",
            day,
        )
        resolved = await self._pool.fetch(
            f"{_SELECT} WHERE i.resolved_at >= {_DAY_START} AND i.resolved_at < {_DAY_END} "
            "ORDER BY i.resolved_at DESC, i.id DESC",
            day,
        )
        still_open = await self._pool.fetch(
            f"{_SELECT} WHERE i.first_seen_at < {_DAY_END} "
            f"AND (i.resolved_at IS NULL OR i.resolved_at >= {_DAY_END}) "
            "ORDER BY i.first_seen_at DESC, i.id DESC",
            day,
        )
        return IssueDayReport(
            date=day,
            opened=[_from_record(r) for r in opened],
            resolved=[_from_record(r) for r in resolved],
            open=[_from_record(r) for r in still_open],
        )

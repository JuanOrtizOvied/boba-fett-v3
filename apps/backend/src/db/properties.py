"""Database access for the properties section (`property_holding`).

Phase 3 only needs the read side of the sync: the rows now in the table, typed
like the parser's values so the diff can compare them. The read endpoints of the
admin area are added here later.
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg

from properties_sync.config import PROPERTY_COLUMNS
from properties_sync.diff import ExistingRow

# Column names come from `properties_sync.config`, never from user input.
_SYNC_COLUMNS = ", ".join(column.field for column in PROPERTY_COLUMNS)


def _allocations(raw: Any) -> tuple[tuple[str, float], ...]:
    if raw is None:
        return ()
    items = json.loads(raw) if isinstance(raw, str) else raw
    return tuple((item["name"], float(item["percentage"])) for item in items)


def to_existing_row(record: Any) -> ExistingRow:
    """A `property_holding` record as the diff needs it: numbers as `float | None`
    (the column is NUMERIC, so `Decimal` comes back), allocations as a tuple of
    `(name, percentage)` and a missing text as an empty string."""
    values: dict[str, Any] = {}
    for column in PROPERTY_COLUMNS:
        raw = record[column.field]
        if column.type == "number":
            values[column.field] = None if raw is None else float(raw)
        elif column.type == "allocations":
            values[column.field] = _allocations(raw)
        else:
            values[column.field] = "" if raw is None else raw
    return ExistingRow(
        key=(record["code"], record["client"]),
        values=values,
        is_deleted=bool(record["is_deleted"]),
    )


class PropertyRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    @property
    def pool(self) -> asyncpg.Pool:
        return self._pool

    async def list_for_sync(self) -> list[ExistingRow]:
        """Every row of the table, deleted ones included, for the diff."""
        rows = await self._pool.fetch(
            f"SELECT {_SYNC_COLUMNS}, is_deleted FROM property_holding ORDER BY id"
        )
        return [to_existing_row(row) for row in rows]

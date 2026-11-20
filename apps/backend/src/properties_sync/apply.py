"""Apply a `ChangeSet` to `property_holding` in one transaction.

Updates only set the fields that changed. Rows are never removed: a delete sets
`is_deleted`, a restore clears it. Either every change lands or none does.

Table and column names come from `properties_sync.config`, never from the
workbook; only values are passed as query parameters. A number is written as the
decimal the owners typed (`Decimal(repr(value))`) and not as the long binary
expansion of the float, so the table holds `0.03` and not `0.0299999999999999988...`.
"""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import asyncpg

from properties_sync.config import KEY_FIELDS, PROPERTY_COLUMNS
from properties_sync.diff import ChangeSet

_TABLE = "property_holding"
_FIELDS = {column.field for column in PROPERTY_COLUMNS}
_ALLOCATION_FIELDS = {c.field for c in PROPERTY_COLUMNS if c.type == "allocations"}
_NUMBER_FIELDS = {c.field for c in PROPERTY_COLUMNS if c.type == "number"}


def _check_fields(fields: list[str]) -> None:
    unknown = [field for field in fields if field not in _FIELDS]
    if unknown:
        raise ValueError(f"not a property field: {', '.join(unknown)}")


def _db_value(field: str, value: Any) -> Any:
    if field in _ALLOCATION_FIELDS:
        return json.dumps([{"name": name, "percentage": pct} for name, pct in value])
    if field in _NUMBER_FIELDS:
        return None if value is None else Decimal(repr(value))
    return value


def _placeholder(position: int, field: str) -> str:
    """An allocation field is written through `catalog_allocation_with_slugs`, the SQL
    function behind the on-demand backfill, so the slug of each item is derived from its
    name in the same statement. The workbook only gives name and percentage; without
    this, a field that changes in the workbook would be stored without the slugs it had."""
    if field in _ALLOCATION_FIELDS:
        return f"catalog_allocation_with_slugs(${position}::jsonb)"
    return f"${position}"


def _insert_statement(values: dict[str, Any]) -> tuple[str, list[Any]]:
    fields = list(values)
    _check_fields(fields)
    placeholders = ", ".join(_placeholder(i, f) for i, f in enumerate(fields, start=1))
    sql = f"INSERT INTO {_TABLE} ({', '.join(fields)}) VALUES ({placeholders})"
    return sql, [_db_value(f, values[f]) for f in fields]


def _update_statement(key: tuple[str, str], new_values: dict[str, Any]) -> tuple[str, list[Any]]:
    fields = list(new_values)
    _check_fields(fields)
    sets = ", ".join(f"{f} = {_placeholder(i, f)}" for i, f in enumerate(fields, start=1))
    where = " AND ".join(f"{f} = ${len(fields) + i}" for i, f in enumerate(KEY_FIELDS, start=1))
    sql = f"UPDATE {_TABLE} SET {sets}, updated_at = now() WHERE {where}"
    return sql, [_db_value(f, new_values[f]) for f in fields] + list(key)


def _flag_statement(key: tuple[str, str], *, deleted: bool) -> tuple[str, list[Any]]:
    """Set or clear the soft delete of one row."""
    where = " AND ".join(f"{f} = ${i}" for i, f in enumerate(KEY_FIELDS, start=1))
    flag = "true" if deleted else "false"
    return f"UPDATE {_TABLE} SET is_deleted = {flag}, updated_at = now() WHERE {where}", list(key)


async def apply_changeset(pool: asyncpg.Pool, changeset: ChangeSet) -> None:
    """Write `changeset` in a single transaction."""
    async with pool.acquire() as conn, conn.transaction():
        for restore in changeset.restores:
            sql, args = _flag_statement(restore.key, deleted=False)
            await conn.execute(sql, *args)
        for insert in changeset.inserts:
            sql, args = _insert_statement(insert.values)
            await conn.execute(sql, *args)
        for update in changeset.updates:
            sql, args = _update_statement(update.key, {c.field: c.new for c in update.changes})
            await conn.execute(sql, *args)
        for delete in changeset.soft_deletes:
            sql, args = _flag_statement(delete.key, deleted=True)
            await conn.execute(f"{sql} AND NOT is_deleted", *args)

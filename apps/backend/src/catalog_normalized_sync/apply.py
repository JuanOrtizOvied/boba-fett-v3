"""Apply a `ChangeSet` to the normalized catalog tables in one transaction.

Parents are inserted before their children (products, series, administrators)
and updates only set the fields that changed. Rows are never removed: a delete
sets `is_deleted` and `deleted_at`, a restore clears them. Either every change
lands or none does.

Table and column names come from `catalog_normalized_sync.config`, never from
the workbook; only values are passed as query parameters.
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg

from catalog_normalized_sync.config import (
    LEVEL_ADMIN,
    LEVEL_PRODUCT,
    LEVEL_SERIES,
    SHEETS,
)
from catalog_normalized_sync.diff import ChangeSet

_TABLES = {
    LEVEL_PRODUCT: "catalog_product",
    LEVEL_SERIES: "catalog_product_series",
    LEVEL_ADMIN: "catalog_product_series_admin",
}
_KEY_FIELDS = {spec.level: spec.key_fields for spec in SHEETS}
_ALLOCATION_FIELDS = {
    column.field for spec in SHEETS for column in spec.columns if column.type == "allocations"
}


def _db_value(field: str, value: Any) -> Any:
    if field in _ALLOCATION_FIELDS:
        return json.dumps([{"name": name, "percentage": pct} for name, pct in value])
    return value


def _placeholder(position: int, field: str) -> str:
    return f"${position}::jsonb" if field in _ALLOCATION_FIELDS else f"${position}"


def _insert_statement(level: str, values: dict[str, Any]) -> tuple[str, list[Any]]:
    fields = list(values)
    placeholders = ", ".join(_placeholder(i, f) for i, f in enumerate(fields, start=1))
    sql = f"INSERT INTO {_TABLES[level]} ({', '.join(fields)}) VALUES ({placeholders})"
    return sql, [_db_value(f, values[f]) for f in fields]


def _update_statement(
    level: str, key: tuple[str, ...], new_values: dict[str, Any]
) -> tuple[str, list[Any]]:
    fields = list(new_values)
    sets = ", ".join(f"{f} = {_placeholder(i, f)}" for i, f in enumerate(fields, start=1))
    key_fields = _KEY_FIELDS[level]
    where = " AND ".join(f"{f} = ${len(fields) + i}" for i, f in enumerate(key_fields, start=1))
    sql = f"UPDATE {_TABLES[level]} SET {sets} WHERE {where}"
    return sql, [_db_value(f, new_values[f]) for f in fields] + list(key)


def _flag_statement(level: str, key: tuple[str, ...], *, deleted: bool) -> tuple[str, list[Any]]:
    """Set or clear the soft-delete of one row. `now()` is the transaction's
    start, so every row of one run gets the same `deleted_at`."""
    where = " AND ".join(f"{f} = ${i}" for i, f in enumerate(_KEY_FIELDS[level], start=1))
    flag = (
        "is_deleted = true, deleted_at = now()"
        if deleted
        else "is_deleted = false, deleted_at = NULL"
    )
    return f"UPDATE {_TABLES[level]} SET {flag} WHERE {where}", list(key)


async def apply_changeset(pool: asyncpg.Pool, changeset: ChangeSet) -> None:
    """Write `changeset` in a single transaction."""
    async with pool.acquire() as conn, conn.transaction():
        for restore in changeset.restores:
            sql, args = _flag_statement(restore.level, restore.key, deleted=False)
            await conn.execute(sql, *args)
        for spec in SHEETS:
            for insert in changeset.inserts:
                if insert.level == spec.level:
                    sql, args = _insert_statement(insert.level, insert.values)
                    await conn.execute(sql, *args)
        for update in changeset.updates:
            sql, args = _update_statement(
                update.level, update.key, {c.field: c.new for c in update.changes}
            )
            await conn.execute(sql, *args)
        for delete in changeset.deletes:
            sql, args = _flag_statement(delete.level, delete.key, deleted=True)
            await conn.execute(f"{sql} AND NOT is_deleted", *args)

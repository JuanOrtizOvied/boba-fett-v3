"""Writes a `ChangeSet` to the v2 tables inside one transaction.

Every change of a run is applied or none is: an unexpected error rolls the whole
transaction back. The order is the one the diff lists: new managers and
administrators first, then products, series and administrator links. Nothing is
ever deleted from the tables: a delete only sets `is_deleted`, and no change
restores a row. Column names come from fixed whitelists, never from the data.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from decimal import Decimal

import asyncpg

from catalog_v2.diff import (
    ADMINISTRATOR,
    DELETE,
    INSERT,
    LINK,
    MANAGER,
    PRODUCT,
    SERIES,
    UPDATE,
    Change,
    ChangeSet,
)
from catalog_v2.normalize import normalize_key

_COMPOSITES = {"asset_class", "geographic_focus", "underlying"}
_PRODUCT_COLUMNS = {
    "name",
    "isin",
    "asset_class",
    "geographic_focus",
    "underlying",
    "currency",
    "investment_horizon",
}
_SERIES_COLUMNS = {"ter", "flows_min", "flows_max", "return_min", "return_max"}
_LINK_COLUMNS = {
    "custody",
    "buy_commission",
    "sell_commission",
    "minimum_usd",
    "min_commission_usd",
}
_TABLES = {
    PRODUCT: "product_catalog_v2",
    SERIES: "product_series_v2",
    LINK: "product_administrator_v2",
}


@dataclass
class ApplyReport:
    """What a run wrote, counted by level and action."""

    entities_added: int = 0
    counts: dict[tuple[str, str], int] | None = None

    def count(self, level: str, action: str) -> int:
        return (self.counts or {}).get((level, action), 0)


def _bump(report: ApplyReport, level: str, action: str) -> None:
    if report.counts is None:
        report.counts = {}
    report.counts[(level, action)] = report.counts.get((level, action), 0) + 1


def _as_database_value(column: str, value: object) -> object:
    """A value as the driver expects it for its column."""
    if column in _COMPOSITES:
        return json.dumps(value)
    if isinstance(value, float):
        return Decimal(repr(value))  # exact: the stored number is the one in the workbook
    return value


def _placeholder(column: str, position: int) -> str:
    return f"${position}::jsonb" if column in _COMPOSITES else f"${position}"


async def _insert(conn: asyncpg.Connection, table: str, values: dict[str, object]) -> int:
    columns = list(values)
    placeholders = [_placeholder(c, i) for i, c in enumerate(columns, start=1)]
    row = await conn.fetchrow(
        f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) "
        "RETURNING id",
        *(_as_database_value(c, values[c]) for c in columns),
    )
    return row["id"]


async def _update(
    conn: asyncpg.Connection, table: str, row_id: int, values: dict[str, object]
) -> None:
    if not values:
        return
    columns = list(values)
    assignments = [f"{c} = {_placeholder(c, i)}" for i, c in enumerate(columns, start=1)]
    await conn.execute(
        f"UPDATE {table} SET {', '.join(assignments)}, updated_at = now() "
        f"WHERE id = ${len(columns) + 1}",
        *(_as_database_value(c, values[c]) for c in columns),
        row_id,
    )


async def _soft_delete(conn: asyncpg.Connection, table: str, row_id: int) -> None:
    await conn.execute(
        f"UPDATE {table} SET is_deleted = true, updated_at = now() WHERE id = $1", row_id
    )


def _only(fields: dict[str, object], allowed: set[str]) -> dict[str, object]:
    return {k: v for k, v in fields.items() if k in allowed}


async def _entity_ids(conn: asyncpg.Connection, table: str) -> dict[str, int]:
    return {r["name"]: r["id"] for r in await conn.fetch(f"SELECT id, name FROM {table}")}


async def apply_changeset(pool: asyncpg.Pool, changes: ChangeSet) -> ApplyReport:
    """Apply every change in one transaction and report what was written."""
    report = ApplyReport()
    async with pool.acquire() as conn, conn.transaction():
        for entity in changes.new_entities:
            if entity.role == MANAGER:
                await conn.execute("INSERT INTO manager_v2 (name) VALUES ($1)", entity.name)
            elif entity.role == ADMINISTRATOR:
                # No score yet, so it stays editable in the web.
                await conn.execute(
                    "INSERT INTO administrator_v2 (name, score, score_is_fixed) "
                    "VALUES ($1, NULL, false)",
                    entity.name,
                )
            report.entities_added += 1
        manager_ids = await _entity_ids(conn, "manager_v2")
        administrator_ids = await _entity_ids(conn, "administrator_v2")

        product_ids: dict[str, int] = {}
        for change in (c for c in changes.changes if c.level == PRODUCT):
            await _apply_product(conn, change, manager_ids, product_ids)
            _bump(report, PRODUCT, change.action)
        for row in await conn.fetch("SELECT id, codigo FROM product_catalog_v2"):
            product_ids[row["codigo"]] = row["id"]

        series_ids: dict[tuple[str, str], int] = {}
        for change in (c for c in changes.changes if c.level == SERIES):
            await _apply_series(conn, change, product_ids, series_ids)
            _bump(report, SERIES, change.action)
        for row in await conn.fetch(
            "SELECT s.id, p.codigo, s.series FROM product_series_v2 s "
            "JOIN product_catalog_v2 p ON p.id = s.product_id"
        ):
            series_ids[(row["codigo"], normalize_key(row["series"]))] = row["id"]

        for change in (c for c in changes.changes if c.level == LINK):
            await _apply_link(conn, change, series_ids, administrator_ids)
            _bump(report, LINK, change.action)
    return report


async def _apply_product(
    conn: asyncpg.Connection,
    change: Change,
    manager_ids: dict[str, int],
    product_ids: dict[str, int],
) -> None:
    table = _TABLES[PRODUCT]
    if change.action == DELETE:
        await _soft_delete(conn, table, change.id)
        return
    values = _only(change.fields, _PRODUCT_COLUMNS)
    if "manager" in change.fields:
        values["manager_id"] = manager_ids[change.fields["manager"]]
    if change.action == INSERT:
        values.setdefault("name", "")  # a row without a name is stored, not rejected
        product_ids[change.key[0]] = await _insert(conn, table, {"codigo": change.key[0], **values})
    elif change.action == UPDATE:
        await _update(conn, table, change.id, values)


async def _apply_series(
    conn: asyncpg.Connection,
    change: Change,
    product_ids: dict[str, int],
    series_ids: dict[tuple[str, str], int],
) -> None:
    table = _TABLES[SERIES]
    if change.action == DELETE:
        await _soft_delete(conn, table, change.id)
        return
    values = _only(change.fields, _SERIES_COLUMNS)
    if change.action == INSERT:
        codigo, series = change.key
        series_ids[(codigo, normalize_key(series))] = await _insert(
            conn, table, {"product_id": product_ids[codigo], "series": series, **values}
        )
    elif change.action == UPDATE:
        await _update(conn, table, change.id, values)


async def _apply_link(
    conn: asyncpg.Connection,
    change: Change,
    series_ids: dict[tuple[str, str], int],
    administrator_ids: dict[str, int],
) -> None:
    table = _TABLES[LINK]
    if change.action == DELETE:
        await _soft_delete(conn, table, change.id)
        return
    values = _only(change.fields, _LINK_COLUMNS)
    if change.action == INSERT:
        codigo, series, administrator = change.key
        await _insert(
            conn,
            table,
            {
                "series_id": series_ids[(codigo, normalize_key(series))],
                "administrator_id": administrator_ids[administrator],
                **values,
            },
        )
    elif change.action == UPDATE:
        await _update(conn, table, change.id, values)

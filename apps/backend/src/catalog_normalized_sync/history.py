"""Change history of the normalized catalog sync.

`events_from_changeset` turns the `ChangeSet` of one run into the events to keep
(one per create, update, delete and restore), and `store_events` writes them with
the run's id and trigger. The first is pure (no database), so it is unit-tested on
its own; the second is called by `apply_changeset` inside its transaction, so the
changes and their events land together or not at all.

The history is evidence of what the sync applied. Nothing here reverts, restores
or writes to the workbook.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Any

import asyncpg

from catalog_normalized_sync.config import LEVEL_ADMIN, LEVEL_SERIES, SHEETS
from catalog_normalized_sync.diff import ChangeSet

ACTION_CREATE = "create"
ACTION_UPDATE = "update"
ACTION_DELETE = "delete"
ACTION_RESTORE = "restore"

# What can start a run. `web` is reserved for a future write path and is never
# produced by the sync itself.
TRIGGERS = ("webhook", "scheduler", "lifecycle", "manual", "web")

_KEY_FIELDS = {spec.level: spec.key_fields for spec in SHEETS}


@dataclass(frozen=True)
class SyncEvent:
    """One applied change, before it gets the run's id, trigger and time."""

    action: str
    level: str
    product_code: str
    series: str | None = None
    administrator: str | None = None
    changes: tuple[dict[str, Any], ...] = ()


def _json_value(value: Any) -> Any:
    """A value as JSON holds it. Allocation lists (tuples of `(name, pct)`) use the
    shape `apply` writes to the tables; anything JSON cannot hold natively is
    kept as text."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, (tuple, list)):
        return [
            {"name": item[0], "percentage": item[1]}
            if isinstance(item, (tuple, list)) and len(item) == 2
            else _json_value(item)
            for item in value
        ]
    return str(value)


def _is_empty(value: Any) -> bool:
    return value is None or value == "" or value == () or value == []


def _key_columns(level: str, key: tuple[str, ...]) -> tuple[str, str | None, str | None]:
    """`(product_code, series, administrator)` of a row key, whatever its level."""
    product_code = key[0]
    series = key[1] if level in (LEVEL_SERIES, LEVEL_ADMIN) else None
    administrator = key[2] if level == LEVEL_ADMIN else None
    return product_code, series, administrator


def _event(
    action: str, level: str, key: tuple[str, ...], changes: tuple[dict[str, Any], ...] = ()
) -> SyncEvent:
    product_code, series, administrator = _key_columns(level, key)
    return SyncEvent(action, level, product_code, series, administrator, changes)


def events_from_changeset(changeset: ChangeSet) -> list[SyncEvent]:
    """The events of one run, in the order `apply_changeset` writes the changes:
    restores, inserts (parents first), updates, deletes. An empty `ChangeSet`
    gives no events."""
    events: list[SyncEvent] = []

    for restore in changeset.restores:
        events.append(_event(ACTION_RESTORE, restore.level, restore.key))

    for spec in SHEETS:
        for insert in changeset.inserts:
            if insert.level != spec.level:
                continue
            # The key is already in the event's own columns; keep the rest, and
            # only what has a value.
            changes = tuple(
                {"field": name, "old": None, "new": _json_value(value)}
                for name, value in insert.values.items()
                if name not in _KEY_FIELDS[insert.level] and not _is_empty(value)
            )
            events.append(_event(ACTION_CREATE, insert.level, insert.key, changes))

    for update in changeset.updates:
        changes = tuple(
            {"field": c.field, "old": _json_value(c.old), "new": _json_value(c.new)}
            for c in update.changes
        )
        events.append(_event(ACTION_UPDATE, update.level, update.key, changes))

    for delete in changeset.deletes:
        events.append(_event(ACTION_DELETE, delete.level, delete.key))

    return events


async def store_events(
    conn: asyncpg.Connection,
    events: list[SyncEvent],
    *,
    run_id: uuid.UUID,
    trigger: str,
) -> None:
    """Insert `events` with the run's id and trigger. `occurred_at` is left to its
    default, `now()`, which inside a transaction is the transaction's start, so
    every event of the run shares one instant."""
    if not events:
        return
    if trigger not in TRIGGERS:
        raise ValueError(f"unknown sync trigger: {trigger!r}")
    await conn.executemany(
        "INSERT INTO normalized_sync_event "
        "(run_id, trigger, action, level, product_code, series, administrator, changes) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
        [
            (
                run_id,
                trigger,
                event.action,
                event.level,
                event.product_code,
                event.series,
                event.administrator,
                json.dumps(list(event.changes)),
            )
            for event in events
        ],
    )

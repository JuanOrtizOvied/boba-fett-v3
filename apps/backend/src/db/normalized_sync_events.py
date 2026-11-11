"""Read side of the change history of the normalized catalog sync.

The events are written by `catalog_normalized_sync.history` inside the sync
transaction; this module only reads them. The table has no foreign key to the
catalog, so the history of a soft-deleted product is still here and the name of
a product is looked up with a join that ignores `is_deleted`.

A day is 00:00 to 24:00 in `America/Lima`. The boundaries are computed by the
database with its own time zone data (no fixed offset in Python), and the
filter is a range on `occurred_at` so its index is used.
"""

from __future__ import annotations

import datetime
import json
import uuid
from typing import Any

import asyncpg
from pydantic import BaseModel

LIMA_TZ = "America/Lima"

# What a product did on a day, from the point of view of whoever reads the day. A
# product counts once, under the first that applies: it is `deleted` when it is
# soft-deleted now, `new` when its product row was created that day, `restored`
# when the sync reactivated it that day, and `modified` otherwise (a changed value,
# or a series or administrator that was added, changed or removed).
PRODUCT_STATUSES = ("new", "modified", "deleted", "restored")


class SyncEventRow(BaseModel):
    id: int
    run_id: uuid.UUID
    occurred_at: datetime.datetime
    trigger: str
    action: str
    level: str
    product_code: str
    series: str | None = None
    administrator: str | None = None
    changes: list[dict[str, Any]] = []
    # Who saved the workbook the run read, as stored: an email, the marker
    # `unknown` when it could not be determined, or None when there is no data
    # (events from before the column existed and runs from a local file).
    changed_by: str | None = None


class ProductEvents(BaseModel):
    """One product on one day: its status and how many events it had, in total and
    per action (events of every level, product, series and administrator)."""

    product_code: str
    name: str
    deleted: bool
    status: str
    events: int
    create: int
    update: int
    delete: int
    restore: int


class DaySummary(BaseModel):
    """`totals` counts PRODUCTS per status (`PRODUCT_STATUSES`), each product once,
    so they add up to `len(products)`. The events behind them are on each entry."""

    date: datetime.date
    totals: dict[str, int]
    products: list[ProductEvents]


class ProductHistory(BaseModel):
    """A page of a product's events, newest first, and how many it has in all."""

    total: int
    events: list[SyncEventRow]


def _event_from_record(r: asyncpg.Record) -> SyncEventRow:
    changes = r["changes"]
    if isinstance(changes, str):
        changes = json.loads(changes)
    return SyncEventRow(
        id=r["id"],
        run_id=r["run_id"],
        occurred_at=r["occurred_at"],
        trigger=r["trigger"],
        action=r["action"],
        level=r["level"],
        product_code=r["product_code"],
        series=r["series"],
        administrator=r["administrator"],
        changes=changes or [],
        changed_by=r["changed_by"],
    )


# The events of one Lima day. A series or administrator `delete` is left out when
# the same run also deleted its product: deleting a product removes its children
# too, and the day must count that as one delete. The events stay stored and the
# history of the product still lists all of them.
_DAY_EVENTS = """
    SELECT e.* FROM normalized_sync_event e
    WHERE e.occurred_at >= ($1::date)::timestamp AT TIME ZONE 'America/Lima'
      AND e.occurred_at < (($1::date) + 1)::timestamp AT TIME ZONE 'America/Lima'
      AND NOT (
        e.action = 'delete' AND e.level <> 'product'
        AND EXISTS (
          SELECT 1 FROM normalized_sync_event p
          WHERE p.run_id = e.run_id AND p.product_code = e.product_code
            AND p.level = 'product' AND p.action = 'delete'
        )
      )
"""

_DAY_PRODUCTS = f"""
    WITH day_events AS ({_DAY_EVENTS})
    SELECT d.product_code,
           COALESCE(p.name, d.product_code) AS name,
           COALESCE(p.is_deleted, false) AS deleted,
           count(*) AS events,
           count(*) FILTER (WHERE d.action = 'create') AS create_count,
           count(*) FILTER (WHERE d.action = 'update') AS update_count,
           count(*) FILTER (WHERE d.action = 'delete') AS delete_count,
           count(*) FILTER (WHERE d.action = 'restore') AS restore_count,
           count(*) FILTER (WHERE d.level = 'product' AND d.action = 'create') AS product_created,
           count(*) FILTER (WHERE d.level = 'product' AND d.action = 'restore') AS product_restored
    FROM day_events d
    LEFT JOIN catalog_product p ON p.code = d.product_code
    GROUP BY d.product_code, p.name, p.is_deleted
    ORDER BY d.product_code
"""


def _status(deleted: bool, created: bool, restored: bool) -> str:
    """The status of a product for the day (see `PRODUCT_STATUSES`)."""
    if deleted:
        return "deleted"
    if created:
        return "new"
    if restored:
        return "restored"
    return "modified"


class NormalizedSyncEventRepository:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def list_for_product(
        self, code: str, *, limit: int = 10, offset: int = 0
    ) -> ProductHistory:
        """Events of `code`, newest first. Works for soft-deleted products, and
        returns an empty page (not an error) when there are no events."""
        total = await self._pool.fetchval(
            "SELECT count(*) FROM normalized_sync_event WHERE product_code = $1", code
        )
        rows = await self._pool.fetch(
            "SELECT * FROM normalized_sync_event WHERE product_code = $1 "
            "ORDER BY occurred_at DESC, id DESC LIMIT $2 OFFSET $3",
            code,
            limit,
            offset,
        )
        return ProductHistory(total=total, events=[_event_from_record(r) for r in rows])

    async def day_summary(self, day: datetime.date | None = None) -> DaySummary:
        """What changed on `day` (today in Lima when None): one entry per product
        with events that day, and the number of products per status."""
        if day is None:
            day = await self._pool.fetchval("SELECT (now() AT TIME ZONE 'America/Lima')::date")
        rows = await self._pool.fetch(_DAY_PRODUCTS, day)
        products = [
            ProductEvents(
                product_code=r["product_code"],
                name=r["name"],
                deleted=r["deleted"],
                status=_status(r["deleted"], r["product_created"] > 0, r["product_restored"] > 0),
                events=r["events"],
                create=r["create_count"],
                update=r["update_count"],
                delete=r["delete_count"],
                restore=r["restore_count"],
            )
            for r in rows
        ]
        totals = {s: sum(1 for p in products if p.status == s) for s in PRODUCT_STATUSES}
        return DaySummary(date=day, totals=totals, products=products)

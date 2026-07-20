from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

import asyncpg

from db.models import AssetAllocation, Product

# Fields excluded from the per-product diff in `compare_snapshots` — they
# identify the row rather than describe portfolio state, so they never carry
# meaningful "change" information (`design.md` — "Diff Algorithm" step 5).
_DIFF_IGNORED_FIELDS = {"id", "user_id"}


class SnapshotUnchangedError(Exception):
    """Raised by `create_snapshot` when the current portfolio is identical
    to the most recent snapshot — no point saving a duplicate."""


class SnapshotNotFoundError(Exception):
    """Raised by `compare_snapshots` when a referenced snapshot id does not
    exist at all (CMP-001 "Comparing a non-existent snapshot id").

    Kept distinguishable from `SnapshotAccessError` so PR5's route can map
    this to `404` and the access-denied case to `403`, instead of collapsing
    both into one generic `ValueError` (`tasks.md` T-009 deviation note).
    """


class SnapshotAccessError(Exception):
    """Raised by `compare_snapshots` when a referenced snapshot exists but
    is not owned by the requesting `user_id` (CMP-001 "Comparing a snapshot
    the user does not own").
    """


@asynccontextmanager
async def _repeatable_read_transaction(conn: asyncpg.Connection) -> AsyncIterator[None]:
    """Start a `REPEATABLE READ` transaction on `conn` (`design.md` ADR-5).

    Production connections acquired fresh from the real `asyncpg.Pool`
    open this as the top-level transaction, so
    `isolation="repeatable_read"` applies exactly as designed, giving
    `create_snapshot` a consistent point-in-time read of `products` under
    `SELECT ... FOR SHARE`.

    Test connections (`tests/conftest.py`'s `FakePool.acquire()`) are
    already inside the per-test SAVEPOINT-wrapped session transaction
    (default `read committed` isolation). asyncpg raises `InterfaceError`
    when a nested transaction requests a different isolation level than
    its outer transaction, so in that case we fall back to a plain nested
    transaction (savepoint, no explicit isolation override) — a
    documented test-only divergence from the production isolation level
    (`tasks.md` T-001 / PR2 deviation note).
    """
    tx = conn.transaction(isolation="repeatable_read")
    try:
        await tx.start()
    except asyncpg.InterfaceError as exc:
        if "isolation level" not in str(exc):
            raise
        async with conn.transaction():
            yield
        return

    try:
        yield
    except BaseException:
        await tx.rollback()
        raise
    else:
        await tx.commit()


class VersioningRepository:
    """Repository for portfolio snapshots (`sdd/portfolio-versioning/design.md`
    ADR-2/ADR-5).

    Snapshots are immutable once created (SNAP-005) — this class
    intentionally exposes no update/delete method for `portfolio_snapshots`
    or `snapshot_products`.
    """

    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def create_snapshot(
        self, user_id: str, name: str, description: str = ""
    ) -> dict:
        """Create an immutable snapshot of the user's current portfolio.

        Per SNAP-009, an empty portfolio is a VALID snapshot: it succeeds
        with `product_count=0`, `total_amount=0`, and zero
        `snapshot_products` rows. This intentionally diverges from
        `design.md`'s example code, which raises `ValueError` on an empty
        portfolio — `tasks.md`'s PR2 deviation note flags SNAP-009 as the
        spec of record, and the spec wins over the stale design snippet.

        Uses `REPEATABLE READ` + `SELECT ... FOR SHARE` (ADR-5, SNAP-011)
        so a concurrent product mutation for the same user cannot commit
        while the snapshot read is in flight, guaranteeing the resulting
        snapshot's `product_count` always matches its materialized
        `snapshot_products` row count.

        Every product field is materialized into `snapshot_products.product_data`
        (via `Product.model_dump()`), not just id/name/amount, so enrichment
        fields (`underlying`, `asset_class`, `commission`, etc.) survive
        later live-product edits or deletes (SNAP-002).
        """
        async with self.pool.acquire() as conn:
            async with _repeatable_read_transaction(conn):
                rows = await conn.fetch(
                    "SELECT * FROM products WHERE user_id = $1 FOR SHARE",
                    user_id,
                )

                current_products = {
                    str(r["id"]): self._row_to_product(r).model_dump()
                    for r in rows
                }

                latest = await conn.fetchrow(
                    """SELECT id FROM portfolio_snapshots
                       WHERE user_id = $1
                       ORDER BY created_at DESC LIMIT 1""",
                    user_id,
                )
                if latest is not None:
                    prev_rows = await conn.fetch(
                        "SELECT product_id, product_data FROM snapshot_products WHERE snapshot_id = $1",
                        latest["id"],
                    )
                    prev_products = {
                        str(r["product_id"]): self._jsonb(r["product_data"])
                        for r in prev_rows
                    }
                    if current_products == prev_products:
                        raise SnapshotUnchangedError(
                            "El portafolio no tiene cambios respecto a la última versión guardada"
                        )

                product_count = len(rows)
                total_amount = sum(float(r["amount"]) for r in rows)

                cat_totals: dict[str, float] = {}
                for r in rows:
                    cat = r["category"] or "otros"
                    cat_totals[cat] = cat_totals.get(cat, 0) + float(r["amount"])
                category_summary = sorted(
                    [
                        {"category": c, "percentage": round(a / total_amount * 100, 1) if total_amount else 0}
                        for c, a in cat_totals.items()
                    ],
                    key=lambda x: x["percentage"],
                    reverse=True,
                )

                snapshot_row = await conn.fetchrow(
                    """INSERT INTO portfolio_snapshots
                       (user_id, name, description, product_count, total_amount, category_summary)
                       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                       RETURNING id, created_at""",
                    user_id,
                    name,
                    description,
                    product_count,
                    total_amount,
                    json.dumps(category_summary),
                )
                snapshot_id = snapshot_row["id"]

                for row in rows:
                    product = self._row_to_product(row)
                    await conn.execute(
                        """INSERT INTO snapshot_products
                           (snapshot_id, product_id, product_data)
                           VALUES ($1, $2, $3::jsonb)""",
                        snapshot_id,
                        product.id,
                        json.dumps(product.model_dump()),
                    )

                return {
                    "id": str(snapshot_id),
                    "user_id": user_id,
                    "name": name,
                    "description": description,
                    "product_count": product_count,
                    "total_amount": float(total_amount),
                    "category_summary": category_summary,
                    "created_at": snapshot_row["created_at"].isoformat(),
                }

    async def list_snapshots(
        self, user_id: str, limit: int = 50, offset: int = 0
    ) -> list[dict]:
        """List snapshots for a user, newest first (SNAP-003).

        Returns summary rows only — no `snapshot_products` payload.
        """
        rows = await self.pool.fetch(
            """SELECT id, user_id, name, description, product_count,
                      total_amount, category_summary, created_at
               FROM portfolio_snapshots
               WHERE user_id = $1
               ORDER BY created_at DESC
               LIMIT $2 OFFSET $3""",
            user_id,
            limit,
            offset,
        )
        return [self._row_to_snapshot_summary(r) for r in rows]

    async def has_changes_since_latest(self, user_id: str) -> bool:
        """Return True when the current portfolio differs from the latest
        snapshot (or no snapshot exists yet)."""
        async with self.pool.acquire() as conn:
            latest = await conn.fetchrow(
                """SELECT id FROM portfolio_snapshots
                   WHERE user_id = $1
                   ORDER BY created_at DESC LIMIT 1""",
                user_id,
            )
            if latest is None:
                return True

            rows = await conn.fetch(
                "SELECT * FROM products WHERE user_id = $1", user_id
            )
            current = {
                str(r["id"]): self._row_to_product(r).model_dump()
                for r in rows
            }

            prev_rows = await conn.fetch(
                "SELECT product_id, product_data FROM snapshot_products WHERE snapshot_id = $1",
                latest["id"],
            )
            prev = {
                str(r["product_id"]): self._jsonb(r["product_data"])
                for r in prev_rows
            }
            return current != prev

    async def get_snapshot(self, snapshot_id: str, user_id: str) -> dict | None:
        """Get a single snapshot with its full materialized product list.

        Returns `None` (never raises) when the snapshot doesn't exist OR
        belongs to a different user (SNAP-010) — the ownership check and
        the not-found check are collapsed into one non-disclosing `None`
        result, letting the caller (a future route) uniformly 404 without
        revealing whether the id exists for another user.
        """
        snapshot_row = await self.pool.fetchrow(
            """SELECT id, user_id, name, description, product_count,
                      total_amount, category_summary, created_at
               FROM portfolio_snapshots
               WHERE id = $1 AND user_id = $2""",
            snapshot_id,
            user_id,
        )
        if snapshot_row is None:
            return None

        product_rows = await self.pool.fetch(
            "SELECT product_data FROM snapshot_products WHERE snapshot_id = $1",
            snapshot_id,
        )

        detail = self._row_to_snapshot_summary(snapshot_row)
        detail["products"] = [self._jsonb(r["product_data"]) for r in product_rows]
        return detail

    async def compare_snapshots(
        self, snapshot_a_id: str, snapshot_b_id: str, user_id: str
    ) -> dict:
        """Compare two snapshots and return a structured diff (ADR-3).

        `snapshot_a_id` is always the baseline for `before`/`after`
        labeling, regardless of the snapshots' actual `created_at` order
        (CMP-007) — callers control direction by choosing which id is `a`.

        Raises `SnapshotNotFoundError` when either id does not exist at
        all, or `SnapshotAccessError` when it exists but is not owned by
        `user_id` — kept distinguishable (rather than one generic
        `ValueError`) so PR5's route can map these to `404` vs `403`
        (CMP-001, `tasks.md` T-009 deviation note).

        Diffing is done by the stable `product_id` (never by name — CMP-002):
        a product deleted and later re-created with the same name has a
        different `product_id`, so it always shows as one `removed` + one
        `added` entry, never a `modified` one. Self-comparison (`a == b`)
        naturally yields empty `added`/`removed`/`modified` lists — the
        set-difference/field-loop algorithm below needs no special case for
        it (CMP-006).
        """
        for snapshot_id in (snapshot_a_id, snapshot_b_id):
            owner = await self.pool.fetchval(
                "SELECT user_id FROM portfolio_snapshots WHERE id = $1",
                snapshot_id,
            )
            if owner is None:
                raise SnapshotNotFoundError(f"Snapshot {snapshot_id} not found")
            if str(owner) != str(user_id):
                raise SnapshotAccessError(
                    f"Snapshot {snapshot_id} is not owned by this user"
                )

        rows_a = await self.pool.fetch(
            "SELECT product_id, product_data FROM snapshot_products WHERE snapshot_id = $1",
            snapshot_a_id,
        )
        rows_b = await self.pool.fetch(
            "SELECT product_id, product_data FROM snapshot_products WHERE snapshot_id = $1",
            snapshot_b_id,
        )

        products_a = {r["product_id"]: self._jsonb(r["product_data"]) for r in rows_a}
        products_b = {r["product_id"]: self._jsonb(r["product_data"]) for r in rows_b}

        ids_a = set(products_a.keys())
        ids_b = set(products_b.keys())

        added = [products_b[pid] for pid in (ids_b - ids_a)]
        removed = [products_a[pid] for pid in (ids_a - ids_b)]

        modified = []
        for pid in ids_a & ids_b:
            pa, pb = products_a[pid], products_b[pid]
            changes = {}
            for field in pa:
                if field in _DIFF_IGNORED_FIELDS:
                    continue
                before_val = pa[field]
                after_val = pb.get(field)
                if before_val != after_val:
                    changes[field] = {"before": before_val, "after": after_val}
            if changes:
                modified.append(
                    {
                        "product_id": pid,
                        "name": pb.get("name") or pa.get("name"),
                        "before": pa,
                        "after": pb,
                        "changes": changes,
                    }
                )

        total_amount_a = sum(float(p.get("amount", 0)) for p in products_a.values())
        total_amount_b = sum(float(p.get("amount", 0)) for p in products_b.values())

        return {
            "snapshot_a": snapshot_a_id,
            "snapshot_b": snapshot_b_id,
            "added": added,
            "removed": removed,
            "modified": modified,
            "summary": {
                "added_count": len(added),
                "removed_count": len(removed),
                "modified_count": len(modified),
                "total_amount_delta": total_amount_b - total_amount_a,
                "product_count_delta": len(products_b) - len(products_a),
            },
        }

    async def list_changes(
        self,
        user_id: str,
        limit: int = 50,
        offset: int = 0,
        product_id: str | None = None,
        operation: str | None = None,
    ) -> dict:
        """Paginated change log for a user (AL-006), optionally filtered by
        `product_id` and/or `operation`.

        Ownership is enforced entirely by the `WHERE user_id = $1` clause —
        there is no cross-user code path in this method. The admin-scoped
        read route (PR5, AL-007) calls this same method with the target
        client's `user_id` — it is reused, never forked, per `tasks.md`
        T-010.

        `operation` was added in PR5 (T-018) — AL-006's "Filter by
        operation type" scenario (`?operation=delete`) is a Must-priority
        requirement that PR3's original `product_id`-only filter did not
        cover. This is an additive, backward-compatible keyword param
        (existing call sites and tests are unaffected); PR5's
        `tasks.md` T-018 scoped its "Files" to the route layer only, but
        satisfying AL-006 without silently dropping the requirement
        requires this small repository extension — flagged in the PR5
        apply-progress as a deviation from the stated file scope.

        Returns `total` and `has_more` alongside the page of rows (AL-006
        "Default page size") — this return shape intentionally differs from
        `design.md`'s stub (a bare `list[dict]`), since the spec requires
        pagination metadata; PR5's route adapts to this shape.
        """
        conditions = ["user_id = $1"]
        params: list[Any] = [user_id]

        if product_id is not None:
            params.append(product_id)
            conditions.append(f"product_id = ${len(params)}")
        if operation is not None:
            params.append(operation)
            conditions.append(f"operation = ${len(params)}")

        where_clause = " AND ".join(conditions)
        limit_param = len(params) + 1
        offset_param = len(params) + 2

        rows = await self.pool.fetch(
            f"""SELECT id, user_id, product_id, operation, before_state,
                       after_state, source, metadata, snapshot_id, created_at
                FROM portfolio_changes
                WHERE {where_clause}
                ORDER BY created_at DESC
                LIMIT ${limit_param} OFFSET ${offset_param}""",
            *params,
            limit,
            offset,
        )
        total = await self.pool.fetchval(
            f"SELECT count(*) FROM portfolio_changes WHERE {where_clause}",
            *params,
        )

        changes = [self._row_to_change(r) for r in rows]
        return {
            "changes": changes,
            "total": total,
            "has_more": offset + len(changes) < total,
        }

    def _row_to_change(self, row: asyncpg.Record) -> dict:
        return {
            "id": str(row["id"]),
            "user_id": str(row["user_id"]),
            "product_id": row["product_id"],
            "operation": row["operation"],
            "before_state": self._jsonb(row["before_state"]),
            "after_state": self._jsonb(row["after_state"]),
            "source": row["source"],
            "metadata": self._jsonb(row["metadata"]),
            "snapshot_id": str(row["snapshot_id"]) if row["snapshot_id"] else None,
            "created_at": row["created_at"].isoformat(),
        }

    def _row_to_snapshot_summary(self, row: asyncpg.Record) -> dict:
        return {
            "id": str(row["id"]),
            "user_id": str(row["user_id"]),
            "name": row["name"],
            "description": row["description"],
            "product_count": row["product_count"],
            "total_amount": float(row["total_amount"]),
            "category_summary": self._jsonb(row["category_summary"]) if row.get("category_summary") else [],
            "created_at": row["created_at"].isoformat(),
        }

    def _row_to_product(self, row: asyncpg.Record) -> Product:
        """Mirrors `ProductRepository._row_to_product` (`db/repository.py`)
        so a materialized snapshot product carries the exact same field
        set as a live `Product`."""
        raw = row["underlying"]
        if isinstance(raw, str):
            raw = json.loads(raw)
        return Product(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            name=row["name"],
            provider=row["provider"],
            amount=float(row["amount"]),
            category=row["category"],
            underlying=[AssetAllocation(**a) for a in (raw or [])],
            asset_class=row.get("asset_class", "") or "",
            geographic_focus=row.get("geographic_focus", "") or "",
            commission=row.get("commission", "") or "",
            currency=row.get("currency", "") or "",
            administrator=row.get("administrator", "") or "",
            manager=row.get("manager", "") or "",
            liquidity=row.get("liquidity", "") or "",
            return_rate=row.get("return_rate", "") or "",
            catalog_product_id=row.get("catalog_product_id"),
        )

    @staticmethod
    def _jsonb(value: Any) -> Any:
        return json.loads(value) if isinstance(value, str) else value

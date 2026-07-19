from __future__ import annotations

import json
import uuid

import asyncpg

from db.models import AssetAllocation, Product, ProductCreate, ProductUpdate


class ProductRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def list_by_user(self, user_id: str) -> list[Product]:
        rows = await self.pool.fetch(
            "SELECT * FROM products WHERE user_id = $1 ORDER BY created_at",
            user_id,
        )
        return [self._row_to_product(r) for r in rows]

    async def get(self, product_id: str) -> Product | None:
        row = await self.pool.fetchrow(
            "SELECT * FROM products WHERE id = $1", product_id
        )
        return self._row_to_product(row) if row else None

    async def create(
        self,
        user_id: str,
        data: ProductCreate,
        *,
        source: str = "api",
        metadata: dict | None = None,
        conn: asyncpg.Connection | None = None,
    ) -> Product:
        """Insert a product and log the mutation in one transaction.

        `source`/`metadata` attribute the change (agent tool, REST API, or
        admin action — `sdd/portfolio-versioning/design.md` ADR-4). When
        `conn` is not passed, a connection is acquired from the pool and the
        insert + audit log are wrapped in a single transaction (ADR-1). When
        `conn` is passed, the caller owns the surrounding transaction.
        """
        if conn is not None:
            return await self._create_impl(conn, user_id, data, source, metadata)
        async with self.pool.acquire() as acquired_conn:
            async with acquired_conn.transaction():
                return await self._create_impl(
                    acquired_conn, user_id, data, source, metadata
                )

    async def _create_impl(
        self,
        conn: asyncpg.Connection,
        user_id: str,
        data: ProductCreate,
        source: str,
        metadata: dict | None,
    ) -> Product:
        product_id = f"prod_{uuid.uuid4().hex[:8]}"
        await conn.execute(
            """INSERT INTO products
               (id, user_id, name, provider, amount, category, subcategory,
                composition, asset_class, geographic_focus, underlying,
                commission, currency, administrator, manager, liquidity,
                return_rate, catalog_product_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)""",
            product_id,
            user_id,
            data.name,
            data.provider,
            data.amount,
            data.category,
            data.subcategory,
            json.dumps([a.model_dump() for a in data.composition]),
            data.asset_class,
            data.geographic_focus,
            data.underlying,
            data.commission,
            data.currency,
            data.administrator,
            data.manager,
            data.liquidity,
            data.return_rate,
            data.catalog_product_id,
        )
        product = Product(id=product_id, user_id=user_id, **data.model_dump())
        await self._log_change(
            conn,
            user_id=user_id,
            product_id=product_id,
            operation="create",
            before_state=None,
            after_state=product.model_dump(),
            source=source,
            metadata=metadata,
        )
        return product

    async def update(
        self,
        product_id: str,
        data: ProductUpdate,
        *,
        source: str = "api",
        metadata: dict | None = None,
        conn: asyncpg.Connection | None = None,
    ) -> Product | None:
        """Update a product and log the mutation in one transaction.

        Returns `None` without inserting a change-log row when `product_id`
        does not exist (AL-002 "No-op update"). See `create()` for
        `source`/`metadata`/`conn` semantics.
        """
        if conn is not None:
            return await self._update_impl(conn, product_id, data, source, metadata)
        async with self.pool.acquire() as acquired_conn:
            async with acquired_conn.transaction():
                return await self._update_impl(
                    acquired_conn, product_id, data, source, metadata
                )

    async def _update_impl(
        self,
        conn: asyncpg.Connection,
        product_id: str,
        data: ProductUpdate,
        source: str,
        metadata: dict | None,
    ) -> Product | None:
        before_row = await conn.fetchrow(
            "SELECT * FROM products WHERE id = $1 FOR UPDATE", product_id
        )
        if before_row is None:
            return None
        before_product = self._row_to_product(before_row)

        updates = data.model_dump(exclude_none=True)
        if "composition" in updates:
            updates["composition"] = json.dumps(
                [a.model_dump() for a in data.composition]
            )
        if not updates:
            return before_product

        set_parts = []
        values = [product_id]
        for i, (key, val) in enumerate(updates.items(), start=2):
            set_parts.append(f"{key} = ${i}")
            values.append(val)
        set_clause = ", ".join(set_parts) + ", updated_at = now()"

        row = await conn.fetchrow(
            f"UPDATE products SET {set_clause} WHERE id = $1 RETURNING *",
            *values,
        )
        if row is None:
            return None
        after_product = self._row_to_product(row)
        await self._log_change(
            conn,
            user_id=after_product.user_id,
            product_id=product_id,
            operation="update",
            before_state=before_product.model_dump(),
            after_state=after_product.model_dump(),
            source=source,
            metadata=metadata,
        )
        return after_product

    async def delete(
        self,
        product_id: str,
        *,
        source: str = "api",
        metadata: dict | None = None,
        conn: asyncpg.Connection | None = None,
    ) -> bool:
        """Delete a product and log the mutation in one transaction.

        Returns `False` without inserting a change-log row when
        `product_id` does not exist (AL-003 "Deleting a non-existent
        product"). See `create()` for `source`/`metadata`/`conn` semantics.
        """
        if conn is not None:
            return await self._delete_impl(conn, product_id, source, metadata)
        async with self.pool.acquire() as acquired_conn:
            async with acquired_conn.transaction():
                return await self._delete_impl(
                    acquired_conn, product_id, source, metadata
                )

    async def _delete_impl(
        self,
        conn: asyncpg.Connection,
        product_id: str,
        source: str,
        metadata: dict | None,
    ) -> bool:
        before_row = await conn.fetchrow(
            "SELECT * FROM products WHERE id = $1 FOR UPDATE", product_id
        )
        if before_row is None:
            return False
        before_product = self._row_to_product(before_row)

        result = await conn.execute("DELETE FROM products WHERE id = $1", product_id)
        if result != "DELETE 1":
            return False

        await self._log_change(
            conn,
            user_id=before_product.user_id,
            product_id=product_id,
            operation="delete",
            before_state=before_product.model_dump(),
            after_state=None,
            source=source,
            metadata=metadata,
        )
        return True

    async def _log_change(
        self,
        conn: asyncpg.Connection,
        *,
        user_id: str,
        product_id: str | None,
        operation: str,
        before_state: dict | None,
        after_state: dict | None,
        source: str,
        metadata: dict | None = None,
        snapshot_id: str | None = None,
    ) -> None:
        """Insert one `portfolio_changes` audit row within the caller's
        transaction (`sdd/portfolio-versioning/design.md` ADR-1/ADR-4)."""
        await conn.execute(
            """INSERT INTO portfolio_changes
               (user_id, product_id, operation, before_state, after_state,
                source, metadata, snapshot_id)
               VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, $8)""",
            user_id,
            product_id,
            operation,
            json.dumps(before_state) if before_state is not None else None,
            json.dumps(after_state) if after_state is not None else None,
            source,
            json.dumps(metadata or {}),
            snapshot_id,
        )

    async def get_summary(self, user_id: str) -> dict:
        products = await self.list_by_user(user_id)
        total = sum(p.amount for p in products)
        by_category: dict[str, list[Product]] = {}
        for p in products:
            by_category.setdefault(p.category, []).append(p)
        distribution = {
            cat: sum(p.amount for p in prods) / total * 100 if total else 0
            for cat, prods in by_category.items()
        }
        largest = max(products, key=lambda p: p.amount) if products else None
        return {
            "total_amount": total,
            "product_count": len(products),
            "categories_used": list(by_category.keys()),
            "distribution": distribution,
            "largest_position": (
                {"name": largest.name, "percentage": largest.amount / total * 100}
                if largest
                else None
            ),
        }

    def _row_to_product(self, row: asyncpg.Record) -> Product:
        comp = row["composition"]
        if isinstance(comp, str):
            comp = json.loads(comp)
        return Product(
            id=str(row["id"]),
            user_id=str(row["user_id"]),
            name=row["name"],
            provider=row["provider"],
            amount=float(row["amount"]),
            category=row["category"],
            subcategory=row["subcategory"] or "",
            composition=[AssetAllocation(**a) for a in (comp or [])],
            asset_class=row.get("asset_class", "") or "",
            geographic_focus=row.get("geographic_focus", "") or "",
            underlying=row.get("underlying", "") or "",
            commission=row.get("commission", "") or "",
            currency=row.get("currency", "") or "",
            administrator=row.get("administrator", "") or "",
            manager=row.get("manager", "") or "",
            liquidity=row.get("liquidity", "") or "",
            return_rate=row.get("return_rate", "") or "",
            catalog_product_id=row.get("catalog_product_id"),
        )

from __future__ import annotations

import json
import uuid

import asyncpg

from db.models import AssetAllocation, Product, ProductCreate, ProductUpdate


class ProductRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def list_by_portfolio(self, portfolio_id: str) -> list[Product]:
        rows = await self.pool.fetch(
            "SELECT * FROM products WHERE portfolio_id = $1 ORDER BY created_at",
            portfolio_id,
        )
        return [self._row_to_product(r) for r in rows]

    async def get(self, product_id: str) -> Product | None:
        row = await self.pool.fetchrow(
            "SELECT * FROM products WHERE id = $1", product_id
        )
        return self._row_to_product(row) if row else None

    async def create(self, portfolio_id: str, data: ProductCreate) -> Product:
        product_id = f"prod_{uuid.uuid4().hex[:8]}"
        await self.pool.execute(
            """INSERT INTO products (id, portfolio_id, name, provider, amount, category, composition)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            product_id,
            portfolio_id,
            data.name,
            data.provider,
            data.amount,
            data.category,
            json.dumps([a.model_dump() for a in data.composition]),
        )
        return Product(id=product_id, portfolio_id=portfolio_id, **data.model_dump())

    async def update(self, product_id: str, data: ProductUpdate) -> Product | None:
        updates = data.model_dump(exclude_none=True)
        if "composition" in updates:
            updates["composition"] = json.dumps(
                [a.model_dump() for a in data.composition]
            )
        if not updates:
            return await self.get(product_id)

        set_parts = []
        values = [product_id]
        for i, (key, val) in enumerate(updates.items(), start=2):
            set_parts.append(f"{key} = ${i}")
            values.append(val)
        set_clause = ", ".join(set_parts) + ", updated_at = now()"

        row = await self.pool.fetchrow(
            f"UPDATE products SET {set_clause} WHERE id = $1 RETURNING *",
            *values,
        )
        return self._row_to_product(row) if row else None

    async def delete(self, product_id: str) -> bool:
        result = await self.pool.execute(
            "DELETE FROM products WHERE id = $1", product_id
        )
        return result == "DELETE 1"

    async def get_summary(self, portfolio_id: str) -> dict:
        products = await self.list_by_portfolio(portfolio_id)
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
            id=row["id"],
            portfolio_id=row["portfolio_id"],
            name=row["name"],
            provider=row["provider"],
            amount=float(row["amount"]),
            category=row["category"],
            composition=[AssetAllocation(**a) for a in (comp or [])],
        )

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

    async def create(self, user_id: str, data: ProductCreate) -> Product:
        product_id = f"prod_{uuid.uuid4().hex[:8]}"
        await self.pool.execute(
            """INSERT INTO products
               (id, user_id, name, provider, amount, category, subcategory,
                composition, asset_class, geographic_focus, underlying,
                commission, currency, administrator, manager, liquidity,
                return_rate)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)""",
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
        )
        return Product(id=product_id, user_id=user_id, **data.model_dump())

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
        )

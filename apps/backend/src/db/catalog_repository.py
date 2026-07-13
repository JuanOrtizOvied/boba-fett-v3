from __future__ import annotations

import asyncpg

from db.models import CatalogProduct


class CatalogRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def search(self, query: str, limit: int = 5) -> list[CatalogProduct]:
        rows = await self.pool.fetch(
            """
            SELECT *,
                GREATEST(
                    similarity(name, $1),
                    similarity(COALESCE(underlying, ''), $1),
                    similarity(COALESCE(administrator, ''), $1)
                ) AS sim
            FROM product_catalog
            WHERE
                similarity(name, $1) > 0.1
                OR similarity(COALESCE(underlying, ''), $1) > 0.1
                OR name ILIKE '%' || $1 || '%'
                OR COALESCE(underlying, '') ILIKE '%' || $1 || '%'
                OR COALESCE(asset_class, '') ILIKE '%' || $1 || '%'
            ORDER BY sim DESC
            LIMIT $2
            """,
            query,
            limit,
        )
        return [self._row_to_catalog_product(r) for r in rows]

    def _row_to_catalog_product(self, row: asyncpg.Record) -> CatalogProduct:
        return CatalogProduct(
            id=row["id"],
            name=row["name"],
            geographic_focus=row["geographic_focus"] or "",
            asset_class=row["asset_class"] or "",
            underlying=row["underlying"] or "",
            commission=row["commission"] or "",
            currency=row["currency"] or "",
            administrator=row["administrator"] or "",
            manager=row["manager"] or "",
            liquidity=row["liquidity"] or "",
            return_rate=row["return_rate"] or "",
            category=row["category"] or "",
            subcategory=row["subcategory"] or "",
        )

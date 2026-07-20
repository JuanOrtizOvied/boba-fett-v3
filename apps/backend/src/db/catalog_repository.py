from __future__ import annotations

import json

import asyncpg

from db.models import AssetAllocation, CatalogProduct, CatalogProductCreate, CatalogProductUpdate


class CatalogRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def list_all(self) -> list[CatalogProduct]:
        rows = await self.pool.fetch("SELECT * FROM product_catalog ORDER BY id")
        return [self._row_to_catalog_product(r) for r in rows]

    async def insert_if_not_duplicate(
        self, data: CatalogProductCreate
    ) -> CatalogProduct | None:
        """Insert a new catalog entry unless a normalized match already
        exists (`sdd/product-catalog-approval/design` — "Duplicate Detection
        SQL"). Matching is on name + category + asset_class, trimmed and
        case-insensitive. Returns `None` when a duplicate is found instead
        of inserting."""
        existing = await self.pool.fetchrow(
            """
            SELECT id FROM product_catalog
            WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
              AND LOWER(TRIM(COALESCE(category, ''))) = LOWER(TRIM($2))
              AND LOWER(TRIM(COALESCE(asset_class, ''))) = LOWER(TRIM($3))
            LIMIT 1
            """,
            data.name,
            data.category,
            data.asset_class,
        )
        if existing is not None:
            return None

        row = await self.pool.fetchrow(
            """
            INSERT INTO product_catalog
                (name, category, asset_class, geographic_focus,
                 underlying, commission, currency, administrator, manager,
                 liquidity, return_rate, approved_from_product_id,
                 alternative_names, approved_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
            RETURNING *
            """,
            data.name,
            data.category,
            data.asset_class,
            data.geographic_focus,
            json.dumps([a.model_dump() for a in data.underlying]),
            data.commission,
            data.currency,
            data.administrator,
            data.manager,
            data.liquidity,
            data.return_rate,
            data.approved_from_product_id,
            data.alternative_names,
        )
        return self._row_to_catalog_product(row)

    async def replace_from_approval(
        self, catalog_id: int, data: CatalogProductCreate
    ) -> CatalogProduct | None:
        row = await self.pool.fetchrow(
            """
            UPDATE product_catalog
            SET name = $2,
                category = $3,
                asset_class = $4,
                geographic_focus = $5,
                underlying = $6,
                commission = $7,
                currency = $8,
                administrator = $9,
                manager = $10,
                liquidity = $11,
                return_rate = $12,
                approved_from_product_id = $13,
                alternative_names = CASE
                    WHEN cardinality($14::text[]) > 0 THEN $14
                    ELSE alternative_names
                END,
                approved_at = now()
            WHERE id = $1
            RETURNING *
            """,
            catalog_id,
            data.name,
            data.category,
            data.asset_class,
            data.geographic_focus,
            json.dumps([a.model_dump() for a in data.underlying]),
            data.commission,
            data.currency,
            data.administrator,
            data.manager,
            data.liquidity,
            data.return_rate,
            data.approved_from_product_id,
            data.alternative_names,
        )
        return self._row_to_catalog_product(row) if row else None

    async def update(
        self, catalog_id: int, data: CatalogProductUpdate
    ) -> CatalogProduct | None:
        fields = data.model_dump(exclude_none=True)
        if "underlying" in fields:
            fields["underlying"] = json.dumps(
                [a.model_dump() for a in data.underlying]
            )
        if not fields:
            row = await self.pool.fetchrow(
                "SELECT * FROM product_catalog WHERE id = $1", catalog_id
            )
            return self._row_to_catalog_product(row) if row else None
        set_clause = ", ".join(f"{k} = ${i + 2}" for i, k in enumerate(fields))
        values = [catalog_id, *fields.values()]
        row = await self.pool.fetchrow(
            f"UPDATE product_catalog SET {set_clause} WHERE id = $1 RETURNING *",
            *values,
        )
        return self._row_to_catalog_product(row) if row else None

    async def delete(self, catalog_id: int) -> bool:
        row = await self.pool.fetchrow(
            "DELETE FROM product_catalog WHERE id = $1 RETURNING id", catalog_id
        )
        return row is not None

    async def search(self, query: str, limit: int = 5) -> list[CatalogProduct]:
        rows = await self.pool.fetch(
            """
            SELECT pc.*,
                GREATEST(
                    similarity(name, $1),
                    similarity(COALESCE(administrator, ''), $1),
                    COALESCE((
                        SELECT MAX(similarity(alt, $1))
                        FROM unnest(alternative_names) AS alt
                    ), 0)
                ) AS sim
            FROM product_catalog pc
            WHERE
                similarity(name, $1) > 0.1
                OR name ILIKE '%' || $1 || '%'
                OR COALESCE(asset_class, '') ILIKE '%' || $1 || '%'
                OR EXISTS (
                    SELECT 1 FROM unnest(alternative_names) AS alt
                    WHERE similarity(alt, $1) > 0.1
                       OR alt ILIKE '%' || $1 || '%'
                )
            ORDER BY sim DESC
            LIMIT $2
            """,
            query,
            limit,
        )
        return [self._row_to_catalog_product(r) for r in rows]

    def _row_to_catalog_product(self, row: asyncpg.Record) -> CatalogProduct:
        raw = row["underlying"]
        if isinstance(raw, str):
            raw = json.loads(raw)
        return CatalogProduct(
            id=row["id"],
            name=row["name"],
            geographic_focus=row["geographic_focus"] or "",
            asset_class=row["asset_class"] or "",
            underlying=[AssetAllocation(**a) for a in (raw or [])],
            commission=row["commission"] or "",
            currency=row["currency"] or "",
            administrator=row["administrator"] or "",
            manager=row["manager"] or "",
            liquidity=row["liquidity"] or "",
            return_rate=row["return_rate"] or "",
            category=row["category"] or "",
            alternative_names=list(row["alternative_names"] or []),
            approved_from_product_id=row["approved_from_product_id"],
            approved_at=(
                row["approved_at"].isoformat() if row["approved_at"] is not None else None
            ),
        )

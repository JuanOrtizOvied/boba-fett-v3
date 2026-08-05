from __future__ import annotations

import json

import asyncpg
from sqlalchemy import Column, Integer, MetaData, Table, Text, case, func, or_, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text

from db.models import AssetAllocation, CatalogProduct, CatalogProductCreate, CatalogProductUpdate

# Define the table object for SQLAlchemy Core expressions
metadata = MetaData()
product_catalog_table = Table(
    "product_catalog",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", Text, nullable=False),
    Column("geographic_focus", postgresql.JSONB, server_default=text("'[]'::jsonb")),
    Column("asset_class", postgresql.JSONB, server_default=text("'[]'::jsonb")),
    Column("underlying", postgresql.JSONB, server_default=text("'[]'::jsonb")),
    Column("commission", Text, server_default=""),
    Column("currency", Text, server_default=""),
    Column("administrator", Text, server_default=""),
    Column("manager", Text, server_default=""),
    Column("liquidity", Text, server_default=""),
    Column("return_rate", Text, server_default=""),
    Column("approved_from_product_id", Text()),
    Column("approved_at", Text()),
    Column("alternative_names", postgresql.ARRAY(Text), server_default=text("'{}'::text[]")),
)

class CatalogRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def get_catalog(self, search: str | None, limit: int, offset: int) -> list[dict]:
        """Fetches the product catalog with optional search and pagination.

        Uses SQLAlchemy Core for expression construction.
        The name column has a trigram index; aliases are searched functionally.
        """
        # Base selection
        query = select(product_catalog_table)

        if search:
            # Normalize the search input
            normalized_input = func.normalize_catalog_text(search)

            # The name column can leverage the trigram index.
            # Alias searching remains functional because alternative_names
            # cannot be indexed using the previous expression strategy.

            name_match = product_catalog_table.c.name.ilike(
                func.concat("%", search, "%")
            )

            alt_names_match = func.normalize_catalog_text(
                func.array_to_string(
                    func.coalesce(
                        product_catalog_table.c.alternative_names,
                        postgresql.array([], type_=Text)
                    ),
                    " "
                )
            ).like(func.concat("%", normalized_input, "%"))

            query = query.where(
                or_(
                    name_match,
                    alt_names_match
                )
            )

            # Ranking logic
            # 1. Exact Match
            # 2. Starts With
            # 3. Contains (Default)
            name_norm = func.normalize_catalog_text(product_catalog_table.c.name)
            exact_match = (name_norm == normalized_input, 1)
            starts_with = (name_norm.like(func.concat(normalized_input, "%")), 2)

            query = query.order_by(
                case(
                    exact_match,
                    starts_with,
                    else_=3
                ),
                product_catalog_table.c.name.asc()
            )
        else:
            query = query.order_by(product_catalog_table.c.name.asc())

        query = query.limit(limit).offset(offset)

        # Compile to SQL string
        # Note: Since we use asyncpg directly, we compile the expression to a string.
        # In a full SQLAlchemy migration, we would use the engine to execute.
        dialect = postgresql.dialect()
        statement = query.compile(dialect=dialect, compile_kwargs={"literal_binds": True})
        sql_string = str(statement)

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(sql_string)
            return [self._normalize_row(r) for r in rows]

    @staticmethod
    def _normalize_row(row: asyncpg.Record) -> dict:
        """asyncpg devuelve JSONB como string; se parsea para que el
        frontend reciba arrays/objetos según el contrato de CatalogProduct."""
        d = dict(row)
        for field in ("geographic_focus", "asset_class", "underlying"):
            raw = d.get(field)
            if isinstance(raw, str):
                d[field] = json.loads(raw)
            elif raw is None:
                d[field] = []
        d["alternative_names"] = list(d.get("alternative_names") or [])
        approved_at = d.get("approved_at")
        if approved_at is not None and not isinstance(approved_at, str):
            d["approved_at"] = approved_at.isoformat()
        return d


    async def list_all(self) -> list[CatalogProduct]:
        rows = await self.pool.fetch("SELECT * FROM product_catalog ORDER BY id")
        return [self._row_to_catalog_product(r) for r in rows]

    async def insert_if_not_duplicate(
        self, data: CatalogProductCreate
    ) -> CatalogProduct | None:
        """Insert a new catalog entry unless a normalized match already
        exists (`sdd/product-catalog-approval/design` — "Duplicate Detection
        SQL"). Matching is on name + asset_class, trimmed and
        case-insensitive. Returns `None` when a duplicate is found instead
        of inserting."""
        asset_class_json = json.dumps([a.model_dump() for a in data.asset_class])
        existing = await self.pool.fetchrow(
            """
            SELECT id FROM product_catalog
            WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
              AND asset_class = $2::jsonb
            LIMIT 1
            """,
            data.name,
            asset_class_json,
        )
        if existing is not None:
            return None

        row = await self.pool.fetchrow(
            """
            INSERT INTO product_catalog
                (name, asset_class, geographic_focus,
                 underlying, commission, currency, administrator, manager,
                 liquidity, return_rate, approved_from_product_id,
                 alternative_names, approved_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
            RETURNING *
            """,
            data.name,
            asset_class_json,
            json.dumps([a.model_dump() for a in data.geographic_focus]),
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
                asset_class = $3,
                geographic_focus = $4,
                underlying = $5,
                commission = $6,
                currency = $7,
                administrator = $8,
                manager = $9,
                liquidity = $10,
                return_rate = $11,
                approved_from_product_id = $12,
                alternative_names = CASE
                    WHEN cardinality($13::text[]) > 0 THEN $13
                    ELSE alternative_names
                END,
                approved_at = now()
            WHERE id = $1
            RETURNING *
            """,
            catalog_id,
            data.name,
            json.dumps([a.model_dump() for a in data.asset_class]),
            json.dumps([a.model_dump() for a in data.geographic_focus]),
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
        if "geographic_focus" in fields:
            fields["geographic_focus"] = json.dumps(
                [a.model_dump() for a in data.geographic_focus]
            )
        if "asset_class" in fields:
            fields["asset_class"] = json.dumps(
                [a.model_dump() for a in data.asset_class]
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
                OR asset_class::text ILIKE '%' || $1 || '%'
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

    @staticmethod
    def _parse_json_allocations(raw: object) -> list[AssetAllocation]:
        if isinstance(raw, str):
            raw = json.loads(raw)
        return [AssetAllocation(**a) for a in (raw or [])]

    def _row_to_catalog_product(self, row: asyncpg.Record) -> CatalogProduct:
        raw = row["underlying"]
        if isinstance(raw, str):
            raw = json.loads(raw)
        return CatalogProduct(
            id=row["id"],
            name=row["name"],
            geographic_focus=self._parse_json_allocations(row["geographic_focus"]),
            asset_class=self._parse_json_allocations(row["asset_class"]),
            underlying=[AssetAllocation(**a) for a in (raw or [])],
            commission=row["commission"] or "",
            currency=row["currency"] or "",
            administrator=row["administrator"] or "",
            manager=row["manager"] or "",
            liquidity=row["liquidity"] or "",
            return_rate=row["return_rate"] or "",
            alternative_names=list(row["alternative_names"] or []),
            approved_from_product_id=row["approved_from_product_id"],
            approved_at=(
                row["approved_at"].isoformat() if row["approved_at"] is not None else None
            ),
        )

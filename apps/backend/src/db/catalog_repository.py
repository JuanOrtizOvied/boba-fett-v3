from __future__ import annotations

import json

import asyncpg
from sqlalchemy import Column, Integer, MetaData, Table, Text, case, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import text

from db.models import (
    Administrator,
    AssetAllocation,
    CatalogProduct,
    CatalogProductCreate,
    CatalogProductUpdate,
    Manager,
)


# `slugs` is server-computed, never client-supplied: name + alternative_names,
# each run through normalize_catalog_text (lower + unaccent, defined in the
# `enable_search_extensions` migration), deduplicated. Expressed as a raw SQL
# fragment (not Python) so every write path — insert, approval-replace, and
# the dynamic update() — derives it identically to the migration backfill.
def _slugs_expr(name_expr: str, alternative_names_expr: str) -> str:
    return (
        "(SELECT COALESCE(ARRAY_AGG(DISTINCT normalize_catalog_text(btrim(v))), '{}') "
        f"FROM unnest(array_prepend({name_expr}, {alternative_names_expr})) AS v "
        "WHERE v IS NOT NULL AND btrim(v) <> '')"
    )


def _pg_text_array_literal(values: list[str]) -> str:
    """Safely-escaped `ARRAY[...]::text[]` literal for embedding directly
    into a compiled SQL string. `get_catalog` compiles with
    `literal_binds=True` and executes the resulting string via
    `conn.fetch`, with no separate bind params — this fragment isn't
    covered by SQLAlchemy's own literal rendering because it targets a
    Postgres-specific function (`jsonb_array_elements`) SQLAlchemy Core
    doesn't model, so escaping is done by hand here."""
    quoted = ", ".join("'" + v.replace("'", "''") + "'" for v in values)
    return f"ARRAY[{quoted}]::text[]"


def _allocation_filter_clause(column_expr: str, values: list[str]):
    """`EXISTS` clause matching an entry with at least one allocation
    element (`asset_class`/`geographic_focus`/`underlying`, each a JSONB
    array of `{name, percentage}`) whose `name` is in `values` — "any
    element's name is in the selected set", not exact array equality
    (design.md ADR-5). Case/whitespace-insensitive, same reasoning as
    `_ci_in_clause` below."""
    normalized = [v.strip().lower() for v in values]
    array_literal = _pg_text_array_literal(normalized)
    return text(
        f"EXISTS (SELECT 1 FROM jsonb_array_elements({column_expr}) AS elem "
        f"WHERE LOWER(TRIM(elem->>'name')) = ANY({array_literal}))"
    )


def _ci_in_clause(column, values: list[str]):
    """Case/whitespace-insensitive `IN` match for scalar filter fields
    (`currency`, `administrator`, `manager`). Mirrors the `LOWER(TRIM(name))`
    normalization `insert_if_not_duplicate` and
    `create_administrator`/`create_manager` already use elsewhere in this
    file. Needed because these are free-text fields with no format
    enforcement on create — `CatalogProductCreate` doesn't validate
    `currency` against `CURRENCY_OPTIONS`, only `CatalogProductUpdate`
    does — so legacy rows can carry inconsistent casing (e.g. `"dólares"`
    vs `"Dólares"`) that would otherwise silently fail to match a
    canonically-cased filter option (confirmed against real data:
    2026-09-22)."""
    normalized = [v.strip().lower() for v in values]
    return func.lower(func.trim(column)).in_(normalized)


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
    Column("isin", Text, server_default=""),
    Column("distribution", Text, server_default=""),
    Column("approved_from_product_id", Text()),
    Column("approved_at", Text()),
    Column("alternative_names", postgresql.ARRAY(Text), server_default=text("'{}'::text[]")),
    Column("slugs", postgresql.ARRAY(Text), server_default=text("'{}'::text[]")),
)

class CatalogRepository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def get_catalog(
        self,
        search: str | None,
        limit: int,
        offset: int,
        *,
        currency: list[str] | None = None,
        administrator: list[str] | None = None,
        manager: list[str] | None = None,
        asset_class: list[str] | None = None,
        geographic_focus: list[str] | None = None,
        underlying: list[str] | None = None,
    ) -> list[dict]:
        """Fetches the product catalog with optional search, field filters,
        and pagination (`openspec/changes/catalog-export-and-filters` —
        "Catalog Listing").

        Uses SQLAlchemy Core for expression construction. Matches against
        `slugs` — the server-computed, already-normalized (lower + unaccent)
        array of name + alternative_names (see `_slugs_expr`) — instead of
        querying `name`/`alternative_names` separately. This also fixes
        accent-insensitivity for `name` itself (the old `name ILIKE` branch
        never ran `normalize_catalog_text`, so an unaccented query missed
        accented names unless an alias happened to carry the match).
        `idx_catalog_slugs_trgm` (see migrations) indexes this exact
        `catalog_slugs_text(slugs)` expression — `array_to_string` itself is
        STABLE, not IMMUTABLE, so it can't be indexed directly (42P17);
        `catalog_slugs_text` is a thin SQL wrapper declared IMMUTABLE.

        Every filter kwarg accepts multiple values: values within one field
        combine with OR (`IN (...)` for scalar fields, `= ANY(...)` against
        each JSONB element's `name` for allocation fields), while different
        filter fields — and `search` — combine with AND (design.md ADR-4,
        ADR-5, ADR-6 in that change).
        """
        # Base selection
        query = select(product_catalog_table)

        if currency:
            query = query.where(_ci_in_clause(product_catalog_table.c.currency, currency))
        if administrator:
            query = query.where(_ci_in_clause(product_catalog_table.c.administrator, administrator))
        if manager:
            query = query.where(_ci_in_clause(product_catalog_table.c.manager, manager))
        if asset_class:
            query = query.where(_allocation_filter_clause("product_catalog.asset_class", asset_class))
        if geographic_focus:
            query = query.where(
                _allocation_filter_clause("product_catalog.geographic_focus", geographic_focus)
            )
        if underlying:
            query = query.where(_allocation_filter_clause("product_catalog.underlying", underlying))

        if search:
            # Normalize the search input
            normalized_input = func.normalize_catalog_text(search)

            # `slugs` elements are already normalized at write time, so no
            # normalize_catalog_text() call is needed on the read side.
            slugs_match = func.catalog_slugs_text(
                product_catalog_table.c.slugs
            ).like(func.concat("%", normalized_input, "%"))

            query = query.where(slugs_match)

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

    async def get_by_ids(self, ids: list[int]) -> list[CatalogProduct]:
        """Fetch catalog entries by id, for selective Excel export
        (`openspec/changes/catalog-export-and-filters` — "Export Selected
        Catalog Entries to Excel"). No pagination — admins select a bounded
        set of rows client-side before exporting."""
        if not ids:
            return []
        rows = await self.pool.fetch(
            "SELECT * FROM product_catalog WHERE id = ANY($1::int[]) ORDER BY id",
            ids,
        )
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
            f"""
            INSERT INTO product_catalog
                (name, asset_class, geographic_focus,
                 underlying, commission, currency, administrator, manager,
                 liquidity, return_rate, isin, distribution,
                 approved_from_product_id,
                 alternative_names, slugs, administrator_score, manager_score, approved_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                {_slugs_expr("$1", "COALESCE($14::text[], '{}'::text[])")}, $15, $16, now())
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
            data.isin,
            data.distribution,
            data.approved_from_product_id,
            data.alternative_names,
            data.administrator_score,
            data.manager_score,
        )
        return self._row_to_catalog_product(row)

    async def replace_from_approval(
        self, catalog_id: int, data: CatalogProductCreate
    ) -> CatalogProduct | None:
        row = await self.pool.fetchrow(
            f"""
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
                isin = $12,
                distribution = $13,
                approved_from_product_id = $14,
                alternative_names = CASE
                    WHEN cardinality($15::text[]) > 0 THEN $15
                    ELSE alternative_names
                END,
                slugs = {_slugs_expr(
                    "$2",
                    "CASE WHEN cardinality($15::text[]) > 0 THEN $15 ELSE alternative_names END",
                )},
                administrator_score = $16,
                manager_score = $17,
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
            data.isin,
            data.distribution,
            data.approved_from_product_id,
            data.alternative_names,
            data.administrator_score,
            data.manager_score,
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

        values: list[object] = [catalog_id]
        placeholders: dict[str, str] = {}
        set_parts: list[str] = []
        for key, value in fields.items():
            values.append(value)
            placeholders[key] = f"${len(values)}"
            set_parts.append(f"{key} = {placeholders[key]}")

        # slugs is derived from name + alternative_names, so it must be
        # recomputed whenever either changes — even if only one of the two
        # is present in this partial update. The side not being updated is
        # read from the table's own (unchanged) column value.
        if "name" in fields or "alternative_names" in fields:
            name_expr = placeholders.get("name", "name")
            alt_expr = (
                f"{placeholders['alternative_names']}::text[]"
                if "alternative_names" in fields
                else "COALESCE(alternative_names, '{}'::text[])"
            )
            set_parts.append(f"slugs = {_slugs_expr(name_expr, alt_expr)}")

        set_clause = ", ".join(set_parts)
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

    async def list_administrators(self) -> list[Administrator]:
        rows = await self.pool.fetch(
            "SELECT id, name, score, score_is_fixed FROM administrator ORDER BY name ASC"
        )
        return [Administrator(**dict(r)) for r in rows]

    async def list_managers(self) -> list[Manager]:
        rows = await self.pool.fetch(
            "SELECT id, name, score FROM manager ORDER BY name ASC"
        )
        return [Manager(**dict(r)) for r in rows]

    async def create_administrator(self, name: str, score: int) -> Administrator | None:
        """Inserts a new administrator (`task_fffceb1e` — persisting
        free-text names typed in the catalog edit modal). Returns `None` on
        a case/whitespace-insensitive duplicate instead of inserting, same
        convention as `insert_if_not_duplicate`. New entries are always
        `score_is_fixed=true` — the "Cash o efectivo" manual-score exception
        is a fixed, pre-seeded special case, not something admins create."""
        existing = await self.pool.fetchrow(
            "SELECT id FROM administrator WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
            name,
        )
        if existing is not None:
            return None
        row = await self.pool.fetchrow(
            """
            INSERT INTO administrator (name, score, score_is_fixed)
            VALUES ($1, $2, true)
            RETURNING id, name, score, score_is_fixed
            """,
            name,
            score,
        )
        return Administrator(**dict(row))

    async def create_manager(self, name: str, score: int) -> Manager | None:
        existing = await self.pool.fetchrow(
            "SELECT id FROM manager WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) LIMIT 1",
            name,
        )
        if existing is not None:
            return None
        row = await self.pool.fetchrow(
            "INSERT INTO manager (name, score) VALUES ($1, $2) RETURNING id, name, score",
            name,
            score,
        )
        return Manager(**dict(row))

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
            isin=row["isin"] or "",
            distribution=row["distribution"] or "",
            alternative_names=list(row["alternative_names"] or []),
            administrator_score=row["administrator_score"],
            manager_score=row["manager_score"],
            slugs=list(row["slugs"] or []),
            approved_from_product_id=row["approved_from_product_id"],
            approved_at=(
                row["approved_at"].isoformat() if row["approved_at"] is not None else None
            ),
        )

"""Read and soft-delete access to the v2 catalog tables.

Plain SQL over asyncpg, like the other repositories. Nothing here removes a
row: deleting is `is_deleted = true` and only the explicit restore reverses
it. The write path used by the workbook sync (insert and update with an
optional shared connection) is added with the sync itself, in Phase 3.
"""

from __future__ import annotations

import json

import asyncpg

from catalog_v2.diff import StoredLink, StoredProduct, StoredSeries, StoredState
from catalog_v2.models import (
    AdministratorLink,
    AdministratorV2,
    Allocation,
    CatalogV2Product,
    CatalogV2ProductDetail,
    EntityRef,
    ManagerV2,
    Series,
)

# Besides its own columns, each product carries a summary of its active series and
# administrators, so the page can compute its observations from the list alone.
_PRODUCT_SELECT = """
    SELECT p.id, p.codigo, p.name, p.isin, p.manager_id,
           COALESCE(m.name, '') AS manager, m.score AS manager_score,
           p.asset_class, p.geographic_focus, p.underlying,
           p.currency, p.investment_horizon, p.is_deleted,
           (SELECT count(*) FROM product_series_v2 s
             WHERE s.product_id = p.id AND NOT s.is_deleted) AS series_count,
           (SELECT count(*) FROM product_series_v2 s
             WHERE s.product_id = p.id AND NOT s.is_deleted
               AND (s.ter IS NULL OR s.return_min IS NULL OR s.return_max IS NULL))
             AS incomplete_series,
           (SELECT COALESCE(json_agg(x ORDER BY x.name), '[]'::json) FROM (
               SELECT DISTINCT a.id, a.name, a.score
               FROM product_series_v2 s
               JOIN product_administrator_v2 l ON l.series_id = s.id
               JOIN administrator_v2 a ON a.id = l.administrator_id
               WHERE s.product_id = p.id AND NOT s.is_deleted AND NOT l.is_deleted
           ) x) AS administrators
    FROM product_catalog_v2 p
    LEFT JOIN manager_v2 m ON m.id = p.manager_id
"""


def _allocations(raw: object) -> list[Allocation]:
    """asyncpg returns JSONB as a string."""
    if isinstance(raw, str):
        raw = json.loads(raw)
    return [Allocation(**item) for item in (raw or [])]


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class CatalogV2Repository:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    @staticmethod
    def _row_to_product(row: asyncpg.Record) -> CatalogV2Product:
        return CatalogV2Product(
            id=row["id"],
            codigo=row["codigo"],
            name=row["name"],
            isin=row["isin"] or "",
            manager_id=row["manager_id"],
            manager=row["manager"] or "",
            manager_score=row["manager_score"],
            asset_class=_allocations(row["asset_class"]),
            geographic_focus=_allocations(row["geographic_focus"]),
            underlying=_allocations(row["underlying"]),
            currency=row["currency"] or "",
            investment_horizon=row["investment_horizon"] or "",
            is_deleted=row["is_deleted"],
            series_count=row["series_count"],
            incomplete_series=row["incomplete_series"],
            administrators=[
                EntityRef(**item) for item in json.loads(row["administrators"] or "[]")
            ],
        )

    async def list_products(
        self,
        search: str | None = None,
        limit: int = 1000,
        offset: int = 0,
        *,
        include_deleted: bool = False,
        manager_ids: list[int] | None = None,
        administrator_ids: list[int] | None = None,
    ) -> list[CatalogV2Product]:
        """Products matching `search`, or ordered by `codigo` without one.

        `search` is accent and case insensitive and matches the normalized name
        (`slugs`, served by a trigram index) or, as typed, the `codigo`, so an
        admin can paste a code from the Excel. `%` and `_` are taken
        literally. Results are ranked: exact name, then names that start with
        the text, then the rest.

        `manager_ids` keeps the products of any of those managers, and
        `administrator_ids` the products with an active link to any of those
        administrators. Several values of one filter combine with OR, and the
        filters and the search combine with AND.
        """
        conditions: list[str] = []
        params: list[object] = []
        order = "p.codigo"
        if not include_deleted:
            conditions.append("p.is_deleted = false")
        if manager_ids:
            params.append(manager_ids)
            conditions.append(f"p.manager_id = ANY(${len(params)}::int[])")
        if administrator_ids:
            params.append(administrator_ids)
            conditions.append(
                "EXISTS (SELECT 1 FROM product_series_v2 s "
                "JOIN product_administrator_v2 l ON l.series_id = s.id "
                f"WHERE s.product_id = p.id AND l.administrator_id = ANY(${len(params)}::int[]) "
                "AND NOT s.is_deleted AND NOT l.is_deleted)"
            )
        text = search.strip() if search else ""
        if text:
            params.append(text)
            raw = f"${len(params)}"
            params.append(_escape_like(text))
            escaped = f"${len(params)}"
            normalized_like = "'%' || normalize_catalog_text_v2(" + escaped + ") || '%'"
            conditions.append(
                f"(catalog_slugs_text_v2(p.slugs) LIKE {normalized_like} ESCAPE '\\' "
                f"OR p.codigo ILIKE '%' || {escaped} || '%' ESCAPE '\\')"
            )
            name_norm = "normalize_catalog_text_v2(p.name)"
            order = (
                f"CASE WHEN {name_norm} = normalize_catalog_text_v2({raw}) THEN 1 "
                f"WHEN {name_norm} LIKE normalize_catalog_text_v2({escaped}) || '%' "
                f"ESCAPE '\\' THEN 2 ELSE 3 END, p.name, p.codigo"
            )
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.extend([limit, offset])
        rows = await self.pool.fetch(
            f"{_PRODUCT_SELECT} {where} ORDER BY {order} "
            f"LIMIT ${len(params) - 1} OFFSET ${len(params)}",
            *params,
        )
        return [self._row_to_product(r) for r in rows]

    async def get_product(
        self, product_id: int, *, include_deleted: bool = False
    ) -> CatalogV2ProductDetail | None:
        """A product with its series and, for each series, its administrator
        links. A deleted series (or link) is left out unless
        `include_deleted`, and a deleted product hides its children from the
        default listing without changing their own flags."""
        row = await self.pool.fetchrow(f"{_PRODUCT_SELECT} WHERE p.id = $1", product_id)
        if row is None or (row["is_deleted"] and not include_deleted):
            return None

        series_rows = await self.pool.fetch(
            "SELECT id, series, ter, flows_min, flows_max, return_min, return_max, is_deleted "
            "FROM product_series_v2 WHERE product_id = $1 "
            + ("" if include_deleted else "AND is_deleted = false ")
            + "ORDER BY series",
            product_id,
        )
        link_rows = await self.pool.fetch(
            "SELECT l.id, l.series_id, l.administrator_id, a.name AS administrator, "
            "a.score AS administrator_score, l.custody, l.buy_commission, l.sell_commission, "
            "l.minimum_usd, l.min_commission_usd, l.is_deleted "
            "FROM product_administrator_v2 l "
            "JOIN administrator_v2 a ON a.id = l.administrator_id "
            "JOIN product_series_v2 s ON s.id = l.series_id "
            "WHERE s.product_id = $1 "
            + ("" if include_deleted else "AND l.is_deleted = false ")
            + "ORDER BY a.name",
            product_id,
        )
        links_by_series: dict[int, list[AdministratorLink]] = {}
        for link in link_rows:
            links_by_series.setdefault(link["series_id"], []).append(
                AdministratorLink(**{k: link[k] for k in link.keys() if k != "series_id"})
            )

        base = self._row_to_product(row)
        return CatalogV2ProductDetail(
            **base.model_dump(),
            series=[
                Series(
                    **{k: s[k] for k in s.keys()},
                    administrators=links_by_series.get(s["id"], []),
                )
                for s in series_rows
            ],
        )

    async def delete_product(self, product_id: int) -> bool:
        """Soft delete. `True` when the id exists (deleting an already
        deleted product still succeeds), `False` for an unknown id."""
        row = await self.pool.fetchrow(
            "UPDATE product_catalog_v2 SET is_deleted = true, updated_at = now() "
            "WHERE id = $1 RETURNING id",
            product_id,
        )
        return row is not None

    async def restore_product(self, product_id: int) -> CatalogV2Product | None:
        """Reactivate a deleted product. `None` when the id does not exist or
        the product is not deleted. The workbook sync never does this."""
        updated = await self.pool.fetchrow(
            "UPDATE product_catalog_v2 SET is_deleted = false, updated_at = now() "
            "WHERE id = $1 AND is_deleted = true RETURNING id",
            product_id,
        )
        if updated is None:
            return None
        row = await self.pool.fetchrow(f"{_PRODUCT_SELECT} WHERE p.id = $1", product_id)
        return self._row_to_product(row) if row else None

    async def load_state(
        self, conn: asyncpg.Connection | asyncpg.Pool | None = None
    ) -> StoredState:
        """A snapshot of every v2 row, deleted ones included, in the shape the
        diff compares against: composites as lists of name and percentage, the
        manager as its name and numbers as stored. Pass the connection of a
        transaction to read inside it."""
        db = conn or self.pool
        products = await db.fetch(
            "SELECT p.id, p.codigo, p.name, p.isin, COALESCE(m.name, '') AS manager, "
            "p.asset_class, p.geographic_focus, p.underlying, p.currency, "
            "p.investment_horizon, p.is_deleted "
            "FROM product_catalog_v2 p LEFT JOIN manager_v2 m ON m.id = p.manager_id"
        )
        series = await db.fetch(
            "SELECT s.id, p.codigo, s.series, s.ter, s.flows_min, s.flows_max, "
            "s.return_min, s.return_max, s.is_deleted "
            "FROM product_series_v2 s JOIN product_catalog_v2 p ON p.id = s.product_id"
        )
        links = await db.fetch(
            "SELECT l.id, p.codigo, s.series, a.name AS administrator, l.custody, "
            "l.buy_commission, l.sell_commission, l.minimum_usd, l.min_commission_usd, "
            "l.is_deleted "
            "FROM product_administrator_v2 l "
            "JOIN product_series_v2 s ON s.id = l.series_id "
            "JOIN product_catalog_v2 p ON p.id = s.product_id "
            "JOIN administrator_v2 a ON a.id = l.administrator_id"
        )
        managers = await db.fetch("SELECT name FROM manager_v2 ORDER BY name")
        administrators = await db.fetch("SELECT name FROM administrator_v2 ORDER BY name")

        def composite(raw: object) -> list[dict[str, object]]:
            return [a.model_dump() for a in _allocations(raw)]

        return StoredState(
            products=tuple(
                StoredProduct(
                    r["id"],
                    r["codigo"],
                    {
                        "name": r["name"],
                        "isin": r["isin"],
                        "manager": r["manager"],
                        "asset_class": composite(r["asset_class"]),
                        "geographic_focus": composite(r["geographic_focus"]),
                        "underlying": composite(r["underlying"]),
                        "currency": r["currency"],
                        "investment_horizon": r["investment_horizon"],
                    },
                    r["is_deleted"],
                )
                for r in products
            ),
            series=tuple(
                StoredSeries(
                    r["id"],
                    r["codigo"],
                    r["series"],
                    {
                        k: r[k]
                        for k in ("ter", "flows_min", "flows_max", "return_min", "return_max")
                    },
                    r["is_deleted"],
                )
                for r in series
            ),
            links=tuple(
                StoredLink(
                    r["id"],
                    r["codigo"],
                    r["series"],
                    r["administrator"],
                    {
                        k: r[k]
                        for k in (
                            "custody",
                            "buy_commission",
                            "sell_commission",
                            "minimum_usd",
                            "min_commission_usd",
                        )
                    },
                    r["is_deleted"],
                )
                for r in links
            ),
            managers=tuple(r["name"] for r in managers),
            administrators=tuple(r["name"] for r in administrators),
        )

    async def list_administrators(self) -> list[AdministratorV2]:
        rows = await self.pool.fetch(
            "SELECT id, name, score, score_is_fixed FROM administrator_v2 ORDER BY name"
        )
        return [AdministratorV2(**dict(r)) for r in rows]

    async def set_administrator_score(
        self, administrator_id: int, score: int | None
    ) -> AdministratorV2 | None:
        """Set or clear the score of an administrator. `None` when it does not
        exist. `score_is_fixed` is left as it is: it says whether the score is
        defined by the entity or typed per product, not whether it can be edited."""
        row = await self.pool.fetchrow(
            "UPDATE administrator_v2 SET score = $2 WHERE id = $1 "
            "RETURNING id, name, score, score_is_fixed",
            administrator_id,
            score,
        )
        return AdministratorV2(**dict(row)) if row else None

    async def set_manager_score(self, manager_id: int, score: int | None) -> ManagerV2 | None:
        """Set or clear the score of a manager. `None` when it does not exist."""
        row = await self.pool.fetchrow(
            "UPDATE manager_v2 SET score = $2 WHERE id = $1 RETURNING id, name, score",
            manager_id,
            score,
        )
        return ManagerV2(**dict(row)) if row else None

    async def list_managers(self) -> list[ManagerV2]:
        rows = await self.pool.fetch("SELECT id, name, score FROM manager_v2 ORDER BY name")
        return [ManagerV2(**dict(r)) for r in rows]

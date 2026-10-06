"""Read and soft-delete access to the v2 catalog tables.

Plain SQL over asyncpg, like the other repositories. Nothing here removes a
row: deleting is `is_deleted = true` and only the explicit restore reverses
it. The write path used by the workbook sync (insert and update with an
optional shared connection) is added with the sync itself, in Phase 3.
"""

from __future__ import annotations

import json

import asyncpg

from catalog_v2.models import (
    AdministratorLink,
    AdministratorV2,
    Allocation,
    CatalogV2Product,
    CatalogV2ProductDetail,
    ManagerV2,
    Series,
)

_PRODUCT_SELECT = """
    SELECT p.id, p.codigo, p.name, p.isin, p.manager_id,
           COALESCE(m.name, '') AS manager, m.score AS manager_score,
           p.asset_class, p.geographic_focus, p.underlying,
           p.currency, p.investment_horizon, p.is_deleted
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
        )

    async def list_products(
        self,
        search: str | None = None,
        limit: int = 1000,
        offset: int = 0,
        *,
        include_deleted: bool = False,
    ) -> list[CatalogV2Product]:
        """Products matching `search`, or ordered by `codigo` without one.

        `search` is accent and case insensitive and matches the normalized name
        (`slugs`, served by a trigram index) or, as typed, the `codigo`, so an
        admin can paste a code from the Excel. `%` and `_` are taken
        literally. Results are ranked: exact name, then names that start with
        the text, then the rest.
        """
        conditions: list[str] = []
        params: list[object] = []
        order = "p.codigo"
        if not include_deleted:
            conditions.append("p.is_deleted = false")
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

    async def list_administrators(self) -> list[AdministratorV2]:
        rows = await self.pool.fetch(
            "SELECT id, name, score, score_is_fixed FROM administrator_v2 ORDER BY name"
        )
        return [AdministratorV2(**dict(r)) for r in rows]

    async def list_managers(self) -> list[ManagerV2]:
        rows = await self.pool.fetch("SELECT id, name, score FROM manager_v2 ORDER BY name")
        return [ManagerV2(**dict(r)) for r in rows]

"""Integration tests for the normalized catalog tables and
`NormalizedCatalogRepository` against real Postgres."""

from __future__ import annotations

import asyncpg
import pytest

from db.catalog_normalized import NormalizedCatalogRepository


async def _product(pool, code="BD-00001", name="Fund A"):
    await pool.execute(
        "INSERT INTO catalog_product (code, name, manager, currency) VALUES ($1, $2, 'Mgr', 'USD')",
        code,
        name,
    )


async def _series(pool, code="BD-00001", series="A", ter=0.0384):
    await pool.execute(
        "INSERT INTO catalog_product_series (product_code, series, management_fee_ter) "
        "VALUES ($1, $2, $3)",
        code,
        series,
        ter,
    )


async def _admin(pool, code="BD-00001", series="A", administrator="Admin Co"):
    await pool.execute(
        "INSERT INTO catalog_product_series_admin "
        "(product_code, series, administrator, custody_fee) VALUES ($1, $2, $3, 0.001)",
        code,
        series,
        administrator,
    )


# --- T-001: constraints -----------------------------------------------------


async def test_chain_inserts(test_pool):
    await _product(test_pool)
    await _series(test_pool)
    await _admin(test_pool)
    assert await test_pool.fetchval("SELECT count(*) FROM catalog_product_series_admin") >= 1


async def test_admin_fk_rejects_missing_series(test_pool):
    await _product(test_pool)
    await _series(test_pool, series="A")
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        async with test_pool.acquire() as conn, conn.transaction():
            await _admin(conn, series="ZZ")


async def test_series_requires_existing_product(test_pool):
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        async with test_pool.acquire() as conn, conn.transaction():
            await _series(conn, code="BD-MISSING")


async def test_series_unique_per_product(test_pool):
    await _product(test_pool)
    await _series(test_pool)
    with pytest.raises(asyncpg.UniqueViolationError):
        async with test_pool.acquire() as conn, conn.transaction():
            await _series(conn)


async def test_admin_unique_per_product_series_admin(test_pool):
    await _product(test_pool)
    await _series(test_pool)
    await _admin(test_pool)
    with pytest.raises(asyncpg.UniqueViolationError):
        async with test_pool.acquire() as conn, conn.transaction():
            await _admin(conn)


# --- T-002: repository ------------------------------------------------------


async def test_list_products_returns_products_only_ordered(test_pool):
    await _product(test_pool, "BD-00002", "Fund B")
    await _product(test_pool, "BD-00001", "Fund A")
    await _series(test_pool, "BD-00001")
    rows = await NormalizedCatalogRepository(test_pool).list_products()
    codes = [r.code for r in rows]
    assert codes == sorted(codes)
    assert {"BD-00001", "BD-00002"} <= set(codes)
    assert all(r.series == [] for r in rows)


async def test_get_product_detail_nests_series_and_admins(test_pool):
    await _product(test_pool)
    await _series(test_pool, series="A", ter=0.0384)
    await _series(test_pool, series="B", ter=0.02)
    await _admin(test_pool, series="A", administrator="Admin 1")
    await _admin(test_pool, series="A", administrator="Admin 2")
    await _admin(test_pool, series="B", administrator="Admin 3")

    detail = await NormalizedCatalogRepository(test_pool).get_product_detail("BD-00001")

    assert detail is not None
    assert detail.name == "Fund A"
    assert [s.series for s in detail.series] == ["A", "B"]
    assert detail.series[0].management_fee_ter == pytest.approx(0.0384)
    assert [a.administrator for a in detail.series[0].administrators] == ["Admin 1", "Admin 2"]
    assert [a.administrator for a in detail.series[1].administrators] == ["Admin 3"]
    assert detail.series[0].administrators[0].custody_fee == pytest.approx(0.001)
    assert detail.series[0].flows_min is None


async def test_get_product_detail_missing_returns_none(test_pool):
    assert await NormalizedCatalogRepository(test_pool).get_product_detail("BD-NOPE") is None


# --- ficha-patrimonial-v2 T-1: enrichment search ----------------------------


async def test_search_for_enrichment_fuzzy_matches_by_name(test_pool):
    """A close (not exact) name query resolves to the product, with its
    series and administrators nested (mirrors V1 `CatalogRepository.search`
    pg_trgm behaviour, then reuses `get_product_detail`)."""
    await _product(test_pool, "BD-00001", "Latam Credit Opportunities Fund")
    await _series(test_pool, "BD-00001", series="A", ter=0.0384)
    await _admin(test_pool, "BD-00001", series="A", administrator="Admin Co")

    match = await NormalizedCatalogRepository(test_pool).search_for_enrichment(
        "latam credit opportunities"
    )

    assert match is not None
    assert match.code == "BD-00001"
    assert [s.series for s in match.series] == ["A"]
    assert match.series[0].management_fee_ter == pytest.approx(0.0384)
    assert [a.administrator for a in match.series[0].administrators] == ["Admin Co"]


async def test_search_for_enrichment_returns_none_for_no_match(test_pool):
    await _product(test_pool, "BD-00001", "Latam Credit Opportunities Fund")
    match = await NormalizedCatalogRepository(test_pool).search_for_enrichment(
        "zzzz totally unrelated query xkcd"
    )
    assert match is None


async def test_search_for_enrichment_picks_best_similarity(test_pool):
    await _product(test_pool, "BD-00001", "Global Equity Fund")
    await _product(test_pool, "BD-00002", "Latam Fixed Income Fund")

    match = await NormalizedCatalogRepository(test_pool).search_for_enrichment(
        "latam fixed income"
    )

    assert match is not None
    assert match.code == "BD-00002"


async def test_search_for_enrichment_empty_query_returns_none(test_pool):
    await _product(test_pool, "BD-00001", "Global Equity Fund")
    assert await NormalizedCatalogRepository(test_pool).search_for_enrichment("") is None

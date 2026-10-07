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

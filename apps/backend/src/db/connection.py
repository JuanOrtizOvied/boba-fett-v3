from __future__ import annotations

import os
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

load_dotenv()

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        database_url = os.environ.get(
            "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/sabbi"
        )
        _pool = await asyncpg.create_pool(database_url, min_size=2, max_size=10)
        await _run_schema(_pool)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def _run_schema(pool: asyncpg.Pool) -> None:
    schema_path = Path(__file__).parent / "schema.sql"
    sql = schema_path.read_text()
    async with pool.acquire() as conn:
        await conn.execute(sql)


def get_repository(pool: asyncpg.Pool | None = None):
    from db.repository import ProductRepository

    if pool is None:
        raise RuntimeError("Pool not initialized — call get_pool() first")
    return ProductRepository(pool)

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
        _run_migrations()
        await _seed_admin(_pool)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def _run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    ini_path = Path(__file__).resolve().parents[2] / "alembic.ini"
    cfg = Config(str(ini_path))
    command.upgrade(cfg, "head")


async def _seed_admin(pool: asyncpg.Pool) -> None:
    from auth.seed import seed_admin

    await seed_admin(pool)


def get_repository(pool: asyncpg.Pool | None = None):
    from db.repository import ProductRepository

    if pool is None:
        raise RuntimeError("Pool not initialized — call get_pool() first")
    return ProductRepository(pool)


def get_catalog_repository(pool: asyncpg.Pool | None = None):
    from db.catalog_repository import CatalogRepository

    if pool is None:
        raise RuntimeError("Pool not initialized — call get_pool() first")
    return CatalogRepository(pool)

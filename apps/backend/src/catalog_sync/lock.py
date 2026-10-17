"""Postgres advisory-lock helper for cross-process serialization of sync
runs (`openspec/changes/catalog-sharepoint-sync` — design.md ADR-9; spec
scenario SYNC-30).

A single in-process `asyncio.Lock` isn't enough — production runs Gunicorn
with 4 worker *processes* (`apps/backend/Dockerfile`), each with its own
memory. `pg_advisory_lock` is session-scoped in Postgres itself, so it
serializes across every worker and every server, on a dedicated connection
held for the duration of the lock. `SYNC_RUN_LOCK_KEY` serializes sync
runs; the subscription renewal job (Phase 7) is meant to use a different
constant key with `pg_try_advisory_lock` instead, since it can just skip a
cycle rather than wait.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import asyncpg

# Arbitrary but fixed int64 key. `pg_advisory_lock` keys share one 64-bit
# namespace across the whole database, so every advisory lock this project
# takes needs its own distinct constant to avoid an accidental collision
# with an unrelated lock elsewhere in the app.
SYNC_RUN_LOCK_KEY = 8_401_002_001

# The periodic job takes this one with `try_advisory_lock`: only one of the
# workers acts per cycle and the others skip it instead of waiting.
SUBSCRIPTION_JOB_LOCK_KEY = 8_401_002_002

DEFAULT_LOCK_TIMEOUT_SECONDS = 30.0


class LockTimeoutError(TimeoutError):
    """The advisory lock wasn't acquired within the bounded wait
    (design.md ADR-9: "blocking on the lock (with a bounded wait)"), most
    likely because another worker is already running a sync."""


@asynccontextmanager
async def advisory_lock(
    pool: asyncpg.Pool,
    key: int = SYNC_RUN_LOCK_KEY,
    *,
    timeout_seconds: float = DEFAULT_LOCK_TIMEOUT_SECONDS,
) -> AsyncIterator[None]:
    """Hold `pg_advisory_lock(key)` on a dedicated connection for the
    duration of the `async with` block.

    Blocks up to `timeout_seconds` waiting for another session to release
    the same key; raises `LockTimeoutError` instead of blocking forever
    behind a stuck or crashed worker. Always releases the lock before
    returning the connection to the pool, even if the block raises.
    """
    async with pool.acquire() as conn:
        timeout_ms = int(timeout_seconds * 1000)
        await conn.execute(f"SET statement_timeout = {timeout_ms}")
        try:
            await conn.fetchval("SELECT pg_advisory_lock($1)", key)
        except asyncpg.QueryCanceledError as exc:
            raise LockTimeoutError(
                f"Could not acquire advisory lock {key} within {timeout_seconds}s"
            ) from exc
        finally:
            # A pooled connection is reused for unrelated queries later —
            # never let it carry this shortened timeout past lock acquisition.
            await conn.execute("SET statement_timeout = 0")

        try:
            yield
        finally:
            await conn.fetchval("SELECT pg_advisory_unlock($1)", key)


@asynccontextmanager
async def try_advisory_lock(
    pool: asyncpg.Pool, key: int = SUBSCRIPTION_JOB_LOCK_KEY
) -> AsyncIterator[bool]:
    """Try to take `pg_advisory_lock(key)` without waiting. Yields `True`
    while the lock is held and `False` if another session already has it, in
    which case the caller should skip its work. Released on exit when taken."""
    async with pool.acquire() as conn:
        acquired = bool(await conn.fetchval("SELECT pg_try_advisory_lock($1)", key))
        try:
            yield acquired
        finally:
            if acquired:
                await conn.fetchval("SELECT pg_advisory_unlock($1)", key)

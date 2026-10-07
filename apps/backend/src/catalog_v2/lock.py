"""Postgres advisory locks for the v2 sync.

Production runs several worker processes, each with its own memory, so an
in-process lock is not enough. `pg_advisory_lock` lives in Postgres itself and
serializes across every worker, on a dedicated connection held for as long as
the lock is needed. v2 uses its own keys: they share one 64-bit namespace with
every other advisory lock in the database, and they must never collide with the
ones of the current sync.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg

# Serializes sync runs: a second run waits for the first.
SYNC_RUN_LOCK_KEY = 8_401_003_001

# Taken without waiting by the periodic job: only one worker acts per cycle and
# the others skip it.
PERIODIC_JOB_LOCK_KEY = 8_401_003_002

DEFAULT_LOCK_TIMEOUT_SECONDS = 30.0


class LockTimeoutError(TimeoutError):
    """The lock was not acquired within the bounded wait, most likely because
    another worker is already running a sync."""


@asynccontextmanager
async def advisory_lock(
    pool: asyncpg.Pool,
    key: int = SYNC_RUN_LOCK_KEY,
    *,
    timeout_seconds: float = DEFAULT_LOCK_TIMEOUT_SECONDS,
) -> AsyncIterator[None]:
    """Hold `pg_advisory_lock(key)` for the duration of the `async with` block.

    Waits up to `timeout_seconds` for another session to release the key and
    raises `LockTimeoutError` instead of blocking forever behind a stuck worker.
    The lock is always released before the connection goes back to the pool.
    """
    async with pool.acquire() as conn:
        await conn.execute(f"SET statement_timeout = {int(timeout_seconds * 1000)}")
        try:
            await conn.fetchval("SELECT pg_advisory_lock($1)", key)
        except asyncpg.QueryCanceledError as exc:
            raise LockTimeoutError(
                f"Could not acquire advisory lock {key} within {timeout_seconds}s"
            ) from exc
        finally:
            # A pooled connection is reused later: it must not keep the short timeout.
            await conn.execute("SET statement_timeout = 0")

        try:
            yield
        finally:
            await conn.fetchval("SELECT pg_advisory_unlock($1)", key)


@asynccontextmanager
async def try_advisory_lock(
    pool: asyncpg.Pool, key: int = PERIODIC_JOB_LOCK_KEY
) -> AsyncIterator[bool]:
    """Try to take the lock without waiting. Yields `True` while it is held and
    `False` when another session has it, in which case the caller skips its
    work. Released on exit when taken."""
    async with pool.acquire() as conn:
        acquired = bool(await conn.fetchval("SELECT pg_try_advisory_lock($1)", key))
        try:
            yield acquired
        finally:
            if acquired:
                await conn.fetchval("SELECT pg_advisory_unlock($1)", key)

"""Periodic job for the normalized catalog SharePoint sync.

Same shape as `catalog_sync.scheduler`, behind its own flag
(`SHAREPOINT_NORMALIZED_SYNC_ENABLED`). Each cycle does two things:

1. keeps the Graph subscription alive (`ensure_subscription`). Graph only
   offers notifications for the whole drive, so this one subscription also
   serves any other sync that reads the same drive, and
2. runs a safety sync (`run_sync_from_sharepoint`, not forced), so a
   notification that was lost or failed is recovered. When nothing changed the
   stored hash makes it a no-op: a cycle costs one download.

The upkeep writes `webhook_subscriptions`, which the other job also writes, so
a cycle takes the same `try_advisory_lock` the other job takes and skips
itself when someone holds it. The first cycle runs a little later than the
other job's for the same reason. Nothing runs, and no Graph call is made,
unless the flag is true. A step that fails is logged (error type and message
only, never a secret) and never stops the loop or the other step.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from catalog_normalized_sync.config import NormalizedSettings
from catalog_normalized_sync.service import RunReport, run_sync_from_sharepoint
from catalog_sync.config import Settings
from catalog_sync.graph import GraphClient, GraphConfigError
from catalog_sync.lock import try_advisory_lock
from catalog_sync.subscriptions import ensure_subscription

logger = logging.getLogger("catalog_normalized_sync.scheduler")

# The other job's first cycle runs after 30 s; start later so they do not
# fight for the shared lock.
INITIAL_DELAY_SECONDS = 45.0


@dataclass(frozen=True)
class CycleReport:
    """What one cycle did. `ran` is False when it did nothing at all;
    `reason` then says why ("disabled" or "locked")."""

    ran: bool
    reason: str | None = None
    subscription_actions: list[str] | None = None
    subscription_failed: bool = False
    sync_report: RunReport | None = None
    sync_failed: bool = False


async def run_maintenance_cycle(
    pool: asyncpg.Pool,
    settings: Settings | None = None,
    normalized: NormalizedSettings | None = None,
    *,
    client: GraphClient | None = None,
    now: datetime | None = None,
) -> CycleReport:
    """One pass of subscription upkeep plus the safety sync. `client` is for
    tests; otherwise a client is created for the cycle and always closed."""
    settings = settings or Settings.from_env()
    normalized = normalized or NormalizedSettings.from_env()
    if not normalized.sync_enabled:
        return CycleReport(ran=False, reason="disabled")

    async with try_advisory_lock(pool) as acquired:
        if not acquired:
            return CycleReport(ran=False, reason="locked")

        try:
            graph = client or GraphClient(settings)
        except GraphConfigError as exc:
            logger.error("Normalized catalog sync cannot start a cycle: %s", exc)
            return CycleReport(ran=True, subscription_failed=True, sync_failed=True)

        try:
            actions: list[str] | None = None
            subscription_failed = False
            try:
                actions = await ensure_subscription(pool, graph, settings, now=now)
                logger.info("Graph subscription check: %s", ", ".join(actions))
            except Exception as exc:  # one step failing must not stop the other
                subscription_failed = True
                logger.error("Graph subscription upkeep failed: %s: %s", type(exc).__name__, exc)

            sync_report: RunReport | None = None
            sync_failed = False
            try:
                sync_report = await run_sync_from_sharepoint(
                    pool, settings=settings, normalized=normalized, client=graph
                )
                logger.info(
                    "Safety sync %s", "skipped (unchanged)" if sync_report.skipped else "applied"
                )
            except Exception as exc:
                sync_failed = True
                logger.error("Safety sync failed: %s: %s", type(exc).__name__, exc)

            return CycleReport(
                ran=True,
                subscription_actions=actions,
                subscription_failed=subscription_failed,
                sync_report=sync_report,
                sync_failed=sync_failed,
            )
        finally:
            if client is None:
                await graph.aclose()


async def maintenance_loop(
    pool: asyncpg.Pool,
    settings: Settings,
    normalized: NormalizedSettings,
    *,
    initial_delay: float = INITIAL_DELAY_SECONDS,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Run a cycle every `settings.sync_interval_minutes` until cancelled.
    An unexpected error in a cycle is logged and the loop carries on.
    `sleep` exists so tests do not wait for real."""
    await sleep(initial_delay)
    interval_seconds = settings.sync_interval_minutes * 60
    while True:
        try:
            await run_maintenance_cycle(pool, settings, normalized)
        except Exception as exc:
            logger.error(
                "Normalized catalog maintenance cycle crashed: %s: %s", type(exc).__name__, exc
            )
        await sleep(interval_seconds)


def _show_sync_logs() -> None:
    """Print the INFO logs of both sync packages (subscription created, sync
    applied or skipped). Python shows only warnings and errors by default and
    uvicorn configures just its own loggers, so without this a working sync
    would be silent. A line is written per cycle or notification, no more.

    Alembic runs `fileConfig` (migrations/env.py) when the pool is first
    created, which switches off every logger that already exists, these ones
    included (they are created when their module is imported). A switched-off
    logger stays silent whatever its level, so they are turned back on here."""
    names = ("catalog_sync", "catalog_normalized_sync")
    for logger_name, existing in list(logging.root.manager.loggerDict.items()):
        if isinstance(existing, logging.Logger) and logger_name.split(".")[0] in names:
            existing.disabled = False
    for name in names:
        sync_logger = logging.getLogger(name)
        sync_logger.setLevel(logging.INFO)
        # Alembic's root handler would print every line a second time.
        sync_logger.propagate = False
        if not sync_logger.handlers:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
            sync_logger.addHandler(handler)


def start_maintenance_task(
    pool: asyncpg.Pool,
    settings: Settings | None = None,
    normalized: NormalizedSettings | None = None,
    *,
    initial_delay: float = INITIAL_DELAY_SECONDS,
) -> asyncio.Task | None:
    """Start the loop, or return `None` without doing anything when
    `SHAREPOINT_NORMALIZED_SYNC_ENABLED` is false (no Graph call at startup)."""
    settings = settings or Settings.from_env()
    normalized = normalized or NormalizedSettings.from_env()
    if not normalized.sync_enabled:
        return None
    _show_sync_logs()
    return asyncio.create_task(
        maintenance_loop(pool, settings, normalized, initial_delay=initial_delay),
        name="catalog-normalized-sync-maintenance",
    )

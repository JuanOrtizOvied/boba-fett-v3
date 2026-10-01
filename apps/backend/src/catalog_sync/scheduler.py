"""Periodic job for the SharePoint catalog sync
(`openspec/changes/catalog-sharepoint-sync`, Phase 7.5; design.md ADR-11).

One asyncio task started from the FastAPI lifespan, no scheduler dependency.
Each cycle does two things:

1. keeps the Graph subscription alive (`ensure_subscription`: create it,
   renew it before it expires, recreate it if it lapsed), and
2. runs a safety sync (`run_sync_from_sharepoint`, not forced), so a
   notification that was lost or failed is recovered. When nothing changed
   the stored hash makes it a no-op: a cycle costs one download.

Production runs several worker processes and each starts this task, so a
cycle takes `try_advisory_lock` and skips itself when another worker already
holds it. Nothing runs, and no Graph call is made, unless
`SHAREPOINT_SYNC_ENABLED` is true. A step that fails is logged (error type
and message only, never a secret) and never stops the loop or the other step.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

from catalog_sync.config import Settings
from catalog_sync.graph import GraphClient, GraphConfigError
from catalog_sync.lock import try_advisory_lock
from catalog_sync.service import RunReport, run_sync_from_sharepoint
from catalog_sync.subscriptions import ensure_subscription
from db.catalog_repository import CatalogRepository

logger = logging.getLogger("catalog_sync.scheduler")

# Let the app finish starting before the first cycle.
INITIAL_DELAY_SECONDS = 30.0


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
    repo: CatalogRepository,
    settings: Settings | None = None,
    *,
    client: GraphClient | None = None,
    now: datetime | None = None,
) -> CycleReport:
    """One pass of subscription upkeep plus the safety sync. `client` is for
    tests; otherwise a client is created for the cycle and always closed."""
    settings = settings or Settings.from_env()
    if not settings.sync_enabled:
        return CycleReport(ran=False, reason="disabled")

    async with try_advisory_lock(repo.pool) as acquired:
        if not acquired:
            return CycleReport(ran=False, reason="locked")

        try:
            graph = client or GraphClient(settings)
        except GraphConfigError as exc:
            logger.error("SharePoint sync cannot start a cycle: %s", exc)
            return CycleReport(ran=True, subscription_failed=True, sync_failed=True)

        try:
            actions: list[str] | None = None
            subscription_failed = False
            try:
                actions = await ensure_subscription(repo.pool, graph, settings, now=now)
                logger.info("Graph subscription check: %s", ", ".join(actions))
            except Exception as exc:  # one step failing must not stop the other
                subscription_failed = True
                logger.error("Graph subscription upkeep failed: %s: %s", type(exc).__name__, exc)

            sync_report: RunReport | None = None
            sync_failed = False
            try:
                sync_report = await run_sync_from_sharepoint(repo, settings=settings, client=graph)
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
    repo: CatalogRepository,
    settings: Settings,
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
            await run_maintenance_cycle(repo, settings)
        except Exception as exc:
            logger.error("SharePoint maintenance cycle crashed: %s: %s", type(exc).__name__, exc)
        await sleep(interval_seconds)


def start_maintenance_task(
    repo: CatalogRepository,
    settings: Settings | None = None,
    *,
    initial_delay: float = INITIAL_DELAY_SECONDS,
) -> asyncio.Task | None:
    """Start the loop, or return `None` without doing anything when
    `SHAREPOINT_SYNC_ENABLED` is false (no Graph call at startup)."""
    settings = settings or Settings.from_env()
    if not settings.sync_enabled:
        return None
    return asyncio.create_task(
        maintenance_loop(repo, settings, initial_delay=initial_delay),
        name="catalog-sync-maintenance",
    )


async def stop_maintenance_task(task: asyncio.Task | None) -> None:
    if task is None:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task

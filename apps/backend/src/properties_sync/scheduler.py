"""Periodic safety job for the properties sync.

Each cycle runs one sync (`run_sync_from_sharepoint`, not forced), so a
notification that was lost or failed is recovered. When nothing changed the
stored hash makes it a no-op: a cycle costs one download.

Unlike the catalog job it does NOT keep the Graph subscription alive: Graph only
offers notifications for the whole drive, so the one subscription the catalog
jobs maintain serves this sync too. It runs only when the normalized sync is
enabled (`PropertiesSettings`), which is also what keeps that subscription alive.
Nothing runs, and no Graph call is made, otherwise. A failing cycle is logged
(error type only, never a message) and never stops the loop.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import asyncpg

from catalog_sync.config import Settings
from catalog_sync.graph import GraphClient
from properties_sync.config import PropertiesSettings
from properties_sync.service import RunReport, describe_error, run_sync_from_sharepoint

logger = logging.getLogger("properties_sync.scheduler")

# The catalog jobs start after 30 s and 45 s; start later so the three downloads
# do not pile up.
INITIAL_DELAY_SECONDS = 60.0


@dataclass(frozen=True)
class CycleReport:
    """What one cycle did. `ran` is False when it did nothing at all."""

    ran: bool
    reason: str | None = None
    sync_report: RunReport | None = None
    sync_failed: bool = False


async def run_cycle(
    pool: asyncpg.Pool,
    settings: Settings | None = None,
    properties: PropertiesSettings | None = None,
    *,
    client: GraphClient | None = None,
) -> CycleReport:
    """One safety sync. `client` is for tests."""
    settings = settings or Settings.from_env()
    properties = properties or PropertiesSettings.from_env()
    if not properties.sync_enabled:
        return CycleReport(ran=False, reason="disabled")
    try:
        report = await run_sync_from_sharepoint(
            pool, settings=settings, properties=properties, client=client, trigger="scheduler"
        )
    except Exception as exc:
        logger.error("Properties safety sync failed: %s", describe_error(exc))
        return CycleReport(ran=True, sync_failed=True)
    logger.info("Properties safety sync %s", "skipped (unchanged)" if report.skipped else "applied")
    return CycleReport(ran=True, sync_report=report)


async def maintenance_loop(
    pool: asyncpg.Pool,
    settings: Settings,
    properties: PropertiesSettings,
    *,
    initial_delay: float = INITIAL_DELAY_SECONDS,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> None:
    """Run a cycle every `settings.sync_interval_minutes` until cancelled. An
    unexpected error in a cycle is logged and the loop carries on. `sleep` exists
    so tests do not wait for real."""
    await sleep(initial_delay)
    interval_seconds = settings.sync_interval_minutes * 60
    while True:
        try:
            await run_cycle(pool, settings, properties)
        except Exception as exc:
            logger.error("Properties maintenance cycle crashed: %s", describe_error(exc))
        await sleep(interval_seconds)


def _show_logs() -> None:
    """Print the INFO logs of this package. Python shows only warnings and errors
    by default and uvicorn configures just its own loggers, so without this a
    working sync would be silent. Alembic runs `fileConfig` when the pool is first
    created, which switches off every logger that already exists, these included;
    they are turned back on here."""
    for logger_name, existing in list(logging.root.manager.loggerDict.items()):
        if isinstance(existing, logging.Logger) and logger_name.split(".")[0] == "properties_sync":
            existing.disabled = False
    package_logger = logging.getLogger("properties_sync")
    package_logger.setLevel(logging.INFO)
    # Alembic's root handler would print every line a second time.
    package_logger.propagate = False
    if not package_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
        package_logger.addHandler(handler)


def start_maintenance_task(
    pool: asyncpg.Pool,
    settings: Settings | None = None,
    properties: PropertiesSettings | None = None,
    *,
    initial_delay: float = INITIAL_DELAY_SECONDS,
) -> asyncio.Task | None:
    """Start the loop, or return `None` without doing anything when the normalized
    sync is disabled (no Graph call at startup)."""
    settings = settings or Settings.from_env()
    properties = properties or PropertiesSettings.from_env()
    if not properties.sync_enabled:
        return None
    _show_logs()
    return asyncio.create_task(
        maintenance_loop(pool, settings, properties, initial_delay=initial_delay),
        name="properties-sync-maintenance",
    )

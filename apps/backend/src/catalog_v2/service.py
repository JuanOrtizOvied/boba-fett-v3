"""Runs one v2 sync pass over the workbook.

Under the advisory lock it hashes the file, skips it when the content is the one
already processed, parses it, compares it with what is stored and applies the
difference in one transaction. The hash is stored only after a successful apply,
so a failed run is retried by the next one, and a dry run reads everything and
writes nothing.

The bytes come from the caller (`run_sync_from_bytes`, used by the local command)
or from a source that is called inside the lock (`run_sync_from_source`). The
SharePoint source downloads the configured file from Graph, so two notifications
that arrive together run one after the other and the second one downloads the
latest version: an older download can never overwrite a newer one.
"""

from __future__ import annotations

import hashlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import asyncpg

from catalog_v2.apply import ApplyReport, apply_changeset
from catalog_v2.config import Settings
from catalog_v2.diff import ChangeSet, diff_workbook
from catalog_v2.graph import GraphClient, GraphConfigError
from catalog_v2.lock import advisory_lock
from catalog_v2.parser import ParseReport, parse_workbook
from catalog_v2.repository import CatalogV2Repository

# Where the sync reads the workbook from: a function that returns its bytes.
WorkbookSource = Callable[[], Awaitable[bytes]]


class SyncDisabledError(RuntimeError):
    """The SharePoint sync was asked to run while `SHAREPOINT_V2_SYNC_ENABLED` is
    false, so no Graph call is made."""


@dataclass(frozen=True)
class RunReport:
    """What a run did. `skipped` means the content was already processed, so the
    other fields are empty. `applied` is `None` for a dry run."""

    content_hash: str
    skipped: bool = False
    dry_run: bool = False
    parse_report: ParseReport | None = None
    changeset: ChangeSet | None = None
    applied: ApplyReport | None = None


async def _last_processed_hash(pool: asyncpg.Pool) -> str | None:
    return await pool.fetchval(
        "SELECT last_processed_hash FROM webhook_subscriptions_v2 ORDER BY id LIMIT 1"
    )


async def _store_hash(pool: asyncpg.Pool, digest: str) -> None:
    """Remember the processed content. With no subscription row yet there is
    nothing to update, which only means the next run reads the file again; the
    diff makes that harmless."""
    await pool.execute(
        "UPDATE webhook_subscriptions_v2 SET last_processed_hash = $1, updated_at = now()",
        digest,
    )


async def _run_locked(pool: asyncpg.Pool, data: bytes, *, force: bool, dry_run: bool) -> RunReport:
    """One sync pass over `data`. The caller MUST hold the advisory lock."""
    digest = hashlib.sha256(data).hexdigest()
    if not force and not dry_run and digest == await _last_processed_hash(pool):
        return RunReport(digest, skipped=True)

    parsed = parse_workbook(data)
    state = await CatalogV2Repository(pool).load_state()
    changeset = diff_workbook(parsed, state)
    if dry_run:
        return RunReport(digest, dry_run=True, parse_report=parsed.report, changeset=changeset)

    applied = await apply_changeset(pool, changeset)
    await _store_hash(pool, digest)
    return RunReport(digest, parse_report=parsed.report, changeset=changeset, applied=applied)


async def run_sync_from_bytes(
    pool: asyncpg.Pool, data: bytes, *, force: bool = False, dry_run: bool = False
) -> RunReport:
    """Sync the workbook `data` into the v2 tables. `force` ignores the stored
    hash; `dry_run` goes as far as the list of changes and writes nothing, hash
    included. A missing sheet or key column raises before anything is written."""
    async with advisory_lock(pool):
        return await _run_locked(pool, data, force=force, dry_run=dry_run)


async def run_sync_from_source(
    pool: asyncpg.Pool, source: WorkbookSource, *, force: bool = False
) -> RunReport:
    """Like `run_sync_from_bytes`, but the workbook is fetched by `source` inside
    the lock. When `source` raises nothing is written, the stored hash is left
    untouched and the next run tries again."""
    async with advisory_lock(pool):
        data = await source()
        return await _run_locked(pool, data, force=force, dry_run=False)


def _require_sharepoint_settings(settings: Settings) -> tuple[str, str]:
    """The site id and the file path of the workbook, or `GraphConfigError`
    naming the variables that are missing."""
    missing = [
        name
        for name, value in (
            ("SHAREPOINT_SITE_ID", settings.sharepoint_site_id),
            ("SHAREPOINT_V2_FILE_PATH", settings.sharepoint_file_path),
        )
        if not value
    ]
    if missing:
        raise GraphConfigError(f"Missing SharePoint settings: {', '.join(missing)}")
    assert settings.sharepoint_site_id and settings.sharepoint_file_path
    return settings.sharepoint_site_id, settings.sharepoint_file_path


def sharepoint_source(settings: Settings, client: GraphClient | None = None) -> WorkbookSource:
    """A source that downloads the configured workbook straight from its path;
    nothing is searched or walked. The configuration is checked and the client is
    created when the source is called, not before, so building one never fails.
    A client passed in is the caller's to close; one created here is closed after
    the download."""

    async def download() -> bytes:
        site_id, file_path = _require_sharepoint_settings(settings)
        graph = client or GraphClient(settings)
        try:
            return await graph.download_file(site_id, file_path)
        finally:
            if client is None:
                await graph.aclose()

    return download


async def run_sync_from_sharepoint(
    pool: asyncpg.Pool,
    *,
    settings: Settings | None = None,
    client: GraphClient | None = None,
    force: bool = False,
) -> RunReport:
    """Download the workbook from SharePoint and run one sync pass over it.

    Raises `SyncDisabledError` when `SHAREPOINT_V2_SYNC_ENABLED` is false and
    `GraphConfigError` when the site id, the file path or the Azure credentials
    are not configured, all of them before any Graph call. A failed download
    raises `GraphError` and writes nothing.
    """
    settings = settings or Settings.from_env()
    if not settings.sync_enabled:
        raise SyncDisabledError("SHAREPOINT_V2_SYNC_ENABLED is false")
    _require_sharepoint_settings(settings)
    return await run_sync_from_source(pool, sharepoint_source(settings, client), force=force)

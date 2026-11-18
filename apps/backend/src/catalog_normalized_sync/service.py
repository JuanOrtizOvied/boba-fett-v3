"""One run of the normalized catalog sync: lock, hash, parse, diff, apply.

`run_sync_from_bytes` is what the local command uses (always `force=True`).
`run_sync_from_sharepoint` downloads the workbook inside the lock and runs the
same pass; the webhook handler uses it with `force=False`, so unchanged
content is a no-op. The new hash is stored only after the changes were
applied, so a failed run is retried by the next notification.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import asyncpg

from catalog_normalized_sync.apply import apply_changeset
from catalog_normalized_sync.author import UNKNOWN_AUTHOR, fetch_last_editor
from catalog_normalized_sync.config import NormalizedSettings
from catalog_normalized_sync.diff import ChangeSet, diff_workbook
from catalog_normalized_sync.history import events_from_changeset
from catalog_normalized_sync.issues import (
    describe,
    diff_issues,
    issues_from_run,
    load_open_issues,
)
from catalog_normalized_sync.parser import ParsedWorkbook, parse_workbook
from catalog_sync.config import Settings
from catalog_sync.graph import GraphClient, GraphConfigError
from catalog_sync.lock import advisory_lock
from db.catalog_normalized import NormalizedCatalogRepository

# Distinct from SYNC_RUN_LOCK_KEY (..001) and SUBSCRIPTION_JOB_LOCK_KEY (..002)
# in `catalog_sync.lock`: advisory lock keys share one namespace per database.
NORMALIZED_SYNC_LOCK_KEY = 8_401_002_003

logger = logging.getLogger(__name__)


class SyncDisabledError(RuntimeError):
    """The sync was asked to run by SharePoint while
    `SHAREPOINT_NORMALIZED_SYNC_ENABLED` is false, so no Graph call is made."""


@dataclass(frozen=True)
class RunReport:
    content_hash: str
    skipped: bool
    parsed: ParsedWorkbook | None = None
    changeset: ChangeSet | None = None


def _content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _get_last_hash(pool: asyncpg.Pool) -> str | None:
    return await pool.fetchval("SELECT last_processed_hash FROM normalized_sync_state WHERE id = 1")


async def _store_hash(pool: asyncpg.Pool, content_hash: str) -> None:
    await pool.execute(
        "INSERT INTO normalized_sync_state (id, last_processed_hash) VALUES (1, $1) "
        "ON CONFLICT (id) DO UPDATE "
        "SET last_processed_hash = EXCLUDED.last_processed_hash, updated_at = now()",
        content_hash,
    )


async def preview(pool: asyncpg.Pool, data: bytes) -> tuple[ParsedWorkbook, ChangeSet]:
    """What a run over `data` would change. Reads only."""
    parsed = parse_workbook(data)
    snapshot = await NormalizedCatalogRepository(pool).list_for_sync()
    return parsed, diff_workbook(snapshot, parsed)


AuthorProvider = Callable[[], Awaitable[str | None]]
"""Says who saved the workbook the run read: an email, `UNKNOWN_AUTHOR`, or None."""


async def _author_of(
    provider: AuthorProvider | None, changeset: ChangeSet, issues_changed: bool = False
) -> str | None:
    """Who saved the workbook, asked only when the run is going to store something
    that records it: history events, or an unread row that opens or resolves (a
    skipped run, or a run with neither, makes no lookup). Never raises: whatever
    goes wrong, the changes still apply and the author is `UNKNOWN_AUTHOR`."""
    if provider is None or not (events_from_changeset(changeset) or issues_changed):
        return None
    try:
        return await provider()
    except Exception as exc:  # noqa: BLE001 - the author is an extra, never a reason to fail
        logger.warning(
            "Could not look up who saved the normalized workbook (%s)", type(exc).__name__
        )
        return UNKNOWN_AUTHOR


async def _run_locked(
    pool: asyncpg.Pool,
    data: bytes,
    *,
    force: bool,
    trigger: str = "manual",
    author_provider: AuthorProvider | None = None,
) -> RunReport:
    """One pass over `data`. The caller MUST hold the advisory lock. `trigger` is
    what started the run; it is stored with the history events of its changes, and
    so is the author `author_provider` gives (None when there is no provider: runs
    from a local file have no SharePoint editor)."""
    content_hash = _content_hash(data)
    if not force and await _get_last_hash(pool) == content_hash:
        return RunReport(content_hash=content_hash, skipped=True)

    parsed, changeset = await preview(pool, data)
    if changeset.deletes_blocked:
        logger.warning(
            "Normalized catalog sync held back its deletes: %s", changeset.deletes_blocked
        )
    unread = issues_from_run(parsed, changeset)
    if unread:
        logger.warning(
            "Normalized catalog sync could not read %d row(s) of the workbook; the "
            "database keeps what it had for them: %s",
            len(unread),
            describe(unread),
        )
    issues = diff_issues(await load_open_issues(pool), unread)
    changed_by = await _author_of(author_provider, changeset, issues.changes_state)
    await apply_changeset(pool, changeset, trigger=trigger, changed_by=changed_by, issues=issues)
    await _store_hash(pool, content_hash)
    return RunReport(content_hash=content_hash, skipped=False, parsed=parsed, changeset=changeset)


async def run_sync_from_bytes(
    pool: asyncpg.Pool, data: bytes, *, force: bool = False, trigger: str = "manual"
) -> RunReport:
    """Run one sync pass over `data` (an `.xlsx` file's bytes). Unless `force`,
    content equal to the last applied one is skipped without parsing."""
    async with advisory_lock(pool, NORMALIZED_SYNC_LOCK_KEY):
        return await _run_locked(pool, data, force=force, trigger=trigger)


def _require_settings(settings: Settings, normalized: NormalizedSettings) -> tuple[str, str]:
    missing = [
        name
        for name, value in (
            ("SHAREPOINT_SITE_ID", settings.sharepoint_site_id),
            ("SHAREPOINT_NORMALIZED_FILE_PATH", normalized.file_path),
        )
        if not value
    ]
    if missing:
        raise GraphConfigError(f"Missing SharePoint settings: {', '.join(missing)}")
    assert settings.sharepoint_site_id and normalized.file_path
    return settings.sharepoint_site_id, normalized.file_path


async def download_workbook(
    *,
    settings: Settings | None = None,
    normalized: NormalizedSettings | None = None,
    client: GraphClient | None = None,
) -> bytes:
    """Download the configured workbook straight from its path. Nothing is
    searched or walked. Ignores the enabled flag: it is an explicit action."""
    settings = settings or Settings.from_env()
    normalized = normalized or NormalizedSettings.from_env()
    site_id, file_path = _require_settings(settings, normalized)
    if client is not None:
        return await client.download_file(site_id, file_path)
    async with GraphClient(settings) as graph:
        return await graph.download_file(site_id, file_path)


async def run_sync_from_sharepoint(
    pool: asyncpg.Pool,
    *,
    settings: Settings | None = None,
    normalized: NormalizedSettings | None = None,
    client: GraphClient | None = None,
    force: bool = False,
    trigger: str = "manual",
) -> RunReport:
    """Download the workbook from SharePoint and run one sync pass over it.
    `trigger` is what started the run: `webhook`, `scheduler`, `lifecycle` or
    `manual`.

    The file is fetched inside the advisory lock: two notifications that
    arrive together run one after the other, and the second one downloads the
    latest version, so an older download never overwrites a newer one.

    Raises `SyncDisabledError` when `SHAREPOINT_NORMALIZED_SYNC_ENABLED` is
    false and `GraphConfigError` when the site or the file path are not
    configured, both before any Graph call.
    """
    settings = settings or Settings.from_env()
    normalized = normalized or NormalizedSettings.from_env()
    if not normalized.sync_enabled:
        raise SyncDisabledError("SHAREPOINT_NORMALIZED_SYNC_ENABLED is false")
    site_id, file_path = _require_settings(settings, normalized)

    owns_client = client is None
    graph = client or GraphClient(settings)
    try:
        async with advisory_lock(pool, NORMALIZED_SYNC_LOCK_KEY):
            data = await download_workbook(settings=settings, normalized=normalized, client=graph)
            return await _run_locked(
                pool,
                data,
                force=force,
                trigger=trigger,
                author_provider=lambda: fetch_last_editor(graph, site_id, file_path),
            )
    finally:
        if owns_client:
            await graph.aclose()

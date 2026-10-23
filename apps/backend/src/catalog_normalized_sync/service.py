"""One run of the normalized catalog sync: lock, hash, parse, diff, apply.

`run_sync_from_bytes` is what the local command uses (always `force=True`).
`run_sync_from_sharepoint` downloads the workbook inside the lock and runs the
same pass; the webhook handler uses it with `force=False`, so unchanged
content is a no-op. The new hash is stored only after the changes were
applied, so a failed run is retried by the next notification.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import asyncpg

from catalog_normalized_sync.apply import apply_changeset
from catalog_normalized_sync.config import NormalizedSettings
from catalog_normalized_sync.diff import ChangeSet, diff_workbook
from catalog_normalized_sync.parser import ParsedWorkbook, parse_workbook
from catalog_sync.config import Settings
from catalog_sync.graph import GraphClient, GraphConfigError
from catalog_sync.lock import advisory_lock
from db.catalog_normalized import NormalizedCatalogRepository

# Distinct from SYNC_RUN_LOCK_KEY (..001) and SUBSCRIPTION_JOB_LOCK_KEY (..002)
# in `catalog_sync.lock`: advisory lock keys share one namespace per database.
NORMALIZED_SYNC_LOCK_KEY = 8_401_002_003


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


async def _run_locked(pool: asyncpg.Pool, data: bytes, *, force: bool) -> RunReport:
    """One pass over `data`. The caller MUST hold the advisory lock."""
    content_hash = _content_hash(data)
    if not force and await _get_last_hash(pool) == content_hash:
        return RunReport(content_hash=content_hash, skipped=True)

    parsed, changeset = await preview(pool, data)
    await apply_changeset(pool, changeset)
    await _store_hash(pool, content_hash)
    return RunReport(content_hash=content_hash, skipped=False, parsed=parsed, changeset=changeset)


async def run_sync_from_bytes(pool: asyncpg.Pool, data: bytes, *, force: bool = False) -> RunReport:
    """Run one sync pass over `data` (an `.xlsx` file's bytes). Unless `force`,
    content equal to the last applied one is skipped without parsing."""
    async with advisory_lock(pool, NORMALIZED_SYNC_LOCK_KEY):
        return await _run_locked(pool, data, force=force)


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
) -> RunReport:
    """Download the workbook from SharePoint and run one sync pass over it.

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
    _require_settings(settings, normalized)

    owns_client = client is None
    graph = client or GraphClient(settings)
    try:
        async with advisory_lock(pool, NORMALIZED_SYNC_LOCK_KEY):
            data = await download_workbook(settings=settings, normalized=normalized, client=graph)
            return await _run_locked(pool, data, force=force)
    finally:
        if owns_client:
            await graph.aclose()

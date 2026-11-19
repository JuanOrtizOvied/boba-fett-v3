"""One run of the properties sync: lock, hash, parse, diff, apply.

`run_sync_from_bytes` is what the local command uses (always `force=True`).
`run_sync_from_sharepoint` downloads the workbook inside the lock and runs the
same pass; the webhook handler and the safety job use it with `force=False`, so
unchanged content is a no-op. The new hash is stored only after the changes were
applied, so a failed run is retried by the next notification.

Nothing here logs a client name or a cell value: only counts and row numbers of
the sheet, and for an error only its type (see `describe_error`).
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass

import asyncpg

from catalog_sync.config import Settings
from catalog_sync.graph import GraphClient, GraphConfigError, GraphError
from catalog_sync.lock import advisory_lock
from db.properties import PropertyRepository
from properties_sync.apply import apply_changeset
from properties_sync.config import PropertiesSettings
from properties_sync.diff import ChangeSet, diff_properties
from properties_sync.parser import ParsedProperties, parse_workbook

# Distinct from the keys of `catalog_sync.lock` (..001, ..002) and of the
# normalized catalog sync (..003): advisory lock keys share one namespace per
# database.
PROPERTIES_SYNC_LOCK_KEY = 8_401_002_004

# How many sheet row numbers a warning lists before saying "and N more".
_ROWS_SHOWN = 20

logger = logging.getLogger(__name__)


class SyncDisabledError(RuntimeError):
    """The sync was asked to run while `SHAREPOINT_NORMALIZED_SYNC_ENABLED` is
    false (this sync rides on it), so no Graph call is made."""


@dataclass(frozen=True)
class RunReport:
    content_hash: str
    skipped: bool
    parsed: ParsedProperties | None = None
    changeset: ChangeSet | None = None


def describe_error(exc: BaseException) -> str:
    """An error as a log-safe text: its type, and for a Graph error the status and
    code. Never the message, which a database error may fill with row values."""
    if isinstance(exc, GraphError):
        return f"{type(exc).__name__} (status {exc.status}, code {exc.code})"
    return type(exc).__name__


def _content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _get_last_hash(pool: asyncpg.Pool) -> str | None:
    return await pool.fetchval("SELECT last_processed_hash FROM properties_sync_state WHERE id = 1")


async def _store_hash(pool: asyncpg.Pool, content_hash: str) -> None:
    await pool.execute(
        "INSERT INTO properties_sync_state (id, last_processed_hash) VALUES (1, $1) "
        "ON CONFLICT (id) DO UPDATE "
        "SET last_processed_hash = EXCLUDED.last_processed_hash, updated_at = now()",
        content_hash,
    )


async def preview(pool: asyncpg.Pool, data: bytes) -> tuple[ParsedProperties, ChangeSet]:
    """What a run over `data` would change. Reads only."""
    parsed = parse_workbook(data)
    existing = await PropertyRepository(pool).list_for_sync()
    return parsed, diff_properties(existing, parsed)


def _log_findings(parsed: ParsedProperties, changeset: ChangeSet) -> None:
    if changeset.deletes_blocked:
        logger.warning("Properties sync held back its deletes: %s", changeset.deletes_blocked)
    if parsed.skipped:
        numbers = [str(row.row_number) for row in parsed.skipped[:_ROWS_SHOWN]]
        more = len(parsed.skipped) - len(numbers)
        logger.warning(
            "Properties sync could not read %d row(s) of the sheet; the database keeps what "
            "it had for them (sheet rows: %s%s)",
            len(parsed.skipped),
            ", ".join(numbers),
            f" and {more} more" if more > 0 else "",
        )


async def _run_locked(
    pool: asyncpg.Pool, data: bytes, *, force: bool, trigger: str = "manual"
) -> RunReport:
    """One pass over `data`. The caller MUST hold the advisory lock. `trigger` is
    only for the caller's logs: this sync keeps no history."""
    content_hash = _content_hash(data)
    if not force and await _get_last_hash(pool) == content_hash:
        return RunReport(content_hash=content_hash, skipped=True)

    parsed, changeset = await preview(pool, data)
    _log_findings(parsed, changeset)
    await apply_changeset(pool, changeset)
    await _store_hash(pool, content_hash)
    return RunReport(content_hash=content_hash, skipped=False, parsed=parsed, changeset=changeset)


async def run_sync_from_bytes(
    pool: asyncpg.Pool, data: bytes, *, force: bool = False, trigger: str = "manual"
) -> RunReport:
    """Run one sync pass over `data` (an `.xlsx` file's bytes). Unless `force`,
    content equal to the last applied one is skipped without parsing."""
    async with advisory_lock(pool, PROPERTIES_SYNC_LOCK_KEY):
        return await _run_locked(pool, data, force=force, trigger=trigger)


def _require_settings(settings: Settings, properties: PropertiesSettings) -> tuple[str, str]:
    missing = [
        name
        for name, value in (
            ("SHAREPOINT_SITE_ID", settings.sharepoint_site_id),
            ("SHAREPOINT_NORMALIZED_FILE_PATH", properties.file_path),
        )
        if not value
    ]
    if missing:
        raise GraphConfigError(f"Missing SharePoint settings: {', '.join(missing)}")
    assert settings.sharepoint_site_id and properties.file_path
    return settings.sharepoint_site_id, properties.file_path


async def download_workbook(
    *,
    settings: Settings | None = None,
    properties: PropertiesSettings | None = None,
    client: GraphClient | None = None,
) -> bytes:
    """Download the configured workbook straight from its path. Ignores the
    enabled flag: it is an explicit action."""
    settings = settings or Settings.from_env()
    properties = properties or PropertiesSettings.from_env()
    site_id, file_path = _require_settings(settings, properties)
    if client is not None:
        return await client.download_file(site_id, file_path)
    async with GraphClient(settings) as graph:
        return await graph.download_file(site_id, file_path)


async def run_sync_from_sharepoint(
    pool: asyncpg.Pool,
    *,
    settings: Settings | None = None,
    properties: PropertiesSettings | None = None,
    client: GraphClient | None = None,
    force: bool = False,
    trigger: str = "webhook",
) -> RunReport:
    """Download the workbook from SharePoint and run one sync pass over it.

    The file is fetched inside the advisory lock: two notifications that arrive
    together run one after the other, and the second one downloads the latest
    version, so an older download never overwrites a newer one.

    Raises `SyncDisabledError` when the normalized sync is disabled and
    `GraphConfigError` when the site or the file path are not configured, both
    before any Graph call."""
    settings = settings or Settings.from_env()
    properties = properties or PropertiesSettings.from_env()
    if not properties.sync_enabled:
        raise SyncDisabledError("SHAREPOINT_NORMALIZED_SYNC_ENABLED is false")
    _require_settings(settings, properties)

    owns_client = client is None
    graph = client or GraphClient(settings)
    try:
        async with advisory_lock(pool, PROPERTIES_SYNC_LOCK_KEY):
            data = await download_workbook(settings=settings, properties=properties, client=graph)
            return await _run_locked(pool, data, force=force, trigger=trigger)
    finally:
        if owns_client:
            await graph.aclose()

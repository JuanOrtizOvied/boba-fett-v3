"""Sync run orchestration: lock, hash, parse, diff, apply
(`openspec/changes/catalog-sharepoint-sync` — design.md ADR-2, ADR-8, ADR-9;
spec scenarios SYNC-28, SYNC-29, SYNC-30).

Not pure — this is the top-level entry point that ties every other
`catalog_sync` module together against a real database. `run_sync_from_bytes`
is called by the local dry-run CLI (Phase 4.5, always `force=True`).
`run_sync_from_sharepoint` (Phase 7.3) downloads the workbook from SharePoint
and runs the same pass; the webhook handler and the periodic job use it with
`force=False`, so unchanged content is a no-op (SYNC-28).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from catalog_sync.apply import apply_changeset
from catalog_sync.config import SHEET_NAME, Settings
from catalog_sync.diff import ChangeSet, OfficialLists, diff_catalog
from catalog_sync.graph import GraphClient, GraphConfigError
from catalog_sync.lock import advisory_lock
from catalog_sync.parser import ParseReport, parse_workbook
from db.catalog_repository import CatalogRepository
from db.models import ASSET_CLASS_OPTIONS, GEOGRAPHIC_FOCUS_OPTIONS, UNDERLYING_OPTIONS


class SyncDisabledError(RuntimeError):
    """The SharePoint sync was asked to run while `SHAREPOINT_SYNC_ENABLED`
    is false, so no Graph call is made (SYNC-37)."""


@dataclass(frozen=True)
class RunReport:
    """Summary of one sync run, for the webhook handler/CLI to log."""

    content_hash: str
    skipped: bool
    parse_report: ParseReport | None = None
    changeset: ChangeSet | None = None


def _content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


async def _load_official_lists(repo: CatalogRepository) -> OfficialLists:
    managers = await repo.list_managers()
    return OfficialLists(
        asset_class=ASSET_CLASS_OPTIONS,
        geographic_focus=GEOGRAPHIC_FOCUS_OPTIONS,
        underlying=UNDERLYING_OPTIONS,
        manager=[m.name for m in managers],
        manager_scores={m.name: m.score for m in managers if m.score is not None},
    )


async def _get_last_processed_hash(repo: CatalogRepository) -> str | None:
    # One active subscription is the documented shape for this project (a
    # single SharePoint file at a fixed path — proposal.md, "Single file,
    # multiple editors"); Phase 7 is what actually creates this row.
    return await repo.pool.fetchval(
        "SELECT last_processed_hash FROM webhook_subscriptions ORDER BY id LIMIT 1"
    )


async def _store_processed_hash(repo: CatalogRepository, content_hash: str) -> None:
    # A no-op (0 rows affected) if no subscription row exists yet — fine
    # before Phase 7, since there's nothing to compare future runs against
    # either way.
    await repo.pool.execute(
        "UPDATE webhook_subscriptions SET last_processed_hash = $1, updated_at = now()",
        content_hash,
    )


async def _run_locked(
    repo: CatalogRepository, data: bytes, *, force: bool, sheet_name: str
) -> RunReport:
    """One sync pass over `data`. The caller MUST hold the advisory lock."""
    content_hash = _content_hash(data)

    if not force:
        last_hash = await _get_last_processed_hash(repo)
        if last_hash is not None and last_hash == content_hash:
            return RunReport(content_hash=content_hash, skipped=True)

    parse_result = parse_workbook(data, sheet_name=sheet_name)
    existing_rows = await repo.list_for_sync()
    official_lists = await _load_official_lists(repo)
    changeset = diff_catalog(existing_rows, parse_result.rows, official_lists)

    await apply_changeset(repo, changeset)
    await _store_processed_hash(repo, content_hash)

    return RunReport(
        content_hash=content_hash,
        skipped=False,
        parse_report=parse_result.report,
        changeset=changeset,
    )


async def run_sync_from_bytes(
    repo: CatalogRepository,
    data: bytes,
    *,
    force: bool = False,
    sheet_name: str = SHEET_NAME,
) -> RunReport:
    """Run one sync pass over `data` (an `.xlsx` file's bytes).

    Order (design.md ADR-8): acquire the advisory lock, hash the content,
    compare against the last processed hash unless `force` — equal means
    skip without parsing or writing anything (SYNC-28). Otherwise parse,
    diff against the current catalog, and apply the resulting `ChangeSet`
    in one transaction (`apply_changeset`, Phase 4.3). The new hash is
    stored **only** after a successful apply — `apply_changeset` raising
    (SYNC-29) propagates out of this function too, and the stored hash is
    left untouched, so the next notification retries the same content.

    `MissingSheetError` from `parse_workbook` also propagates uncaught: a
    file-level failure aborts before any write (design.md ADR-8), and there
    is nothing meaningful to apply or report beyond the error itself.
    """
    async with advisory_lock(repo.pool):
        return await _run_locked(repo, data, force=force, sheet_name=sheet_name)


async def run_sync_from_sharepoint(
    repo: CatalogRepository,
    *,
    settings: Settings | None = None,
    client: GraphClient | None = None,
    force: bool = False,
) -> RunReport:
    """Download the workbook from SharePoint and run one sync pass over it.

    The file is fetched **inside** the advisory lock (design.md ADR-8, ADR-9):
    two notifications that arrive together then run one after the other, and
    the second one downloads the latest version, so an older download can
    never overwrite a newer one ("latest notification wins"). The download
    goes straight to the configured path; nothing is searched or walked.

    Nothing is written when the download fails: the error (`GraphError`)
    propagates, the hash is untouched, and the next notification retries.
    Raises `SyncDisabledError` when `SHAREPOINT_SYNC_ENABLED` is false and
    `GraphConfigError` when the site id or file path are not configured,
    both before any Graph call.
    """
    settings = settings or Settings.from_env()
    if not settings.sync_enabled:
        raise SyncDisabledError("SHAREPOINT_SYNC_ENABLED is false")
    missing = [
        name
        for name, value in (
            ("SHAREPOINT_SITE_ID", settings.sharepoint_site_id),
            ("SHAREPOINT_FILE_PATH", settings.sharepoint_file_path),
        )
        if not value
    ]
    if missing:
        raise GraphConfigError(f"Missing SharePoint settings: {', '.join(missing)}")
    assert settings.sharepoint_site_id and settings.sharepoint_file_path

    owns_client = client is None
    graph = client or GraphClient(settings)
    try:
        async with advisory_lock(repo.pool):
            data = await graph.download_file(
                settings.sharepoint_site_id, settings.sharepoint_file_path
            )
            return await _run_locked(
                repo, data, force=force, sheet_name=settings.sharepoint_sheet_name
            )
    finally:
        if owns_client:
            await graph.aclose()

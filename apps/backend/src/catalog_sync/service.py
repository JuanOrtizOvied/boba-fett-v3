"""Sync run orchestration: lock, hash, parse, diff, apply
(`openspec/changes/catalog-sharepoint-sync` — design.md ADR-2, ADR-8, ADR-9;
spec scenarios SYNC-28, SYNC-29, SYNC-30).

Not pure — this is the top-level entry point that ties every other
`catalog_sync` module together against a real database. `run_sync_from_bytes`
is called both by the local dry-run CLI (Phase 4.5, always `force=True`) and,
once Phase 7 exists, by the Graph webhook handler after downloading the
current file (`force=False`, so unchanged content is a no-op — SYNC-28).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from catalog_sync.apply import apply_changeset
from catalog_sync.diff import ChangeSet, OfficialLists, diff_catalog
from catalog_sync.lock import advisory_lock
from catalog_sync.parser import ParseReport, parse_workbook
from db.catalog_repository import CatalogRepository
from db.models import ASSET_CLASS_OPTIONS, GEOGRAPHIC_FOCUS_OPTIONS, UNDERLYING_OPTIONS


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


async def run_sync_from_bytes(
    repo: CatalogRepository, data: bytes, *, force: bool = False
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
        content_hash = _content_hash(data)

        if not force:
            last_hash = await _get_last_processed_hash(repo)
            if last_hash is not None and last_hash == content_hash:
                return RunReport(content_hash=content_hash, skipped=True)

        parse_result = parse_workbook(data)
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

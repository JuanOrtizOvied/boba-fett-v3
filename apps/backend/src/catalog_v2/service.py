"""Runs one v2 sync pass over the bytes of the workbook.

Under the advisory lock it hashes the file, skips it when the content is the one
already processed, parses it, compares it with what is stored and applies the
difference in one transaction. The hash is stored only after a successful apply,
so a failed run is retried by the next one, and a dry run reads everything and
writes nothing.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import asyncpg

from catalog_v2.apply import ApplyReport, apply_changeset
from catalog_v2.diff import ChangeSet, diff_workbook
from catalog_v2.lock import advisory_lock
from catalog_v2.parser import ParseReport, parse_workbook
from catalog_v2.repository import CatalogV2Repository


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


async def run_sync_from_bytes(
    pool: asyncpg.Pool, data: bytes, *, force: bool = False, dry_run: bool = False
) -> RunReport:
    """Sync the workbook `data` into the v2 tables. `force` ignores the stored
    hash; `dry_run` goes as far as the list of changes and writes nothing, hash
    included. A missing sheet or key column raises before anything is written."""
    digest = hashlib.sha256(data).hexdigest()
    async with advisory_lock(pool):
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

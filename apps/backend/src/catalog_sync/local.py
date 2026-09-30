"""CLI to run the SharePoint catalog sync against a local `.xlsx` file, with
no SharePoint/Graph dependency (`openspec/changes/catalog-sharepoint-sync`,
Phase 4.5):

    python -m catalog_sync.local <file.xlsx> [--dry-run]

Always forced — a local run never checks (or is gated by) the stored
content hash, since there is no real webhook subscription driving it.
`--dry-run` parses the file and diffs it against the current database but
never calls `apply_changeset`, so nothing is written; without the flag, the
resulting `ChangeSet` is applied for real, exactly like a webhook-triggered
run would (`service.run_sync_from_bytes(..., force=True)`).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from catalog_sync.diff import ChangeSet, OfficialLists, diff_catalog
from catalog_sync.parser import ParseReport, parse_workbook
from catalog_sync.service import run_sync_from_bytes
from db.catalog_repository import CatalogRepository
from db.connection import close_pool, get_pool
from db.models import ASSET_CLASS_OPTIONS, GEOGRAPHIC_FOCUS_OPTIONS, UNDERLYING_OPTIONS


async def _load_official_lists(repo: CatalogRepository) -> OfficialLists:
    managers = await repo.list_managers()
    return OfficialLists(
        asset_class=ASSET_CLASS_OPTIONS,
        geographic_focus=GEOGRAPHIC_FOCUS_OPTIONS,
        underlying=UNDERLYING_OPTIONS,
        manager=[m.name for m in managers],
        manager_scores={m.name: m.score for m in managers if m.score is not None},
    )


def _print_parse_report(report: ParseReport, *, row_count: int | None = None) -> None:
    if row_count is not None:
        print(f"Parsed rows: {row_count}")
    if report.skipped_blank_codigo:
        print(f"  Skipped (blank codigo), row(s): {list(report.skipped_blank_codigo)}")
    if report.skipped_duplicate_codigo:
        print(f"  Skipped (duplicate codigo): {list(report.skipped_duplicate_codigo)}")


def _print_changeset(changeset: ChangeSet) -> None:
    print(f"Inserts: {len(changeset.inserts)}")
    for change in changeset.inserts:
        print(f"  + {change.codigo}: {sorted(change.fields.keys())}")

    print(f"Updates: {len(changeset.updates)}")
    for change in changeset.updates:
        print(f"  ~ {change.codigo} (id={change.catalog_id}): {sorted(change.fields.keys())}")

    print(f"Adoptions: {len(changeset.adoptions)}")
    for change in changeset.adoptions:
        print(f"  ^ {change.codigo} (id={change.catalog_id}): {sorted(change.fields.keys())}")

    print(f"Soft deletes: {len(changeset.soft_deletes)}")
    for change in changeset.soft_deletes:
        print(f"  - {change.codigo} (id={change.catalog_id})")

    if changeset.ignored:
        print(f"Ignored: {len(changeset.ignored)}")
        for row in changeset.ignored:
            print(f"  ! row {row.row_number} codigo={row.codigo}: {row.reason}")


async def _run(path: Path, *, dry_run: bool) -> None:
    data = path.read_bytes()
    pool = await get_pool()
    try:
        repo = CatalogRepository(pool)

        if dry_run:
            parse_result = parse_workbook(data)
            _print_parse_report(parse_result.report, row_count=len(parse_result.rows))
            existing_rows = await repo.list_for_sync()
            official_lists = await _load_official_lists(repo)
            changeset = diff_catalog(existing_rows, parse_result.rows, official_lists)
            _print_changeset(changeset)
            print("\n[dry-run] Nothing was written.")
        else:
            report = await run_sync_from_bytes(repo, data, force=True)
            if report.parse_report is not None:
                _print_parse_report(report.parse_report)
            if report.changeset is not None:
                _print_changeset(report.changeset)
            print(f"\nApplied. content_hash={report.content_hash}")
    finally:
        await close_pool()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the SharePoint catalog sync against a local .xlsx file."
    )
    parser.add_argument("file", type=Path, help="Path to the .xlsx file")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without writing to the database",
    )
    args = parser.parse_args()

    if not args.file.exists():
        print(f"File not found: {args.file}", file=sys.stderr)
        raise SystemExit(1)

    asyncio.run(_run(args.file, dry_run=args.dry_run))


if __name__ == "__main__":
    main()

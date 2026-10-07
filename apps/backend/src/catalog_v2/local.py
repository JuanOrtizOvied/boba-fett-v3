"""Runs the v2 sync against a local `.xlsx` file, with no SharePoint or Graph:

    python -m catalog_v2.local <file.xlsx> [--dry-run]

It is always forced: a local run never checks the stored content hash. With
`--dry-run` it reads the file and compares it with the database but writes
nothing; without the flag it applies the changes for real, exactly as a
notification-driven run would.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from catalog_v2.diff import DELETE, INSERT, LINK, PRODUCT, SERIES, UPDATE, ChangeSet
from catalog_v2.parser import ParseReport
from catalog_v2.service import RunReport, run_sync_from_bytes
from db.connection import close_pool, get_pool

_LEVELS = ((PRODUCT, "products"), (SERIES, "series"), (LINK, "administrator links"))


def _print_parse_report(report: ParseReport) -> None:
    print("Parse report:")
    print(f"  rows without their key (skipped): {len(report.skipped_blank_key)}")
    print(f"  duplicate keys (skipped):         {len(report.duplicates)}")
    print(f"  unreadable numbers:               {len(report.non_numeric)}")
    print(f"  names outside the lists:          {len(report.unmatched_names)}")
    print(f"  unrecognized currency or horizon: {len(report.unrecognized)}")
    print(f"  cells marked 'por confirmar':     {len(report.pending)}")
    for sheet, header in report.missing_columns:
        print(f"  column not in the workbook: {header!r} ({sheet})")


def _print_changeset(changes: ChangeSet) -> None:
    print("Changes:")
    for level, label in _LEVELS:
        inserts, updates = len(changes.of(level, INSERT)), len(changes.of(level, UPDATE))
        deletes, unchanged = len(changes.of(level, DELETE)), changes.unchanged[level]
        print(
            f"  {label:20} inserts {inserts:4} | updates {updates:4} | "
            f"deletes {deletes:4} | unchanged {unchanged:4}"
        )
    managers = [e.name for e in changes.new_entities if e.role == "manager"]
    administrators = [e.name for e in changes.new_entities if e.role == "administrator"]
    print(
        "New entities without score: "
        f"managers {len(managers)}, administrators {len(administrators)}"
    )
    for role, duplicates in changes.possible_duplicates.items():
        for d in duplicates:
            print(f"  possible duplicate ({role}): {d.name!r} ~ {d.similar_to!r} [{d.reason}]")
    if changes.ignored:
        print(f"Ignored rows: {len(changes.ignored)}")
        for row in changes.ignored:
            print(f"  ! {row.level} row {row.row_number} {row.key}: {row.reason}")


def _print(report: RunReport) -> None:
    if report.parse_report is not None:
        _print_parse_report(report.parse_report)
    if report.changeset is not None:
        _print_changeset(report.changeset)
    if report.dry_run:
        print("\n[dry-run] Nothing was written.")
    elif report.applied is not None:
        print(f"\nApplied. entities added: {report.applied.entities_added}")
        print(f"content_hash={report.content_hash}")


async def _run(path: Path, *, dry_run: bool) -> None:
    data = path.read_bytes()
    pool = await get_pool()
    try:
        report = await run_sync_from_bytes(pool, data, force=True, dry_run=dry_run)
        _print(report)
    finally:
        await close_pool()


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the v2 catalog sync on a local .xlsx file.")
    parser.add_argument("file", type=Path, help="Path to the .xlsx file")
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview the changes without writing anything"
    )
    args = parser.parse_args()

    if not args.file.exists():
        print(f"File not found: {args.file}", file=sys.stderr)
        raise SystemExit(1)
    asyncio.run(_run(args.file, dry_run=args.dry_run))


if __name__ == "__main__":
    main()

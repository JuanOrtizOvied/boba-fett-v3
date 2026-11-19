"""Run the properties sync by hand, from a local file or from SharePoint.

    python -m properties_sync.local path/to/workbook.xlsx
    python -m properties_sync.local --sharepoint
    python -m properties_sync.local --sharepoint --apply

Without `--apply` it only previews: it reads the workbook, compares it with the
database and prints what would change, writing nothing (the one write every
command shares is `get_pool()` running pending migrations). With `--apply` it
forces one pass and writes the changes.

`--sharepoint` downloads the workbook from the configured path
(`SHAREPOINT_SITE_ID`, `SHAREPOINT_NORMALIZED_FILE_PATH` and the Azure settings).
It is an explicit manual action, so it works whatever
`SHAREPOINT_NORMALIZED_SYNC_ENABLED` says. Run it from `apps/backend`, where the
Alembic `migrations` folder is.

The output shows counts, property codes and the names of the fields that change.
It never prints a client name or a cell value: a terminal can end up in a
screenshot.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from catalog_sync.graph import GraphConfigError, GraphError
from db.connection import close_pool, get_pool
from properties_sync.diff import ChangeSet
from properties_sync.parser import MissingColumnError, MissingSheetError, ParsedProperties
from properties_sync.service import download_workbook, preview, run_sync_from_bytes


def _print_parse_report(parsed: ParsedProperties) -> None:
    print(f"Sheet rows read: {len(parsed.rows)}")
    if parsed.skipped:
        print(f"Skipped rows: {len(parsed.skipped)}")
        for row in parsed.skipped:
            print(f"  ! sheet row {row.row_number}: {row.reason}")


def _print_changeset(changeset: ChangeSet, limit: int) -> None:
    print(
        f"\nProperties: {len(changeset.inserts)} to insert, {len(changeset.updates)} to update, "
        f"{len(changeset.soft_deletes)} to delete, {len(changeset.restores)} to restore, "
        f"{changeset.unchanged} unchanged"
    )
    for insert in changeset.inserts[:limit]:
        print(f"  + {insert.key[0]}")
    for delete in changeset.soft_deletes[:limit]:
        print(f"  - {delete.key[0]}")
    for restore in changeset.restores[:limit]:
        print(f"  ^ {restore.key[0]} (restored)")
    for update in changeset.updates[:limit]:
        print(f"  ~ {update.key[0]}: {', '.join(c.field for c in update.changes)}")
    hidden = sum(
        max(len(items) - limit, 0)
        for items in (
            changeset.inserts,
            changeset.updates,
            changeset.soft_deletes,
            changeset.restores,
        )
    )
    if hidden:
        print(f"  ... {hidden} more not shown (use --limit)")
    if changeset.deletes_blocked:
        print(f"\n!! Deletes held back: {changeset.deletes_blocked}")


async def _run(args: argparse.Namespace) -> None:
    data = await download_workbook() if args.sharepoint else args.file.read_bytes()

    pool = await get_pool()
    try:
        if args.apply:
            report = await run_sync_from_bytes(pool, data, force=True, trigger="manual")
            parsed, changeset = report.parsed, report.changeset
        else:
            parsed, changeset = await preview(pool, data)
    finally:
        await close_pool()

    assert parsed is not None and changeset is not None
    _print_parse_report(parsed)
    _print_changeset(changeset, args.limit)
    if args.apply:
        print(f"\nApplied. content_hash={report.content_hash}")
    else:
        print("\n[dry-run] Nothing was written.")


def main(argv: list[str] | None = None) -> int:
    from dotenv import load_dotenv

    load_dotenv()
    parser = argparse.ArgumentParser(
        description="Run the properties sync by hand (preview unless --apply)."
    )
    parser.add_argument("file", nargs="?", type=Path, help="Path to a local .xlsx file")
    parser.add_argument(
        "--sharepoint", action="store_true", help="download the workbook from SharePoint"
    )
    parser.add_argument("--apply", action="store_true", help="write the changes to the database")
    parser.add_argument(
        "--limit", type=int, default=25, help="changes listed per kind (default 25)"
    )
    args = parser.parse_args(argv)

    if args.sharepoint == (args.file is not None):
        parser.error("pass either a file or --sharepoint")
    if args.file is not None and not args.file.exists():
        print(f"File not found: {args.file}", file=sys.stderr)
        return 1

    try:
        asyncio.run(_run(args))
    except GraphConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2
    except GraphError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except (MissingSheetError, MissingColumnError) as exc:
        print(f"Workbook error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

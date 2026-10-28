"""Run the normalized catalog sync by hand, from a local file or from SharePoint.

    python -m catalog_normalized_sync.local path/to/workbook.xlsx
    python -m catalog_normalized_sync.local --sharepoint
    python -m catalog_normalized_sync.local --sharepoint --apply

Without `--apply` it only previews: it reads the workbook, compares it with
the database and prints what would change, writing nothing (the one write
every command shares is `get_pool()` running pending migrations). With
`--apply` it writes the changes, as the webhook-driven run would.

`--sharepoint` downloads the workbook from the configured path
(`SHAREPOINT_SITE_ID`, `SHAREPOINT_NORMALIZED_FILE_PATH` and the Azure
settings). It is an explicit manual action, so it works whatever
`SHAREPOINT_NORMALIZED_SYNC_ENABLED` says. Run it from `apps/backend`, where
the Alembic `migrations` folder is.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from catalog_normalized_sync.diff import ChangeSet
from catalog_normalized_sync.parser import MissingColumnError, MissingSheetError, ParsedWorkbook
from catalog_normalized_sync.service import download_workbook, preview, run_sync_from_bytes
from catalog_sync.graph import GraphConfigError, GraphError
from db.connection import close_pool, get_pool

LEVEL_LABELS = {"product": "Products", "series": "Series", "admin": "Administrators"}


def _short(value: object, width: int = 70) -> str:
    text = repr(value)
    return text if len(text) <= width else text[: width - 3] + "..."


def _print_parse_report(parsed: ParsedWorkbook) -> None:
    print(
        f"Workbook rows: products={len(parsed.products)} series={len(parsed.series)} "
        f"administrators={len(parsed.admins)}"
    )
    if parsed.skipped:
        print(f"Skipped rows: {len(parsed.skipped)}")
        for row in parsed.skipped:
            print(f"  ! {row.sheet} row {row.row_number}: {row.reason}")


def _print_changeset(changeset: ChangeSet, limit: int) -> None:
    for level, label in LEVEL_LABELS.items():
        inserts = [c for c in changeset.inserts if c.level == level]
        updates = [c for c in changeset.updates if c.level == level]
        ignored = [c for c in changeset.ignored if c.level == level]
        deletes = [c for c in changeset.deletes if c.level == level]
        restores = [c for c in changeset.restores if c.level == level]
        print(
            f"\n{label}: {len(inserts)} to insert, {len(updates)} to update, "
            f"{len(deletes)} to delete, {len(restores)} to restore, "
            f"{changeset.unchanged.get(level, 0)} unchanged, {len(ignored)} ignored"
        )
        for change in inserts[:limit]:
            print(f"  + {' | '.join(change.key)}")
        for change in deletes[:limit]:
            print(f"  - {' | '.join(change.key)}")
        for change in restores[:limit]:
            print(f"  ^ {' | '.join(change.key)} (restored)")
        for change in updates[:limit]:
            print(f"  ~ {' | '.join(change.key)}")
            for field_change in change.changes:
                print(
                    f"      {field_change.field}: {_short(field_change.old)} -> "
                    f"{_short(field_change.new)}"
                )
        for row in ignored[:limit]:
            print(f"  ! row {row.row_number} {' | '.join(row.key)}: {row.reason}")
        hidden = sum(max(len(items) - limit, 0) for items in (inserts, updates, deletes, restores))
        if hidden:
            print(f"  ... {hidden} more not shown (use --limit)")
    if changeset.deletes_blocked:
        print(f"\n!! Deletes held back: {changeset.deletes_blocked}")


async def _run(args: argparse.Namespace) -> None:
    data = await download_workbook() if args.sharepoint else args.file.read_bytes()

    pool = await get_pool()
    try:
        if args.apply:
            report = await run_sync_from_bytes(pool, data, force=True)
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
        description="Run the normalized catalog sync by hand (preview unless --apply)."
    )
    parser.add_argument("file", nargs="?", type=Path, help="Path to a local .xlsx file")
    parser.add_argument(
        "--sharepoint", action="store_true", help="download the workbook from SharePoint"
    )
    parser.add_argument("--apply", action="store_true", help="write the changes to the database")
    parser.add_argument(
        "--limit", type=int, default=25, help="changes listed per level (default 25)"
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

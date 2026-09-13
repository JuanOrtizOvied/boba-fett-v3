"""Seed the product_catalog table from an Excel file.

Usage:
    python -m db.seed_catalog /path/to/products.xlsx
"""

from __future__ import annotations

import asyncio
import json
import re
import sys

from openpyxl import load_workbook

from db.connection import close_pool, get_pool

_ZW_RE = re.compile(r"[​‌‍﻿]")
_PCT_RE = re.compile(r"(.+?):?\s+([\d.]+)\s*%")

_SLUGS_EXPR = (
    "(SELECT COALESCE(ARRAY_AGG(DISTINCT normalize_catalog_text(btrim(v))), '{}') "
    "FROM unnest(array_prepend($1, '{}'::text[])) AS v "
    "WHERE v IS NOT NULL AND btrim(v) <> '')"
)


def _clean(value: object) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return _ZW_RE.sub("", text)


def _clean_commission(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        if value == 0:
            return "0%"
        pct = value * 100 if value < 1 else value
        formatted = f"{pct:g}%"
        return formatted
    return _clean(value)


def _clean_return_rate(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        if value == 0:
            return "0%"
        pct = value * 100 if value < 1 else value
        formatted = f"{pct:g}%"
        return formatted
    return _clean(value)


def _parse_pct_list(text: str, *, fallback_100: bool = False) -> str:
    """Parse 'Name1 X%, Name2 Y%' into JSON array of {name, percentage}.

    Handles comma, newline, multi-space, and ' y ' as separators.
    Handles optional colon before the percentage (e.g. 'Bonos: 21%').
    When *fallback_100* is True and no percentages are found, returns a
    single entry with 100% allocation.
    """
    cleaned = _clean(text)
    if not cleaned:
        return "[]"

    normalized = cleaned.replace("\n", ",").replace("\r", ",")
    normalized = re.sub(r"%\s{2,}", "%, ", normalized)
    normalized = re.sub(r"%\s+y\s+", "%, ", normalized)

    parts = [p.strip() for p in re.split(r",(?![^(]*\))", normalized) if p.strip()]
    result = []
    for part in parts:
        part = part.strip().rstrip(",")
        m = _PCT_RE.match(part)
        if m:
            name = m.group(1).strip().rstrip(",").rstrip(":")
            pct = float(m.group(2))
            result.append({"name": name, "percentage": pct})

    if not result and cleaned and fallback_100:
        result = [{"name": cleaned, "percentage": 100}]
    return json.dumps(result)


async def seed(path: str) -> int:
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(min_row=2, values_only=True))
    wb.close()

    pool = await get_pool()

    async with pool.acquire() as conn:
        admin_rows = await conn.fetch(
            "SELECT name, score FROM administrator"
        )
        admin_scores = {r["name"].lower().strip(): r["score"] for r in admin_rows}

        mgr_rows = await conn.fetch(
            "SELECT name, score FROM manager"
        )
        mgr_scores = {r["name"].lower().strip(): r["score"] for r in mgr_rows}

        await conn.execute("TRUNCATE product_catalog RESTART IDENTITY")

        count = 0
        for row in rows:
            if not row or not row[0]:
                continue
            name = _clean(row[0])
            if not name:
                continue

            administrator = _clean(row[6])
            manager = _clean(row[7])
            admin_score = admin_scores.get(administrator.lower().strip())
            mgr_score = mgr_scores.get(manager.lower().strip())

            await conn.execute(
                f"""INSERT INTO product_catalog
                   (name, geographic_focus, asset_class, underlying,
                    commission, currency, administrator, manager,
                    liquidity, return_rate, administrator_score,
                    manager_score, slugs)
                   VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb,
                           $5, $6, $7, $8, $9, $10, $11, $12,
                           {_SLUGS_EXPR})""",
                name,
                _parse_pct_list(row[1]),
                _parse_pct_list(row[2], fallback_100=True),
                _parse_pct_list(row[3], fallback_100=True),
                _clean_commission(row[4]),
                _clean(row[5]),
                administrator,
                manager,
                _clean(row[8]),
                _clean_return_rate(row[9]),
                admin_score,
                mgr_score,
            )
            count += 1

    await close_pool()
    return count


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python -m db.seed_catalog <path-to-excel>")
        sys.exit(1)
    total = asyncio.run(seed(sys.argv[1]))
    print(f"Seeded {total} products into product_catalog")

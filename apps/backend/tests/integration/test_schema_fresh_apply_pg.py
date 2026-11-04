"""Integration test: `schema.sql` must apply cleanly to a BRAND-NEW database.

Regression for the `geographic_focus` / `asset_class` TEXT→JSONB migrations,
whose `ALTER COLUMN ... TYPE JSONB` failed on a fresh apply because the column's
`DEFAULT ''` (text) could not be cast automatically to jsonb. An already-migrated
DB skips those blocks (the `data_type='text'` guard is false), so the suite's
shared test DB never exercised a fresh apply.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg

from tests.conftest import require_test_database_url

_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "src" / "db" / "schema.sql"


async def test_schema_applies_to_a_fresh_database():
    url = require_test_database_url()
    parts = urlsplit(url)
    maintenance_url = urlunsplit(parts._replace(path="/postgres"))
    dbname = f"sabbi_fresh_{uuid.uuid4().hex}"

    admin = await asyncpg.connect(maintenance_url)
    try:
        await admin.execute(f'CREATE DATABASE "{dbname}"')
        fresh = await asyncpg.connect(urlunsplit(parts._replace(path=f"/{dbname}")))
        try:
            # Must not raise — a fresh apply of the whole schema.
            await fresh.execute(_SCHEMA_PATH.read_text())
            data_type = await fresh.fetchval(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'products' AND column_name = 'geographic_focus'"
            )
            assert data_type == "jsonb"
        finally:
            await fresh.close()
    finally:
        await admin.execute(f'DROP DATABASE IF EXISTS "{dbname}"')
        await admin.close()

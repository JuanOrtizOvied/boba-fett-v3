# Feature: schema.sql must apply cleanly to a fresh database

- **Feature ID:** `schema-fresh-apply`
- **File locator:** `odd/tasks/schema-fresh-apply.md`
- **Engram mirror topic:** `odd/schema-fresh-apply/tasks`
- **Branch:** `feat/ficha-catalog-curation` (carried with the current branch).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`.

## Objective

`apps/backend/src/db/schema.sql` is auto-applied on first `get_pool()`
(`db/connection.py`) and once per test session (`tests/conftest.py`). It was
only ever built incrementally, so a FRESH apply (new dev DB, ephemeral CI DB,
disaster recovery) failed. Make the whole file idempotently fresh-appliable
while preserving behavior on already-migrated (production) DBs.

## Root causes found (all fresh-apply only; guarded blocks skip on legacy)

1. **`products.geographic_focus` / `asset_class` TEXT→JSONB cast.** `ALTER COLUMN
   ... TYPE JSONB` re-casts the column's `DEFAULT ''` (text) to jsonb and fails
   (`default ... cannot be cast automatically to type jsonb`). Fix: `DROP DEFAULT`
   before the type change, then `SET DEFAULT '[]'::jsonb`. Same hardening applied
   to the two `product_catalog` blocks (no-op on fresh, where they're jsonb).
2. **`product_catalog` referenced before `CREATE TABLE`.** The legacy
   `DROP COLUMN subcategory` and the `underlying` backfill `UPDATE` ran before
   the table's `CREATE TABLE IF NOT EXISTS` (further down). Fix: guard both with
   `IF EXISTS (information_schema.tables/columns ...)` so they no-op on a fresh
   apply and still run on legacy DBs.
3. **`products.amount` NUMERIC→TEXT blocked by the inline CHECK.** The fresh
   table's `CHECK (amount > 0)` (auto-named `products_amount_check`) is
   re-validated during `ALTER COLUMN amount TYPE TEXT` → `operator does not
   exist: text > numeric`. The migration dropped only `products_amount_positive`,
   and AFTER the type change. Fix: drop both constraint names BEFORE the type
   change (`DROP IF EXISTS` is a no-op on DBs without them).

## Tasks
- [x] **T-1 — Fresh-apply regression test.** DONE. Route: INLINE.
  `tests/integration/test_schema_fresh_apply_pg.py`: creates a uniquely-named
  temp database off the maintenance (`/postgres`) URL, applies the whole
  `schema.sql`, asserts no error and `products.geographic_focus` ends up `jsonb`,
  then drops the temp DB. TDD: RED (DatatypeMismatchError) → GREEN after the
  schema fixes. Skips when `TEST_DATABASE_URL` is unset.
- [x] **T-2 — Schema fixes (root causes 1–3).** DONE. Route: INLINE. See above.
  Verified via `psql -v ON_ERROR_STOP=1 -f schema.sql` on a fresh scratch DB
  (clean) and the regression test (GREEN).

## Checks / evidence
- Fresh apply: regression test 1/1 GREEN; `psql` fresh apply exits 0.
- Existing-DB behavior preserved: dev-flow backend suite **364 passed / 149
  skipped / 0 new** (integration skipped without `TEST_DATABASE_URL`). With the
  shared seeded test DB, 30 integration failures are **pre-existing** (accumulated
  seed/row-count state), unchanged by this fix (31→30: my new test flipped to
  pass). ruff clean on the new test.

## Next step
Commit; feature complete.

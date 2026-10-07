# Feature: Normalized Product Catalog (new version)

- **Feature ID:** `catalog-v3-normalized`
- **File locator:** `odd/tasks/catalog-v3-normalized.md`
- **Engram mirror topic:** `odd/catalog-v3-normalized/tasks`
- **Branch:** `feat/catalog-v3-normalized` (branch off `main` before first commit)
- **TDD mode:** enabled (strict) — source: project CLAUDE.md "Strict TDD Mode: enabled". Runner: `pytest -q` (from `apps/backend`, `pythonpath=src`). Integration tests need `TEST_DATABASE_URL` (present in `apps/backend/.env`).

## Objective

Build a NEW, normalized version of the product database as a **data layer only**,
in parallel to the existing flat `product_catalog` table, which stays untouched
along with all its consumers (agent tools, search, admin UI, portfolio).

Source of truth for the data: `BD_Productos_Sabbi_v2.xlsx` (3 sheets).

## Problem / why

The current `product_catalog` is flat: one row per product with `administrator`
as a single text field. The business v2 database models a 3-level hierarchy:

- **Producto** (333 rows) — classification, manager, currency, horizon. Key: `Código` (BD-XXXXX).
- **Producto × Serie** (355 rows) — TER, flows, returns per series. 1 product → N series.
- **Producto × Serie × Administrador** (358 rows) — custody, buy/sell commission,
  billing currency, minimums per administrator. 1 (product, series) → N administrators.

Verified referential integrity in the Excel (all clean, no dupes): every
`(code, series)` in sheet 3 exists in sheet 2; every code exists in sheet 1.
→ a composite FK `admin → (product_code, series)` is safe.

## Scope (authorized)

- IN: 3 new tables, Alembic migration (chained from head `8dd9733f267d`),
  mirror in `src/db/schema.sql` (test fixtures apply this file), read models,
  read repository, ingestion script from the Excel. Unit + integration tests.
- OUT: do NOT modify `product_catalog`, `catalog_repository.py`, agent tools,
  search, admin UI, or portfolio code. No consumer rewiring (user chose
  "Solo capa de datos").

## Design decisions

- Table names (new normalized namespace, distinct from legacy flat `product_catalog`):
  `catalog_product`, `catalog_product_series`, `catalog_product_series_admin`.
- Percent-list fields (`asset_class`, `geographic_focus`, `underlying`) parsed to
  JSONB `{name, percentage}[]` reusing `db.seed_catalog._parse_pct_list` — same
  convention as the flat catalog / `AssetAllocation`.
- TER / flows / returns / commissions stored as `NUMERIC` fractions exactly as in
  the Excel (0.0384 = 3.84%). Document that they are fractions, not percentages.
- `administrator` stored as free text (74 distinct names in sheet 3 do NOT map 1:1
  to the existing `administrator` reference table; the Excel is authoritative here).
- Schema lives in BOTH Alembic migration (prod/dev via `connection._run_migrations`)
  AND `src/db/schema.sql` (integration test fixtures apply this once per session).
- Python module: `src/db/catalog_normalized.py` (models + `NormalizedCatalogRepository`).

## Schema

`catalog_product`: id PK, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
ticker_isin TEXT, manager TEXT, asset_class JSONB, geographic_focus JSONB,
underlying JSONB, currency TEXT, investment_horizon TEXT, created_at.

`catalog_product_series`: id PK, product_code TEXT NOT NULL → catalog_product(code),
series TEXT NOT NULL, management_fee_ter NUMERIC, flows_min/max NUMERIC,
return_min/max NUMERIC, created_at, UNIQUE(product_code, series).

`catalog_product_series_admin`: id PK, product_code TEXT NOT NULL, series TEXT NOT NULL,
administrator TEXT NOT NULL, custody_fee NUMERIC, buy_commission NUMERIC,
sell_commission NUMERIC, billing_currency TEXT, minimum_usd NUMERIC,
min_commission_usd NUMERIC, created_at,
FK (product_code, series) → catalog_product_series(product_code, series),
UNIQUE(product_code, administrator, series).

## Tasks

- [x] **T-001 — Schema + migration.** Add the 3 tables to `src/db/schema.sql`
  (idempotent `CREATE TABLE IF NOT EXISTS`) and a new Alembic migration
  `migrations/versions/<rev>_add_normalized_catalog.py` chained from `8dd9733f267d`.
  RED: integration test inserting a product → series → admin chain and asserting
  the composite FK + UNIQUE constraints. Route: delegated writer.
- [x] **T-002 — Read models + repository.** `src/db/catalog_normalized.py`:
  Pydantic models (`CatalogProductRow`, `CatalogProductSeries`,
  `CatalogProductSeriesAdmin`) + `NormalizedCatalogRepository` (`list_products`,
  `get_product_detail(code)` returning product with nested series and their admins).
  RED: integration tests for the reads. Route: delegated writer.
- [x] **T-003 — Ingestion script.** `src/db/seed_catalog_normalized.py` reading the
  3 sheets by name into the 3 tables in dependency order (idempotent upsert,
  reusing `_parse_pct_list` / `_clean`). RED: unit tests for row-mapping/parse
  helpers (no DB). Route: delegated writer.
- [ ] **T-004 — Verify + seed.** Run `pytest -q` + `ruff check src/`; report results.
  Then (with user ok) run the real ingestion against the dev Postgres and report
  row counts (expected 333 / 355 / 358).

## Acceptance criteria

- `pytest -q` green (new tests included); `ruff check src/` clean.
- `product_catalog` and its consumers byte-unchanged.
- Ingestion of `BD_Productos_Sabbi_v2.xlsx` yields 333 / 355 / 358 rows with FKs intact.

## Progress / evidence

- T-001 done: schema.sql appended + migration a7c1e2d3f4b5 (down 8dd9733f267d); RED (ImportError) -> GREEN, 5 constraint tests pass vs sabbi_test.
- T-002 done: src/db/catalog_normalized.py; 3 repo integration tests green.
- T-003 done: src/db/seed_catalog_normalized.py; 14 unit tests green (no DB). Real seed NOT run.
- Verify: new tests 22 passed; full suite 382 passed / 13 failed (pre-existing, Fernet-encrypted columns in sabbi_test, unrelated); ruff clean on src/ and new files.

## Next step

Delegate T-001..T-003 to one bounded writer (TDD), then T-004 verify.

# Feature: Ficha Patrimonial enrichment on the V2 normalized catalog

- **Feature ID:** `ficha-patrimonial-v2`
- **File locator:** `odd/tasks/ficha-patrimonial-v2.md`
- **Engram mirror topic:** `odd/ficha-patrimonial-v2/tasks`
- **Branch:** `feat/ficha-patrimonial-v2` (off `main` @ `439f318`)
- **TDD mode:** strict (project convention). Backend runner: `apps/backend/.venv/bin/python -m pytest -q`. Web: `yarn workspace web test`.

## Objective

Make the admin "Ficha Patrimonial" import enrich each parsed row from the **normalized V2 catalog**
(`catalog_product` / `catalog_product_series` / `catalog_product_series_admin`) instead of the
flat V1 `product_catalog`. Product-level fields auto-fill from V2; the **admin picks the
series/administrator** in the review table, which fills the commercial fields. Commercial fields
are NEVER guessed.

## Authorized scope

- Ficha patrimonial ONLY (parse/enrich + review table). The chat agent's `search_product` /
  `cascade_search` stay on V1 — UNTOUCHED.
- Legacy flat `product_catalog`, `CatalogRepository`, and the flat `/admin/catalog` UI stay
  UNTOUCHED (project constraint — no parallel writers, don't touch V1 consumers).

## Product decisions (confirmed by user)

1. **Shape mismatch → "Producto + admin elige serie/admin".** V2 is product → series → series×admin,
   but a ficha row is one product. L1 fills product-level fields; the admin picks the series and
   administrator in the review table. Commercial fields (commission, administrator, return_rate,
   liquidity) are never auto-guessed.
2. **Model untouched.** The L2 gap-fill keeps `claude-haiku-4-5` (`EXTRACTION_MODEL_NAME`).
   This change is about the catalog SOURCE, not the extraction model.
3. **Defaults:**
   - **pg_trgm matching on `catalog_product.name`** — mirror V1's `similarity(name,$1) > 0.1`
     pattern (extension already enabled; no new migration/index needed for a ~300-row table).
   - **V2-only coverage, no V1 fallback** — ficha L1 queries V2 exclusively.
   - **`management_fee_ter` as the primary commission** — once the admin picks a series.

## Design

### Field classification

- **Product-level (auto-fill from V2 L1; L2/L3 may fill gaps):** `name`, `currency`, `manager`,
  `asset_class`, `geographic_focus`, `underlying`.
- **Commercial (admin picks series/admin; NEVER auto-guessed, excluded from L2/L3 merge):**
  `commission` (← series `management_fee_ter`), `administrator`, `return_rate` (← series
  `return_min`/`return_max`), `liquidity` (left blank — no V2 field).

### Backend

- `NormalizedCatalogRepository.search_for_enrichment(query) -> CatalogProductRow | None`:
  best name-similarity match (mirror V1 threshold) WITH nested series+admins
  (reuse `get_product_detail` on the winning `code`).
- `db/models.py`: option models `CatalogSeriesAdminOption`, `CatalogSeriesOption` (lightweight,
  defined here to avoid a `db.models` → `db.catalog_normalized` circular import). Add to
  `SearchResult`: `catalog_product_code: str = ""`, `series_options: list[CatalogSeriesOption] = []`
  (optional/defaulted → chat's `SearchResult` consumers unaffected).
- `agent/search.py`: a **separate** `cascade_search_v2(query, pool)` + `_search_catalog_v2(...)`.
  V2 L1 fills product-level fields + `catalog_product_code` + `series_options`; L2/L3 reuse the
  existing module helpers but merge ONLY product-level fields (restricted field set — no commercial
  guessing). `cascade_search` (V1, chat) stays byte-identical.
- `api/admin_routes.py`: `_enrich_ficha_row` calls `cascade_search_v2` instead of `cascade_search`.

### Frontend

- TS mirror: add `catalog_product_code` + `series_options` to the enriched `SearchResult` shape
  (`apps/web/lib/portfolio-types.ts`).
- `ReviewTable.tsx` + `reviewTableShared.ts`: when a row has `series_options`, render a
  series picker and an administrator picker. On selection, fill the editable row's `commission`
  (from `management_fee_ter`, formatted %), `administrator`, and `return_rate` (from the series
  return range). `liquidity` stays blank. Confirm payload shape is unchanged (`ProductCreate`).

### Out of scope / untouched

- `confirm_ficha_patrimonial` persistence shape (creates portfolio `products`; no catalog FK change).
- V1 `product_catalog`, `CatalogRepository.search`, flat `/admin/catalog`, chat `cascade_search`.

## Tasks

- [x] **T-1 — V2 enrichment search (backend repo).** DONE. Added
  `NormalizedCatalogRepository.search_for_enrichment(query)` — pg_trgm best-match mirroring V1
  (`similarity(name,$1) > 0.1 OR name ILIKE`), then `get_product_detail` for nested series+admins;
  blank/no-match → None. Route: INLINE (2 files, mechanical mirror of V1 pattern, tight TDD loop
  against test DB). TDD: RED (AttributeError) → GREEN. Integration PG: 12/12 passed
  (`test_catalog_normalized_pg.py`, incl. 4 new `search_for_enrichment` cases) against a dedicated
  alembic-migrated test DB.
- [x] **T-2 — V2 cascade + ficha wiring (backend).** DONE. Route: INLINE (full context loaded,
  surgical edits, live TDD loop) — writer-trigger (4 files) noted; chose inline deliberately.
  Added `CatalogSeriesOption`/`CatalogSeriesAdminOption` + `SearchResult.catalog_product_code` /
  `series_options` (`db/models.py`); `PRODUCT_FIELD_NAMES`, `fields=` param on `_merge_fields`,
  `_is_product_complete`, `_series_options`, `_search_catalog_v2`, `cascade_search_v2`
  (`agent/search.py`); `_enrich_ficha_row` now calls `cascade_search_v2` (`api/admin_routes.py`);
  updated `test_ficha_patrimonial_routes.py` monkeypatch target. `cascade_search` (V1/chat) and
  `agent/tools.py` UNCHANGED. TDD: RED (missing symbols) → GREEN, `test_search_v2.py` 4/4 incl. a
  regression guard that V1 `cascade_search` STILL fills commercial fields. Full backend suite:
  452 passed, 13 pre-existing env failures (all `amount` field-encryption in untouched
  product/audit/versioning tests — verified identical on base+T-1 via stash), 0 new.
- [x] **T-3 — Series/admin picker (frontend).** DONE. Route: INLINE (harness: no subagents unless
  asked). TS types `CatalogSeriesOption`/`CatalogSeriesAdminOption` + optional
  `SearchResult.catalog_product_code`/`series_options` (`portfolio-types.ts`); `EditableFichaRow`
  gains `seriesOptions`/`selectedSeries`/`selectedAdministrator`; pure helpers
  `formatFractionAsPercent` and `applySeriesAdminSelection` (fills commission from
  `management_fee_ter`, return range from series, administrator from pick; unknown series =
  selection only) in `reviewTableShared.ts`; Serie + Administrador selects in `ProductCard`
  (`ReviewTable.tsx`), admin select disabled until a series is picked; `aria-label` added to the
  free-text Administrador input. `liquidity` left blank (no V2 field). TDD: RED->GREEN. Ficha
  review-table tests 23/23 (7 new shared + 1 new component picker test).
- [x] **T-4 — Final verification.** DONE. Backend full suite 452 passed / 13 pre-existing env
  failures (`amount` field-encryption, verified identical on base via stash) / 0 new. Web full
  suite 87 passed / 8 failed — the 8 are EXACTLY the 4 pre-existing stale files
  (admin-portfolio-approval, bulk-accept-bar, ficha-patrimonial-page, propose-product-card),
  verified identical (same 8) on base+T1+T2 via stash; my 8 new tests pass, 0 new failures.
  Chat path (`cascade_search`, `agent/tools.py`) confirmed untouched.

## Acceptance criteria / checks

- Ficha enrichment L1 reads `catalog_product*` (V2); a row matching a V2 product gets its
  product-level fields filled and carries `series_options`.
- Commercial fields are blank until the admin picks a series/admin; selecting one fills
  `commission` (from `management_fee_ter`), `administrator`, `return_rate`. `liquidity` stays blank.
- Chat `cascade_search` / `search_product` behaviour unchanged (V1).
- V1 `product_catalog` / flat `/admin/catalog` untouched.
- Backend `pytest -q` and web suite: 0 new failures vs. `main` base (8 pre-existing web failures
  remain the known follow-up).

## Progress / evidence

- **Test DB setup (integration PG).** `schema.sql` has a latent bug on a TRULY fresh apply
  (`products.geographic_focus`: `ALTER COLUMN ... TYPE JSONB` without dropping the old `DEFAULT ''`
  → `DatatypeMismatchError`). NOT in scope to fix. Workaround: build the test DB with
  `alembic upgrade head` first (correct schema), then the conftest's idempotent `schema.sql` apply
  skips the `DO` migration block. Dedicated DB `boba_fett_ficha_test` (TEMPLATE template0), creds
  from user-provided DSN. Run: `TEST_DATABASE_URL='postgresql://admin:pass@localhost:5432/boba_fett_ficha_test' .venv/bin/python -m pytest tests/integration/...`.
- **T-1:** integration PG 12/12 passed (4 new `search_for_enrichment` cases). Commit `26812f5`.
- **T-2:** `test_search_v2.py` 4/4; full backend suite 452 passed / 13 pre-existing env failures /
  0 new. Commit `aa888f7`.
- **T-3/T-4:** ficha review-table tests 23/23; web suite 87 passed / 8 pre-existing failures / 0
  new; backend 452 passed / 0 new. Commit `146ab4e`.

## Next step

Feature complete (T-1..T-4 done, all on branch `feat/ficha-patrimonial-v2`). Push / PR are the
user's call under ordinary repo policy. Open follow-up (separate, pre-existing on `main`): the 4
stale web test files and the `schema.sql` fresh-apply `products.geographic_focus` default-cast bug.

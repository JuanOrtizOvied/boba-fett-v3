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
- [ ] **T-2 — V2 cascade + ficha wiring (backend).** Option models + `SearchResult` fields;
  `_search_catalog_v2` + `cascade_search_v2` (product-only L2/L3 merge); wire `_enrich_ficha_row`.
  RED→GREEN unit tests. Assert `cascade_search` (V1) unchanged.
- [ ] **T-3 — Series/admin picker (frontend).** TS types + ReviewTable picker filling commercial
  fields from the selected series/admin; liquidity blank. RED→GREEN vitest.
- [ ] **T-4 — Final verification.** Full backend + web suites; confirm 0 new failures vs. base;
  confirm chat path untouched.

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
- **T-1:** integration PG 12/12 passed (4 new `search_for_enrichment` cases). Commit: (below).

## Next step

Start T-1.

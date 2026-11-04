# Feature: Ficha as catalog curator (update/create V2 + history)

- **Feature ID:** `ficha-catalog-curation`
- **File locator:** `odd/tasks/ficha-catalog-curation.md`
- **Engram mirror topic:** `odd/ficha-catalog-curation/tasks`
- **Branch:** `feat/ficha-catalog-curation` (off the current ficha work).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`; web `yarn workspace web test`.

## Objective (user-confirmed scope: "Ambos")

Approving a ficha line now curates the V2 catalog AND creates the client's
holding:
- **Catalog match + edits** → UPDATE `catalog_product` (+ series/admins), record
  history → create the client `product` linked to the `catalog_product_code`.
  Button: "Es un producto existente".
- **Not in catalog** (already web-searched via Claude) → CREATE a new
  `catalog_product` (+ history as a creation) → create the linked client
  `product`. Button: "Aprobar y crear producto".

This reverses the earlier "catalog read-only" decision: the ficha is now a
writer to the V2 catalog.

## Building blocks (verified)
- V2 update methods EXIST: `NormalizedCatalogRepository.update_product` /
  `update_series` / `update_admin` / `create_*` (used by the admin catalog CRUD).
- L3 web search for not-found already uses Claude `web_search`/`web_fetch`.
- NO catalog history table yet → build one.

## Proposed defaults (adjustable)
- **History table** `catalog_product_history`: `product_code`, `action`
  (create/update), `changed_by` (admin uuid), `source` ('ficha'), `changes`
  JSONB (field → {old, new}), `created_at`.
- **Fields propagated on update:** product-level (name, manager, currency,
  ticker_isin, investment_horizon, asset_class, geographic_focus, underlying) +
  series (TER/flows/returns) + admins (custody/buy/sell/minimum).
- **New-product code:** auto-generated next free `BD-#####`.

## Tasks
- [x] **T-1 — History table + repo.** DONE. Route: INLINE. `catalog_product_history`
  (product_code, action CHECK create/update, changed_by UUID FK users, source,
  changes JSONB, created_at; indexed by code; no FK to catalog_product so the
  audit survives deletes) in `schema.sql`. `db/catalog_history.py`:
  `CatalogHistoryEntry` + `CatalogHistoryRepository.record(...)` /
  `list_for_product(code)` (newest first, JSONB round-trip). TDD: RED
  (ModuleNotFound) → GREEN. Integration `test_catalog_history_pg` 2/2. Backend
  351 passed / 147 skipped / 0 new; ruff clean. Commit: `d485f2e`.
- [x] **T-2 — Update catalog on approve: product-level (backend service).** DONE.
  Route: INLINE. `db/catalog_curation.py::apply_catalog_product_update(catalog_repo,
  history_repo, code, CatalogProductUpdate, changed_by)` — fetches the current
  product, diffs the product-level fields (name/manager/currency/ticker_isin/
  investment_horizon + asset_class/geographic_focus/underlying), updates ONLY
  when something changed, and records the diff ({field:{old,new}}) to history.
  Returns the diff; empty + no writes when unchanged or missing. TDD: RED
  (ModuleNotFound) → GREEN. Unit tests (mocked repos, no DB) 4/4. Backend 355
  passed / 0 new; ruff clean. Commit: `22e5ac5`. NOTE: series/admin updates and
  the approve ENDPOINT wiring are the next step (T-2b / T-3).
- [x] **T-2b — Series + admins.** DONE. Route: INLINE. `apply_catalog_curation`
  (product + series + admins, one combined history row); `_apply_series`/
  `_apply_admins` match by series name / (series, administrator) using the ids
  from `get_product_detail`, diff with a float tolerance, `update_series`/
  `update_admin` only changed rows. `SeriesUpdateInput`/`AdminUpdateInput` models.
  `apply_catalog_product_update` kept as a product-only wrapper. TDD → GREEN;
  curation tests 6/6; backend 357 passed / 0 new; ruff clean. Commit: `eb4100e`.
- [x] **T-3 — Approve endpoint + client holding.** DONE. Route: INLINE.
  `POST /admin/ficha-patrimonial/approve` (`FichaApproveRequest`: user_id,
  ProductCreate, catalog_product_code, catalog_update, series[], admins[]): when
  a `catalog_product_code` is present it runs `apply_catalog_curation`
  (update + history, `changed_by` = the admin), then creates the client
  `product` (linked via `catalog_product_id`), returning
  `{product_id, catalog_changes}`. `_history_repo` DI helper +
  `app.state.history_repo = CatalogHistoryRepository(pool)` wired in
  `api/routes.py`. TDD: RED → GREEN. Route tests: approve updates catalog +
  creates product; no-code skips curation. Backend 359 passed / 147 skipped / 0
  new; ruff clean; `api.routes` imports clean. Commit: `9f8dc44`.
- [x] **T-4 — Create new product in catalog.** DONE. Route: INLINE.
  `NormalizedCatalogRepository.next_product_code()` (max `BD-#####` + 1);
  `create_catalog_product_from_ficha(...)` generates the code, `create_product`
  from the edited product-level fields (name fallback = client product name),
  records a 'create' history row. Approve endpoint's no-code branch now CREATES
  a new catalog product and links the client holding via `catalog_product_id`
  (replacing the earlier "skip curation"). TDD: RED → GREEN. Unit tests (service
  + name fallback) + integration (next_product_code increments) + updated route
  test. Backend 361 passed / 148 skipped / 0 new; ruff clean. Commit: `a0d46bd`.
- [~] **T-5 — Frontend.** Split a/b.
  - [x] **T-5a — API client + conversion helpers.** DONE. TS types
    `CatalogSeriesUpdate`/`CatalogAdminUpdate`/`FichaApproveRequest`
    (`portfolio-types.ts`); `approveFichaLine(request)` in `fichaApi.ts`; pure
    `percentToFraction` + `buildApproveRequest(row, userId)` in
    `reviewTableShared.ts` (client holding via `buildConfirmProducts`, catalog
    code, and series/admin values converted back to fractions). TDD → GREEN.
    Tests: percentToFraction (2), buildApproveRequest (2), approveFichaLine api
    (1). tsc + eslint clean. Web 149 passed / 6 pre-existing / 0 new.
  - [x] **T-5b — Button wiring.** DONE. The card's primary per-line button reads
    "Es un producto existente" when `catalog_matched` else "Aprobar y crear
    producto"; clicking it marks the line approved AND calls `onApprove`
    (ReviewTable builds the request via `buildApproveRequest` and the page POSTs
    `/approve` via `approveFichaLine`, then refreshes the list). Removed the old
    disabled "Es un producto existente" button. TDD → GREEN; updated the picker +
    deferred tests, added an onApprove test; page test mocks `approveFichaLine`.
    Web 150 passed / 6 pre-existing / 0 new; tsc + eslint clean. Commit: `5749e3b`.

**FEATURE COMPLETE** (T-1..T-5): ficha approve now curates the V2 catalog
(update existing with history, or create new web-searched products with a
generated code) AND creates the linked client holding, end-to-end.

- [x] **Follow-up — History read (backend + API client).** DONE.
  `GET /admin/catalog/products/{code}/history` → `list_for_product` (route test);
  TS `CatalogHistoryEntry` + `fichaApi.getCatalogHistory(code)` (api test). The
  change history is now READABLE (UI display of it is the remaining piece).
  Backend 362 passed / 0 new; web 10/10 ficha-api; tsc + eslint clean.
  Commit: `3a926df`.

## Acceptance criteria / checks
- Editing a catalog-matched product and approving updates the V2 tables and
  writes a history row; a new product is created in the catalog; both create the
  linked client holding. 0 new failures vs. base.

## Next step
Implement T-1 (RED → GREEN).

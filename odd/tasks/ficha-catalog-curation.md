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
  curation tests 6/6; backend 357 passed / 0 new; ruff clean. Commit: `__T2b__`.
- [ ] **T-3 — Client holding linked.** Approve also creates the client `product`
  with `catalog_product_id`/code set.
- [ ] **T-4 — Create new product in catalog.** Web-searched → `create_product`
  (+ history) + code generation.
- [ ] **T-5 — Frontend.** Button shows "Es un producto existente" (update) vs
  "Aprobar y crear producto" (create) by `catalog_matched`; wire edits → update.

## Acceptance criteria / checks
- Editing a catalog-matched product and approving updates the V2 tables and
  writes a history row; a new product is created in the catalog; both create the
  linked client holding. 0 new failures vs. base.

## Next step
Implement T-1 (RED → GREEN).

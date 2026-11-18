# Feature: admin "Buscar producto" — single-name cascade lookup

- **Feature ID:** `admin-product-lookup`
- **File locator:** `odd/tasks/admin-product-lookup.md`
- **Engram mirror topic:** `odd/admin-product-lookup/tasks`
- **Branch:** `feat/admin-product-lookup` off `feat/admin-single-catalog-section` (which is
  itself unmerged off `main` — so merging this branch brings the catalog consolidation too).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q -p no:recording`;
  web `cd apps/web && yarn vitest run <file>` + `npx tsc --noEmit`.
- **Route:** INLINE single writer.

## User request
> "debemos implementar una seccion que solo busco un producto por el nombre ingresado
> con la misma logica, primero catalogo y si no encuentra buscar en la web con claude"

A standalone admin section: type a product name → run the SAME enrichment cascade the ficha
uses (`cascade_search_v2`: normalized catalog L1 → Claude knowledge L2 → Claude web L3) →
show the result. READ-ONLY lookup (assumption from "solo busco"): view the enriched product,
no approve/create/edit.

## Design / reuse
- Backend `cascade_search_v2(name, pool)` already IS "catalog first, then web with Claude";
  it is only wired into the ficha parse today. Expose it via a new single-name endpoint.
- `SearchResult` (frontend type) already carries everything to display: provenance,
  confidence, series_options (with suggested confidence), sources, web_search_insufficient.

## Tasks
- [x] **T-1 — Backend: `POST /admin/product-lookup`.** DONE. INLINE (TDD). Added
  `ProductLookupRequest {name}` + `product_lookup` endpoint returning `SearchResult | None`
  (null when the cascade finds nothing), reusing `cascade_search_v2(name, product_repo.pool)`;
  blank name → null with no DB/LLM call. Router-level `require_admin` guards it. TDD: RED (404)
  → GREEN. 4 tests (returns result + trims name + passes pool; null when None; blank
  short-circuit no cascade call; non-admin blocked). Checks: ficha-routes suite 39 passed;
  ruff clean. Commit: `eafcde0`.
- [x] **T-2 — Frontend: "Buscar producto" page + nav + read-only result.** DONE. INLINE (TDD).
  New `lib/catalogLookupApi.ts` `lookupProduct(name): Promise<SearchResult | null>` →
  `POST /api/admin/product-lookup`. New route `app/admin/buscar-producto/page.tsx` (name input +
  Buscar button + idle/loading/done states; not-found message on null). New read-only
  `components/admin/ProductLookupResult.tsx`: reuses `SOURCE_BADGES` for the origin badge, shows
  a confidence pill, the present product fields, asset_class/geographic_focus/underlying lists,
  series_options (with ✨ suggested confidence badge), Fuentes, and the web_search_insufficient
  notice. Nav entry added in `app/admin/layout.tsx`. TDD: RED (missing modules) → GREEN. 3 tests
  (search shows result + origin badge; null → not-found; insufficient → warning). Checks: full
  web suite 218 passed / 20 files; tsc clean. Commit: `eafcde0`.

## Extension (2026-11-11): editable form + save to catalog

User request: *"el resultado del producto en /admin/buscar-producto tambien debe mostrarse en un
formulario como aparece en ficha patrimonial"*. Scope confirmed via AskUserQuestion:
**"Editable + guardar al catálogo"** — the lookup result is shown in the SAME editable form the
ficha uses (field grid + Series/Administradores tables) and can be SAVED to the normalized
catalog. No client/holding part (that only applies to the ficha).

### Design / reuse
- The catalog write already exists and is client-free: `apply_catalog_curation` (update an
  existing product) and `create_catalog_product_from_ficha` (create a new one), both in
  `db/catalog_curation.py`, used today by `POST /ficha-patrimonial/approve`.
- `/approve` cannot be reused directly: `FichaApproveRequest.product: ProductCreate` and
  `ProductCreate.amount = Field(gt=0)` force a positive amount a lookup does not have, and the
  catalog write never uses `product.amount`. So a dedicated endpoint without `ProductCreate`.
- The ficha form atoms (AllocationEditor/Field/ConfidenceTag/SuggestedBadge/SeriesTable/
  AdminTable/inputClass) were private inside `ReviewTable.tsx` → extract to a shared module so
  the lookup form reuses them instead of duplicating ~370 lines.

### Tasks
- [x] **T-3 — Backend: `POST /admin/product-lookup/save`.** DONE. INLINE (TDD). New
  `ProductLookupSaveRequest {name, catalog_product_code, catalog_update, series, admins}` +
  `product_lookup_save` endpoint: branch `code → apply_catalog_curation`, else
  `create_catalog_product_from_ficha(name_fallback=catalog_update.name or name)`; returns
  `{catalog_product_code, catalog_changes}`. `Depends(require_admin)` for `admin["id"]`
  (history changed_by). TDD: RED (404) → GREEN. 3 tests (curate branch, create branch, non-admin
  blocked). Checks: ficha-routes suite 42 passed; ruff clean. Commit: `2d8c6ce`.
- [x] **T-4 — Frontend: extract shared form atoms.** DONE. INLINE (refactor, guarded by existing
  `ficha-review-table.test.tsx`). Moved AllocationEditor/Field/ConfidenceTag/SuggestedBadge/
  SeriesTable/AdminTable/CatalogProductPicker/inputClass from `ReviewTable.tsx` into
  `components/admin/ficha-patrimonial/productFormFields.tsx`; `ReviewTable` imports them. No
  behavior change. Checks: tsc + eslint clean; ficha suites 103 passed. Commit: `0b04f0d`.
- [x] **T-5 — Frontend: editable `ProductLookupForm` + save + wire page.** DONE. INLINE (TDD).
  `reviewTableShared.ts`: `searchResultToEditableRow(result)` + `buildCatalogSaveRequest(row)`
  (reuse the series/admin fraction mapping, drop `product`/`user_id`). `catalogLookupApi.ts`:
  `saveProductToCatalog(req)`. New `components/admin/ProductLookupForm.tsx` (editable fields +
  Series/Admin tables + "Buscar con Claude" refine + origin/confidence/Fuentes + "Guardar en
  catálogo"). Wired into `buscar-producto/page.tsx` (replaced the read-only `ProductLookupResult`,
  deleted). TDD: RED → GREEN. New `product-lookup-form.test.tsx` (3), updated
  `buscar-producto-page.test.tsx`. Checks: full web suite 221 passed / 21 files; tsc + eslint
  clean. Commit: `eafcde0`.

## Acceptance criteria
- A "Buscar producto" admin section runs the catalog→web cascade on the entered name and shows
  the enriched result read-only, with its origin (catalog/web), confidence, series and sources.
- Not-found (null) and insufficient-web results are clearly messaged.
- (Extension) The result is shown in the ficha-style EDITABLE form and can be saved to the
  normalized catalog (update existing or create new) via `POST /admin/product-lookup/save`,
  with no client/holding involved.
- Backend + web suites green; no behavior change to the ficha flow or the cascade logic itself.

## Next step
T-3 backend save endpoint (RED test first).

## Follow-up (2026-11-11): identical card design to Ficha Patrimonial

User: *"el diseño de buscar producto debe ser igual al de ficha patrimonial"*. The first
version used a bespoke single-column layout. To make the design truly identical (not just
similar), the ficha `ProductCard` itself was extracted into the shared module as
`ProductReviewCard` and is now rendered by BOTH the ficha review table and the lookup form.

- [x] **T-6 — Share the ficha `ProductCard` as `ProductReviewCard`.** DONE. INLINE (refactor,
  guarded by `ficha-review-table.test.tsx`). Moved `ProductCard` out of `ReviewTable.tsx` into
  `productFormFields.tsx` as `ProductReviewCard`, parameterized with `footer` (action bar) and
  `showClientSelection` (the client Serie/Administrador block). `ReviewTable` passes its
  Aprobar/Descartar footer; `ProductLookupForm` renders the same card with
  `showClientSelection={false}` and a "Guardar en catálogo" footer. `reviewTableShared.ts`:
  split `searchResultToFichaRow` out of `searchResultToEditableRow` so the lookup has both the
  synthetic `rawRow` and the editable row. Checks: full web suite 221 passed / 21 files; tsc +
  eslint clean. Commit: `a74c47b`.

# Feature: Catalog product picker on the ficha review card

- **Feature ID:** `ficha-catalog-product-picker`
- **File locator:** `odd/tasks/ficha-catalog-product-picker.md`
- **Engram mirror topic:** `odd/ficha-catalog-product-picker/tasks`
- **Branch:** `feat/ficha-catalog-product-picker` off `main`.
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q -p no:recording`
  (venv + `-p no:recording`; the global vcr/urllib3 plugin breaks system python).
  Web `yarn workspace web test`.
- **Route:** DELEGATED (backend writer) + INLINE (frontend). Writer trigger: 2+ non-trivial files.

## User request
Con un match de catálogo de **confianza baja** el enrichment pega el producto equivocado
(ej: "KKR Infra" → "FM Real Estate & Infrastructure"). El área de inversiones debe poder
**buscar el producto correcto por nombre o código** y, al elegirlo, que se carguen TODOS
sus datos en el card (el correcto es BD-00352, ya está en la BD). Hoy solo se puede aceptar
el match equivocado o crear uno nuevo.

## Product decision (confirmed)
El picker está disponible en **cualquier card** (override), resaltado en confianza baja.
Cubre el caso pedido y también un match media/alta equivocado.

## Current state (explored)
- Enrichment V2: `cascade_search_v2` → `_search_catalog_v2` (search.py:564) toma el mejor
  match difuso pg_trgm (`search_for_enrichment`, `similarity > 0.1`, aunque sea bajo) y
  construye un `SearchResult` con `catalog_product_code`, `series_options` (`_series_options`),
  campos de producto, `similarity`. `_classify_match` marca `confidence` (baja si similitud baja).
- `NormalizedCatalogRepository.get_product_detail(code)` ya devuelve el producto con series
  y administradores anidados. `list_products(search)` filtra por `code ILIKE OR name ILIKE`.
- **Search endpoint YA existe:** `GET /api/admin/normalized-catalog/products?search=` →
  `list_normalized_products` (admin_routes.py ~874). Devuelve `CatalogProductRow[]` (code, name…).
- Frontend: `toEditableRow` (reviewTableShared.ts:441) mapea un `SearchResult` de catálogo a
  `EditableFichaRow` (name, campos, `seriesOptions`, `editableSeries` via `toEditableSeriesRows`,
  `editableAdmins` via `toEditableAdminRows`). `applyResearchToRow` es el patrón de "patch" para
  la acción "Volver a investigar" (web). `ProductCard` (ReviewTable.tsx:380) ya renderiza la
  Serie/Administrador del cliente cuando `seriesOptions.length > 0`.
- `resolveConfidence` prefiere `enriched.confidence`; `SearchResult` type (portfolio-types.ts:185)
  ya tiene `catalog_product_code`, `series_options`, `confidence`, `catalog_matched`.

## Design: reuse the enrichment's product→SearchResult mapping, keyed by code
Selecting a catalog product must produce the SAME `SearchResult` shape the enrichment builds,
so the card renders identically (series picker, fields, "es un producto existente").

## Tasks
- [x] **T-1 — Backend: catalog-product-by-code endpoint.** DONE. DELEGATED (TDD).
  `catalog_result_from_product(product)` extracted in search.py (pure extraction, enrichment
  unchanged); `_search_catalog_v2` reuses it. `GET /admin/ficha-patrimonial/catalog-product/{code}`
  (admin_routes.py:805) → SearchResult (confidence "alta", catalog_matched True, similarity 1.0,
  primary_source "catalog"), 404 when missing. Tests: returns-result, 404, non-admin 403.
  **Verified (parent):** routes + search_v2 + search = 71 passed; ruff clean on changed files.
- [x] **T-2 — Frontend: catalog search helpers + apply mapping.** DONE. INLINE (TDD).
  `fichaApi.ts`: `searchCatalogProducts(q)` (GET normalized-catalog list) +
  `getCatalogProductAsSearchResult(code)` (GET the new endpoint). `reviewTableShared.ts`:
  `applyCatalogSelectionToRow(row, result)` mirrors `toEditableRow`'s catalog branch and
  preserves amount/currency/identity/lineStatus. Tests: 2 shared + 2 fichaApi.
- [x] **T-3 — Frontend: picker UI in ProductCard + wiring.** DONE. INLINE (TDD).
  `CatalogProductPicker` in ReviewTable.tsx: debounced search (≥2 chars) → results (name +
  code · currency) → on select, fetch SearchResult and
  `onUpdate(applyCatalogSelectionToRow(row, result))`. On every card, emphasized when
  `confidence.level === "baja"`. Test: searching + selecting loads the correct product's
  name/manager into the card. Web suite 191 passed; tsc + eslint clean.

## Acceptance criteria
- On any review card the admin can search the catalog by name or code and select the correct
  product; all its data (fields + series/administrators + code) loads into the card, and it
  reads as an existing catalog product (confidence alta), not "create new".
- Enrichment behavior unchanged (existing search_v2 tests green). Backend + web suites green.
- Admin-only (router dependency). No schema change.

## Next step
Feature complete (T-1..T-3). Backend 71 passed (routes + search regression); web 191 passed;
ruff/tsc/eslint clean. Nothing committed (branch `feat/ficha-catalog-product-picker`, off main).
Pending (user-owned): review, commit, push/PR, deploy. No schema change / no migration.

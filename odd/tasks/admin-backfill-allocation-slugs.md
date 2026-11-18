# Admin action: backfill missing allocation slugs

## Objective
An admin-triggered action that generates `slugs` for every allocation item that
lacks them in the normalized `catalog_product` table, across the three JSONB
fields `asset_class`, `geographic_focus`, `underlying`. On-demand repair for
rows that entered by a path that skipped the model, or future data.

## Context / why
- The model (`CatalogAllocation`) already computes per-item kebab-case `slugs`
  on read/write, and migration a9c1e3f5b7d2 backfilled existing rows. This adds
  an explicit admin button so an admin can re-run the fill at any time.
- The SQL function `catalog_allocation_with_slugs(jsonb)` already exists (created
  by that migration; mirrored in schema.sql). Reuse it.

## Design
### Backend
- `NormalizedCatalogRepository.backfill_allocation_slugs() -> dict[str, int]`
  (apps/backend/src/db/catalog_normalized.py): for each of asset_class /
  geographic_focus / underlying, run a guarded UPDATE that only touches rows with
  at least one item missing `slugs`, and count rows updated:
  ```
  WITH updated AS (
    UPDATE catalog_product
    SET <col> = catalog_allocation_with_slugs(<col>)
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(<col>) e WHERE NOT (e ? 'slugs'))
    RETURNING 1
  ) SELECT count(*) FROM updated
  ```
  Return `{"asset_class": n, "geographic_focus": n, "underlying": n}`.
- Route `POST /normalized-catalog/backfill-slugs` (apps/backend/src/api/admin_routes.py),
  `repo: NormalizedCatalogRepository = Depends(_normalized_catalog_repo)`:
  returns `{"updated": {...}, "total": sum}`.

### Frontend
- `catalogo-normalizado/page.tsx`: a button "Generar slugs faltantes" in the
  header actions. On click: `POST ${BASE}/backfill-slugs` via `fetchWithAuth`,
  disable while loading, then a toast — success with per-field counts, or
  "No faltaban slugs" when total is 0; error via `readApiError`. Re-fetch the
  product list on success.

## Constraints
- Admin-only (same router/dependency as the other normalized-catalog routes).
- Idempotent: re-running when nothing is missing updates 0 rows.
- Reuse the existing `catalog_allocation_with_slugs` SQL function; no new slug
  logic. TDD strict. Backend runner:
  `cd apps/backend && .venv/bin/python -m pytest -q -p no:recording`.
  Web: `cd apps/web && yarn vitest run <file>` + `npx tsc --noEmit` + eslint.

## Tasks
- [x] T-1 Backend: `NormalizedCatalogRepository.backfill_allocation_slugs()`
      (guarded CTE-count UPDATE per field, reusing `catalog_allocation_with_slugs`,
      columns from a fixed tuple) + route `POST /normalized-catalog/backfill-slugs`
      returning `{updated, total}`. Route test (AsyncMock repo, 200 + shape +
      awaited once); integration test (insert items w/o slugs → count 1 + stored
      `["renta-fija"]`; 2nd call → 0).
- [x] T-2 Frontend: `Generar slugs faltantes` button under `+ Nuevo producto`
      (disabled + "Generando slugs…" while running); POST → success toast with
      per-field counts + `refetchList`, zero-case `No faltaban slugs`, error via
      `readApiError`. 3 page tests (POST+toast+refetch, zero-case, 500 error).

## Acceptance
- [x] Endpoint fills slugs on all missing items and returns per-field counts; a
      second call returns zeros (idempotent) — integration test proves it.
- [x] The admin page has a working button that reports the result.
- [x] Verified: backend non-DB suite 446 passed/154 skipped; integration 14
      passed (boba-fett-test DB); ruff clean on touched files; web vitest 7
      passed; tsc + eslint clean. (9 DB-suite failures are pre-existing baseline,
      confirmed by stash comparison, in unrelated files.)

## Route
Delegated direct (one writer, sonnet) — backend + frontend, 2+ non-trivial
files. Verified by orchestrator (suite + diff review).

## TDD
Enabled (strict), source: CLAUDE.md. RED→GREEN required.

## Progress
- Branch: feat/admin-backfill-allocation-slugs (off main); tip commit holds it.
- Not merged; not pushed.

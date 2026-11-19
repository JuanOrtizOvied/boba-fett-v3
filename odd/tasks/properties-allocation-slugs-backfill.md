# Admin action: backfill missing property allocation slugs

## Objective
An on-demand admin button on the properties screen (`/admin/propiedades`) that
generates a kebab-case `slugs` array for every allocation item that lacks one in
the `property_holding` table, across the three JSONB fields `asset_class`,
`geographic_focus`, `underlying`. Click to fill; re-click any time.

## Context / why
- `property_holding` stores these three fields as JSONB arrays of `{name,
  percentage}`, with NO slugs today. The SharePoint sync (`properties_sync`) is
  the ONLY writer; the admin page is read-only.
- The user explicitly chose an ON-DEMAND admin button (not a durable sync change,
  not a one-time migration). Because the sync writes allocations without slugs, a
  future sync that changes a property's allocation drops that row's slugs; the
  button exists precisely so an admin can re-fill whenever needed.
- The SQL function `catalog_allocation_with_slugs(jsonb)` already exists
  (migration `a9c1e3f5b7d2`, mirrored in `schema.sql:686`). REUSE it. No new slug
  logic, no new migration, no DDL.

## Design
### Backend
- `PropertyRepository.backfill_allocation_slugs() -> dict[str, int]`
  (`apps/backend/src/db/properties.py`): for each of asset_class /
  geographic_focus / underlying, a guarded CTE-count UPDATE that only touches
  rows with at least one item missing `slugs`, counting rows updated:
  ```sql
  WITH updated AS (
    UPDATE property_holding
    SET <col> = catalog_allocation_with_slugs(<col>)
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(<col>) e WHERE NOT (e ? 'slugs'))
    RETURNING 1
  ) SELECT count(*) FROM updated
  ```
  `<col>` comes from the fixed tuple `("asset_class","geographic_focus","underlying")`,
  never from user input. Returns `{"asset_class": n, "geographic_focus": n,
  "underlying": n}`. Idempotent. Update the module/class docstring note that said
  "Nothing here writes" — now there is exactly one maintenance write path.
- Route `POST /admin/properties/backfill-slugs`
  (`apps/backend/src/api/properties_routes.py`), gated by the router's existing
  `require_admin`, resolves the repo via `_property_repo(request)`: returns
  `{"updated": {...}, "total": sum}`.

### Frontend
- `apps/web/app/admin/propiedades/page.tsx`: import `useToast` from
  `@/components/ui/Toast`; add `isBackfilling` state + `handleBackfillSlugs`
  (POST `${BASE}/backfill-slugs` via `fetchWithAuth`; on !ok throw
  `readError(res, "No se pudieron generar los slugs")`; success toast with
  per-field counts and re-fetch the list, or `"No faltaban slugs"` when total is
  0; catch → error toast). Add a "Generar slugs faltantes" button in the master
  column header (near `PropertySearch`), disabled + "Generando slugs…" while
  running. `BASE` is already `/api/admin/properties`. Re-fetching the list: the
  current list effect keys on `term`; expose a manual refetch (small refactor to
  a callback, OR a `reloadKey` state bumped on success) — keep it minimal.

## Constraints
- Admin-only (reuse the router's `require_admin`; no new auth).
- Idempotent: re-running when nothing is missing updates 0 rows and toasts
  "No faltaban slugs".
- Reuse `catalog_allocation_with_slugs`; NO new slug logic, NO migration, NO DDL,
  NO changes to `properties_sync`.
- Do NOT change the read models/response shape (`Allocation`, `PropertySummary`,
  `PropertyDetail`): slugs land in the JSONB; surfacing them in the API is out of
  scope for this request.
- Artifacts in English; TDD strict (RED→GREEN). Backend runner:
  `cd apps/backend && .venv/bin/python -m pytest -q -p no:recording`.
  Web: `cd apps/web && yarn vitest run <file>` + `npx tsc --noEmit` + `npx eslint`.

## Tasks
- [x] T-1 Backend: `PropertyRepository.backfill_allocation_slugs()` + route
      `POST /admin/properties/backfill-slugs` returning `{updated, total}`.
      Route test (new `tests/test_properties_routes.py`: FastAPI app including
      `properties_router`, `app.state.property_repo = AsyncMock()`, admin cookie
      `sabbi_access` → 200 + shape + repo awaited once; non-admin → 403/401).
      Integration test (new `tests/integration/test_properties_backfill_pg.py`:
      insert `property_holding` rows with allocation items lacking slugs → count
      matches + stored `["renta-fija"]`; 2nd call → 0). Skips without
      `TEST_DATABASE_URL`, like the other `tests/integration/*_pg.py`.
- [x] T-2 Frontend: `useToast` + `isBackfilling` + `handleBackfillSlugs` +
      "Generar slugs faltantes" button on `propiedades/page.tsx`; list refetch on
      success. New page test (`apps/web/__tests__/propiedades-page.test.tsx`,
      mirroring `catalogo-normalizado-page.test.tsx`): POST+success toast+refetch,
      zero-case `No faltaban slugs`, error case.

## Acceptance
- [x] Endpoint fills slugs on all missing items and returns per-field counts; a
      second call returns zeros (idempotent) — integration test proves it.
- [x] The properties admin page has a working button that reports the result.
- [x] Backend route + integration tests green; web vitest + tsc + eslint clean.
      Report any pre-existing baseline failures separately.

## Route
Delegated direct (one writer, sonnet) — backend + frontend, 2+ non-trivial
files + new tests. Verified by orchestrator (targeted suites + diff review).

## TDD
Enabled (strict), source: CLAUDE.md. RED→GREEN required.

## Progress
- Branch: feat/properties-allocation-slugs-backfill (off main).
- Not committed; not merged; not pushed.

# Feature: Integrate normalized catalog CRUD onto current main

- **Feature ID:** `normalized-catalog-on-main`
- **File locator:** `odd/tasks/normalized-catalog-on-main.md`
- **Engram mirror topic:** `odd/normalized-catalog-on-main/tasks`
- **New branch:** `feat/normalized-catalog-on-main` (off current `main` @ `15dac21`)
- **Source branch (stale):** `feat/admin-normalized-catalog-crud` (8 ahead / 43 behind, base `5cf5b00`)
- **TDD mode:** strict (project convention). Backend runner: `apps/backend/.venv/bin/python -m pytest -q`. Web: `yarn workspace web test`.

## Objective

Bring the normalized product-catalog CRUD feature (data layer + backend CRUD + frontend
master-detail UI at `/admin/catalogo-normalizado`) onto the CURRENT `main`, as a clean
single-alembic-head branch, instead of merging the stale branch (which would create two
alembic heads and drag 43-commits-old assumptions).

## Strategy (recreate, not merge)

New branch off `main`; cherry-pick only the feature-bearing commits; re-point the migration's
`down_revision` to main's head so there is ONE alembic head.

- Cherry-pick (in order): `3b65558` (data layer), `353c04d` (doc), `d2d96eb` (backend CRUD),
  `360da06` (frontend), `f977e39` (doc).
- DROP: `1611b13` (hooks — main already has the identical lint-staged eslint line),
  `5913154` (unrelated stale-test repairs — user decided OUT, separate follow-up on main),
  `46bfffc` (doc recording the dropped test/hook work).

## Conflict map (from read-only mapping — all ADDITIVE, "keep both")

- `apps/backend/src/db/schema.sql`: branch appends 3 `CREATE TABLE IF NOT EXISTS`
  (`catalog_product`, `catalog_product_series`, `catalog_product_series_admin`) at EOF;
  main appended `webhook_subscriptions` + `product_catalog` column adds. Keep both. No name clash.
- `apps/backend/src/api/admin_routes.py`: branch adds `_normalized_catalog_repo` dep + 10
  endpoints under `/normalized-catalog/*`; main added `/catalog/*` sync/export/restore + soft
  delete. Disjoint. KEEP the `Normalized*Create/Update` aliases so they don't shadow
  main's `db.models` imports.
- `apps/backend/src/api/routes.py`: branch adds 1 import + `app.state.normalized_catalog_repo`
  in `lifespan`; main reworked `lifespan` (try/finally + maintenance task) and `/portfolio/me/export`.
  Re-add the one `app.state` line inside main's reworked lifespan.

## Migration (the only fine point)

Re-point `a7c1e2d3f4b5` `down_revision`: `"8dd9733f267d"` -> `"9c4e7a2b5d16"` (main head).
Verified safe: `catalog_product*` tables touch nothing main added between those revisions;
single head after the edit. (Dev DB is already at `9c4e7a2b5d16` from today's fix.)

## Tasks

- [x] **T-1 — Branch + data layer.** DONE. Branch `feat/normalized-catalog-on-main` off
  `main@15dac21`. Cherry-picked `3b65558` -> `f32053b` (schema.sql conflict resolved keep-both:
  webhook_subscriptions + catalog_product* coexist; migration `down_revision` re-pointed
  `8dd9733f267d` -> `9c4e7a2b5d16`) and `353c04d` -> `933c10e` (doc). `alembic heads` = single
  head `a7c1e2d3f4b5 (head)`. Dropped `1611b13` (hooks already on main).
- [x] **T-2 — Backend CRUD.** DONE. Cherry-picked `d2d96eb` -> `2e6abd6`. Both conflicts were
  import-block only (10 endpoints + `app.state` line auto-merged): resolved keep-both, aliases
  `Normalized*Create/Update` preserved. `py_compile` OK. Backend `pytest -q` = 321 passed,
  136 skipped (integration PG not run here — deferred to T-4), 0 failures.
- [x] **T-3 — Frontend.** DONE. Cherry-picked `360da06` -> `3d2d873` (10 files, clean, nav entry
  auto-merged into `admin/layout.tsx`) and `f977e39` -> `c5c9db7` (doc). Feature web tests
  (`catalogo-normalizado-page` + `admin-layout-nav`) = 6/6 passed.
- [x] **T-4 — Final verification.** DONE. `alembic heads` = single head `a7c1e2d3f4b5`.
  `alembic upgrade head` from base on a throwaway DB -> rc 0, `current = a7c1e2d3f4b5 (head)`.
  Normalized-catalog integration PG tests on a throwaway DB migrated to head = 28/28 passed.
  Backend full `pytest -q` = 321 passed / 136 skipped / 0 failed. Web full suite = 79 passed,
  8 failed in exactly the 4 files `5913154` would have fixed (admin-portfolio-approval,
  bulk-accept-bar, ficha-patrimonial-page, propose-product-card) — CONFIRMED pre-existing on
  `main` (same 8 failures on clean `main`), NOT introduced by this integration.

## Acceptance criteria / checks

- `alembic heads` returns exactly ONE head (`a7c1e2d3f4b5`).
- `alembic upgrade head` succeeds from base on a fresh DB.
- Backend `pytest -q` green (unit + integration), web test suite green.
- `/admin/catalogo-normalizado` UI files present; nav entry in `admin/layout.tsx`.
- `product_catalog`, flat `/admin/catalog`, and its consumers UNTOUCHED (constraint).

## Progress / evidence

- Branch `feat/normalized-catalog-on-main` off `main@15dac21`. Commits:
  `f32053b` (data layer), `933c10e` (doc), `2e6abd6` (backend CRUD), `3d2d873` (frontend),
  `c5c9db7` (doc).
- Conflicts resolved (all additive, keep-both): `schema.sql`, `admin_routes.py`, `routes.py`.
- Migration `a7c1e2d3f4b5` re-parented to `9c4e7a2b5d16` -> single alembic head, upgrades clean.
- Tests: backend 321 pass / 136 skip / 0 fail; normalized-catalog integration PG 28/28;
  web feature 6/6; web full suite introduces 0 new failures (8 pre-existing on `main`).
- DROPPED commits: `1611b13` (hooks on main), `5913154` (unrelated stale-test repairs, user
  decided OUT), `46bfffc` (doc of dropped work).

## Next step

Feature branch is ready. Open follow-up (separate, on `main`): repair the 4 stale web test
files (`5913154` scope). Push / PR of this branch are the user's call under ordinary repo policy.

# Feature: Admin CRUD for the normalized product catalog

- **Feature ID:** `admin-normalized-catalog-crud`
- **File locator:** `odd/tasks/admin-normalized-catalog-crud.md`
- **Engram mirror topic:** `odd/admin-normalized-catalog-crud/tasks`
- **Branch:** `feat/admin-normalized-catalog-crud` (off `main`)
- **Depends on:** `catalog-v3-normalized` (tables catalog_product / _series / _series_admin already shipped, branch feat/catalog-v3-normalized).
- **TDD mode:** strict. Backend: `pytest -q` (apps/backend, .venv/bin/python, integration needs TEST_DATABASE_URL — override to DATABASE_URL creds against sabbi_test, since .env TEST_DATABASE_URL fails auth). Frontend: `vitest run` (apps/web).

## Objective

A master-detail admin module to CRUD the normalized catalog (product -> series ->
administrator), in a NEW admin section, without touching the existing flat
`/admin/catalog` module or `product_catalog`.

UX (user-approved): product list + search; open a product -> detail with editable
product fields, its series (sub-CRUD), and under each series its administrators (sub-CRUD).

## Design decisions

- New route prefix `/admin/normalized-catalog/*`; new page `/admin/catalogo-normalizado`;
  nav label "Catálogo normalizado" in `apps/web/app/admin/layout.tsx`.
- Full CRUD at all 3 levels. Deletes rely on existing ON DELETE CASCADE
  (deleting a product removes its series + admins; deleting a series removes its admins).
- v1 immutable keys (no ON UPDATE CASCADE migration): product `code`, series `series`
  label, and admin identity (product_code+series+administrator) are set at create and
  NOT editable; PATCH updates only the attribute fields. Renaming = delete + recreate.
- Mirror existing admin patterns: `require_admin` guard, `app.state.*_repo`,
  `fetchWithAuth`, `useToast`, modal + confirm-delete components.
- Numeric fee/commission/flow/return fields are FRACTIONS (0.0384 = 3.84%), as in the DB.

## API contract (`/admin/normalized-catalog`, all require_admin)

- `GET  /products` — list products (no nesting), optional `?search=`.
- `GET  /products/{code}` — product with nested series and their admins (404 if missing).
- `POST /products` (201) — create product. Body: code, name, + optional fields.
- `PATCH /products/{code}` — update product attribute fields (not code).
- `DELETE /products/{code}` (204).
- `POST /series` (201) — create. Body: product_code, series, + numeric fields.
- `PATCH /series/{id}` — update numeric fields only.
- `DELETE /series/{id}` (204).
- `POST /admins` (201) — create. Body: product_code, series, administrator, + fields.
- `PATCH /admins/{id}` — update attribute fields only.
- `DELETE /admins/{id}` (204).

Validation: 404 for missing parent/row; 409 on duplicate (code / (product_code,series) /
(product_code,administrator,series)); 400 for empty required strings.

## Tasks

- [x] **T-A — Backend CRUD (writer, TDD).** Create/Update Pydantic models (3 levels) +
  write methods on `NormalizedCatalogRepository` (create/update/delete product, series,
  admin; map asyncpg UniqueViolation -> 409, ForeignKeyViolation -> 404). Routes in
  `admin_routes.py`. Wire `app.state.normalized_catalog_repo` in `routes.py` lifespan AND
  in `tests/integration/conftest.py` `admin_api_client`. Integration route tests +
  repo tests. No commit (orchestrator commits).
- [ ] **T-B — Frontend admin module (writer, TDD).** Types for product/series/admin +
  create/update inputs; new master-detail page `/admin/catalogo-normalizado`; modals for
  product/series/admin create+edit; confirm-delete; nav link in admin/layout.tsx; vitest
  tests (incl. updating `admin-layout-nav.test.tsx`). Uses fetchWithAuth + the T-A API.
- [ ] **T-C — Verify + commit per slice.** Run backend `pytest -q` + `ruff check src/`;
  frontend `vitest run` + `next lint`. Spot-check. Work-unit commit per slice on the branch.

## Acceptance criteria

- Backend: new route + repo tests green; `product_catalog` / flat `/admin/catalog` untouched.
- Frontend: vitest green incl. nav test; page renders master-detail, all 3 levels CRUD via API.
- `ruff check src/` + `next lint` clean on new/changed files.

## Progress / evidence

- (pending)

## Next step

Delegate T-A (backend) to one bounded writer with TDD; then T-B (frontend).

## T-A evidence

- RED: 13 of 20 new route tests failed before implementation. GREEN: `test_normalized_catalog_crud_pg.py` 20 passed; with `test_catalog_normalized_pg.py` + `test_admin_catalog_pg.py` 38 passed; `ruff check src/` clean.
- Empty required strings rejected by pydantic validators -> HTTP 422.
- Route: delegated direct writer. Not committed yet.

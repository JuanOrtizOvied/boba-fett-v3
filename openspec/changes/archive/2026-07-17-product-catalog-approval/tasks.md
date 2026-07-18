# Tasks: Product Catalog Approval

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~600-650 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (backend) -> PR 2 (catalog page) -> PR 3 (approval modal) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema + models + repository + admin API endpoints + backend tests | PR 1 | Base: main. Self-contained, testable via pytest, no frontend dependency. |
| 2 | `/admin/catalog` listing page + nav link + shared TS types | PR 2 | Base: main (after PR 1 merges). Depends on PR 1 endpoints being live. |
| 3 | "Approve to catalog" modal on portfolio view | PR 3 | Base: main (after PR 1 merges). Independent of PR 2; can run parallel to it. |

## Phase 1: Backend Foundation (Schema & Models) — PR 1

- [x] 1.1 In `apps/backend/src/db/schema.sql`, add idempotent `ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS approved_from_product_id TEXT` and `... ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`.
- [x] 1.2 In `apps/backend/src/db/models.py`, add `CatalogProductCreate` model with all catalog fields (`name`, `category`, `subcategory`, `asset_class`, `geographic_focus`, `underlying`, `commission`, `currency`, `administrator`, `manager`, `liquidity`, `return_rate`) and optional `approved_from_product_id: str | None`; require `name` and `category`.
- [x] 1.3 Add `approved_from_product_id: str | None = None` and `approved_at: str | None = None` fields to `CatalogProduct`.

## Phase 2: Repository — PR 1

- [x] 2.1 In `apps/backend/src/db/catalog_repository.py`, add `list_all(limit: int = 100, offset: int = 0) -> list[CatalogProduct]` ordered by `id`.
- [x] 2.2 Add `insert_if_not_duplicate(data: CatalogProductCreate) -> CatalogProduct | None` — runs the `LOWER(TRIM(...))` duplicate check on name+category+subcategory+asset_class (per design SQL), returns `None` on match, otherwise inserts and returns the new row.
- [x] 2.3 Add `delete(catalog_id: int) -> bool` — `DELETE ... RETURNING id`, returns whether a row was removed.

## Phase 3: API Wiring — PR 1

- [x] 3.1 In `apps/backend/src/api/routes.py` lifespan, instantiate `CatalogRepository(pool)` and set `app.state.catalog_repo`.
- [x] 3.2 In `apps/backend/src/api/admin_routes.py`, add `_catalog_repo(request) -> CatalogRepository` dependency helper.
- [x] 3.3 Add `GET /admin/products` — cross-list all products with `user_email` (join via `user_repo` + `product_repo`).
- [x] 3.4 Add `GET /admin/catalog/entries` -> `list[CatalogProduct]` via `list_all()`.
- [x] 3.5 Add `POST /admin/catalog/approve` (body `CatalogProductCreate`) -> `201 CatalogProduct`, or `409` when `insert_if_not_duplicate` returns `None`. Pydantic validation on missing `name`/`category` yields `422` automatically.
- [x] 3.6 Add `DELETE /admin/catalog/entries/{catalog_id}` -> `204`; `404` if `delete()` returns `False`.

## Phase 4: Backend Tests — PR 1

- [x] 4.1 Unit test: duplicate detection matches on trimmed/case-insensitive fields (spec scenario "Exact duplicate rejected").
- [x] 4.2 Unit test: entry differing in `commission` only is inserted, not rejected.
- [x] 4.3 Integration test: full approve flow (create product -> approve -> verify row -> repeat approval -> 409).
- [x] 4.4 Integration test: `POST /admin/catalog/approve` without admin role returns `403`.
- [x] 4.5 Integration test: after `delete()`, entry is absent from `list_all()` and from `CatalogRepository.search()` (L1 cascade).

## Phase 5: Frontend Types & Nav — PR 2

- [x] 5.1 In `apps/web/lib/portfolio-types.ts`, add `CatalogProduct` and `CatalogProductCreate` interfaces mirroring the backend models.
- [x] 5.2 In `apps/web/app/admin/layout.tsx`, add `{ href: "/admin/catalog", label: "Catalogo" }` to `NAV_LINKS`.

## Phase 6: Catalog Listing Page — PR 2

- [ ] 6.1 Create `apps/web/app/admin/catalog/page.tsx` — fetches `GET /api/admin/catalog/entries`, renders a table of all fields, and a delete button per row calling `DELETE /api/admin/catalog/entries/:id` with optimistic row removal.

## Phase 7: Approval Modal — PR 3

- [x] 7.1 In `apps/web/app/admin/portfolios/[userId]/page.tsx`, add an "Aprobar" button to `ReadOnlyProductCard`.
- [x] 7.2 Add a local approval-modal component: pre-fills `name`/`category`/`subcategory` from the product, empty enrichment fields, Cancel closes with no side effects, Confirm posts to `POST /api/admin/catalog/approve` and shows success or the `409` duplicate message inline.

## Phase 8: Verification — PR 3

- [ ] 8.1 Manual walkthrough: approve a product, confirm catalog entry appears at `/admin/catalog`, submit a duplicate and confirm rejection message, delete an entry and confirm it disappears from the listing.

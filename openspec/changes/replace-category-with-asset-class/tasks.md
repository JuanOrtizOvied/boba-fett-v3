# Tasks: Replace `category` with `asset_class`

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~850-1000 (35+ files: 13 backend, 1 migration, 18 frontend, 18 tests) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (migration + backend + backend tests, ~450-500 lines) -> PR 2 (frontend + frontend tests, ~400-500 lines) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending (ask user) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Migration + backend rename, independently deployable | PR 1 | base: main; includes backend tests |
| 2 | Frontend rename + frontend tests | PR 2 | base: PR 1 branch (stacked) or tracker branch (feature-branch-chain); depends on PR 1 API shape |

## Phase 1: Migration (PR 1) — COMPLETE

- [x] 1.1 Create Alembic migration `apps/backend/migrations/versions/8f2a91c4d6b7_replace_category_with_asset_class.py`: upgrade backfills `asset_class` from `category` on `products`/`product_catalog`, drops `category` columns, renames `portfolio_snapshots.category_summary` -> `asset_class_summary`, rewrites JSONB keys via `jsonb_agg`/`jsonb_build_object` (ADR-1, ADR-2)
- [x] 1.2 Implement downgrade: re-add `category` columns, copy back from `asset_class`, rename column back, rewrite JSONB keys back
- [x] 1.3 Test migration: `alembic upgrade head` then `alembic downgrade -1` against real dev Postgres; verified no data loss

## Phase 2: Backend Data Model (PR 1) — COMPLETE

- [x] 2.1 `db/tables.py`: remove `category` Column from `products`, `product_catalog`; rename `category_summary` -> `asset_class_summary` on `portfolio_snapshots`
- [x] 2.2 `db/models.py`: remove `category` field from Product, ProductCreate, ProductUpdate, CatalogProduct, CatalogProductCreate, CatalogProductUpdate, SearchResult; make `asset_class` required where `category` was
- [x] 2.3 `db/schema.sql`: update CREATE TABLE statements, add guarded backfill+drop block (ADR-4), rename `category_summary` + JSONB keys

## Phase 3: Backend Repositories & Export (PR 1, depends on Phase 2) — COMPLETE

- [x] 3.1 `db/repository.py`: `_row_to_product` drop `category=`; `get_summary` rename `by_category` -> `by_asset_class`; INSERT SQL drop `category` column
- [x] 3.2 `db/catalog_repository.py`: remove `category` from INSERT/UPDATE/SELECT and duplicate-detection query; `_row_to_catalog_product` drop `category=`
- [x] 3.3 `db/versioning.py`: `create_snapshot` groups by `asset_class`; JSONB key `"category"` -> `"asset_class"`; column ref `category_summary` -> `asset_class_summary`; `_row_to_snapshot_summary` key rename
- [x] 3.4 `db/excel.py`: rename `CATEGORY_ORDER`/`CATEGORY_LABELS` -> `ASSET_CLASS_ORDER`/`ASSET_CLASS_LABELS`, `_write_category_sheet` -> `_write_asset_class_sheet`, `product.category` -> `product.asset_class`

## Phase 4: Backend Agent (PR 1, depends on Phase 2) — COMPLETE

- [x] 4.1 `agent/state.py`: rename `CATEGORIES` -> `ASSET_CLASSES`, update docstring
- [x] 4.2 `agent/tools.py`: `_normalize_category_key` -> `_normalize_asset_class_key`, tool params `category` -> `asset_class`, import rename
- [x] 4.3 `agent/search.py`: remove `"category"` from `FIELD_NAMES`, repurpose `_is_valid_category`/`_classify`, import `ASSET_CLASSES`
- [x] 4.4 `agent/prompts.py`: `_format_categories` -> `_format_asset_classes`; system prompt text "categoria" -> "clase de activo"
- [x] 4.5 `api/routes.py`: update docstring reference
- [x] BONUS: `agent/nodes.py` EXTRACTION_PROMPT "categoría" -> "clase de activo" (found via grep sweep)

## Phase 5: Backend Tests (PR 1, depends on Phases 1-4) — COMPLETE

- [x] 5.1 Updated all 14 backend test files (12 listed + test_graph.py + test_routes_guarded.py) — batch find-replace fixtures/assertions `category` -> `asset_class`
- [x] 5.2 Ran backend suite: 228 passed, 1 pre-existing unrelated failure (reported, not fixed per safety-net rule)
- [x] 5.3 Grep sweep backend: confirmed no `category` reference remains except `subcategory`

## Phase 6: Frontend Types & Lib (PR 2) — COMPLETE

- [x] 6.1 `lib/portfolio-types.ts`: `Category` type -> `AssetClass`; `category` field -> `asset_class` in all interfaces
- [x] 6.2 `lib/categories.ts`: rename `CategoryMeta` -> `AssetClassMeta`, `CATEGORY_ORDER`/`CATEGORY_META`/`CATEGORY_SUBCATEGORIES` -> `ASSET_CLASS_*`, helper functions
- [x] 6.3 `lib/usePortfolio.ts`: `categoryDistribution`/`activeCategory` -> `assetClassDistribution`/`activeAssetClass`, `CategoryFilter` -> `AssetClassFilter`
- [x] 6.4 `lib/usePortfolioVersioning.ts`: `SnapshotCategorySummary` -> `SnapshotAssetClassSummary`, key `category_summary` -> `asset_class_summary`

## Phase 7: Frontend Components (PR 2, depends on Phase 6) — COMPLETE

- [x] 7.1 `components/portfolio/CategoryTabs.tsx`: rename export `CategoryTabs` -> `AssetClassTabs`, keep filename (ADR-3)
- [x] 7.2 `components/portfolio/CategorySection.tsx`: rename export `CategorySection` -> `AssetClassSection`, keep filename (ADR-3)
- [x] 7.3 Updated `PortfolioPanel.tsx`, `ProductCard.tsx`, `EditProductModal.tsx`, `PortfolioSummary.tsx`, `SummaryTable.tsx`, `ComparisonView.tsx`, `ChangeLog.tsx`, `SnapshotList.tsx`: import renames, `product.category` -> `product.asset_class`, dropdown label "Clase de activo". BONUS: fixed a pre-existing broken import in dead-code component `MetricsRow.tsx` (`CATEGORY_ORDER` no longer existed after Phase 6), plus comment cleanups in `AddProductButton.tsx`, `VersioningBar.tsx`, `app/globals.css`.
- [x] 7.4 `components/assistant-ui/thread.tsx`: proposed product card `category` -> `asset_class`

## Phase 8: Frontend Admin Pages (PR 2, depends on Phase 6) — COMPLETE

- [x] 8.1 `app/admin/catalog/page.tsx`: category column -> asset_class column
- [x] 8.2 `app/admin/portfolios/[userId]/page.tsx` + `ReadOnlyProductCard.tsx`: field refs and approval pre-fill (`name`, `asset_class`, `subcategory`)
- [x] 8.3 `app/admin/threads/[threadId]/page.tsx`: field refs

## Phase 9: Frontend Tests & Verification (PR 2, depends on Phases 6-8)

- [x] 9.1 Updated all 6 frontend test files — batch find-replace `Category` -> `AssetClass`, `category` -> `asset_class` in props/assertions
- [x] 9.2 Ran `npx tsc --noEmit` (0 errors) and `npx vitest run` (Node 18 in this environment can't run vitest 4/rolldown — ran under Node 22 instead): 34/40 passed, 6 pre-existing failures. Confirmed via `git stash` + re-run against baseline `HEAD` that all 6 failures (1 in `propose-product-card.test.tsx`, 4 in `bulk-accept-bar.test.tsx`, 1 in `admin-portfolio-approval.test.tsx`) already failed identically before this change (ambiguous text-regex matches and one `vi.mock` bug unrelated to `category`/`asset_class`) — zero regressions introduced by the rename, none fixed per safety-net rule.
- [x] 9.3 Grep sweep repo-wide: confirmed no `category` reference remains except `subcategory`, ADR-3 filenames (`CategoryTabs.tsx`/`CategorySection.tsx`), and one quoted legacy spec excerpt (comment)
- [ ] 9.4 Manual smoke test: add product via chat, verify dashboard grouping/colors, export Excel, approve to catalog (deferred — requires running dev servers; out of scope for a non-interactive apply batch)

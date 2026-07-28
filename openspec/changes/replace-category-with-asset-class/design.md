# Design: Replace `category` with `asset_class`

## Technical Approach

Pure rename-consolidation: the `category` column/field is eliminated everywhere and `asset_class` absorbs its role using the same taxonomy values. No new tables, no new endpoints, no value changes. The migration copies data, the code rename follows, and `schema.sql` is updated for the fresh-DB path.

## Architecture Decisions

### ADR-1: Migration strategy -- copy-then-drop vs. rename column

| Option | Tradeoff | Verdict |
|--------|----------|---------|
| `ALTER TABLE RENAME COLUMN category TO asset_class` | One-step, but `asset_class` column already exists with different data | Rejected |
| Copy `category` into `asset_class` where empty, then drop `category` | Two-step, safe for existing data, reversible | **Chosen** |

**Rationale**: Both `products` and `product_catalog` already have an `asset_class` column (added later, often empty). A straight rename would collide. The safe path is: `UPDATE ... SET asset_class = category WHERE asset_class = '' OR asset_class IS NULL`, then `DROP COLUMN category`. The downgrade re-adds `category` and copies back.

### ADR-2: `category_summary` column rename vs. JSONB key rename

| Option | Tradeoff | Verdict |
|--------|----------|---------|
| Rename column only (`category_summary` -> `asset_class_summary`), leave JSONB keys as `{"category": ...}` | Simpler migration, but inner keys diverge from field name | Rejected |
| Rename column AND rename JSONB keys inside existing rows | Full consistency, slightly more complex migration SQL | **Chosen** |

**Rationale**: The JSONB key `"category"` inside `category_summary` / `asset_class_summary` is read by `_row_to_snapshot_summary` and consumed by frontend snapshot views. Leaving stale keys creates a confusing asymmetry. The migration renames the column and rewrites existing JSONB arrays: `jsonb_set` each element to replace `"category"` key with `"asset_class"`. The volume of `portfolio_snapshots` rows is small (user-triggered snapshots), so the UPDATE is cheap.

### ADR-3: Frontend file renames vs. in-place edits

| Option | Tradeoff | Verdict |
|--------|----------|---------|
| Rename `CategoryTabs.tsx` -> `AssetClassTabs.tsx`, `CategorySection.tsx` -> `AssetClassSection.tsx` | Clean naming, but creates large git diff (delete + add) | Rejected |
| In-place edit: rename exports/types but keep filenames | Smaller diff, easier review, same runtime behavior | **Chosen** |

**Rationale**: The 400-line budget is tight for a 35+ file change. Keeping filenames avoids doubling the diff with git delete/add pairs. Component exports and types get renamed (`CategoryTabs` -> `AssetClassTabs`, `CategorySection` -> `AssetClassSection`). File renames can follow in a separate cleanup PR if desired.

### ADR-4: `schema.sql` update approach

| Option | Tradeoff | Verdict |
|--------|----------|---------|
| Remove all `category` references, treat `schema.sql` as pure fresh-DB script | Clean, but diverges from "migration-style" blocks in the file | Rejected |
| Keep idempotent migration blocks in `schema.sql` for backward compat | Matches existing pattern (file already has `ALTER ... ADD COLUMN IF NOT EXISTS` blocks) | **Chosen** |

**Rationale**: `schema.sql` is executed by `db/connection.py` on first pool creation. It already uses `IF NOT EXISTS` / `IF EXISTS` guards for incremental changes. Add a guarded block that copies `category` -> `asset_class` and drops `category`, matching the existing pattern. This way `schema.sql` works for both fresh databases and databases that already ran the Alembic migration.

### ADR-5: Chained PR boundaries

| Option | Tradeoff | Verdict |
|--------|----------|---------|
| Single PR (~800-1000 lines) | Simple, but exceeds 400-line budget significantly | Rejected |
| 2 PRs: (1) migration + backend, (2) frontend + tests | Each ~400-500 lines, backend is independently deployable | **Chosen** |

**Rationale**: The backend rename can be deployed independently -- the migration runs, backend code stops writing `category`, and the API response shape changes. Since there are no external consumers, the frontend PR follows immediately. Tests are split: backend tests in PR1, frontend tests in PR2.

## Data Flow

Current flow (category + asset_class coexist):

    User -> Frontend (category field) -> API -> DB (category col + asset_class col)

After change (asset_class only):

    User -> Frontend (asset_class field) -> API -> DB (asset_class col only)

Snapshot creation data flow change:

    products rows -> group by asset_class -> build asset_class_summary JSONB -> portfolio_snapshots.asset_class_summary

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/migrations/versions/xxxx_replace_category_with_asset_class.py` | Create | Alembic migration: copy category->asset_class, drop category cols, rename category_summary, rewrite JSONB keys |
| `apps/backend/src/db/tables.py` | Modify | Remove `category` Column from `products`, `product_catalog`. Rename `category_summary` -> `asset_class_summary` in `portfolio_snapshots` |
| `apps/backend/src/db/models.py` | Modify | Remove `category` field from Product, ProductCreate, ProductUpdate, CatalogProduct, CatalogProductCreate, CatalogProductUpdate, SearchResult. Make `asset_class` required where `category` was |
| `apps/backend/src/db/schema.sql` | Modify | Add guarded migration block (copy + drop category). Update CREATE TABLE statements. Rename column + JSONB keys in `portfolio_snapshots` |
| `apps/backend/src/db/repository.py` | Modify | `_row_to_product`: remove `category=` arg. `get_summary`: `by_category` -> `by_asset_class`, key name in response dict. `_create_impl` INSERT SQL: remove category column |
| `apps/backend/src/db/versioning.py` | Modify | `create_snapshot`: group by `asset_class` instead of `category`. JSONB key `"category"` -> `"asset_class"`. Column ref `category_summary` -> `asset_class_summary`. `_row_to_snapshot_summary`: key rename |
| `apps/backend/src/db/excel.py` | Modify | `CATEGORY_ORDER` -> `ASSET_CLASS_ORDER`, `CATEGORY_LABELS` -> `ASSET_CLASS_LABELS`, `_group_by_category` -> `_group_by_asset_class`, `_write_category_sheet` -> `_write_asset_class_sheet`, `product.category` -> `product.asset_class` |
| `apps/backend/src/db/catalog_repository.py` | Modify | Remove `category` from INSERT/UPDATE/SELECT SQL, duplicate-detection query. `_row_to_catalog_product`: remove `category=` |
| `apps/backend/src/agent/state.py` | Modify | Rename `CATEGORIES` -> `ASSET_CLASSES`. Update docstring/comments |
| `apps/backend/src/agent/tools.py` | Modify | `_normalize_category_key` -> `_normalize_asset_class_key`, tool params `category` -> `asset_class` (in `propose_product`, `add_product`, `update_product`), import rename |
| `apps/backend/src/agent/search.py` | Modify | Remove `"category"` from `FIELD_NAMES`. Remove `_is_valid_category`, `_sanitize_taxonomy`, `_classify` (or repurpose for `asset_class`). Import rename `CATEGORIES` -> `ASSET_CLASSES` |
| `apps/backend/src/agent/prompts.py` | Modify | `_format_categories` -> `_format_asset_classes`. System prompt text: "categorias" -> "clases de activo". Import rename |
| `apps/backend/src/api/routes.py` | Modify | Docstring update (minor) |
| `apps/web/lib/portfolio-types.ts` | Modify | `Category` type -> `AssetClass`. `category` field -> `asset_class` in Product, ProductCreateInput, ProductUpdateInput, ProposedProduct, EnrichedProposedProduct, CatalogProduct, CatalogProductCreate |
| `apps/web/lib/categories.ts` | Modify | Rename file content: `CategoryMeta` -> `AssetClassMeta`, `CATEGORY_ORDER` -> `ASSET_CLASS_ORDER`, `CATEGORY_META` -> `ASSET_CLASS_META`, `CATEGORY_SUBCATEGORIES` -> `ASSET_CLASS_SUBCATEGORIES`, `resolveCategoryKey` -> `resolveAssetClassKey`, `categoryColorVar` -> `assetClassColorVar`, etc. CSS var names remain unchanged (they reference visual styling, not domain) |
| `apps/web/lib/usePortfolio.ts` | Modify | `CategoryFilter` -> `AssetClassFilter`, `createCategory` -> `createAssetClass`, internal refs |
| `apps/web/lib/usePortfolioVersioning.ts` | Modify | Snapshot summary key `category_summary` -> `asset_class_summary`, JSONB key `category` -> `asset_class` |
| `apps/web/components/portfolio/CategoryTabs.tsx` | Modify | Export rename `CategoryTabs` -> `AssetClassTabs`, props rename, import updates |
| `apps/web/components/portfolio/CategorySection.tsx` | Modify | Export rename `CategorySection` -> `AssetClassSection`, props rename, import updates |
| `apps/web/components/portfolio/PortfolioPanel.tsx` | Modify | Import renames, component usage renames |
| `apps/web/components/portfolio/PortfolioSummary.tsx` | Modify | `category` key refs in summary data |
| `apps/web/components/portfolio/ProductCard.tsx` | Modify | `product.category` -> `product.asset_class` |
| `apps/web/components/portfolio/EditProductModal.tsx` | Modify | Category dropdown -> asset class dropdown, field refs |
| `apps/web/components/portfolio/AddProductButton.tsx` | Modify | `category` prop -> `assetClass` prop |
| `apps/web/components/portfolio/SummaryTable.tsx` | Modify | Category column refs |
| `apps/web/components/portfolio/ComparisonView.tsx` | Modify | Snapshot diff category refs |
| `apps/web/components/portfolio/SnapshotList.tsx` | Modify | `category_summary` -> `asset_class_summary` |
| `apps/web/components/assistant-ui/thread.tsx` | Modify | Proposed product card `category` -> `asset_class` |
| `apps/web/app/admin/catalog/page.tsx` | Modify | `category` column -> `asset_class` |
| `apps/web/app/admin/portfolios/[userId]/*.tsx` | Modify | ReadOnlyProductCard, page: `category` refs |
| Backend test files (12) | Modify | Fixtures, assertions, mocks: `category` -> `asset_class` |
| Frontend test files (6) | Modify | Props, assertions: `category` -> `asset_class` |

## Interfaces / Contracts

After the change, the `Product` Pydantic model becomes:

```python
class Product(BaseModel):
    id: str
    user_id: str
    name: str
    provider: str = ""
    amount: float = Field(gt=0)
    asset_class: str = Field(
        description="One of: inversiones_directas, mercados_privados,"
        " club_deals, mercados_publicos, otros, cash_y_equivalentes"
    )
    underlying: list[AssetAllocation] = Field(default_factory=list)
    geographic_focus: list[AssetAllocation] = Field(default_factory=list)
    # ... remaining fields unchanged
```

The frontend TypeScript type becomes:

```typescript
export type AssetClass =
  | "inversiones_directas"
  | "mercados_privados"
  | "club_deals"
  | "mercados_publicos"
  | "otros"
  | "cash_y_equivalentes";

export interface Product {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  amount: number;
  asset_class: AssetClass;  // was: category: Category
  underlying: AssetAllocation[];
  // ... remaining fields unchanged
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Migration | Upgrade + downgrade | Run `alembic upgrade head` then `alembic downgrade -1` on a test DB with seed data containing `category` values |
| Unit (backend) | All 12 test files | Batch find-replace `category` -> `asset_class` in fixtures and assertions. Verify `_normalize_asset_class_key` maps old aliases correctly |
| Unit (frontend) | All 6 test files | Batch find-replace `Category` -> `AssetClass`, `category` -> `asset_class` in props, mocks, assertions |
| Smoke | End-to-end portfolio flow | Manual: create product via chat, verify dashboard groups by asset_class, export Excel, check sheet names |

## Migration / Rollout

### Alembic Migration (upgrade)

```sql
-- 1. Backfill: copy category -> asset_class where asset_class is empty
UPDATE products SET asset_class = category
  WHERE (asset_class IS NULL OR asset_class = '');

UPDATE product_catalog SET asset_class = category
  WHERE (asset_class IS NULL OR asset_class = '');

-- 2. Drop category columns
ALTER TABLE products DROP COLUMN category;
ALTER TABLE product_catalog DROP COLUMN category;

-- 3. Rename summary column
ALTER TABLE portfolio_snapshots
  RENAME COLUMN category_summary TO asset_class_summary;

-- 4. Rewrite JSONB keys in existing snapshot summaries
UPDATE portfolio_snapshots
SET asset_class_summary = (
  SELECT jsonb_agg(
    jsonb_build_object('asset_class', elem->>'category', 'percentage', elem->'percentage')
  )
  FROM jsonb_array_elements(asset_class_summary) AS elem
)
WHERE asset_class_summary IS NOT NULL
  AND asset_class_summary != '[]'::jsonb;
```

### Alembic Migration (downgrade)

```sql
-- 1. Re-add category columns
ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE product_catalog ADD COLUMN category TEXT DEFAULT '';

-- 2. Copy asset_class back to category
UPDATE products SET category = asset_class;
UPDATE product_catalog SET category = asset_class;

-- 3. Rename summary column back
ALTER TABLE portfolio_snapshots
  RENAME COLUMN asset_class_summary TO category_summary;

-- 4. Rewrite JSONB keys back
UPDATE portfolio_snapshots
SET category_summary = (
  SELECT jsonb_agg(
    jsonb_build_object('category', elem->>'asset_class', 'percentage', elem->'percentage')
  )
  FROM jsonb_array_elements(category_summary) AS elem
)
WHERE category_summary IS NOT NULL
  AND category_summary != '[]'::jsonb;
```

### Deployment order

1. Run Alembic migration on staging with a production DB dump
2. Deploy backend (PR1) -- migration runs, backend uses `asset_class` only
3. Deploy frontend (PR2) -- UI reads `asset_class` from API responses

## Open Questions

- [x] Subcategory unchanged -- confirmed in proposal
- [x] No external API consumers -- confirmed, response shape changes freely
- [ ] CSS custom property names (`--sabbi-cat-*`): keep as-is or rename to `--sabbi-ac-*`? Recommendation: keep as-is (visual styling, not domain semantics) to avoid touching `globals.css` and all var references. Can be renamed in a follow-up.

# Design: Product Catalog Approval

## Technical Approach

Extend the existing admin API and UI to let admins approve portfolio products into `product_catalog`. The backend adds methods to `CatalogRepository` (not a new class -- follows existing single-repo-per-table pattern) and new routes to `admin_routes.py`. The frontend adds an `/admin/catalog` page and an approval modal triggered from the admin portfolio view. Duplicate detection uses a SQL query with `LOWER(TRIM(...))` normalization on all catalog columns.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Repository location | Extend `CatalogRepository` with `insert_if_not_duplicate`, `list_all`, `delete` | New `CatalogAdminRepository` class | One repo per table is the codebase convention (`ProductRepository` for `products`, `CatalogRepository` for `product_catalog`). A second class for the same table breaks this. |
| Duplicate detection | SQL `WHERE` with `LOWER(TRIM(...))` on name + category + subcategory + asset_class | Hash-based column (store a hash on insert, compare hashes) / All-column comparison | Hash adds a schema migration for a computed column; all-column comparison is too strict (empty enrichment fields would never match). Name + category/subcategory + asset_class is the product identity -- enrichment fields may legitimately differ. |
| Approval enrichment | Modal form on frontend, all enrichment fields sent in POST body | Auto-enrich via cascade search / Copy only overlapping fields | The proposal chose admin-fills-fields (option b). Auto-enrich adds complexity and latency. Copy-only produces sparse entries. A form lets the admin see what's missing and fill it. |
| Schema change | Add `approved_from_product_id TEXT` and `approved_at TIMESTAMPTZ` to `product_catalog` | No schema change / Separate junction table | Lightweight provenance tracking; enables rollback. Junction table is over-engineered for a nullable FK. |
| Catalog repo initialization | Add `CatalogRepository` to `app.state` in lifespan (alongside existing repos) | Per-request instantiation via Depends | Matches `app.state.repo` / `app.state.user_repo` pattern already in `routes.py`. |
| Admin portfolio cross-list | New endpoint `GET /admin/products` returning all products with user email | Reuse `GET /admin/portfolios/{user_id}` per user | The catalog approval flow needs a flat list of all products across users. Per-user fetching requires N+1 calls from the frontend. |

## Data Flow

```
Admin visits /admin/catalog
        |
        v
GET /admin/catalog/entries ──> CatalogRepository.list_all() ──> product_catalog table
        |
        v
    Catalog table displayed

Admin visits /admin/portfolios/:userId
        |
        v
GET /admin/portfolios/:userId ──> ProductRepository.list_by_user()
        |
        v
    Cards with "Approve" button

Admin clicks "Approve" on a product card
        |
        v
    Approval modal opens (pre-filled: name, category, subcategory)
    Admin fills enrichment fields (asset_class, currency, etc.)
        |
        v
POST /admin/catalog/approve ──> CatalogRepository.insert_if_not_duplicate()
        |                              |
        |                     Check: LOWER(TRIM(name)) + category +
        |                     subcategory + asset_class match?
        |                              |
        ├── Duplicate found ──> 409 Conflict
        └── No duplicate ────> INSERT into product_catalog ──> 201 Created

Admin deletes catalog entry
        |
        v
DELETE /admin/catalog/entries/:id ──> CatalogRepository.delete() ──> 204
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/src/db/schema.sql` | Modify | Add `approved_from_product_id TEXT` and `approved_at TIMESTAMPTZ` columns to `product_catalog` via `ALTER TABLE ADD COLUMN IF NOT EXISTS` |
| `apps/backend/src/db/models.py` | Modify | Add `CatalogProductCreate` Pydantic model (enrichment fields); add `approved_from_product_id` and `approved_at` to `CatalogProduct` |
| `apps/backend/src/db/catalog_repository.py` | Modify | Add `list_all()`, `insert_if_not_duplicate()`, `delete()` methods |
| `apps/backend/src/api/admin_routes.py` | Modify | Add `GET /admin/catalog/entries`, `POST /admin/catalog/approve`, `DELETE /admin/catalog/entries/{id}`, `GET /admin/products` |
| `apps/backend/src/api/routes.py` | Modify | Instantiate `CatalogRepository` in lifespan, set on `app.state.catalog_repo` |
| `apps/web/app/admin/layout.tsx` | Modify | Add `{ href: "/admin/catalog", label: "Catalogo" }` to `NAV_LINKS` |
| `apps/web/app/admin/catalog/page.tsx` | Create | Catalog management page -- table of entries with delete action |
| `apps/web/app/admin/portfolios/[userId]/page.tsx` | Modify | Add "Aprobar" button to `ReadOnlyProductCard`, open approval modal |
| `apps/web/lib/portfolio-types.ts` | Modify | Add `CatalogProduct` and `CatalogProductCreate` TypeScript types |

## Interfaces / Contracts

### Backend -- New Pydantic model

```python
class CatalogProductCreate(BaseModel):
    name: str
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    subcategory: str = ""
    approved_from_product_id: str | None = None
```

### Backend -- New API endpoints

```
GET  /admin/products              -> list[{product fields + user_email}]
GET  /admin/catalog/entries       -> list[CatalogProduct]
POST /admin/catalog/approve       -> CatalogProduct | 409
     Body: CatalogProductCreate
DELETE /admin/catalog/entries/{id} -> 204
```

### Backend -- CatalogRepository new methods

```python
async def list_all(self, limit: int = 500, offset: int = 0) -> list[CatalogProduct]
async def insert_if_not_duplicate(self, data: CatalogProductCreate) -> CatalogProduct | None
    # Returns None when duplicate detected (caller raises 409)
async def delete(self, catalog_id: int) -> bool
```

### Duplicate detection SQL (core logic)

```sql
SELECT id FROM product_catalog
WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
  AND LOWER(TRIM(COALESCE(category, ''))) = LOWER(TRIM($2))
  AND LOWER(TRIM(COALESCE(subcategory, ''))) = LOWER(TRIM($3))
  AND LOWER(TRIM(COALESCE(asset_class, ''))) = LOWER(TRIM($4))
LIMIT 1
```

### Frontend -- New types

```typescript
export interface CatalogProduct {
  id: number;
  name: string;
  asset_class: string;
  geographic_focus: string;
  underlying: string;
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
  category: string;
  subcategory: string;
  approved_from_product_id: string | null;
  approved_at: string | null;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `insert_if_not_duplicate` duplicate detection logic | pytest with mock pool -- verify SQL params, case normalization |
| Unit | `CatalogProductCreate` validation | pytest Pydantic model instantiation |
| Integration | Full approve flow: create product, approve, verify in catalog, attempt duplicate | pytest against real Postgres (existing test DB pattern if available, else skip) |
| Manual | Admin UI: approval modal, catalog page, delete action | Browser walkthrough |

## Migration / Rollout

Schema changes use `ALTER TABLE ADD COLUMN IF NOT EXISTS` (idempotent, matches existing pattern in `schema.sql`). No data migration needed -- new columns default to `NULL`/empty. Existing catalog entries remain unaffected. Rollback: remove new columns and new routes; existing catalog data untouched.

## Open Questions

- [ ] Should duplicate detection also match on `underlying` field for investment products that share names but differ in underlying assets? (Current design: name + category + subcategory + asset_class only)

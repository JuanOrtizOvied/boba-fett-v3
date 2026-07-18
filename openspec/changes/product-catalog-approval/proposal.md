# Proposal: Product Catalog Approval

## Proposal Question Round

These questions uncover business rules, implications, and edge cases that would improve the proposal. The orchestrator should surface them to the user before proceeding to spec/design.

### Questions

1. **Schema mismatch (business rule)**: The `products` table stores portfolio data (name, provider, amount, category, subcategory, composition) while `product_catalog` stores metadata (name, asset_class, geographic_focus, underlying, commission, currency, administrator, manager, liquidity, return_rate, category, subcategory). When an admin approves a portfolio product, should the system (a) copy only the overlapping fields (name, category, subcategory) and leave the rest empty, (b) let the admin fill in the missing catalog metadata fields during approval via a form, or (c) auto-enrich by running the cascade search to populate catalog fields?

2. **Duplicate detection scope**: "All fields exactly equal" -- does this mean all `product_catalog` columns must match (name, asset_class, geographic_focus, etc.), or just the product-identifying fields (name + category + subcategory)? Should comparison be case-insensitive?

3. **Admin workflow surface**: Should the approval flow live (a) on the existing `/admin/portfolios/:userId` page with an "Approve to catalog" button per product card, (b) on a new dedicated `/admin/catalog` page that aggregates all products across all users with bulk approve capability, or (c) both?

4. **Catalog management after approval**: Once a product is in the catalog, should the admin be able to edit or delete catalog entries from the UI? Or is approval a one-way operation and catalog maintenance happens elsewhere?

5. **Post-approval feedback**: After a product is approved into the catalog, should the source portfolio product show any visual indicator (e.g. a "cataloged" badge)? Or does the portfolio side remain completely unaware?

### Current Assumptions (pending user answers)

- Approval maps overlapping fields + admin fills in enrichment fields via a form (question 1b)
- Duplicate detection compares all `product_catalog` columns, case-insensitive (question 2)
- New `/admin/catalog` page + approve button on portfolio view pages (question 3c)
- Admin can view and delete catalog entries but not inline-edit them (question 4, minimal scope)
- No visual indicator on the source portfolio product for v1 (question 5)

---

## Intent

Admins currently have no way to curate the SABBI product catalog (`product_catalog` table) from real investor portfolio data. The catalog feeds the L1 cascade search -- the most trusted data source the agent uses when identifying products. Today, catalog entries must be inserted manually via SQL. This change lets admins browse products across all investor portfolios and approve them into the catalog, growing the system's trusted knowledge base organically from real usage.

## Scope

### In Scope
- Admin API endpoints: list all products across portfolios, approve product to catalog, list/delete catalog entries
- Duplicate detection before catalog insertion (exact field match)
- Admin UI: catalog management page (`/admin/catalog`) with approve workflow
- Approve action on existing admin portfolio view pages

### Out of Scope
- Bulk import/CSV upload to catalog
- Investor-facing catalog browsing
- Editing catalog entries inline (v2)
- Auto-approval rules or ML-based suggestions
- Changes to the cascade search logic itself

## Capabilities

### New Capabilities
- `product-catalog-approval`: Admin approval workflow from portfolio products to `product_catalog`, including duplicate detection, catalog listing, and catalog entry deletion

### Modified Capabilities
- `admin-panel`: New navigation entry for catalog management, approve affordance on portfolio view

## Approach

Backend: New `CatalogAdminRepository` (or extend `CatalogRepository`) with `insert_if_not_duplicate`, `list_all`, and `delete` methods. New FastAPI routes under `/admin/catalog`. The approve endpoint accepts a product ID, fetches the product, maps fields to catalog schema (with optional admin-supplied enrichment fields in the request body), checks for exact-match duplicates, and inserts.

Frontend: New `/admin/catalog` page listing all catalog entries with delete. "Approve to catalog" button on admin portfolio product cards, opening a modal/drawer for the admin to fill enrichment fields before confirming.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/backend/src/db/schema.sql` | Modified | Add approved_from metadata columns to product_catalog (optional) |
| `apps/backend/src/db/catalog_repository.py` | Modified | Add insert, list_all, delete, duplicate check methods |
| `apps/backend/src/api/admin_routes.py` | Modified | New catalog admin endpoints |
| `apps/web/app/admin/layout.tsx` | Modified | Add "Catalogo" nav link |
| `apps/web/app/admin/catalog/page.tsx` | New | Catalog management page |
| `apps/web/app/admin/portfolios/[userId]/page.tsx` | Modified | Add approve button to product cards |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Schema mismatch leads to sparse catalog entries | High | Approval form lets admin fill missing fields; cascade search already handles partial catalog data |
| Duplicate detection too strict (case/whitespace) | Med | Normalize strings before comparison (trim, lowercase) |
| Large catalog degrades trigram search performance | Low | Existing `gin_trgm_ops` index handles this; monitor query times |

## Rollback Plan

1. Remove new admin routes and frontend pages
2. No schema migration needed if `product_catalog` table structure is unchanged (only new rows)
3. Delete any catalog entries added via the approval flow if needed (track via `approved_from_product_id` column)

## Dependencies

- Existing `product_catalog` table and `CatalogRepository`
- Admin auth infrastructure (`require_admin` dependency)
- Existing admin panel layout and navigation

## Success Criteria

- [ ] Admin can view a list of all products across all investor portfolios
- [ ] Admin can approve a product into the catalog with enrichment fields
- [ ] Duplicate products are detected and rejected before insertion
- [ ] New catalog entries appear in L1 cascade search results
- [ ] Admin can view and delete catalog entries
- [ ] Admin panel navigation includes catalog management link

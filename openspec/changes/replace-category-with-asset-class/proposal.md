# Proposal: Replace `category` with `asset_class`

## Intent

The `products` and `product_catalog` tables carry two fields -- `category` and `asset_class` -- that hold the same taxonomy values (`inversiones_directas`, `mercados_privados`, `club_deals`, `mercados_publicos`, `cash_y_equivalentes`, `otros`). Every layer (DB, agent, API, frontend) must keep them in sync, doubling validation, mapping, and test surface. Consolidating on `asset_class` removes the redundancy, simplifies the data model, and eliminates a class of silent-desync bugs.

## Scope

### In Scope
- Alembic migration: copy `category` -> `asset_class` where `asset_class` is empty, drop `category` from `products` and `product_catalog`, rename `category_summary` -> `asset_class_summary` in `portfolio_snapshots`
- Backend (15 files): remove all `category` references in models, repositories, schema, tools, search, state, prompts, excel export, routes
- Frontend (20 files): rename types, constants, components, and hooks (`Category*` -> `AssetClass*`, `CATEGORY_*` -> `ASSET_CLASS_*`)
- Tests (18 files): update fixtures, assertions, and mocks

### Out of Scope
- Changing taxonomy values or adding new asset classes
- Restructuring subcategory hierarchy
- Renaming `subcategory` field (remains as-is)
- UI copy changes beyond what the rename requires
- API versioning (no external consumers)

## Capabilities

### New Capabilities
None -- pure consolidation refactor.

### Modified Capabilities
- `portfolio-builder/agent`: tool params `category` -> `asset_class`, `_normalize_category_key` -> `_normalize_asset_class_key`, system prompt taxonomy references
- `portfolio-builder/dashboard`: `CategorySection` -> `AssetClassSection`, `CategoryTabs` -> `AssetClassTabs`, grouping/distribution keys
- `portfolio-builder/product-management`: `CategoryFilter` -> `AssetClassFilter`, edit modal dropdown label, card badge field
- `product-catalog-approval`: duplicate-detection fields, approval required-field validation, catalog listing columns

## Approach

1. **Data migration first**: Alembic migration copies `category` -> `asset_class` where null, then drops `category` columns and renames `category_summary`.
2. **Backend rename**: Systematic find-replace across models, repositories, tools, state, prompts, excel. Update `schema.sql` for fresh-DB path.
3. **Frontend rename**: Types, constants, components, hooks. File renames for component files (`CategorySection.tsx` -> `AssetClassSection.tsx`).
4. **Tests**: Update all 18 test files to match new field/function/component names.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/backend/src/db/` | Modified | models, tables, schema, repositories, versioning, excel |
| `apps/backend/src/agent/` | Modified | tools, search, state, prompts |
| `apps/backend/src/api/` | Modified | routes docstring, admin_routes |
| `apps/web/lib/` | Modified | types, constants, hooks |
| `apps/web/components/portfolio/` | Modified + Renamed | 7 components with category refs |
| `apps/web/components/assistant-ui/` | Modified | thread.tsx propose/accept cards |
| `apps/web/app/admin/` | Modified | catalog page, portfolio views |
| `apps/backend/tests/` | Modified | 12 test files |
| `apps/web/__tests__/` | Modified | 6 test files |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Data loss on production migration | Low | Migration copies before dropping; test on staging dump first |
| Broken imports from renamed files | Medium | Systematic grep verification after rename pass |
| Missed `category` reference causing runtime error | Medium | Full-text search for `category` (case-insensitive) as final check |
| Large diff size (~35+ files) | High | Chained PRs: migration -> backend -> frontend -> tests |

## Rollback Plan

1. Reverse Alembic migration (`alembic downgrade -1`) restores `category` columns with data intact (migration should use `op.add_column` + data copy in downgrade).
2. Git revert of code changes restores all renamed files/references.
3. No external API consumers, so no coordination needed.

## Dependencies

- Alembic configured and connected to the target database
- No concurrent migrations modifying the same tables

## Success Criteria

- [ ] No occurrence of `category` (as a field/column/variable name) remains in backend or frontend code, except `subcategory`
- [ ] All existing tests pass with `asset_class` references
- [ ] Alembic migration applies and rolls back cleanly
- [ ] Portfolio UI renders identically (same colors, labels, grouping)
- [ ] Excel export produces same sheet structure with `asset_class` headers
- [ ] Product catalog approval flow works with `asset_class` field only

## Proposal Question Round

The following assumptions are baked into this proposal based on the confirmed scope. If any are wrong, they should be corrected before spec/design:

1. **API response shape**: The REST API (`/api/products`, `/api/portfolio`) currently returns `category` in JSON responses. After this change, responses will return `asset_class` only. Since there are no external consumers, this is assumed safe -- correct?
2. **Subcategory field unchanged**: The `subcategory` field on both tables remains as-is and is not affected by this rename. Confirmed?
3. **Product catalog approval**: The approval endpoint currently requires `category` as a required field. After this change it will require `asset_class` instead. The duplicate-detection logic also shifts to `asset_class` only. Any concern?
4. **Snapshot history**: Existing `portfolio_snapshots` rows have `category_summary` JSONB. Should the migration also rename keys inside existing JSONB data, or only rename the column (leaving historical snapshots with old key names)?

# Data Model: Asset Class Consolidation

## Purpose

Data-integrity guarantees for dropping the redundant `category` column and
consolidating on `asset_class` across `products`, `product_catalog`, and
`portfolio_snapshots`.

## Requirements

### Requirement: Category Data Migrated Before Column Drop

The migration MUST copy any `category` value into `asset_class` wherever
`asset_class` is null or empty, for both `products` and `product_catalog`,
before dropping the `category` columns. No row MUST lose its taxonomy
classification.

#### Scenario: Row with only category populated is preserved

- GIVEN a `products` row has `category = "otros"` and `asset_class = NULL`
- WHEN the migration runs
- THEN the row ends up with `asset_class = "otros"` and no `category` column

#### Scenario: Row already in sync is unaffected

- GIVEN a row already has `asset_class` populated matching `category`
- WHEN the migration runs
- THEN `asset_class` is unchanged and `category` is dropped

### Requirement: Snapshot Summary Column and Keys Renamed

`portfolio_snapshots.category_summary` MUST be renamed to
`asset_class_summary`, and the JSONB keys within existing historical rows
MUST be renamed from category identifiers to the equivalent `asset_class`
identifiers so historical snapshots read consistently with current data.

#### Scenario: Historical snapshot reads with renamed keys

- GIVEN a snapshot created before the migration with `category_summary`
  JSONB keyed by taxonomy value
- WHEN the migration completes
- THEN `GET /portfolio/me/snapshots/:id` returns `asset_class_summary` with
  the same taxonomy values as keys and unchanged aggregated amounts

### Requirement: Migration Rollback Restores Category Columns

`alembic downgrade -1` MUST re-add the `category` columns (copying current
`asset_class` values back) and MUST rename `asset_class_summary` back to
`category_summary`, including reverting JSONB keys.

#### Scenario: Downgrade restores original schema with data intact

- GIVEN the migration has been applied
- WHEN an operator runs `alembic downgrade -1`
- THEN `category` columns reappear populated from `asset_class`, and
  `category_summary` reappears with original keys

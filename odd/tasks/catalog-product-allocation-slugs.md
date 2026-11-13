# catalog_product allocation per-item slugs

## Objective
In the NORMALIZED `catalog_product` table, every item of the JSONB fields
`asset_class`, `geographic_focus` and `underlying` must carry a `slugs` field:
a string array derived from that item's `name`. Each slug is kebab-case:
lowercase, unaccented, words joined by `-`, no whitespace.

Example: `{ "name": "Mercados Públicos - Variable", "percentage": 100 }`
→ `{ "name": "Mercados Públicos - Variable", "percentage": 100,
     "slugs": ["mercados-publicos-variable"] }`.

## Scope
- Table `catalog_product` (schema.sql:660), handled by
  `apps/backend/src/db/catalog_normalized.py` (`NormalizedCatalogRepository`,
  `CatalogProductRow`, `CatalogProductCreate`, `CatalogProductUpdate`).
- NOT the legacy flat `product_catalog` table (`db/models.py:CatalogProduct`,
  `catalog_repository.py`), which already has a product-level `slugs`.
- Frontend: add optional `slugs?: string[]` to `AssetAllocation` so the field
  is typed where catalog rows are consumed. No UI behavior change.

## Problem / why
The three fields store `AssetAllocation` = `{name, percentage}` as JSONB. There
is no per-item normalized key for matching/lookup. `AssetAllocation` is SHARED
with the portfolio `Product` (`db/models.py`), so slugs must be scoped to the
catalog, not added to the shared value object (would leak into portfolio
payloads and break `test_models.py`, excel export, comparison views).

## Design
- No DDL migration: the columns are already `JSONB`; the slug lives inside the
  JSON item payload. Write serializes via `_db_value` →
  `json.dumps([a.model_dump() ...])` (includes slugs); read rebuilds via
  `_allocations` → model (recomputes slugs, so legacy rows get them lazily).
- `slugify_name(name: str) -> str` (new helper in catalog_normalized.py):
  `unicodedata.NFKD` unaccent → `lower()` → regex-collapse every run of
  non `[a-z0-9]` to a single `-` → strip leading/trailing `-`. Empty name → "".
- `CatalogAllocation(AssetAllocation)`: adds `slugs: list[str] = []` plus a
  `model_validator(mode="after")` that ALWAYS sets
  `slugs = [slugify_name(name)]` when the slug is non-empty, else `[]`.
  Client-supplied `slugs` are ignored (server-computed, read-only — mirrors the
  existing slugs convention).
- Swap `AssetAllocation` → `CatalogAllocation` in `_allocations` and in the
  `asset_class`/`geographic_focus`/`underlying` fields of `CatalogProductRow`,
  `CatalogProductCreate`, `CatalogProductUpdate`. `_db_value`/`_JSON_COLS`
  unchanged (still `model_dump()`).
- Frontend `apps/web/lib/portfolio-types.ts`: `AssetAllocation.slugs?: string[]`.

## Constraints
- Portfolio `Product` and its `AssetAllocation` payloads stay byte-identical
  (no slugs there). Chat/portfolio paths untouched.
- Slugs never trusted from the client; always recomputed from `name`.
- TDD strict (RED→GREEN). Backend runner:
  `cd apps/backend && .venv/bin/python -m pytest -q -p no:recording`.
  Web: `cd apps/web && npx tsc --noEmit` + `npx eslint`.

## Tasks
- [x] T-1 Backend: `slugify_name` + `CatalogAllocation` (after-validator,
      ignores client slugs); wire into `_allocations` + the three catalog
      models. 21 tests (`tests/test_catalog_allocation_slugs.py`): slugify cases,
      validator computes from name + overwrites client slugs + `[]` for empty,
      create/row/update `model_dump` + `_db_value` include slugs, `_allocations`
      recomputes legacy JSON. Added a `mode="before"` coercion so shared
      `AssetAllocation` instances (ficha path) still construct — fixed 3 existing
      tests (test_catalog_curation, test_search_v2 x2) without weakening them.
- [x] T-2 Frontend: `slugs?: string[]` on `AssetAllocation`; `tsc` + `eslint`
      clean. (No UI change; typing only.)
- [x] T-3 schema.sql: documented the per-item `slugs` convention in a comment
      above the `catalog_product` JSONB columns (no DDL).

## Acceptance
- [x] A created/updated normalized product returns each allocation item with
      `slugs = [kebab(name)]`; reading a pre-existing row lacking slugs returns
      them too.
- [x] Portfolio `Product` payloads unchanged (no slugs; shared `AssetAllocation`
      model untouched, verified by a test asserting its dump has no `slugs`).
- [x] Backend suite green (445 passed / 153 skipped) + ruff clean on touched
      files; web `tsc` + `eslint` clean. Verified by orchestrator.

## Open question (flagged to user, non-blocking)
- Scope assumed to be the normalized `catalog_product` table only. If the legacy
  `product_catalog` allocations should ALSO get per-item slugs, extend later.
- Optional one-time SQL backfill of existing JSONB rows was skipped: read-side
  recompute + write-side persist already satisfy the contract. Add a data
  migration only if stored rows must carry slugs before their next write.

## Route
Delegated direct (one writer, sonnet) — 2+ non-trivial files; verified by
orchestrator (full backend suite + diff review, web tsc/eslint).

## TDD
Enabled (strict), source: CLAUDE.md. RED→GREEN required.

## Progress
- Branch: feat/catalog-allocation-slugs (off main); tip commit holds this work.
- Not merged; not pushed.

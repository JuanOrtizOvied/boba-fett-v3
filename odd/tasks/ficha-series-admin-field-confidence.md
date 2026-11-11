# Ficha series/admin per-field confidence

## Objective
In the ficha / "Buscar producto" review card, every Series and Administradores
FIELD must show its own confidence % (like the product-level fields Gestor/Moneda
already do), instead of ONE general badge per series / per administrator.

## Problem
The web research self-reports only a single `confidence` per series
(`_ExtractedSeries.confidence`) and per administrator (`_ExtractedSeriesAdmin.confidence`),
rendered as one `SuggestedBadge` on each card header. The numeric fields (TER, Flujos
mín/máx, Rent. mín/máx, Mínimo USD, Custodia/Compra/Venta) carry no per-field confidence.

## Design
Extend the existing `field_confidence` pattern (product fields already use it) to
series and admins. Each field label gets a `ConfidenceTag`; the series/admin
"existence" confidence moves onto the NAME field label (Serie / Administrador).
Drop the general header `SuggestedBadge`.

### Backend (apps/backend/src/agent/search.py, db/models.py)
- `_ExtractedSeries`: add `field_confidence: dict[str, int] = {}` (keys:
  management_fee_ter, flows_min, flows_max, return_min, return_max, minimum_usd).
  Keep `confidence` (series existence).
- `_ExtractedSeriesAdmin`: add `field_confidence: dict[str, int] = {}` (keys:
  custody_fee, buy_commission, sell_commission, minimum_usd). Keep `confidence`.
- Extraction prompt (`_EXTRACTION_PROMPT_TEMPLATE`, the `series` paragraph): ask the
  model to add a `field_confidence` map (0-100) per series and per administrator,
  keyed by those numeric field names, only for values it actually filled.
- `CatalogSeriesOption`/`CatalogSeriesAdminOption` (db/models.py): add
  `field_confidence: dict[str, int] = {}`.
- `_suggested_series_options`: map + sanitize each `field_confidence` — keep only
  int scores clamped 0..100, for keys whose corresponding value is non-null.

### Frontend (portfolio-types.ts, reviewTableShared.ts, productFormFields.tsx)
- Add `field_confidence?: Record<string, number> | null` to `CatalogSeriesOption`
  and `CatalogSeriesAdminOption`.
- `EditableSeriesRow`: add `fieldConfidence?: Partial<Record<"ter"|"flowsMin"|"flowsMax"|"returnMin"|"returnMax"|"minimumUsd", number>>`.
  `EditableAdminRow`: add `fieldConfidence?: Partial<Record<"custody"|"buy"|"sell"|"minimumUsd", number>>`.
- `toEditableSeriesRows`/`toEditableAdminRows`: build `fieldConfidence` from the
  backend `field_confidence` with the key remap (management_fee_ter→ter,
  flows_min→flowsMin, flows_max→flowsMax, return_min→returnMin, return_max→returnMax,
  minimum_usd→minimumUsd; custody_fee→custody, buy_commission→buy,
  sell_commission→sell, minimum_usd→minimumUsd).
- `SeriesTable`/`AdminTable` (card layout): render `<ConfidenceTag value=...>` next to
  each field label — name label uses `suggestedConfidence`, numeric labels use
  `fieldConfidence?.<key>`. Remove the header `SuggestedBadge`.

## Constraints
- Chat/portfolio cascade untouched.
- Preserve all input `aria-label`s (ficha-review-table tests depend on them).
- TDD strict. Backend runner: `cd apps/backend && .venv/bin/python -m pytest -q -p no:recording`.
  Web: `cd apps/web && yarn vitest run <file>` + `npx tsc --noEmit` + `npx eslint`.

## Tasks
- [x] T-1 Backend: `field_confidence: dict[str,int]` on `_ExtractedSeries`/`_ExtractedSeriesAdmin`
      and `CatalogSeriesOption`/`CatalogSeriesAdminOption`; prompt asks per series/admin;
      `_clamp_field_confidence(raw, filled_keys)` + `_filled_keys` sanitize in
      `_suggested_series_options` (only filled keys, clamp 0..100, drop bools). Tests added.
- [x] T-2 Frontend: `field_confidence?` on both catalog types; `EditableSeriesRow.fieldConfidence`
      / `EditableAdminRow.fieldConfidence`; `remapFieldConfidence` + key maps in
      toEditableSeriesRows/toEditableAdminRows; per-field `ConfidenceTag` on each numeric
      label and the series/admin existence confidence moved to the name label; header
      `SuggestedBadge` removed from both tables. Tests added/updated.

## Acceptance
- [x] A web-suggested series/admin shows a per-field % on each filled numeric field and on
      the name; catalog series/admins show no tags. No single "general" badge.
- [x] Verified by orchestrator: backend 429 passed / 153 skipped + ruff clean; web 225 passed
      / 21 files; tsc + eslint clean.

## Notes
- Series has no `minimum_usd` source field, so its confidence is always dropped (harmless).
- `SuggestedBadge` export remains but is now unused.
- prettier --check flags productFormFields.tsx; NOT a commit/CI gate here (lint-staged runs
  eslint --fix for web), eslint is clean. Follow-up format pass optional.

## Route
Delegated (writer, sonnet); verified by orchestrator (full suites + diff review).

## Progress
- Branch: fix/ficha-asset-class-classified. Commit: (set on commit).

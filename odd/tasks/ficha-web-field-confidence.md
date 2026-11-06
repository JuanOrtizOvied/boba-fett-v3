# Feature: "Buscar con Claude" overwrites the form + per-field confidence %

- **Feature ID:** `ficha-web-field-confidence`
- **File locator:** `odd/tasks/ficha-web-field-confidence.md`
- **Engram mirror topic:** `odd/ficha-web-field-confidence/tasks`
- **Branch:** `feat/ficha-web-field-confidence` off `main`.
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`; web `yarn workspace web test`.
- **Route:** INLINE (design fully worked out from exploration; consistent with prior ficha features).

## User request
1. BUG: after "Buscar con Claude", the form does not update.
2. FEATURE: each form field filled from Claude's web search must show a confidence
   percentage (how sure Claude is of that value).

## Diagnosis (confirmed by reading the code)
- The form fields are controlled by parent state (ReviewTable `editableRows` →
  `updateRow` → `ProductCard` inputs `value={row.x}`), so it is NOT a state-sync bug.
- Root cause of "no se actualiza": `applyResearchToRow` (reviewTableShared.ts) FILLS
  ONLY EMPTY fields, and `toEditableRow` always pre-fills name/currency/etc. So the
  web result is discarded for already-populated fields; only `enriched` (Fuentes,
  badge) changes.
- Per-field confidence: the Claude web_search tool emits citations (Fuentes), NOT a
  numeric per-field score. The only feasible "% de confianza" is the extraction
  model's SELF-REPORTED confidence per field. `ExtractedProduct` (structured output)
  + `SearchResult.provenance` already exist, so this extends cleanly.

## Decision (user-confirmed): Option A — overwrite + inline %
"Buscar con Claude" REPLACES the product fields with Claude's web values, and each
Claude-filled field shows its self-reported confidence % inline. Admin can edit after.
Scope to the explicit button path (`POST /research` → `research_web_v2`), which starts
from an empty result so every filled field is web-sourced.

## Tasks
- [x] **T-1 — Backend: per-field self-reported confidence on the web research.** DONE.
  INLINE (TDD). Added `ExtractedProduct.field_confidence: dict[str,int]` + extended
  `_EXTRACTION_SYSTEM_PROMPT` (self-report 0-100 per filled field, field-name keys,
  omit empties). Added `SearchResult.field_confidence: dict[str,int]`. New
  `_sanitize_field_confidence(raw, result)` clamps 0..100 and keeps only fields
  populated on the result (over `PRODUCT_FIELD_NAMES` + asset_class/geographic_focus/
  underlying); wired at the end of `research_web_v2`. TDD: RED (no attribute) → GREEN.
  3 tests (surfaces+clamps+drops-empty/unknown; empty without scores; sin_datos).
  Checks: search+ficha suites 62 passed / 0 new; ruff clean. Commit: `<pending>`.
- [x] **T-2 — Frontend: overwrite form + render per-field %.** DONE. INLINE (TDD).
  `portfolio-types.ts` SearchResult += `field_confidence?: Record<string, number>`.
  `applyResearchToRow` now OVERWRITES product fields (name/manager/currency/commission/
  return/geographicFocus/underlying/assetClass) when the web result has a value (no
  longer fill-only-empty); a field the web left empty keeps its value; still sets
  `enriched` + `source`. New `ConfidenceTag` pill (green>=80/amber>=50/red, hidden when
  absent, `title="Confianza de Claude: N%"`); `Field` + `AllocationEditor` take an
  optional `confidence`; `ProductCard` passes `row.enriched.field_confidence` per field
  (name/manager/currency/asset_class/geographic_focus/underlying). TDD: RED → GREEN.
  Updated the two fill-only-empty shared tests to the overwrite spec + added
  does-not-clear-empty, carries-confidence, and two component tests (overwrite +
  per-field %). Checks: full web suite 172 passed / 18 files / 0 failed; tsc + eslint
  clean. Commit: `<pending>`.

## Acceptance criteria
- Clicking "Buscar con Claude" visibly updates the editable fields with Claude's web
  values, and each Claude-filled field shows a confidence %.
- The % is the model's self-reported confidence (documented as such), clamped 0-100,
  shown only for fields Claude actually filled.
- Backend + web suites green; no regression to the parse-time cascade.

## Next step
Feature complete (T-1 + T-2). Live behavior needs the staging redeploy from the
sibling feature (anthropic SDK pin) so the web search actually runs; the % is the
extraction model's self-reported confidence. Pending (user-owned): merge/push + deploy.

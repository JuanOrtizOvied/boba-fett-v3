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

## Follow-ups
- [x] **F-1 — Asset class mapped to the ficha taxonomy (bug: 85% but empty select).**
  DONE. INLINE (TDD). User reported the asset-class % showed but the select stayed
  empty. Root cause: the extraction prompt classifies `asset_class` into the PORTFOLIO
  taxonomy (`inversiones_directas`, …) which does not map onto the ficha select
  (`FichaAssetClassKey`: inmobiliario_directo / mercados_publicos_fijo|variable / …).
  Fix (backend): parameterized the extraction prompt (`_EXTRACTION_PROMPT_TEMPLATE` +
  `_build_extraction_system_prompt`); `_search_claude_web` now extracts with
  `_FICHA_EXTRACTION_SYSTEM_PROMPT` (ficha taxonomy), chat path unchanged. Live repro
  (StreetTracks Gold): the model now returns `asset_class: []` (gold ETF doesn't fit
  the ficha classes) and omits its confidence — no more misleading %. 3 backend tests
  (ficha prompt taxonomy; `_search_claude_web` uses it; updated the extract-signature
  test). 64 passed, ruff clean.
- [x] **F-2 — Hide the asset-class % when it did not map (frontend guard).** DONE.
  INLINE (TDD). `ProductCard` passes the asset-class confidence only when
  `row.assetClass` is set; `applyResearchToRow` now OVERWRITES `assetClass` with the
  mapped key OR `""` when the web class is unmappable (clears the stale value so the
  select shows "Sin mapear" and the guard hides the %). 2 tests (component: no % for
  an unmapped class; shared: unmappable web class clears assetClass). Web suite 174
  passed / 18 files; tsc clean.

- [x] **F-3 — New ficha asset class "Commodities y Criptos".** DONE. INLINE (TDD).
  User asked to add this class to the ficha "Clase de activo" select. Frontend
  (`reviewTableShared.ts`): `FichaAssetClassKey` += `commodities_y_criptos`,
  `ASSET_CLASS_LABELS` += "Commodities y Criptos", `normalizeAssetClass` maps
  commodit*/cripto/crypto → the new key. Backend: added to `_FICHA_ASSET_CLASSES`.
  Safe downstream: `buildConfirmProducts` writes the ficha key as the product
  asset_class; the dashboard's `resolveAssetClassKey` already falls back to the
  portfolio "otros" bucket (where commodities/crypto live), like every other ficha
  key — no dashboard change. Tests: frontend mapping + label; backend prompt
  contains the class. Backend 40 passed, web 75 passed, ruff + tsc clean.

## Open findings (NOT fixed — separate from F-3, reported for prioritization)
Discovered during a live repro while validating F-3; both pre-exist this change:
1. **Extraction model does not adhere to the ficha asset-class taxonomy.** The small
   extraction model (`claude-haiku-4-5`) returns portfolio labels (e.g. "otros" for a
   Bitcoin trust) despite the ficha prompt list; a structured-output `Literal` enum did
   NOT enforce it in the current stack (langchain-anthropic 1.4.8 / anthropic 0.116).
   So asset_class often comes back empty/unmapped and the admin picks it manually. A
   reliable fix needs either a stronger extraction model or an SDK/schema combo that
   actually enforces the enum — a scoped task on its own. (Speculative enum/hint/
   context-cap attempts were reverted to keep F-3 minimal.)
2. **Web research can overflow the model context window.** `_research_with_claude_web`
   (web_search + web_fetch) accumulated 4.4M tokens (> 200k max) for some products →
   `AnthropicContextOverflowError`, caught as an empty result. web_fetch content needs
   bounding (e.g. max fetched content per page / fewer uses). Real reliability bug for
   the ficha web search; needs its own fix.

## Next step
F-3 complete. The two findings above are candidates for follow-up features. Live
behavior still needs the staging redeploy (sibling anthropic SDK pin). Pending
(user-owned): merge/push + deploy.

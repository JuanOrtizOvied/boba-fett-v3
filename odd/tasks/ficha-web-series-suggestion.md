# Feature: "Buscar con Claude" suggests series with their administrators

- **Feature ID:** `ficha-web-series-suggestion`
- **File locator:** `odd/tasks/ficha-web-series-suggestion.md`
- **Engram mirror topic:** `odd/ficha-web-series-suggestion/tasks`
- **Branch:** `feat/ficha-web-series-suggestion` off `main`.
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q -p no:recording`;
  web `cd apps/web && yarn vitest run <file>` + `npx tsc --noEmit`.
- **Route:** INLINE single writer (design fully worked out from codegraph exploration;
  delicate backend↔frontend `series_options` contract kept in one head).

## User request
> "porque cuando busco con claude la informacion de series y administradores no se llena?"
> → "debe sugerir series con sus respectivos administradores"

Today "Buscar con Claude" (`research_web_v2`) fills only `name/currency/manager` +
asset_class/geographic_focus/underlying. `series_options` is left `[]`, so the Series
and Administradores tables stay empty when there is no catalog match. The extraction
schema has no series concept, and `applyResearchToRow` (frontend) ignores series.

## Product decision (user-confirmed)
Scope = **names + numbers with confidence**. Claude suggests series names AND their
administrators AND the commercial numeric values (TER, flows, returns, custody/commissions,
minimums) WHEN present in the sources, each suggestion carrying a self-reported confidence
%, and all visibly marked as "sugerido por Claude". The admin reviews/edits before approve.

> Risk acknowledged: this relaxes the standing "commercial fields are never guessed" rule
> for the web-suggestion path ONLY. Mitigations: values are self-reported-confidence-tagged,
> marked as suggestions (not catalog), unknown numbers stay null, and nothing is persisted
> until the admin approves. Catalog-sourced series are unaffected.

## Scope
- The explicit button path only: `POST /research` → `research_web_v2`. (The parse-time
  `cascade_search_v2` is a possible follow-up; NOT in this change.)

## Contract (already wired end-to-end — reuse it)
`SearchResult.series_options: list[CatalogSeriesOption]` already serializes to the frontend
and is already rendered via `toEditableSeriesRows` (Series table) / `toEditableAdminRows`
(Administradores table). We fill it from the web result and add a `confidence` marker.

## Tasks
- [x] **T-1 — Backend: web-suggested series in the extraction + `research_web_v2`.** DONE.
  INLINE (TDD). `db/models.py`: added `confidence: int | None = None` to
  `CatalogSeriesOption` + `CatalogSeriesAdminOption` (null = catalog/manual, number =
  web suggestion). `agent/search.py`: added `_ExtractedSeriesAdmin` / `_ExtractedSeries`
  models + `ExtractedProduct.series: list[_ExtractedSeries]`; extended
  `_EXTRACTION_PROMPT_TEMPLATE` to request series with administrators + per-suggestion
  confidence (null unknown numbers, never fabricate identity); added
  `_clamp_confidence` + `_suggested_series_options(web_data)` mapping extracted dicts →
  `CatalogSeriesOption` (drops blank labels, clamps confidence 0..100); wired into
  `research_web_v2` (sets `result.series_options`). TDD: RED (empty series_options) →
  GREEN. 3 new tests (suggests series+admins+confidence; none when web empty; clamp +
  default-0). Checks: search+search_v2+ficha-routes 82 passed; ruff clean. Commit: `<pending>`.
- [ ] **T-2 — Frontend: render suggested series/admins from the web result.** INLINE (TDD).
  `lib/portfolio-types.ts`: `confidence?: number | null` on `CatalogSeriesOption` +
  `CatalogSeriesAdminOption`. `reviewTableShared.ts`: add `suggestedConfidence?: number`
  to `EditableSeriesRow`/`EditableAdminRow`; set it in `toEditableSeriesRows`/
  `toEditableAdminRows` from the option's `confidence`; `applyResearchToRow` now populates
  `seriesOptions`/`editableSeries`/`editableAdmins` from `result.series_options`.
  `ReviewTable.tsx`: show a "✨ NN%" suggested badge on rows that carry `suggestedConfidence`
  in `SeriesTable`/`AdminTable`. Tests: `ficha-review-table-shared.test.ts` (+ component
  test) RED→GREEN; `npx tsc --noEmit`.

## Acceptance criteria
- After "Buscar con Claude" on a product with no catalog match, the Series and
  Administradores tables populate with Claude's suggestions, each row visibly marked as
  suggested with its confidence %.
- Unknown numeric values stay blank; the admin can edit every value before approving.
- Catalog-matched series are unchanged (no confidence badge). Backend + web suites green;
  no regression to the parse-time cascade or the chat/portfolio cascade.

## Next step
Start T-1 (backend) with a RED test.

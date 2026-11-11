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
- `POST /research` → `research_web_v2` (the button), AND the parse-time
  `cascade_search_v2` (T-3, user-requested follow-up). In both, the catalog stays
  authoritative: the web only fills `series_options` when the catalog has none.

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
- [x] **T-2 — Frontend: render suggested series/admins from the web result.** DONE.
  INLINE (TDD). `lib/portfolio-types.ts`: `confidence?: number | null` on
  `CatalogSeriesOption` + `CatalogSeriesAdminOption`. `reviewTableShared.ts`: added
  `suggestedConfidence?: number` to `EditableSeriesRow`/`EditableAdminRow`; set it in
  `toEditableSeriesRows`/`toEditableAdminRows` from the option's `confidence` (undefined
  for catalog → no badge); `applyResearchToRow` now populates `seriesOptions`/
  `editableSeries`/`editableAdmins` from `result.series_options` (only when present —
  never wipes an existing table). `ReviewTable.tsx`: new `SuggestedBadge` (✨ NN%,
  green≥80/amber≥50/red, title "Sugerido por Claude (búsqueda web): N% de confianza")
  rendered under the series-name and administrator-name inputs. TDD: RED (3 shared fails)
  → GREEN. 5 new tests (2 shared mapping + 2 applyResearchToRow + 1 component badge).
  Checks: full web suite 212 passed / 19 files; tsc clean. Commit: `<pending>`.

## Note (cross-branch)
The Image#6 fix on `fix/ficha-confidence-total-disambiguation` renamed the
`ConfidenceTag` title to "Confianza de Claude (búsqueda web): N%" and updated the
matching `getByTitle` assertions in `ficha-review-table.test.tsx`. THIS branch still
uses the old "Confianza de Claude: N%" title. Merging both to main will reconcile that
test file (take the Image#6 version of those assertions; the new series-badge test here
is independent). Flagged for the user's merge step.

- [x] **T-3 — Parse-time cascade also suggests series.** DONE (follow-up, user-requested
  "que tambien sugiera series"). INLINE (TDD). `agent/search.py` `cascade_search_v2`:
  the L3 web block now computes `_suggested_series_options(web_data)` and, AFTER
  `_strip_unconfident_catalog_match`, fills `result.series_options` from it ONLY when no
  catalog series remain — the catalog stays authoritative (a confident catalog match keeps
  its own series; an unmatched/stripped product gets the web suggestion). No frontend change
  needed: `toEditableRow` → `toEditableSeriesRows/toEditableAdminRows` already read
  `confidence`, so a parsed ficha with web-suggested series renders the badge on load. TDD:
  RED (empty series_options) → GREEN. 2 tests (web fills when catalog has none; web NEVER
  overwrites catalog series). Checks: search+search_v2+ficha-routes 84 passed; ruff clean.
  Commit: `<pending>`.

## Acceptance criteria
- After "Buscar con Claude" on a product with no catalog match, the Series and
  Administradores tables populate with Claude's suggestions, each row visibly marked as
  suggested with its confidence %.
- Unknown numeric values stay blank; the admin can edit every value before approving.
- Catalog-matched series are unchanged (no confidence badge). Backend + web suites green;
  no regression to the parse-time cascade or the chat/portfolio cascade.

## Follow-ups
- [x] **F-1 — BUG: "Buscar con Claude" 500 on messy series numbers.** DONE. INLINE (TDD).
  User hit a 500 on `POST /research` (~8s, no traceback). Root cause (reproduced
  deterministically): the small extraction model returns series fee/return values as
  unit-laden strings ("3.84%", "5%", "50,000"); the new `float | None` schema/model
  fields raised Pydantic `ValidationError` in TWO spots — `_run_extraction`
  (`ExtractedProduct` validation, which killed the WHOLE extraction) and
  `_suggested_series_options` (`CatalogSeriesOption`/`CatalogSeriesAdminOption`
  construction). No traceback because `_search_claude_web`/`research_web_v2` claimed
  "never raises" but did not guard `_run_extraction`. Fix (3 layers): (A) extracted
  series numeric/confidence fields accept `_LooseNumber = float|int|str|None` so a messy
  value never rejects the whole payload; (B) new `_coerce_optional_float` (clean number
  or None — never guesses a magnitude, so "3.84%" → None, admin fills it) used in
  `_suggested_series_options`; `_clamp_confidence` hardened to `int(float(...))`;
  (C) wrapped `_run_extraction` in `_search_claude_web` with try/except +
  `logger.exception` (degrades to sources-only, logs the traceback). TDD: RED (4 fails)
  → GREEN. 6 tests (schema tolerates bad numbers; `_suggested_series_options` coerces to
  null + keeps clean; research_web_v2 survives messy; `_search_claude_web` degrades on
  extraction raise). Checks: full backend unit suite 408 passed; ruff clean. Commit:
  `<pending>`.

- [x] **F-2 — Web-research step now asks for series + administrators.** DONE. INLINE (TDD).
  User saw "Buscar con Claude" return near-empty (only `name`) with `series_options: []`.
  Partly expected (obscure product, 1 thin source → no-fabricate leaves fields empty), but
  a REAL gap surfaced: `_research_with_claude_web`'s instruction only asked for
  manager/currency/asset_class/geo/underlying — never the SERIES/administrators — so the
  grounded text fed to extraction rarely contained them and `series_options` stayed empty
  even when the data exists online. Fix: extracted the instruction to `_WEB_RESEARCH_PROMPT`
  and added series/share-classes + administrators + their fees (report only what sources
  state). TDD: RED → GREEN. 1 test (prompt mentions series + administrator). Checks:
  search + ficha-routes 73 passed; ruff clean. Commit: `<pending>`.
  LIMITATION: improves the general case only; a product with no series data on the web
  (like the reported bond) will still come back sparse. The extraction model is the small
  `claude-haiku-4-5`; a stronger model would raise recall but costs more/slower (not changed).

- [x] **F-3 — Backend: retry with a reformulated name, then flag insufficient.** DONE.
  INLINE (TDD). User: "tenemos que avisar si no encuentra nada o hacer otra búsqueda" →
  chose "reintentar y luego avisar". `agent/search.py`: `_has_useful_web_data` (name alone
  ≠ useful); `_reformulate_query` strips issuer legal forms + emission/series tails (e.g.
  "BBVA Sociedad Titulizadora – Bonos BEST Vigésimo Tercera Emisión" → "BBVA Bonos BEST"),
  returns None when nothing to strip (no pointless duplicate search); refactored the body
  into `_research_web_once`; `research_web_v2` now retries ONCE with the reformulated name
  when the first pass is thin and keeps whichever found useful data, then sets
  `SearchResult.web_search_insufficient` (models.py) when neither did. Guardrail: the retry
  is used only if it does better — never worse. TDD: RED (7) → GREEN. Tests: useful-data
  gate, reformulate strip + none, retry-and-use, flag-when-both-empty, no-retry-when-useful,
  no-retry-when-not-reformulable. Checks: full backend unit suite 416 passed; ruff clean.
  Commit: `<pending>`.
- [ ] **F-4 — Frontend: warn the admin when `web_search_insufficient`.** `portfolio-types.ts`
  += `web_search_insufficient?: boolean`; `ReviewTable.researchRow` shows a clear notice
  when the flag is set (still applies the sparse result so name/source show). Tests + tsc.

## Next step
Start T-1 (backend) with a RED test.

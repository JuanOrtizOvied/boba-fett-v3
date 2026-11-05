# Feature: per-product "Investigate with Claude web search"

- **Feature ID:** `ficha-reinvestigate-web`
- **File locator:** `odd/tasks/ficha-reinvestigate-web.md`
- **Engram mirror topic:** `odd/ficha-reinvestigate-web/tasks`
- **Branch:** off `main` (feature branch `feat/ficha-reinvestigate-web`).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`; web `yarn workspace web test`.

## Objective (user request)

Each product card in the ficha validation workbench must have a working button to
**re-investigate that product with Claude's web search + web fetch tools**. Today
the card shows a disabled "Volver a investigar" button ("Disponible en una próxima
etapa"). Enable it: on click, run a Claude web research for that product and update
the card with the web-grounded fields + cited sources (Fuentes).

## Design decisions (sensible defaults, not forks)
- The button FORCES a web search (Claude `web_search` + `web_fetch`), independent of
  the catalog — matches the literal request. Reuses `_search_claude_web`.
- Merging the result into the card FILLS ONLY EMPTY editable fields (never
  overwrites what the admin already edited) and ALWAYS refreshes the `enriched`
  block (Fuentes + confidence + source badge → "Búsqueda web").
- Admin-only endpoint (web search costs money); graceful empty result with no
  `ANTHROPIC_API_KEY`.

## Tasks
- [x] **T-1 — Backend: `research_web_v2` + endpoint.** DONE. Route: INLINE.
  `agent/search.py` `research_web_v2(query) -> SearchResult`: runs
  `_search_claude_web`, merges web fields (PRODUCT_FIELD_NAMES, source
  "web_search"), attaches sources, sanitize + classify, confidence via
  `_classify_match(0.0, has_data)`. `POST /admin/ficha-patrimonial/research`
  (`FichaResearchRequest{name}`) → `SearchResult`; inherits router-level
  `require_admin`. TDD: RED → GREEN. Unit (2, mock `_search_claude_web`) + route
  (2: returns web result, non-admin blocked). Backend 368 passed / 149 skipped /
  0 new; ruff clean. Commit: `<pending>`.
- [x] **T-2 — Frontend API + merge helper.** DONE. Route: INLINE.
  `fichaApi.researchFichaLine(name)` → POST /research. Pure
  `applyResearchToRow(row, result): Partial<EditableFichaRow>` in
  `reviewTableShared.ts` (fills empty name/manager/currency/commission/return/
  geo/underlying/assetClass via the in-file `normalizeAssetClass`; always sets
  `enriched` + `source: "web_search"`). TDD: RED → GREEN. 2 helper tests + 1 api
  test. Web 59/59 on the two files.
- [x] **T-3 — Button wiring.** DONE. Route: INLINE. The card's "Volver a
  investigar" button is enabled → `onResearch`; ReviewTable's `researchRow(index)`
  calls `researchFichaLine(row.name)`, applies `applyResearchToRow` via
  `updateRow`, with a per-row "Investigando…" loading state and an error line.
  The card's enriched-derived display (source badge, confidence, Fuentes,
  similarity, ticker/horizonte) now reads the editable `row.enriched`/`row.source`
  so results show live; the declared left rail stays on `rawRow`. Updated the
  obsolete "deferred disabled" test to assert it is enabled. TDD: RED → GREEN.
  Web 169 passed / 0 new; tsc + eslint clean.

## Acceptance criteria / checks
- Clicking "Volver a investigar" calls the research endpoint and fills empty card
  fields + Fuentes without clobbering admin edits. MET: backend 368 passed,
  web 169 passed, tsc + eslint clean, 0 new failures.

**FEATURE COMPLETE** (T-1..T-3).

## Follow-ups
- [x] **F-4 — Auto web-search threshold raised to 55%.** DONE. Route: INLINE.
  Separate constant `_WEB_SEARCH_SIMILARITY = 0.55` (independent of the confidence
  boundaries `_MEDIA_SIMILARITY=0.4`/0.6); `_is_low_confidence_catalog` now
  triggers the Claude web search when a catalog match has `similarity < 0.55`
  (was 0.4). Results already reflect in the card (parse fills `enriched` + sources
  + source badge, which the card reads from `row.enriched`/`row.source`). TDD: RED
  → GREEN (mid 0.5 triggers; 0.6 skips) + fixed a pre-existing test that relied on
  the old threshold to avoid the network by mocking `_search_claude_web`. Backend
  373 passed / 0 new; ruff clean.
- [x] **F-1 — Auto web search on a low-confidence catalog match.** DONE. Route:
  INLINE. During parse, `cascade_search_v2` now runs the Claude web step when the
  product is incomplete OR the catalog match is weak (`_is_low_confidence_catalog`:
  a `catalog_product_code` with `similarity < _MEDIA_SIMILARITY` (0.4) → "baja").
  So a weak catalog hit is auto-verified with web data + sources, without an extra
  click. A strong, complete match still skips the web call. TDD: RED → GREEN
  (low-confidence triggers web + attaches sources; strong match skips). Backend
  370 passed / 149 skipped / 0 new; ruff clean. Commit: `<pending>`.
- [x] **F-3 — Confidence rises when the web verifies.** DONE. Route: INLINE.
  `_classify_match(similarity, has_data, web_verified=False)` now raises the floor
  to "media" when `web_verified` (Claude web search returned cited sources) AND
  there is data — a weak catalog match corroborated by the web is no longer merely
  "baja". `cascade_search_v2` sets `web_verified = bool(web_sources)` from the L3
  step; `research_web_v2` passes `web_verified=bool(web_sources)` too. "alta" stays
  reserved for a strong catalog match (sim >= 0.6). TDD: RED → GREEN (weak catalog
  + web sources → "media"; weak catalog + no web sources → stays "baja"; manual
  research with sources → "media"). Backend 371 passed / 0 new; ruff clean.
  Commit: `<pending>`.
- [x] **F-2 — "Buscar con Claude" UX.** DONE. Moved the button under the
  similarity in the (widened `w-80`) left rail; relabeled to "✨ Buscar con
  Claude" (gradient, prominent); Fuentes moved to a card under the button
  ("Fuentes (N)"); search uses the ficha's declared `raw_name`, not the form
  field. Commits: `ddee10a`, `1d70730`, `f49b2ac`, `d8d7c40`.

## Next step
Feature complete. (Live behavior needs a real `ANTHROPIC_API_KEY` + admin login.)

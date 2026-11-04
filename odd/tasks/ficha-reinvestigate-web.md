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
- [ ] **T-2 — Frontend API + merge helper.** `fichaApi.researchFichaLine(name)`
  → POST /research. Pure `applyResearchToRow(row, result): Partial<EditableFichaRow>`
  in `reviewTableShared.ts` (fill empty name/manager/currency/assetClass/geo/
  underlying/return/commission; always set `enriched` + `source`). TDD.
- [ ] **T-3 — Button wiring.** Enable "Volver a investigar" in ReviewTable's
  ProductCard → calls `onResearch`; ReviewTable fetches + updates the row with a
  per-row loading state. TDD (component test mocks `researchFichaLine`).

## Acceptance criteria / checks
- Clicking "Volver a investigar" calls the research endpoint and fills empty card
  fields + Fuentes without clobbering admin edits. 0 new test failures; tsc +
  eslint clean.

## Next step
T-1 (RED → GREEN).

# Feature: Ficha L3 enrichment via Claude web tools (replace Tavily)

- **Feature ID:** `ficha-web-tools-enrichment`
- **File locator:** `odd/tasks/ficha-web-tools-enrichment.md`
- **Engram mirror topic:** `odd/ficha-web-tools-enrichment/tasks`
- **Branch:** `feat/ficha-validacion-workbench` (continues the current branch).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`.

## Objective

Replace Tavily as the ficha enrichment L3 with Claude's server-side
**web_search** + **web_fetch** tools. Catalog (L1) first; if incomplete, Claude
knowledge (L2); if still incomplete, Claude researches the web with its own
tools (L3) and the shared structured extractor pulls the fields.

## Scope (user-confirmed: "Solo ficha")

- Change ONLY `cascade_search_v2` (ficha). The chat `cascade_search` keeps
  `_search_tavily` — Tavily stays a dependency for the chat path.
- Keep L1 (catalog) and L2 (Claude knowledge) unchanged.

## Design

- `_research_with_claude_web(query) -> str`: `ChatAnthropic(...).bind_tools([
  web_search_20250305, web_fetch_20250910])`, invoked with a research prompt;
  returns the assistant's grounded text (web_fetch beta enabled). "" on
  failure / no `ANTHROPIC_API_KEY` (never raises).
- `_search_claude_web(query) -> dict`: research text → `_run_extraction`
  (grounded, "extract ONLY from the web research"). "{}" on no data.
- `cascade_search_v2`: swap `_search_tavily` → `_search_claude_web` at the L3
  step; provenance stays `web_search`.

## Tasks

- [x] **T-1 — Claude-web L3 for ficha.** DONE. Route: INLINE. Added
  `_research_with_claude_web` (`ChatAnthropic(betas=["web-fetch-2025-09-10"])
  .bind_tools([web_search_20250305, web_fetch_20250910])` → grounded text via
  `_blocks_to_text`; "" on no key/failure) + `_search_claude_web` (research →
  `_run_extraction`, grounded) in `agent/search.py`. `cascade_search_v2` L3 now
  calls `_search_claude_web` instead of `_search_tavily`; chat `cascade_search`
  L3 still calls `_search_tavily` (untouched). TDD: RED → GREEN. New tests (4):
  ficha L3 uses Claude-web and NOT Tavily (Tavily monkeypatched to raise),
  graceful without API key, research→extraction delegation, empty-research→{}.
  `test_search_v2` 10/10; backend suite 338 passed / 143 skipped / 0 new.
  De-risked without an API call: `ChatAnthropic(betas=...).bind_tools(_WEB_TOOLS)`
  constructs cleanly. LIVE web_search/web_fetch execution still PENDING a real-API
  run. Commit: `__T1__`.

## Acceptance criteria / checks
- `cascade_search_v2` never calls `_search_tavily`; it calls `_search_claude_web`.
- `cascade_search` (chat) still calls `_search_tavily` — unchanged.
- Graceful: no key / failure → {} (cascade still returns catalog/L2 data or None).
- Backend `pytest -q`: 0 new failures. LIVE validation of the web tools pending a
  real-API run (unit tests mock the LLM).

## Next step
Implement T-1 (RED → GREEN); then a live run to confirm web_search/web_fetch.

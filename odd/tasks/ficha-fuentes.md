# Feature: Ficha "Fuentes" — surface web-research sources

- **Feature ID:** `ficha-fuentes`
- **File locator:** `odd/tasks/ficha-fuentes.md`
- **Engram mirror topic:** `odd/ficha-fuentes/tasks`
- **Branch:** `feat/ficha-fuentes` (off `main`).
- **TDD mode:** strict. Backend `apps/backend/.venv/bin/python -m pytest -q`; web `yarn workspace web test`.

## Objective

Show the mockup's **Fuentes** section on the validation card: a list of the web
sources (link + title) the L3 Claude web research used. Now feasible because the
`web_search`/`web_fetch` response carries citation annotations (url + title) —
previously discarded.

## Scope

- Capture the citation annotations from `_research_with_claude_web` into a new
  `sources: list[Source]` on `SearchResult`.
- Render a **Fuentes** section in the review card when `sources` is non-empty.
- Sources appear ONLY for rows enriched via web/Claude L3 (catalog-only matches
  have no URLs). Persisted inside the `enriched` JSONB (no schema change).

## Tasks

- [x] **T-1 — Capture sources (backend).** DONE. Route: INLINE. `Source(url,title)`
  model + `SearchResult.sources` (`db/models.py`). `_extract_sources` collects
  citation annotations (dedupe by url); `_research_with_claude_web` →
  `(text, sources)`; `_search_claude_web` → `(fields, sources)`;
  `cascade_search_v2` sets `result.sources` from the web research. TDD: RED →
  GREEN. `test_search_v2` 12/12 (incl. extract-dedupe, cascade-captures-sources,
  and the 4 web-tools tests updated for the tuple return). Backend suite 348
  passed / 144 skipped / 0 new; ruff clean. Commit: `__T1__`.
- [ ] **T-2 — Fuentes section (frontend).** `Source` TS type +
  `SearchResult.sources?`; a numbered list of links in the `ProductCard` shown
  when sources exist. Component test.

## Acceptance criteria / checks
- A web-enriched result carries `sources`; the card shows them as links. A
  catalog-only match shows no Fuentes section.
- Chat path unaffected (sources defaulted/empty). 0 new failures vs. base.

## Next step
Implement T-1 (RED → GREEN).

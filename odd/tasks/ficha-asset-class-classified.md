# Ficha asset class — always classified

## Objective
The ficha / "Buscar producto" enrichment must ALWAYS fill the "Clase de activo"
(asset_class) field with one of the 7 ficha classes. Today it frequently comes
back empty ("Sin mapear — seleccioná una clase de activo"), e.g. for VVO
(Vanguard Global Minimum Volatility ETF).

## Problem (root cause)
Two taxonomies are in play:
- Portfolio/chat taxonomy (`agent/state.py` `ASSET_CLASSES`): 6 classes, generic
  `mercados_publicos` (no fijo/variable split).
- Ficha taxonomy (`reviewTableShared.ts` `ASSET_CLASS_LABELS`): 7 classes,
  splitting `mercados_publicos_fijo` / `mercados_publicos_variable`.

The ficha web research (`_search_claude_web`) correctly asks the model to classify
into the FICHA taxonomy (`_FICHA_EXTRACTION_SYSTEM_PROMPT` / `_FICHA_ASSET_CLASSES`),
but `_research_web_once` and `cascade_search_v2` then run `_sanitize_taxonomy` +
`_classify`, which validate/auto-classify against the PORTFOLIO `ASSET_CLASSES`.
So a correct ficha label ("Mercados Publicos - Variable") is DROPPED as invalid,
and `_classify` can't re-derive it from portfolio leaves → asset_class ends empty.
Additionally, `cascade_search_v2`'s L2 (`_extract_from_claude`) used the PORTFOLIO
prompt, and the shared prompt tells the model to leave asset_class empty when
unsure — against "siempre debe completar".

Existing tests masked this: they fed portfolio names ("mercados_publicos") to the
ficha path, which survived the portfolio sanitize.

## Scope
Backend only (`apps/backend/src/agent/search.py` + tests). Frontend
`normalizeAssetClass` already maps the 7 ficha labels, so no web change needed.
Chat/portfolio cascade (`cascade_search`, default `_extract_from_claude`,
`_sanitize_taxonomy`, `_classify`) stays on the portfolio taxonomy — untouched.

## Constraints
- Do not break the chat/portfolio cascade.
- `_search_claude_web` must keep its "never raises" contract.
- TDD strict (RED→GREEN). Runner: `cd apps/backend && .venv/bin/python -m pytest -q -p no:recording`.

## Tasks
- [x] T-1 Ficha taxonomy canonicalization + sanitize. Added `_ficha_asset_class_label`
      (mirrors `normalizeAssetClass`, + synonyms, canonical ficha label or "") and
      `_sanitize_taxonomy_ficha` (keep catalog-sourced; else canonicalize/drop).
- [x] T-2 Always-classify ficha prompt. `_build_extraction_system_prompt(..., always_classify=True)`
      appends `_ALWAYS_CLASSIFY_ASSET_CLASS`; `_FICHA_EXTRACTION_SYSTEM_PROMPT` uses it,
      `_EXTRACTION_SYSTEM_PROMPT` does not.
- [x] T-3 Wire ficha paths. `_research_web_once` and `cascade_search_v2` use
      `_sanitize_taxonomy_ficha` (not portfolio sanitize/classify); `cascade_search_v2`
      runs it between L2 and the L3 gate so an ambiguous `mercados_publicos` is dropped
      and L3 web refines it. `_extract_from_claude` signature UNCHANGED (kept the 12
      test fakes working — the early ficha sanitize achieves the refine instead).
      Updated masked tests: `_complete_result` marks asset_class catalog-sourced;
      field-confidence test uses a ficha label; `test_v2_returns_none_when_no_data`
      mocks `_search_claude_web` (the real ficha L3) instead of dead `_search_tavily`.

## Acceptance
- [x] A web-researched equity ETF (VVO-like) returns asset_class = "Mercados Publicos - Variable"
      (`test_cascade_search_v2_refines_ambiguous_class_with_web`, `test_research_web_v2_keeps_ficha_asset_class`).
- [x] Full backend suite green (428 passed, 153 skipped); chat cascade (`cascade_search`,
      `_sanitize_taxonomy`/`_classify`, portfolio prompt) untouched and green.

## Known edge
- When the web finds NOTHING real (no sources/fields), the cascade still returns None
  (no lone forced class). The always-classify guarantee applies to a FOUND product.

## Route
Direct inline (single backend module + its test file; design fully explored).

## TDD
Enabled (strict), source: project convention (CLAUDE.md). Runner:
`cd apps/backend && .venv/bin/python -m pytest -q -p no:recording`. RED→GREEN observed.

## Progress
- Branch: fix/ficha-asset-class-classified (stacked on feat/buscar-producto-ficha-card).
- Commit: (set on commit).

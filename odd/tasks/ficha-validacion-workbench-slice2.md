# Feature: Ficha validation workbench — Slice 2 (backend enrichment signals)

- **Feature ID:** `ficha-validacion-workbench` (Slice 2)
- **File locator:** `odd/tasks/ficha-validacion-workbench-slice2.md`
- **Engram mirror topic:** `odd/ficha-validacion-workbench/slice2`
- **Branch:** `feat/ficha-validacion-workbench` (continues the Slice 1 branch; stacked on `feat/ficha-patrimonial-v2`).
- **TDD mode:** strict. Backend runner `apps/backend/.venv/bin/python -m pytest -q`; web `yarn workspace web test`.
- **Predecessor:** Slice 1 (visual) COMPLETE — `odd/tasks/ficha-validacion-workbench.md`.

## Objective

Feed the Slice-1 workbench UI with the enrichment SIGNALS it renders as
placeholders, using the sources that actually exist in the V2 catalog. This
removes the Slice-1 "Confianza alta for any catalog match" limitation by gating
confidence on the match similarity.

## Scope (user-confirmed: "Núcleo de catálogo ahora")

### In scope — sources that exist
- **Ticker/ISIN** ← `catalog_product.ticker_isin` (already read by `CatalogProductRow`).
- **Horizonte** ← `catalog_product.investment_horizon` (already read).
- **Similitud %** ← `search_for_enrichment` already computes `similarity(name,$1)`;
  today it is discarded — propagate it.
- **"dato al"** ← `catalog_product.created_at` (PROXY: when the catalog row was
  created, not a true data-as-of; documented as such).
- **Confianza (backend)** ← derived from similarity + source (thresholds below);
  replaces the Slice-1 source-only frontend derivation.
- **"ya estaba en la BD" / Nuevo** ← a catalog match at or above the accept
  threshold; below it the row is treated as Nuevo (needs investigation).
- **Header counts** ← derived: `ya estaban en la BD` (catalog-matched),
  `investigados` (enriched via Claude/web), `por decidir` (lineStatus pending).

### Thresholds (proposed defaults — adjustable)
- Confianza, catalog match: `sim ≥ 0.6` → **alta**; `0.4 ≤ sim < 0.6` → **media**;
  `sim < 0.4` → **baja (revisar)**. `claude_knowledge` → **baja (revisar)**;
  `web_search` → **baja**; no match → **sin datos**.
- "ya estaba en la BD" (catalog_matched): catalog source AND `sim ≥ 0.4`.

### Deferred (no code source — need the real ficha Excel) / low value
- **Flujos (USD/mes)** and **Comentarios del cliente** — the ficha parser has no
  such columns; needs the real workbook layout. Deferred to a Slice 2b.
- **Fuentes (URLs)** — Tavily returns URLs but discards them; only applies to
  web/Claude rows (catalog matches have none). Deferred (low value for the
  catalog-match core).

## Tasks

- [x] **T-1 — Enrichment carries catalog signals (backend).** DONE. Route: INLINE.
  Added `ticker_isin`, `investment_horizon`, `similarity: float`, `data_asof: str`
  to `SearchResult` (defaulted → chat unaffected). `CatalogProductRow` gained
  `created_at: datetime | None` (read via `_PRODUCT_COLS` + `_product_from_record`)
  and `match_similarity: float | None` (set by `search_for_enrichment` from the
  pg_trgm `sim`, NOT a stored column). `_search_catalog_v2` maps ticker/horizon/
  similarity + `data_asof = created_at.date().isoformat()`. TDD: RED (no
  `created_at` field) → GREEN. `test_search_v2` 5/5. Backend suite 326 passed /
  140 skipped (integration, no DB) / 0 new. Real-DB probe (boba-fett-backend):
  "edifica global" → horizon "Largo plazo", data_asof "2026-10-07", similarity
  0.714. Commit: `daa8968`.
- [x] **T-2 — Confidence + catalog-match classification (backend).** DONE. Route:
  INLINE. Pure `_classify_match(similarity, has_data) -> (confidence, catalog_matched)`
  in `agent/search.py`, called at the end of `cascade_search_v2`. Thresholds:
  sim≥0.6→("alta",True); 0.4≤sim<0.6→("media",True); 0<sim<0.4 or no-catalog-but-data
  →("baja",False); no data→("sin_datos",False). Added `confidence: str` +
  `catalog_matched: bool` to `SearchResult`. TDD: RED (no `_classify_match`, no
  fields) → GREEN. `test_search_v2` 6/6 incl. the full threshold table (the 0.136
  false positive now classifies "baja"/not-matched, NOT "alta"). Backend suite 327
  passed / 140 skipped / 0 new. Commit: `a4c39f0`.
- [x] **T-3 — Frontend consumes the signals.** DONE. Route: INLINE. TS mirror:
  added optional `ticker_isin`/`investment_horizon`/`similarity`/`data_asof`/
  `confidence`/`catalog_matched` to `SearchResult` (`portfolio-types.ts`).
  Refactored confidence to a level→badge map (`confidenceBadge`, `SOURCE_TO_LEVEL`);
  `deriveConfidence` kept as the source fallback; new `resolveConfidence(row)`
  prefers the backend `confidence`; new `formatSimilarityPercent`. `ProductCard`:
  confidence badge from `resolveConfidence`, **similitud %** on the declared rail,
  status line "Producto existente/nuevo · dato al <fecha>" from
  `catalog_matched`/`data_asof`, and Ticker/ISIN + Horizonte now show the catalog
  values read-only (replacing the Slice-1 disabled placeholders). TDD: RED → GREEN.
  New tests: 5 shared (resolveConfidence 3, formatSimilarityPercent 2) + 2 component
  (signals + ticker/horizon). tsc + eslint clean. Full web suite 120 passed / 8
  pre-existing / 0 new. Commit: `283fe57`.
- [x] **T-4 — Header counts.** DONE. Route: INLINE. `computeFichaSummary` extended
  with `alreadyInDb` (rows with `catalog_matched`), `investigated` (primary_source
  web/Claude), `toDecide` (NOT catalog_matched → needs an admin decision);
  `FichaSummaryBar` renders them (flujos stays "—", deferred). NOTE: `toDecide` is
  the STATIC "not a confident catalog match" count, derivable from the enriched
  rows; a live pending-count tied to approve/discard would need lifting `lineStatus`
  from `ReviewTable` to the page (future refinement). TDD: RED → GREEN. Tests:
  computeFichaSummary 5/5, FichaSummaryBar 2/2. tsc + eslint clean. Full web suite
  121 passed / 8 pre-existing / 0 new. Commit: `b27c97c`.

## Acceptance criteria / checks
- A catalog-matched ficha row carries ticker/horizonte/similarity/data_asof and a
  confidence gated by similarity; a weak match (sim < 0.4) shows as Nuevo / baja,
  NOT "Confianza alta" (fixes the Slice-1 limitation / the 0.136 false positive).
- Chat path (`cascade_search`, `search_product`, `agent/tools.py`) UNCHANGED —
  only the ficha `cascade_search_v2` / `search_for_enrichment` path is touched.
- Backend `pytest -q` and web suite: 0 new failures vs. the branch base.

## Next step
**Slice 2 COMPLETE** (T-1..T-4). The workbench now shows real catalog signals:
ticker/ISIN, horizonte, similitud %, "dato al", backend confidence (gated by
similarity — the 0.136 false positive now reads "baja"/Nuevo, not "alta"),
"Producto existente/nuevo", and the header counts (ya estaban en la BD /
investigados / por decidir). Deferred to a Slice 2b: flujos + comentarios (need
the real ficha Excel columns) and Fuentes URLs. Slice 3 = persistence + sidebar.
Push / PR are the user's call; branch stacks on the v2 PR.

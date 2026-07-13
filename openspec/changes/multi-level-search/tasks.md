# Tasks: Multi-Level Product Search

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~850-950 (4 files new, 8 modified, 2 test files new) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 -> PR 2 -> PR 3 -> PR 4 (sequential, dependency-ordered) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No (resolved)
Chained PRs recommended: Yes (accepted)
Chain strategy: stacked-to-main
400-line budget risk: High (mitigated by 4-PR split)

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Data model + taxonomy foundation | PR 1 | ~200 lines; no external deps; tests included |
| 2 | Cascade search engine (`agent/search.py`) | PR 2 | ~350 lines; depends on PR 1; heaviest unit, mockable tests |
| 3 | Tool + prompt integration | PR 3 | ~180 lines; depends on PR 2 |
| 4 | Frontend provenance UI | PR 4 | ~175 lines; depends on PR 3's data contract only |

## Phase 1: Foundation — Data Model & Taxonomy (PR 1)

- [x] 1.1 `db/schema.sql`: add `category`, `subcategory TEXT DEFAULT ''` to `product_catalog`
- [x] 1.2 `db/models.py`: add `category`/`subcategory` to `CatalogProduct`; add `FieldSource`, `SearchResult`
- [x] 1.3 `db/catalog_repository.py`: map new columns in `_row_to_catalog_product`, include in search query
- [x] 1.4 `agent/state.py`: replace `CATEGORIES` with 3-level taxonomy (6 categories per `taxonomy.spec.md` table)
- [x] 1.5 `pyproject.toml`: add `tavily-python>=0.5`
- [x] 1.6 `tests/test_state.py`: assert 6 categories, groups, leaves match spec table
- [x] 1.7 `tests/test_models.py`: assert `CatalogProduct` category/subcategory, `SearchResult` defaults

## Phase 2: Cascade Search Core (PR 2, depends on Phase 1)

- [x] 2.1 New `agent/search.py`: `_merge_fields()` — catalog fields never overwritten, tracks provenance
- [x] 2.2 `agent/search.py`: L1 wrapper — `CatalogRepository.search()` mapped into `SearchResult`
- [x] 2.3 `agent/search.py`: `_extract_from_claude()` L2 — haiku `.with_structured_output`, never-invent prompt
- [x] 2.4 `agent/search.py`: `_search_tavily()` L3 — `TavilyClient.search()`, skip gracefully if no `TAVILY_API_KEY`
- [x] 2.5 `agent/search.py`: `cascade_search()` — L1->L2->L3 early-stop, auto-classification into category/subcategory
- [x] 2.6 New `tests/test_search.py`: mocked L1/L2/L3 (`AsyncMock`) — cascade order, catalog-authoritative, field parity, never-invent, missing-key degradation, classification confidence

## Phase 3: Tool & Prompt Integration (PR 3, depends on Phase 2)

- [x] 3.1 `agent/tools.py`: replace `search_catalog` with `search_product` calling `cascade_search()`
- [x] 3.2 `agent/tools.py`: extend `propose_product` with enrichment fields, `provenance`, `primary_source`, card-level tag
- [x] 3.3 `agent/tools.py`: update `portfolio_tools` list (`search_product` replaces `search_catalog`)
- [x] 3.4 `agent/prompts.py`: update `_format_categories` for 3-level taxonomy rendering
- [x] 3.5 `agent/prompts.py`: add cascade order, provenance display, never-invent, manual-classification-fallback rules
- [x] 3.6 `tests/test_tools.py`: update/add tests for `search_product` cascade call and `propose_product` provenance/tag output

## Phase 4: Frontend Provenance UI (PR 4, depends on Phase 3)

- [x] 4.1 `lib/portfolio-types.ts`: add `FieldSource`, `ProvenanceMap`; extend `ProposedProduct`
- [x] 4.2 `thread.tsx`: extend `ProposedProduct`/`ProposeToolResult` with provenance/`primary_source`
- [x] 4.3 `thread.tsx`: card-level badge ("Catálogo SABBI ✓" / "Búsqueda web ⚠" / "No verificado")
- [x] 4.4 `thread.tsx`: field-level source markers for non-catalog fields
- [x] 4.5 `thread.tsx`: display enriched fields (commission, currency, administrator, manager, liquidity, return_rate)
- [x] 4.6 `thread.tsx`: subcategory selector — pre-selected+source when auto-classified, empty+required otherwise
- [x] 4.7 `app/assistant.tsx`: confirm `convertMessages` generic JSON passthrough already forwards provenance (no change expected)

## Phase 5: Cleanup / Verification

- [ ] 5.1 Remove `search_catalog` references from comments/docstrings (`tools.py`, `prompts.py`)
- [ ] 5.2 Grep for old flat-taxonomy references; confirm none remain
- [ ] 5.3 Manual smoke test: unset `TAVILY_API_KEY`, confirm graceful degradation end-to-end

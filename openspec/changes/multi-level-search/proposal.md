# Proposal: Multi-Level Product Search

## Intent

The agent currently has a single search path: trigram similarity against the `product_catalog` table. When a product is not in the catalog, the agent relies on its own training knowledge with no structured fallback and no provenance tracking. This change introduces a three-level cascading search (Catalog -> Claude Knowledge -> Tavily Web Search), hybrid provenance tracking so users know which data is admin-verified vs. web-sourced, a replacement taxonomy with deeper subcategory granularity, and auto-classification into category/subcategory.

## Scope

### In Scope

- **Three-level cascading search tool**: L1 catalog (existing pg_trgm), L2 Claude knowledge (structured extraction prompt), L3 Tavily web search (`tavily-python` SDK, `TAVILY_API_KEY`)
- **Hybrid provenance**: when L1 matches but has empty fields, fill from L2/L3; mark complemented fields as unverified
- **Provenance data model**: per-field source tracking (catalog / claude_knowledge / web_search) in tool return values and proposal card data
- **Source reliability indicators**: badge on proposal card ("Catalogo SABBI" / "Busqueda web" / "No verificado"), field-level source markers
- **Frontend proposal card redesign**: update `ProposeProductCard` in `thread.tsx` to render provenance badges (card-level + field-level), show category/subcategory with source indicator, and display enriched catalog fields (commission, currency, liquidity, etc.)
- **New CATEGORIES taxonomy**: replace existing 6-category dict with new 6-category / multi-subcategory tree (3 levels: category -> subcategory group -> leaf)
- **Auto-classification**: agent classifies into category + subcategory when confident; leaves empty when not
- **System prompt update**: new taxonomy, cascade instructions, provenance rules, never-invent-data guardrail
- **`product_catalog` schema update**: add `category` and `subcategory` columns
- **Search fields parity**: all levels search for name, asset_class, geographic_focus, underlying, commission, currency, administrator, manager, liquidity, return_rate, category, subcategory

### Out of Scope

- Tavily rate limiting, caching, or cost controls (follow-up)
- Catalog admin CRUD changes (already exists)
- Product catalog data migration (no production data)
- Changes to `add_product` / `update_product` / `delete_product` tools
- Dashboard or Excel export changes

## Capabilities

### New Capabilities

- `multi-level-search`: Cascading product search (catalog -> Claude -> Tavily) with provenance tracking and hybrid field completion

### Modified Capabilities

- `portfolio-builder/agent`: New taxonomy in CATEGORIES, updated system prompt, new search tool replacing `search_catalog`, auto-classification logic
- `portfolio-builder/product-management`: Proposal card data contract gains provenance metadata (source badges, field-level indicators)

## Approach

1. **Replace CATEGORIES** in `agent/state.py` with the new 3-level taxonomy tree. No migration needed.
2. **Add `category`/`subcategory` columns** to `product_catalog` table schema.
3. **Create `search_product` tool** (replaces `search_catalog`) implementing the cascade: query L1 first; if no match or empty fields, query L2 (structured Claude extraction via a separate non-streaming call); if still incomplete, query L3 (Tavily). Return unified result with per-field provenance.
4. **Add `tavily-python`** dependency and a thin wrapper in `db/` or `agent/` for web search.
5. **Update system prompt** with new taxonomy, cascade rules, provenance display rules, and never-invent-data guardrail.
6. **Update `propose_product`** to accept and pass through provenance metadata so the frontend can render source badges.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/backend/src/agent/state.py` | Modified | Replace CATEGORIES with new taxonomy |
| `apps/backend/src/agent/tools.py` | Modified | Replace `search_catalog` with `search_product`; update `propose_product` for provenance |
| `apps/backend/src/agent/prompts.py` | Modified | New taxonomy, cascade rules, provenance instructions |
| `apps/backend/src/agent/nodes.py` | Modified | Update `portfolio_tools` reference if tool list changes |
| `apps/backend/src/db/catalog_repository.py` | Modified | Add category/subcategory to search and model |
| `apps/backend/src/db/schema.sql` | Modified | Add category, subcategory columns to product_catalog |
| `apps/backend/src/db/models.py` | Modified | Add provenance fields to CatalogProduct; new SearchResult model |
| `apps/backend/pyproject.toml` | Modified | Add `tavily-python` dependency |
| New: `apps/backend/src/agent/search.py` | New | Multi-level search orchestration logic |
| New: `apps/backend/src/agent/taxonomy.py` | New | Taxonomy tree + classification helpers (optional split from state.py) |
| `apps/web/components/assistant-ui/thread.tsx` | Modified | Redesign `ProposeProductCard` with provenance badges, enriched fields, category/subcategory selectors |
| `apps/web/app/assistant.tsx` | Modified | Update `convertMessages` to pass provenance metadata through to UI |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Tavily API latency adds 2-5s to search | High | L3 is last resort; most products found at L1/L2. Show streaming indicator. |
| Claude L2 extraction hallucinates data | Medium | Strict prompt: return empty for unknown fields. Never-invent guardrail. |
| Taxonomy mismatch with catalog data | Low | No production data; catalog can be re-seeded with new categories. |
| `TAVILY_API_KEY` not set in all environments | Medium | Graceful degradation: skip L3, inform user only L1/L2 were checked. |
| Provenance metadata bloats tool responses | Low | Provenance is lightweight dict of field->source pairs. |

## Rollback Plan

1. Revert `CATEGORIES` to the previous dict (git revert on `state.py`).
2. Restore `search_catalog` tool and remove `search_product` from `portfolio_tools`.
3. Revert system prompt to previous version.
4. Drop `category`/`subcategory` columns from `product_catalog` (no production data, safe).
5. Remove `tavily-python` from `pyproject.toml`.

## Dependencies

- `tavily-python` SDK (PyPI) for Level 3 web search
- `TAVILY_API_KEY` environment variable (already available per user confirmation)
- No frontend dependencies for this change (data contract only)

## Success Criteria

- [ ] Agent finds catalog products via L1 with same or better accuracy than current `search_catalog`
- [ ] Agent fills product info from Claude knowledge (L2) when catalog has no match
- [ ] Agent uses Tavily (L3) as last resort and returns real web data, never invented values
- [ ] Empty fields in catalog matches are filled from L2/L3 with "unverified" provenance
- [ ] `propose_product` returns provenance metadata for every field (source: catalog / claude_knowledge / web_search)
- [ ] CATEGORIES reflects the new 6-category taxonomy with all subcategories
- [ ] Agent auto-classifies products into correct category/subcategory when data is clear
- [ ] Agent leaves classification empty and informs user when product does not match taxonomy
- [ ] Graceful degradation when `TAVILY_API_KEY` is not set (L1 + L2 only)
- [ ] No field contains invented data at any search level

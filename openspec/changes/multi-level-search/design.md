# Design: Multi-Level Product Search

## Technical Approach

Replace the single `search_catalog` tool with a cascading `search_product` tool that orchestrates L1 (catalog pg_trgm) -> L2 (Claude structured extraction) -> L3 (Tavily web search). Each level fills empty fields left by the previous one, tracking per-field provenance. The `propose_product` tool gains enrichment fields and provenance metadata so the frontend `ProposeProductCard` can render source badges and field-level indicators.

## Architecture Decisions

| Decision | Choice | Alternatives Rejected | Rationale |
|----------|--------|----------------------|-----------|
| Search orchestration location | New `agent/search.py` module with `cascade_search()` async function | Inline in tool function / LangGraph subgraph | Keeps tool thin, testable in isolation, reusable. A subgraph adds checkpoint overhead for what is a pure function. |
| L2 extraction mechanism | Separate `ChatAnthropic` call with `.with_structured_output(ExtractedProduct)` using `claude-haiku-3` | Reuse main agent LLM / Raw prompt + JSON parse | Structured output guarantees schema compliance. Haiku is 10x cheaper and ~200ms faster than Sonnet for extraction. Main agent LLM is bound to tools and would cause recursion. |
| L3 web search SDK | `tavily-python` `TavilyClient.search()` with `search_depth="basic"`, `max_results=3` | `langchain-community` Tavily wrapper / Direct HTTP | Direct SDK is simpler, no extra langchain dep. `basic` depth keeps latency under 2s. |
| Provenance granularity | Per-field `dict[str, FieldSource]` on `SearchResult` | Card-level only / Separate provenance table | Per-field is the minimum needed for field-level UI indicators. No DB storage needed since provenance is transient (tool response only). |
| Taxonomy location | Expand existing `CATEGORIES` dict in `state.py` (add `subcategories` as nested dicts with `group` key) | Separate `taxonomy.py` file | The taxonomy is <80 lines and already lives in `state.py`. A separate file adds import indirection for no benefit. |
| Frontend provenance display | Extend `ProposeToolResult.product` with optional enrichment fields + `provenance` dict | Separate API endpoint / WebSocket side-channel | Tool result is already the data contract for `ProposeProductCard`. No new endpoints needed. |

## Data Flow

```
User mentions product
        |
        v
  search_product tool
        |
        v
  cascade_search(query)           <-- agent/search.py
        |
   L1: CatalogRepository.search()
        |
   found? ──yes──> has empty fields? ──no──> return SearchResult(source="catalog")
        |                    |
        no                  yes
        |                    |
        v                    v
   L2: _extract_from_claude(query)  <-- ChatAnthropic.with_structured_output
        |                    |
   has data? ──yes──> merge into result, mark fields as "claude_knowledge"
        |
        no (or still empty fields)
        |
        v
   L3: _search_tavily(query)  <-- TavilyClient.search + parse
        |
   has data? ──yes──> merge into result, mark fields as "web_search"
        |
        v
   return SearchResult (unified, with per-field provenance)
        |
        v
  Agent receives SearchResult, calls propose_product with enrichment + provenance
        |
        v
  Frontend ProposeProductCard renders badges + field indicators
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/backend/src/agent/search.py` | Create | `cascade_search()`, `_extract_from_claude()`, `_search_tavily()`, `_merge_fields()` |
| `apps/backend/src/agent/tools.py` | Modify | Replace `search_catalog` with `search_product`; add enrichment fields + provenance to `propose_product`; update `portfolio_tools` list |
| `apps/backend/src/agent/state.py` | Modify | Expand `CATEGORIES` subcategories to include `group` key for 3-level tree |
| `apps/backend/src/agent/prompts.py` | Modify | New taxonomy reference, cascade instructions, provenance display rules, never-invent guardrail, auto-classification instructions |
| `apps/backend/src/agent/nodes.py` | Modify | No structural change — `portfolio_tools` import stays the same (list updated in `tools.py`) |
| `apps/backend/src/db/schema.sql` | Modify | Add `category TEXT DEFAULT ''` and `subcategory TEXT DEFAULT ''` columns to `product_catalog` |
| `apps/backend/src/db/models.py` | Modify | Add `category`/`subcategory` to `CatalogProduct`; new `SearchResult`, `FieldSource` models |
| `apps/backend/src/db/catalog_repository.py` | Modify | Map `category`/`subcategory` columns in `_row_to_catalog_product` |
| `apps/backend/pyproject.toml` | Modify | Add `tavily-python>=0.5` to dependencies |
| `apps/web/components/assistant-ui/thread.tsx` | Modify | Redesign `ProposeProductCard`: provenance badge, field-level source dots, enrichment fields display, subcategory selector |
| `apps/web/lib/portfolio-types.ts` | Modify | Add `ProvenanceMap`, `FieldSource` types; extend `ProposedProduct` with enrichment + provenance |

## Interfaces / Contracts

### Backend — `db/models.py` additions

```python
from typing import Literal

FieldSource = Literal["catalog", "claude_knowledge", "web_search"]

class SearchResult(BaseModel):
    name: str = ""
    asset_class: str = ""
    geographic_focus: str = ""
    underlying: str = ""
    commission: str = ""
    currency: str = ""
    administrator: str = ""
    manager: str = ""
    liquidity: str = ""
    return_rate: str = ""
    category: str = ""
    subcategory: str = ""
    primary_source: FieldSource = "catalog"
    provenance: dict[str, FieldSource] = {}  # field_name -> source
```

### Backend — `agent/search.py` core signature

```python
async def cascade_search(query: str, pool: asyncpg.Pool) -> SearchResult | None:
    """L1 -> L2 -> L3 cascade. Returns None only if all levels find nothing."""
```

### Backend — `propose_product` extended return

```python
{
    "status": "proposed",
    "product": {
        "name": "...", "amount": 0, "category": "...", "provider": "...",
        "asset_class": "...", "currency": "...", "commission": "...",
        "administrator": "...", "manager": "...", "liquidity": "...",
        "geographic_focus": "...", "subcategory": "...",
        "composition": [...],
        "primary_source": "catalog" | "claude_knowledge" | "web_search",
        "provenance": { "name": "catalog", "commission": "claude_knowledge", ... }
    }
}
```

### Frontend — `portfolio-types.ts` additions

```typescript
type FieldSource = "catalog" | "claude_knowledge" | "web_search";

interface EnrichedProposedProduct extends ProposedProduct {
    asset_class?: string;
    currency?: string;
    commission?: string;
    administrator?: string;
    manager?: string;
    liquidity?: string;
    geographic_focus?: string;
    subcategory?: string;
    primary_source?: FieldSource;
    provenance?: Record<string, FieldSource>;
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `cascade_search` with mocked L1/L2/L3 | pytest + `unittest.mock.AsyncMock` for repo, LLM, Tavily client |
| Unit | `_merge_fields` provenance tracking | Pure function, direct assertions on provenance dict |
| Unit | L2 extraction prompt returns empty for unknown fields | Mock `ChatAnthropic.with_structured_output` response |
| Unit | L3 Tavily result parsing | Mock `TavilyClient.search` response, verify field mapping |
| Unit | Graceful degradation when `TAVILY_API_KEY` missing | Env var unset, verify L3 skipped, result still returned |
| Integration | `ProposeProductCard` renders provenance badges | React testing with mock tool result containing provenance data |

## Migration / Rollout

- **Schema**: `ALTER TABLE product_catalog ADD COLUMN IF NOT EXISTS category TEXT DEFAULT ''; ALTER TABLE ... subcategory TEXT DEFAULT '';` — idempotent, no data migration needed (no production catalog data).
- **Environment**: `TAVILY_API_KEY` must be added to `apps/backend/.env` and deploy secrets. If missing, L3 is skipped gracefully (no crash).
- **Dependency**: `tavily-python` added to `pyproject.toml`; `pip install -e .` or `uv pip install -e .` to pick it up.
- No feature flag needed — the new `search_product` tool replaces `search_catalog` atomically.

## Open Questions

- [ ] Exact subcategory groupings for the expanded taxonomy (the 6 top-level categories are confirmed; subcategory tree needs final review from the user before implementation)

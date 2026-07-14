/**
 * Frontend mirror of `apps/backend/src/db/models.py`. Keep in sync with the
 * Pydantic models exposed by the REST API (`GET/POST/PATCH /portfolio/...`,
 * `/products/...`).
 */

export type Category =
  | "directas"
  | "privados"
  | "club"
  | "publicos"
  | "otros"
  | "cash";

export interface AssetAllocation {
  name: string;
  percentage: number;
}

export interface Product {
  id: string;
  user_id: string;
  name: string;
  provider: string;
  amount: number;
  category: Category;
  subcategory: string;
  composition: AssetAllocation[];
}

export interface ProductCreateInput {
  name: string;
  provider?: string;
  amount: number;
  category: Category;
  subcategory?: string;
  composition: AssetAllocation[];
}

export interface ProductUpdateInput {
  name?: string;
  provider?: string;
  amount?: number;
  category?: Category;
  subcategory?: string;
  composition?: AssetAllocation[];
}

/**
 * Source of a single field's value in a `search_product`/`propose_product`
 * result — mirrors `db.models.FieldSource` in the backend. `catalog` is the
 * SABBI catalog (L1, trusted), `claude_knowledge` is Claude's own training
 * data (L2), `web_search` is a Tavily lookup (L3).
 */
export type FieldSource = "catalog" | "claude_knowledge" | "web_search";

/** Per-field source map keyed by field name, as returned by `propose_product`. */
export type ProvenanceMap = Record<string, FieldSource>;

export interface ProposedProduct {
  name: string;
  amount: number;
  category: Category;
  provider?: string;
}

/**
 * `propose_product`'s return shape once the cascading `search_product` tool
 * (`multi-level-search`) has enriched it — see `agent/tools.py::propose_product`.
 * Enrichment fields and `subcategory` are only populated when a level of the
 * cascade found them; `reliability_tag` aggregates `provenance` into the
 * card-level badge shown by `ProposeProductCard`.
 */
export interface EnrichedProposedProduct extends ProposedProduct {
  asset_class?: string;
  currency?: string;
  commission?: string;
  administrator?: string;
  manager?: string;
  liquidity?: string;
  return_rate?: string;
  geographic_focus?: string;
  subcategory?: string;
  primary_source?: FieldSource;
  provenance?: ProvenanceMap;
  reliability_tag?: string;
}

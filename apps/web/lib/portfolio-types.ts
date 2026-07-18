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
  asset_class: string;
  geographic_focus: string;
  underlying: string;
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
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

/**
 * Mirrors `db.models.CatalogProduct` — a `product_catalog` row as returned by
 * `GET /admin/catalog/entries` (`sdd/product-catalog-approval/spec` ->
 * "Catalog Listing"). `approved_from_product_id`/`approved_at` are only set
 * when the entry was created via the admin approval flow.
 */
export interface CatalogProduct {
  id: number;
  name: string;
  geographic_focus: string;
  asset_class: string;
  underlying: string;
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
  category: string;
  subcategory: string;
  approved_from_product_id: string | null;
  approved_at: string | null;
}

/**
 * Mirrors `db.models.CatalogProductCreate` — the admin-submitted payload for
 * `POST /admin/catalog/approve`. `name` and `category` are required; the
 * rest are optional enrichment fields.
 */
export interface CatalogProductCreate {
  name: string;
  category: string;
  subcategory?: string;
  asset_class?: string;
  geographic_focus?: string;
  underlying?: string;
  commission?: string;
  currency?: string;
  administrator?: string;
  manager?: string;
  liquidity?: string;
  return_rate?: string;
  approved_from_product_id?: string | null;
}

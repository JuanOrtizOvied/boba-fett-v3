/**
 * Frontend mirror of `apps/backend/src/db/models.py`. Keep in sync with the
 * Pydantic models exposed by the REST API (`GET/POST/PATCH /portfolio/...`,
 * `/products/...`).
 */

export type AssetClass =
  | "inversiones_directas"
  | "mercados_privados"
  | "club_deals"
  | "mercados_publicos"
  | "otros"
  | "cash_y_equivalentes";

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
  underlying: AssetAllocation[];
  asset_class: AssetAllocation[];
  geographic_focus: AssetAllocation[];
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
  isin: string;
  distribution: string;
  catalog_product_id: number | null;
}

export interface ProductCreateInput {
  name: string;
  provider?: string;
  amount: number;
  asset_class: AssetAllocation[];
  underlying: AssetAllocation[];
}

export interface ProductUpdateInput {
  name?: string;
  provider?: string;
  amount?: number;
  asset_class?: AssetAllocation[];
  underlying?: AssetAllocation[];
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
  asset_class: AssetAllocation[];
  provider?: string;
}

/**
 * `propose_product`'s return shape once the cascading `search_product` tool
 * (`multi-level-search`) has enriched it — see `agent/tools.py::propose_product`.
 * Enrichment fields are only populated when a level of the cascade found
 * them; `reliability_tag` aggregates `provenance` into the card-level badge
 * shown by `ProposeProductCard`.
 */
export interface EnrichedProposedProduct extends ProposedProduct {
  currency?: string;
  commission?: string;
  administrator?: string;
  manager?: string;
  liquidity?: string;
  return_rate?: string;
  geographic_focus?: AssetAllocation[];
  underlying?: { name: string; percentage: number }[];
  catalog_product_id?: number | null;
  primary_source?: FieldSource;
  provenance?: ProvenanceMap;
  reliability_tag?: string;
}

/**
 * Mirrors `db.models.SearchResult` — the unified result of the cascading
 * L1 (catalog) -> L2 (Claude knowledge) -> L3 (Tavily web search) product
 * search, as embedded in `FichaEnrichedRow.enriched`.
 */
export interface SearchResult {
  name: string;
  asset_class: AssetAllocation[];
  geographic_focus: AssetAllocation[];
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
  underlying: AssetAllocation[];
  catalog_product_id: number | null;
  primary_source: FieldSource;
  provenance: ProvenanceMap;
}

/**
 * Mirrors `db.ficha_patrimonial.FichaClientInfo` — the ficha's row-5 client
 * info, resolved to a `user_id` by `POST /admin/ficha-patrimonial/parse`.
 */
export interface FichaClientInfo {
  email: string;
  name: string;
  phone: string;
  user_id: string;
}

/**
 * Mirrors `db.ficha_patrimonial.FichaParsedRow` — one raw product row
 * (Excel rows 8+) before `cascade_search()` enrichment.
 */
export interface FichaParsedRow {
  excel_row: number;
  raw_name: string;
  raw_tipo_activo: string;
  raw_amount: number;
  raw_currency: string;
  raw_return_rate: string;
  raw_pertenencia: string;
  mapped_asset_class: string | null;
  normalized_return_rate: string;
}

/**
 * Mirrors `db.ficha_patrimonial.FichaEnrichedRow` — a parsed row merged with
 * its `cascade_search()` result. `enrichment_failed` covers both raised
 * exceptions and a true no-match cascade result (`admin_ficha_import` design
 * discovery, PR2 apply-progress).
 */
export interface FichaEnrichedRow extends FichaParsedRow {
  enriched: SearchResult | null;
  enrichment_failed: boolean;
}

/**
 * Mirrors `db.ficha_patrimonial.FichaParseResponse` — the response body of
 * `POST /admin/ficha-patrimonial/parse` (`sdd/admin-ficha-patrimonial/spec`
 * -> "Ficha Parse Endpoint").
 */
export interface FichaParseResponse {
  client: FichaClientInfo;
  rows: FichaEnrichedRow[];
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
  geographic_focus: AssetAllocation[];
  asset_class: AssetAllocation[];
  underlying: AssetAllocation[];
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  return_rate: string;
  isin: string;
  distribution: string;
  alternative_names: string[];
  administrator_score: number | null;
  manager_score: number | null;
  approved_from_product_id: string | null;
  approved_at: string | null;
}

/** Mirrors `db.models.Administrator` — one row from `GET /admin/administrators`. */
export interface AdministratorEntity {
  id: number;
  name: string;
  score: number | null;
  score_is_fixed: boolean;
}

/** Mirrors `db.models.Manager` — one row from `GET /admin/managers`. */
export interface ManagerEntity {
  id: number;
  name: string;
  score: number | null;
}

/**
 * Mirrors `db.models.CatalogProductCreate` — the admin-submitted payload for
 * `POST /admin/catalog/approve`. `name` and `asset_class` are required; the
 * rest are optional enrichment fields.
 */
export interface CatalogProductCreate {
  name: string;
  asset_class: AssetAllocation[];
  geographic_focus?: AssetAllocation[];
  underlying?: AssetAllocation[];
  commission?: string;
  currency?: string;
  administrator?: string;
  manager?: string;
  liquidity?: string;
  return_rate?: string;
  isin?: string;
  distribution?: string;
  alternative_names?: string[];
  administrator_score?: number | null;
  manager_score?: number | null;
  approved_from_product_id?: string | null;
  catalog_product_id?: number | null;
}

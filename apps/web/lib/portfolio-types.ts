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
 * Mirrors `db.models.CatalogSeriesAdminOption` — one administrator option
 * under a series in the ficha V2 review-table picker. Fee/commission values
 * are FRACTIONS (0.0384 = 3.84%), as in the catalog.
 */
export interface CatalogSeriesAdminOption {
  administrator: string;
  custody_fee: number | null;
  buy_commission: number | null;
  sell_commission: number | null;
  billing_currency: string;
  minimum_usd: number | null;
  min_commission_usd: number | null;
  /** Self-reported confidence (0..100) when this administrator was SUGGESTED by
   * the web research. null/absent for catalog/manual admins. */
  confidence?: number | null;
  /** Per-field confidence (0..100) keyed by backend field name (custody_fee…);
   * only for values the web research filled. */
  field_confidence?: Record<string, number> | null;
}

/**
 * Mirrors `db.models.CatalogSeriesOption` — one series option (with its
 * administrators) the admin picks from in the ficha V2 review table.
 */
export interface CatalogSeriesOption {
  series: string;
  management_fee_ter: number | null;
  flows_min: number | null;
  flows_max: number | null;
  return_min: number | null;
  return_max: number | null;
  administrators: CatalogSeriesAdminOption[];
  /** Self-reported confidence (0..100) when this series was SUGGESTED by the web
   * research ("Buscar con Claude"). null/absent for catalog series — the UI reads
   * a number as "sugerido por Claude". */
  confidence?: number | null;
  /** Per-field confidence (0..100) keyed by backend field name
   * (management_fee_ter…); only for values the web research filled. */
  field_confidence?: Record<string, number> | null;
}

/** Mirrors `db.catalog_curation.SeriesUpdateInput` — an edited series (fractions). */
export interface CatalogSeriesUpdate {
  series: string;
  management_fee_ter: number | null;
  flows_min: number | null;
  flows_max: number | null;
  return_min: number | null;
  return_max: number | null;
}

/** Mirrors `db.catalog_curation.AdminUpdateInput` — an edited administrator. */
export interface CatalogAdminUpdate {
  series: string;
  administrator: string;
  custody_fee: number | null;
  buy_commission: number | null;
  sell_commission: number | null;
  minimum_usd: number | null;
  min_commission_usd: number | null;
}

/** Mirrors `api.admin_routes.FichaApproveRequest` — the per-line approve payload. */
export interface FichaApproveRequest {
  user_id: string;
  product: Record<string, unknown>;
  catalog_product_code: string;
  catalog_update: {
    name?: string;
    manager?: string;
    currency?: string;
    asset_class?: AssetAllocation[];
    geographic_focus?: AssetAllocation[];
    underlying?: AssetAllocation[];
  };
  series: CatalogSeriesUpdate[];
  admins: CatalogAdminUpdate[];
}

/** Mirrors `db.catalog_history.CatalogHistoryEntry` — one V2 catalog change. */
export interface CatalogHistoryEntry {
  id: number;
  product_code: string;
  action: string;
  changed_by: string | null;
  source: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  created_at: string | null;
}

/** Mirrors `db.models.Source` — a web source (link + title) cited by L3. */
export interface Source {
  url: string;
  title: string;
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
  /** Ficha V2 enrichment only — matched normalized-catalog product code and
   * the series/admin options the reviewer picks from. Absent for chat/V1. */
  catalog_product_code?: string;
  series_options?: CatalogSeriesOption[];
  /** Ficha V2 Slice-2 signals (catalog-sourced). Absent for chat/V1. */
  ticker_isin?: string;
  investment_horizon?: string;
  /** Fuzzy-match score 0..1 of the L1 catalog match (0 when not catalog-matched). */
  similarity?: number;
  /** Data-as-of ISO date for the catalog match (proxy: catalog row created_at). */
  data_asof?: string;
  /** Backend-derived confidence level: "alta" | "media" | "baja" | "sin_datos". */
  confidence?: string;
  /** True when the product is an accepted catalog match ("ya estaba en la BD"). */
  catalog_matched?: boolean;
  /** Web sources cited by the L3 research (ficha "Fuentes"); empty for catalog. */
  sources?: Source[];
  /** Per-field self-reported confidence (0..100) from the Claude web research
   * ("Buscar con Claude"). Keyed by backend field name (e.g. `{ name: 92 }`).
   * Only present on web-research results; the web_search tool gives no numeric
   * score, so this is the extraction model's self-estimate. */
  field_confidence?: Record<string, number>;
  /** True when "Buscar con Claude" (incl. one reformulated retry) found no useful
   * product/series data — only the name, or nothing. The card warns the admin. */
  web_search_insufficient?: boolean;
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
  /** Persisted ficha_line id (Slice 3b) — present when loaded from a saved
   * ficha; absent for a freshly-parsed response. Enables per-line PATCH. */
  line_id?: number;
}

/** Ficha lifecycle status (Slice 3a), derived from the per-line decisions. */
export type FichaStatus =
  | "por_validar"
  | "en_proceso"
  | "validada"
  | "con_error";

/** Per-line decision state (Slice 3a). */
export type LineStatus = "pending" | "approved" | "discarded";

/** Mirrors `db.ficha_repository.FichaLine` — one persisted ficha product line. */
export interface FichaLine {
  id: number;
  excel_row: number;
  raw_name: string;
  raw_tipo_activo: string;
  raw_amount: number;
  raw_currency: string;
  raw_return_rate: string;
  raw_pertenencia: string;
  mapped_asset_class: string | null;
  normalized_return_rate: string;
  enriched: SearchResult | null;
  line_status: LineStatus;
}

/** Mirrors `db.ficha_repository.Ficha` — a persisted ficha with its lines. */
export interface Ficha {
  id: number;
  user_id: string | null;
  client_name: string;
  client_email: string;
  client_phone: string;
  parse_failed: boolean;
  confirmed: boolean;
  created_at: string | null;
  lines: FichaLine[];
  status: FichaStatus;
}

/** Mirrors `db.ficha_repository.FichaListItem` — a sidebar list row. */
export interface FichaListItem {
  id: number;
  client_name: string;
  client_email: string;
  created_at: string | null;
  line_count: number;
  status: FichaStatus;
}

/**
 * Mirrors `db.ficha_patrimonial.FichaParseResponse` — the response body of
 * `POST /admin/ficha-patrimonial/parse` (`sdd/admin-ficha-patrimonial/spec`
 * -> "Ficha Parse Endpoint").
 */
export interface FichaParseResponse {
  client: FichaClientInfo;
  rows: FichaEnrichedRow[];
  /** Id of the auto-saved ficha (Slice 3a); absent if persistence is off. */
  ficha_id?: number | null;
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
  /** Business code used to match the Excel sync (e.g. BD-00001); null until assigned. */
  codigo: string | null;
  cash_flows: string;
  /** Soft delete flag. Deleted entries are only returned with `include_deleted=true`. */
  is_deleted: boolean;
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

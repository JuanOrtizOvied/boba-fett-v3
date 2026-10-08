/**
 * Types of the v2 catalog API (`/admin/catalog-v2`), see
 * `openspec/changes/catalog-v2-sharepoint-sync`. Rates and commissions of series
 * and administrator links are fractions, as in the workbook (0.0384 is 3.84%);
 * the percentages of a product's composites are on a 0 to 100 scale.
 */

export interface V2Allocation {
  name: string;
  percentage: number;
}

/** A manager or an administrator as a product refers to it. */
export interface V2EntityRef {
  id: number;
  name: string;
  score: number | null;
}

export interface CatalogV2Product {
  id: number;
  codigo: string;
  name: string;
  isin: string;
  manager_id: number | null;
  manager: string;
  manager_score: number | null;
  asset_class: V2Allocation[];
  geographic_focus: V2Allocation[];
  underlying: V2Allocation[];
  currency: string;
  investment_horizon: string;
  is_deleted: boolean;
  /** Active series of the product. */
  series_count: number;
  /** Active series with a blank TER or a blank return (a zero is not blank). */
  incomplete_series: number;
  /** The distinct administrators of the product, with their score. */
  administrators: V2EntityRef[];
}

export interface V2AdministratorLink {
  id: number;
  administrator_id: number;
  administrator: string;
  administrator_score: number | null;
  custody: number | null;
  buy_commission: number | null;
  sell_commission: number | null;
  minimum_usd: number | null;
  min_commission_usd: number | null;
  is_deleted: boolean;
}

export interface V2Series {
  id: number;
  series: string;
  ter: number | null;
  flows_min: number | null;
  flows_max: number | null;
  return_min: number | null;
  return_max: number | null;
  is_deleted: boolean;
  administrators: V2AdministratorLink[];
}

export interface CatalogV2ProductDetail extends CatalogV2Product {
  series: V2Series[];
}

export interface V2Administrator {
  id: number;
  name: string;
  score: number | null;
  score_is_fixed: boolean;
}

export interface V2Manager {
  id: number;
  name: string;
  score: number | null;
}

/** The official values of the finite-set fields, from `GET /options`. */
export interface CatalogV2Options {
  asset_class: string[];
  geographic_focus: string[];
  underlying: string[];
  currency: string[];
  investment_horizon: string[];
}

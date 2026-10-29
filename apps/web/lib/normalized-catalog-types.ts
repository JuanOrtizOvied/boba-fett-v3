import type { AssetAllocation } from "@/lib/portfolio-types";

/**
 * Types for the normalized catalog admin API
 * (`/api/admin/normalized-catalog/*`): product -> series -> administrator.
 *
 * Fee / commission / flows / return fields are FRACTIONS (0.0384 = 3.84%),
 * exactly as stored in the DB. `minimum_usd` and `min_commission_usd` are
 * plain USD amounts.
 */

export interface CatalogProductSeriesAdmin {
  id: number;
  product_code: string;
  series: string;
  administrator: string;
  custody_fee: number | null;
  buy_commission: number | null;
  sell_commission: number | null;
  billing_currency: string;
  minimum_usd: number | null;
  min_commission_usd: number | null;
}

export interface CatalogProductSeries {
  id: number;
  product_code: string;
  series: string;
  management_fee_ter: number | null;
  flows_min: number | null;
  flows_max: number | null;
  return_min: number | null;
  return_max: number | null;
  administrators: CatalogProductSeriesAdmin[];
}

export interface CatalogProductRow {
  id: number;
  code: string;
  name: string;
  ticker_isin: string;
  manager: string;
  asset_class: AssetAllocation[];
  geographic_focus: AssetAllocation[];
  underlying: AssetAllocation[];
  currency: string;
  investment_horizon: string;
  /** Only populated by the detail endpoint (`GET /products/{code}`). */
  series: CatalogProductSeries[];
}

// -- Observations -----------------------------------------------------------

export type CatalogObservationIssue =
  | "empty"
  | "allocation_sum"
  | "not_in_list"
  | "no_series"
  | "no_administrators";

/** One problem of a product. `series` / `administrator` say which series or
 * administrator it belongs to when `level` is not "product". `value` is the
 * offending name or the allocation total. */
export interface CatalogObservation {
  level: "product" | "series" | "admin";
  field: string;
  issue: CatalogObservationIssue;
  value: string;
  series: string | null;
  administrator: string | null;
}

export interface ProductObservations {
  code: string;
  observations: CatalogObservation[];
}

// -- Create / update inputs -------------------------------------------------

export interface CatalogProductCreateInput {
  code: string;
  name: string;
  ticker_isin?: string;
  manager?: string;
  asset_class?: AssetAllocation[];
  geographic_focus?: AssetAllocation[];
  underlying?: AssetAllocation[];
  currency?: string;
  investment_horizon?: string;
}

/** Same as create minus the immutable `code`; null/omitted = unchanged. */
export type CatalogProductUpdateInput = Partial<
  Omit<CatalogProductCreateInput, "code">
>;

export interface CatalogSeriesNumericInput {
  management_fee_ter?: number | null;
  flows_min?: number | null;
  flows_max?: number | null;
  return_min?: number | null;
  return_max?: number | null;
}

export interface CatalogSeriesCreateInput extends CatalogSeriesNumericInput {
  product_code: string;
  series: string;
}

export type CatalogSeriesUpdateInput = CatalogSeriesNumericInput;

export interface CatalogAdminAttributesInput {
  custody_fee?: number | null;
  buy_commission?: number | null;
  sell_commission?: number | null;
  billing_currency?: string;
  minimum_usd?: number | null;
  min_commission_usd?: number | null;
}

export interface CatalogAdminCreateInput extends CatalogAdminAttributesInput {
  product_code: string;
  series: string;
  administrator: string;
}

export type CatalogAdminUpdateInput = CatalogAdminAttributesInput;

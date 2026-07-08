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
  composition: AssetAllocation[];
}

export interface ProductCreateInput {
  name: string;
  provider?: string;
  amount: number;
  category: Category;
  composition: AssetAllocation[];
}

export interface ProductUpdateInput {
  name?: string;
  provider?: string;
  amount?: number;
  category?: Category;
  composition?: AssetAllocation[];
}

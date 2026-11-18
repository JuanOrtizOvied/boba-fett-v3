/**
 * Client for the single-product lookup (`POST /api/admin/product-lookup`), which
 * runs the same enrichment cascade as the ficha: normalized catalog first, then
 * Claude knowledge + web search for the gaps.
 */

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { SearchResult } from "@/lib/portfolio-types";
import type { CatalogSaveRequest } from "@/components/admin/ficha-patrimonial/reviewTableShared";

/** Look up one product by name. Returns null when the cascade finds nothing. */
export async function lookupProduct(name: string): Promise<SearchResult | null> {
  const res = await fetchWithAuth("/api/admin/product-lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(`Product lookup failed (status ${res.status})`);
  }
  return (await res.json()) as SearchResult | null;
}

/** The result of saving a looked-up product to the normalized catalog. */
export interface CatalogSaveResult {
  catalog_product_code: string;
  catalog_changes: Record<string, unknown>;
}

/**
 * Persist the admin-reviewed lookup form into the normalized catalog: curates
 * the matched product or creates it when it is not catalogued yet. No client or
 * holding is involved.
 */
export async function saveProductToCatalog(
  req: CatalogSaveRequest,
): Promise<CatalogSaveResult> {
  const res = await fetchWithAuth("/api/admin/product-lookup/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`Catalog save failed (status ${res.status})`);
  }
  return (await res.json()) as CatalogSaveResult;
}

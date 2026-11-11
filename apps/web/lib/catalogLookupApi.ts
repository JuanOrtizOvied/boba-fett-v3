/**
 * Client for the single-product lookup (`POST /api/admin/product-lookup`), which
 * runs the same enrichment cascade as the ficha: normalized catalog first, then
 * Claude knowledge + web search for the gaps.
 */

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { SearchResult } from "@/lib/portfolio-types";

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

/**
 * Client for the Ficha Patrimonial persistence endpoints (Slice 3a). Thin
 * `fetchWithAuth` wrappers used by the Slice-3b sidebar and review table.
 */

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  CatalogHistoryEntry,
  Ficha,
  FichaApproveRequest,
  FichaEnrichedRow,
  FichaListItem,
  LineStatus,
  SearchResult,
} from "@/lib/portfolio-types";
import type { CatalogProductRow } from "@/lib/normalized-catalog-types";

const BASE = "/api/admin/ficha-patrimonial";

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    throw new Error(`Ficha request failed (status ${res.status})`);
  }
  return (await res.json()) as T;
}

/** List saved fichas (newest first), optionally filtered by derived status. */
export async function listFichas(status?: string): Promise<FichaListItem[]> {
  const url = status
    ? `${BASE}/fichas?status=${encodeURIComponent(status)}`
    : `${BASE}/fichas`;
  return asJson<FichaListItem[]>(await fetchWithAuth(url));
}

/** Load one saved ficha with its lines and derived status. */
export async function getFicha(id: number): Promise<Ficha> {
  return asJson<Ficha>(await fetchWithAuth(`${BASE}/fichas/${id}`));
}

/** Persist a per-line review decision. */
export async function updateLineStatus(
  lineId: number,
  status: LineStatus,
): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/lines/${lineId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
  await asJson(res);
}

/** Mark a ficha confirmed (→ validada once every line is decided). */
export async function confirmFicha(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/fichas/${id}/confirm`, {
    method: "POST",
  });
  await asJson(res);
}

/** Approve one reviewed line: curate the catalog (update/create) + create the
 * client holding. Returns the created product id and the catalog changes. */
export async function approveFichaLine(
  request: FichaApproveRequest,
): Promise<{ product_id: string; catalog_changes: Record<string, unknown> }> {
  const res = await fetchWithAuth(`${BASE}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  return asJson(res);
}

/** Re-investigate one product with Claude's web search + fetch tools. Returns a
 * web-grounded SearchResult (product fields + cited sources) for the card. */
export async function researchFichaLine(name: string): Promise<SearchResult> {
  const res = await fetchWithAuth(`${BASE}/research`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return asJson<SearchResult>(res);
}

/** Search the normalized catalog by name or code (for the card's product picker).
 * Reuses the admin catalog list endpoint (`code ILIKE OR name ILIKE`). */
export async function searchCatalogProducts(
  query: string,
): Promise<CatalogProductRow[]> {
  const url = `/api/admin/normalized-catalog/products?search=${encodeURIComponent(query)}`;
  return asJson<CatalogProductRow[]>(await fetchWithAuth(url));
}

/** Load one catalog product (by code) as a SearchResult so the review card can
 * replace a wrong/low-confidence match with the product the admin picked. */
export async function getCatalogProductAsSearchResult(
  code: string,
): Promise<SearchResult> {
  return asJson<SearchResult>(
    await fetchWithAuth(`${BASE}/catalog-product/${encodeURIComponent(code)}`),
  );
}

/**
 * Parse the download filename from a `Content-Disposition` header, preferring the
 * RFC 5987 `filename*` (UTF-8) form, then plain `filename`, then `fallback`.
 */
export function filenameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  if (!header) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // malformed percent-encoding — fall through to the plain form
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1] : fallback;
}

/** Download the original uploaded `.xlsx` for a ficha, triggering a browser save. */
export async function downloadFichaFile(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/fichas/${id}/file`);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Esta ficha no tiene un archivo guardado para descargar"
        : `No se pudo descargar el archivo (status ${res.status})`,
    );
  }
  const blob = await res.blob();
  const name = filenameFromDisposition(
    res.headers.get("content-disposition"),
    `ficha-${id}.xlsx`,
  );
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Delete a saved ficha (and its lines). */
export async function deleteFicha(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/fichas/${id}`, { method: "DELETE" });
  await asJson(res);
}

/** The change history for one V2 catalog product (newest first). */
export async function getCatalogHistory(
  code: string,
): Promise<CatalogHistoryEntry[]> {
  return asJson<CatalogHistoryEntry[]>(
    await fetchWithAuth(
      `/api/admin/catalog/products/${encodeURIComponent(code)}/history`,
    ),
  );
}

/** Maps a persisted ficha's lines into the review table's row shape. */
export function fichaToEnrichedRows(ficha: Ficha): FichaEnrichedRow[] {
  return ficha.lines.map((line) => ({
    excel_row: line.excel_row,
    raw_name: line.raw_name,
    raw_tipo_activo: line.raw_tipo_activo,
    raw_amount: line.raw_amount,
    raw_currency: line.raw_currency,
    raw_return_rate: line.raw_return_rate,
    raw_pertenencia: line.raw_pertenencia,
    mapped_asset_class: line.mapped_asset_class,
    normalized_return_rate: line.normalized_return_rate,
    enriched: line.enriched,
    enrichment_failed: line.enriched === null,
    line_id: line.id,
  }));
}

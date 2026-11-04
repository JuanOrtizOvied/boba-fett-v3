/**
 * Client for the Ficha Patrimonial persistence endpoints (Slice 3a). Thin
 * `fetchWithAuth` wrappers used by the Slice-3b sidebar and review table.
 */

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  Ficha,
  FichaApproveRequest,
  FichaEnrichedRow,
  FichaListItem,
  LineStatus,
} from "@/lib/portfolio-types";

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

/** Delete a saved ficha (and its lines). */
export async function deleteFicha(id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/fichas/${id}`, { method: "DELETE" });
  await asJson(res);
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

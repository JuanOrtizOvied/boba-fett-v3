/**
 * Client for the Ficha Patrimonial persistence endpoints (Slice 3a). Thin
 * `fetchWithAuth` wrappers used by the Slice-3b sidebar and review table.
 */

import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { Ficha, FichaListItem, LineStatus } from "@/lib/portfolio-types";

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

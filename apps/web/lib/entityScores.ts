/**
 * Types, response checks, API calls and display helpers of the administrators and
 * managers view (`/admin/administradores-gestores`). Own file: nothing here is shared
 * with the catalog or the properties section.
 *
 * The two tables have the same shape, so one set of types serves both. The backend
 * serves a missing score as `null` and the slugs as a list of strings.
 */

import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type EntityKind = "administrators" | "managers";

export const ENTITY_KINDS: readonly EntityKind[] = ["administrators", "managers"];

export const KIND_TEXT: Record<EntityKind, { tab: string; plural: string; singular: string }> = {
  administrators: { tab: "Administradores", plural: "administradores", singular: "administrador" },
  managers: { tab: "Gestores", plural: "gestores", singular: "gestor" },
};

export const NO_SCORE = "Sin score";
export const NO_SLUGS = "Sin slugs";

const BASE = "/api/admin/entity-scores";

export interface EntityScore {
  id: number;
  name: string;
  score: number | null;
  slugs: string[];
  /** ISO text of the moment it was deleted, `null` while it is active. */
  deleted_at: string | null;
}

// -- URL ----------------------------------------------------------------------

/** The URL parameter that keeps the search term of each tab. */
export const SEARCH_PARAM: Record<EntityKind, string> = {
  administrators: "administradores",
  managers: "gestores",
};

/** The active tab from its URL parameter. Anything but "gestores" is the first tab. */
export function tabFromParam(param: string): EntityKind {
  return param === "gestores" ? "managers" : "administrators";
}

/** The first tab is the default, so it leaves no parameter (an empty value). */
export function tabToParam(kind: EntityKind): string {
  return kind === "managers" ? "gestores" : "";
}

// -- Response checks ----------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string";

function isEntityScore(value: unknown): value is EntityScore {
  return (
    isRec(value) &&
    typeof value.id === "number" &&
    Number.isFinite(value.id) &&
    isText(value.name) &&
    (value.score === null || (typeof value.score === "number" && Number.isFinite(value.score))) &&
    Array.isArray(value.slugs) &&
    value.slugs.every(isText) &&
    (value.deleted_at === null || isText(value.deleted_at))
  );
}

/** The list answer, or null when it is not the shape the page expects. */
export function parseEntityScoreList(raw: unknown): EntityScore[] | null {
  return Array.isArray(raw) && raw.every(isEntityScore) ? raw : null;
}

/** The message of a failed answer: the backend's `detail` when it sent one. */
export async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRec(body) && isText(body.detail) && body.detail.trim() !== "") {
      return body.detail;
    }
  } catch {
    // Not JSON: the fallback says enough.
  }
  return fallback;
}

// -- API ----------------------------------------------------------------------

export interface ListOptions {
  search?: string;
  includeDeleted?: boolean;
  signal?: AbortSignal;
}

/** One table, with an optional search and the deleted rows if asked. Throws an `Error`
 * whose message is safe to show. */
export async function listEntityScores(
  kind: EntityKind,
  { search = "", includeDeleted = false, signal }: ListOptions = {},
): Promise<EntityScore[]> {
  const fallback = `No se pudieron cargar los ${KIND_TEXT[kind].plural}`;
  const params = new URLSearchParams();
  if (search.trim() !== "") params.set("search", search.trim());
  if (includeDeleted) params.set("include_deleted", "true");
  const qs = params.toString();
  const res = await fetchWithAuth(`${BASE}/${kind}${qs ? `?${qs}` : ""}`, { signal });
  if (!res.ok) throw new Error(await readError(res, fallback));
  const parsed = parseEntityScoreList(await res.json());
  if (!parsed) throw new Error(fallback);
  return parsed;
}

// -- Display ------------------------------------------------------------------

export const isDeleted = (row: EntityScore): boolean => row.deleted_at !== null;

export const activeRows = (rows: EntityScore[]): EntityScore[] => rows.filter((r) => !isDeleted(r));

export const deletedCount = (rows: EntityScore[]): number => rows.filter(isDeleted).length;

/** The score as the table shows it. */
export function scoreLabel(score: number | null): string {
  return score === null ? NO_SCORE : String(score);
}

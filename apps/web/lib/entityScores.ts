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

// -- Form rules (the server checks them again and has the last word) -------------

export const MAX_NAME = 200;
export const MAX_SLUGS = 30;
export const MAX_SLUG = 100;

/** Trimmed, with every run of spaces collapsed to one. */
export function cleanName(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

/** Lower case, no accents, spaces collapsed: what two names are compared by. */
export function foldName(value: string): string {
  return cleanName(value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
}

/** The slug form of a text: unaccented, lower case, `-` between runs of anything else. */
export function slugifyName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Adds one slug typed by the user: normalized, and only if it is new and not empty. */
export function addSlug(slugs: string[], raw: string): string[] {
  const slug = slugifyName(raw);
  return slug === "" || slugs.includes(slug) ? slugs : [...slugs, slug];
}

/** The active rows, other than `excludeId`, that hold `slug`. */
export function holdersOfSlug(rows: EntityScore[], slug: string, excludeId: number | null) {
  return rows.filter((r) => !isDeleted(r) && r.id !== excludeId && r.slugs.includes(slug));
}

/** `exists_deleted` when every row with that name is deleted, `exists` when one is not,
 * ignoring case, accents and spaces; `null` when the name is free. */
export function findNameClash(
  rows: EntityScore[],
  name: string,
  excludeId: number | null,
): "exists" | "exists_deleted" | null {
  const wanted = foldName(name);
  const same = rows.filter((r) => r.id !== excludeId && foldName(r.name) === wanted);
  if (same.length === 0) return null;
  return same.every(isDeleted) ? "exists_deleted" : "exists";
}

/** What to say under the name when it is taken (see `findNameClash`). */
export function clashMessage(kind: EntityKind, clash: "exists" | "exists_deleted"): string {
  const singular = KIND_TEXT[kind].singular;
  return clash === "exists_deleted"
    ? `Hay un ${singular} eliminado con ese nombre. Restáuralo desde "Mostrar eliminados".`
    : `Ya existe un ${singular} con ese nombre.`;
}

export interface FormValues {
  name: string;
  /** What is typed in the score box: empty, or a whole number from 1 to 10. */
  score: string;
  slugs: string[];
}

export interface FormErrors {
  name?: string;
  score?: string;
  slugs?: string;
}

export const NAME_ERROR = `El nombre debe tener entre 1 y ${MAX_NAME} caracteres.`;
export const SCORE_ERROR = "El score es un número entero del 1 al 10.";
export const SLUGS_ERROR = `Máximo ${MAX_SLUGS} slugs, de hasta ${MAX_SLUG} caracteres cada uno.`;

/** The same checks the server makes, so a mistake shows before the request. */
export function validateForm(values: FormValues): FormErrors {
  const errors: FormErrors = {};
  const name = cleanName(values.name);
  if (name === "" || name.length > MAX_NAME) errors.name = NAME_ERROR;
  const score = values.score.trim();
  if (score !== "") {
    const n = Number(score);
    if (!/^\d+$/.test(score) || n < 1 || n > 10) errors.score = SCORE_ERROR;
  }
  if (values.slugs.length > MAX_SLUGS || values.slugs.some((s) => s.length > MAX_SLUG)) {
    errors.slugs = SLUGS_ERROR;
  }
  return errors;
}

/** The score typed in the form as the API takes it: a number, or null when empty. */
export function scoreFromField(raw: string): number | null {
  return raw.trim() === "" ? null : Number(raw.trim());
}

// -- Writes -------------------------------------------------------------------

/** A failed write. `status` is the HTTP status, `detail` the short code or text the server
 * sent (`exists`, `exists_deleted`, `Not found`) and `fields` the fields a 422 names. */
export class EntityScoreApiError extends Error {
  readonly status: number;
  readonly detail: string | null;
  readonly fields: Array<"name" | "score" | "slugs">;

  constructor(
    message: string,
    status: number,
    detail: string | null,
    fields: Array<"name" | "score" | "slugs"> = [],
  ) {
    super(message);
    this.name = "EntityScoreApiError";
    this.status = status;
    this.detail = detail;
    this.fields = fields;
  }
}

async function failure(res: Response, fallback: string): Promise<EntityScoreApiError> {
  let detail: string | null = null;
  const fields: Array<"name" | "score" | "slugs"> = [];
  try {
    const body: unknown = await res.json();
    if (isRec(body)) {
      if (isText(body.detail)) detail = body.detail;
      if (Array.isArray(body.detail)) {
        for (const item of body.detail) {
          const where = isRec(item) && Array.isArray(item.loc) ? item.loc[1] : null;
          if ((where === "name" || where === "score" || where === "slugs") && !fields.includes(where)) {
            fields.push(where);
          }
        }
      }
    }
  } catch {
    // Not JSON: the fallback says enough.
  }
  return new EntityScoreApiError(fallback, res.status, detail, fields);
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface EntityScoreBody {
  name: string;
  score: number | null;
  slugs: string[];
}

export async function createEntityScore(
  kind: EntityKind,
  body: EntityScoreBody,
): Promise<EntityScore> {
  const res = await fetchWithAuth(`${BASE}/${kind}`, jsonInit("POST", body));
  if (!res.ok) throw await failure(res, `No se pudo crear el ${KIND_TEXT[kind].singular}`);
  const parsed: unknown = await res.json();
  if (!isEntityScore(parsed)) {
    throw new EntityScoreApiError(`No se pudo crear el ${KIND_TEXT[kind].singular}`, 200, null);
  }
  return parsed;
}

/** Only the fields in `patch` change; an explicit `score: null` clears the score. */
export async function updateEntityScore(
  kind: EntityKind,
  id: number,
  patch: Partial<EntityScoreBody>,
): Promise<EntityScore> {
  const res = await fetchWithAuth(`${BASE}/${kind}/${id}`, jsonInit("PATCH", patch));
  if (!res.ok) throw await failure(res, `No se pudo guardar el ${KIND_TEXT[kind].singular}`);
  const parsed: unknown = await res.json();
  if (!isEntityScore(parsed)) {
    throw new EntityScoreApiError(`No se pudo guardar el ${KIND_TEXT[kind].singular}`, 200, null);
  }
  return parsed;
}

export async function deleteEntityScore(kind: EntityKind, id: number): Promise<void> {
  const res = await fetchWithAuth(`${BASE}/${kind}/${id}`, { method: "DELETE" });
  if (!res.ok) throw await failure(res, `No se pudo eliminar el ${KIND_TEXT[kind].singular}`);
}

export async function restoreEntityScore(kind: EntityKind, id: number): Promise<EntityScore> {
  const res = await fetchWithAuth(`${BASE}/${kind}/${id}/restore`, { method: "POST" });
  if (!res.ok) throw await failure(res, `No se pudo restaurar el ${KIND_TEXT[kind].singular}`);
  const parsed: unknown = await res.json();
  if (!isEntityScore(parsed)) {
    throw new EntityScoreApiError(`No se pudo restaurar el ${KIND_TEXT[kind].singular}`, 200, null);
  }
  return parsed;
}

/** What to tell the user about a failed write, and under which field. */
export function describeWriteError(
  err: unknown,
  kind: EntityKind,
): { form?: string; fields: FormErrors; gone: boolean } {
  const singular = KIND_TEXT[kind].singular;
  if (!(err instanceof EntityScoreApiError)) {
    return { form: "No se pudo completar la acción. Inténtalo de nuevo.", fields: {}, gone: false };
  }
  if (err.status === 409) {
    return {
      fields: { name: clashMessage(kind, err.detail === "exists_deleted" ? "exists_deleted" : "exists") },
      gone: false,
    };
  }
  if (err.status === 404) {
    return { form: `Este ${singular} ya no existe o fue eliminado.`, fields: {}, gone: true };
  }
  if (err.status === 422) {
    const fields: FormErrors = {};
    if (err.fields.includes("name")) fields.name = NAME_ERROR;
    if (err.fields.includes("score")) fields.score = SCORE_ERROR;
    if (err.fields.includes("slugs")) fields.slugs = SLUGS_ERROR;
    return Object.keys(fields).length > 0
      ? { fields, gone: false }
      : { form: "Revisa los datos del formulario.", fields: {}, gone: false };
  }
  return { form: err.message, fields: {}, gone: false };
}

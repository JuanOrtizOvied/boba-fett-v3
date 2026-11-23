/**
 * Types, response checks, API call and display helpers of the Markowitz matrix view
 * (`/admin/matriz-markowitz`). Own file: nothing here is shared with the catalog, the
 * properties section or the administrators and managers view.
 *
 * The backend answers the whole matrix in one piece: the assets in matrix order, the
 * values as a square list of lists (`values[i][j]` is the row asset `i` against the column
 * asset `j`; a cell the database does not hold is `null`) and the pairs to review.
 */

import { fetchWithAuth } from "@/lib/fetchWithAuth";

const BASE = "/api/admin/markowitz";

export interface MarkowitzAsset {
  id: number;
  name: string;
  slugs: string[];
  position: number;
  updated_at: string;
}

/** Two assets whose two directions differ: `a_to_b` is the row of `a` against the column
 * of `b`, and `b_to_a` is the opposite cell. */
export interface ReviewPair {
  a_id: number;
  b_id: number;
  a_to_b: number;
  b_to_a: number;
}

export interface MarkowitzMatrix {
  assets: MarkowitzAsset[];
  values: (number | null)[][];
  review: ReviewPair[];
}

export const MISSING = "—";

// -- Response checks ----------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isAsset(value: unknown): value is MarkowitzAsset {
  return (
    isRec(value) &&
    isNumber(value.id) &&
    isText(value.name) &&
    Array.isArray(value.slugs) &&
    value.slugs.every(isText) &&
    isNumber(value.position) &&
    isText(value.updated_at)
  );
}

function isReviewPair(value: unknown): value is ReviewPair {
  return (
    isRec(value) &&
    isNumber(value.a_id) &&
    isNumber(value.b_id) &&
    isNumber(value.a_to_b) &&
    isNumber(value.b_to_a)
  );
}

/** The matrix answer, or null when it is not the shape the page expects: assets that are
 * valid, values that are square and as big as the assets, and review pairs that name
 * assets in the list. */
export function parseMarkowitzMatrix(raw: unknown): MarkowitzMatrix | null {
  if (!isRec(raw) || !Array.isArray(raw.assets) || !Array.isArray(raw.values)) return null;
  if (!Array.isArray(raw.review)) return null;
  if (!raw.assets.every(isAsset) || !raw.review.every(isReviewPair)) return null;
  const assets: MarkowitzAsset[] = raw.assets;
  const size = assets.length;
  const values = raw.values as unknown[];
  if (values.length !== size) return null;
  for (const row of values) {
    if (!Array.isArray(row) || row.length !== size) return null;
    if (!row.every((cell) => cell === null || isNumber(cell))) return null;
  }
  const ids = new Set(assets.map((a) => a.id));
  if (!raw.review.every((p: ReviewPair) => ids.has(p.a_id) && ids.has(p.b_id))) return null;
  return { assets, values: values as (number | null)[][], review: raw.review };
}

/** The message of a failed answer: the backend's `detail` when it is a text. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRec(body) && isText(body.detail) && body.detail.trim() !== "") return body.detail;
  } catch {
    // Not JSON: the fallback says enough.
  }
  return fallback;
}

// -- API ----------------------------------------------------------------------

const LOAD_ERROR = "No se pudo cargar la matriz";

/** The whole matrix. Throws an `Error` whose message is safe to show. */
export async function getMarkowitzMatrix(signal?: AbortSignal): Promise<MarkowitzMatrix> {
  const res = await fetchWithAuth(BASE, { signal });
  if (!res.ok) throw new Error(await readError(res, LOAD_ERROR));
  const parsed = parseMarkowitzMatrix(await res.json());
  if (!parsed) throw new Error(LOAD_ERROR);
  return parsed;
}

// -- URL ----------------------------------------------------------------------

export type MatrixTab = "matrix" | "review";

/** The active tab from its URL parameter. Anything but "revisar" is the matrix. */
export function tabFromParam(param: string): MatrixTab {
  return param === "revisar" ? "review" : "matrix";
}

/** The matrix is the default tab, so it leaves no parameter (an empty value). */
export function tabToParam(tab: MatrixTab): string {
  return tab === "review" ? "revisar" : "";
}

// -- Display ------------------------------------------------------------------

/** A correlation as the cells show it: at least two decimals, up to four, never noise
 * (0.7 is "0.70", 0.1234 is "0.1234", -0.0016 is "-0.0016"). `null` is a dash. */
export function formatValue(value: number | null): string {
  if (value === null) return MISSING;
  const text = value.toFixed(4).replace(/0{1,2}$/, "");
  return text === "-0.00" ? "0.00" : text;
}

/** The difference of a review pair, in the same format. */
export function gapOf(pair: ReviewPair): number {
  return Math.round(Math.abs(pair.a_to_b - pair.b_to_a) * 10000) / 10000;
}

// The scale of the approved mock-up: green for positive values, with the color getting
// stronger as the value grows; blue for negative ones, saturating at -0.2 (the data goes
// no lower than -0.16). Near zero the cell stays almost clear.
const POSITIVE = "79, 122, 26";
const NEGATIVE = "59, 130, 246";
const STRONG_ABOVE = 0.55;

export interface HeatStyle {
  backgroundColor?: string;
  color?: string;
  fontWeight?: number;
}

/** The inline style of a cell. The number is always printed, so color is never the only
 * signal. */
export function heatStyle(value: number | null): HeatStyle {
  if (value === null || value === 0) return {};
  if (value > 0) {
    const alpha = Math.min(1, 0.12 + 0.83 * value);
    return {
      backgroundColor: `rgba(${POSITIVE}, ${alpha.toFixed(3)})`,
      ...(alpha > STRONG_ABOVE ? { color: "#ffffff", fontWeight: 600 } : {}),
    };
  }
  const alpha = Math.min(1, Math.abs(value) / 0.2) * 0.55;
  return { backgroundColor: `rgba(${NEGATIVE}, ${alpha.toFixed(3)})` };
}

/** The gradient of the legend bar, from -0.2 to 1. */
export const LEGEND_GRADIENT = `linear-gradient(90deg, rgba(${NEGATIVE}, 0.55) 0%, rgba(${NEGATIVE}, 0) 17%, rgba(${POSITIVE}, 0.18) 25%, rgb(${POSITIVE}) 100%)`;

/** An asset name by id, for the review list. */
export function nameById(assets: MarkowitzAsset[], id: number): string {
  return assets.find((a) => a.id === id)?.name ?? `#${id}`;
}

// -- Form rules (the server checks them again and has the last word) -------------

export const MAX_NAME = 200;
export const MAX_SLUGS = 30;
export const MAX_SLUG = 100;
export const MAX_DECIMALS = 4;

/** Trimmed, with every run of spaces collapsed to one. */
export function cleanName(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

/** Lower case, no accents, spaces collapsed: what two names are compared by. */
export function foldName(value: string): string {
  return cleanName(value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
}

/** The stored form of a text: unaccented, lower case, `-` between runs of anything else. */
export function slugifyName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Adds one alternative name typed by the user: normalized, and only if it is new and not
 * empty. */
export function addSlug(slugs: string[], raw: string): string[] {
  const slug = slugifyName(raw);
  return slug === "" || slugs.includes(slug) ? slugs : [...slugs, slug];
}

/** The asset, other than `excludeId`, that holds the alternative name `slug`, if any. */
export function holderOfSlug(
  assets: MarkowitzAsset[],
  slug: string,
  excludeId: number | null,
): MarkowitzAsset | null {
  return assets.find((a) => a.id !== excludeId && a.slugs.includes(slug)) ?? null;
}

/** True when another asset already has this name, ignoring case, accents and spaces. */
export function nameTaken(assets: MarkowitzAsset[], name: string, excludeId: number | null) {
  const wanted = foldName(name);
  return assets.some((a) => a.id !== excludeId && foldName(a.name) === wanted);
}

export const NAME_ERROR = `El nombre debe tener entre 1 y ${MAX_NAME} caracteres.`;
export const NAME_TAKEN_ERROR = "Ya existe un activo con ese nombre.";
export const SLUGS_ERROR = `Máximo ${MAX_SLUGS} nombres alternativos, de hasta ${MAX_SLUG} caracteres cada uno.`;
export const VALUE_HELP = "Un número de -1 a 1, con hasta 4 decimales.";

export const slugTakenError = (slug: string, holder: string): string =>
  `«${slug}» ya lo tiene ${holder}. Un nombre alternativo solo puede ser de un activo.`;

/** What is wrong with a typed correlation, or null when it is a good one: a number from -1
 * to 1 with at most four decimals. */
export function valueError(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "Escribe un valor.";
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return `${VALUE_HELP} No uses letras ni comas.`;
  const decimals = text.includes(".") ? text.split(".")[1].length : 0;
  if (decimals > MAX_DECIMALS) return `Máximo ${MAX_DECIMALS} decimales.`;
  const n = Number(text);
  if (n < -1 || n > 1) return "El valor debe estar entre -1 y 1.";
  return null;
}

/** The number of a typed value that passed `valueError`. */
export const valueFromText = (raw: string): number => Number(raw.trim());

/** A number as it is put back in a box: no float noise, no padding. */
export const valueToText = (value: number): string => String(Number(value.toFixed(MAX_DECIMALS)));

export interface AssetFormValues {
  name: string;
  slugs: string[];
}

export interface AssetFormErrors {
  name?: string;
  slugs?: string;
}

/** The checks of the asset forms, against the assets already in the matrix. `slugs` should
 * be the final list (what is still typed in the box included). The slug of the name is
 * checked too, because the server adds it on save. */
export function validateAssetForm(
  values: AssetFormValues,
  assets: MarkowitzAsset[],
  excludeId: number | null,
): AssetFormErrors {
  const errors: AssetFormErrors = {};
  const name = cleanName(values.name);
  if (name === "" || name.length > MAX_NAME) errors.name = NAME_ERROR;
  else if (nameTaken(assets, name, excludeId)) errors.name = NAME_TAKEN_ERROR;

  if (values.slugs.length > MAX_SLUGS || values.slugs.some((s) => s.length > MAX_SLUG)) {
    errors.slugs = SLUGS_ERROR;
    return errors;
  }
  const own = slugifyName(name);
  for (const slug of own ? [own, ...values.slugs] : values.slugs) {
    const holder = holderOfSlug(assets, slug, excludeId);
    if (holder) {
      errors.slugs = slugTakenError(slug, holder.name);
      break;
    }
  }
  return errors;
}

/** The values of the row of `matrix.assets[index]` as text boxes, keyed by asset id, to start
 * a new asset from it. The value against the asset itself (the diagonal) and the cells the
 * database does not hold stay out: those are for the user to write. */
export function valuesFromRow(matrix: MarkowitzMatrix, index: number): Record<number, string> {
  const out: Record<number, string> = {};
  matrix.assets.forEach((asset, j) => {
    const value = matrix.values[index]?.[j];
    if (j !== index && typeof value === "number") out[asset.id] = valueToText(value);
  });
  return out;
}

/** How many of the assets still have no good value in `texts`. */
export function missingValues(assets: MarkowitzAsset[], texts: Record<number, string>): number {
  return assets.filter((a) => valueError(texts[a.id] ?? "") !== null).length;
}

// -- Writes -------------------------------------------------------------------

/** A failed write. `status` is the HTTP status, `code` the short word the server sent
 * (`exists`, `slug_taken`, `incomplete`), `fields` the fields a 422 names, and the rest
 * the details that go with some codes. */
export class MarkowitzApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly fields: string[];
  readonly slug: string | null;
  readonly asset: string | null;
  readonly missing: number[];

  constructor(
    message: string,
    status: number,
    extra: {
      code?: string | null;
      fields?: string[];
      slug?: string | null;
      asset?: string | null;
      missing?: number[];
    } = {},
  ) {
    super(message);
    this.name = "MarkowitzApiError";
    this.status = status;
    this.code = extra.code ?? null;
    this.fields = extra.fields ?? [];
    this.slug = extra.slug ?? null;
    this.asset = extra.asset ?? null;
    this.missing = extra.missing ?? [];
  }
}

async function failure(res: Response, fallback: string): Promise<MarkowitzApiError> {
  const extra: ConstructorParameters<typeof MarkowitzApiError>[2] = {};
  try {
    const body: unknown = await res.json();
    if (isRec(body)) {
      const detail = body.detail;
      if (isText(detail)) extra.code = detail;
      else if (isRec(detail)) {
        if (isText(detail.code)) extra.code = detail.code;
        if (isText(detail.slug)) extra.slug = detail.slug;
        if (isText(detail.asset)) extra.asset = detail.asset;
        if (Array.isArray(detail.missing)) extra.missing = detail.missing.filter(isNumber);
      } else if (Array.isArray(detail)) {
        const fields: string[] = [];
        for (const item of detail) {
          const where = isRec(item) && Array.isArray(item.loc) ? item.loc[1] : null;
          if (isText(where) && !fields.includes(where)) fields.push(where);
        }
        extra.fields = fields;
      }
    }
  } catch {
    // Not JSON: the fallback says enough.
  }
  return new MarkowitzApiError(fallback, res.status, extra);
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface SavedCell {
  row_id: number;
  col_id: number;
  value: number;
  updated_at: string;
}

function isSavedCell(value: unknown): value is SavedCell {
  return (
    isRec(value) &&
    isNumber(value.row_id) &&
    isNumber(value.col_id) &&
    isNumber(value.value) &&
    isText(value.updated_at)
  );
}

const CELL_ERROR = "No se pudo guardar la correlación";
const ASSET_SAVE_ERROR = "No se pudo guardar el activo";
const ASSET_CREATE_ERROR = "No se pudo crear el activo";

/** Sets one cell, and the opposite one when `bothDirections`. Returns the cells written. */
export async function setMarkowitzCell(input: {
  rowId: number;
  colId: number;
  value: number;
  bothDirections: boolean;
}): Promise<SavedCell[]> {
  const res = await fetchWithAuth(
    `${BASE}/cells`,
    jsonInit("PATCH", {
      row_id: input.rowId,
      col_id: input.colId,
      value: input.value,
      both_directions: input.bothDirections,
    }),
  );
  if (!res.ok) throw await failure(res, CELL_ERROR);
  const parsed: unknown = await res.json();
  if (!Array.isArray(parsed) || !parsed.every(isSavedCell)) {
    throw new MarkowitzApiError(CELL_ERROR, 200);
  }
  return parsed;
}

export interface NewAssetInput {
  name: string;
  slugs: string[];
  correlations: { asset_id: number; value: number }[];
}

export async function createMarkowitzAsset(input: NewAssetInput): Promise<MarkowitzAsset> {
  const res = await fetchWithAuth(`${BASE}/assets`, jsonInit("POST", input));
  if (!res.ok) throw await failure(res, ASSET_CREATE_ERROR);
  const parsed: unknown = await res.json();
  if (!isAsset(parsed)) throw new MarkowitzApiError(ASSET_CREATE_ERROR, 200);
  return parsed;
}

/** Only the fields in `patch` change. */
export async function updateMarkowitzAsset(
  id: number,
  patch: Partial<AssetFormValues>,
): Promise<MarkowitzAsset> {
  const res = await fetchWithAuth(`${BASE}/assets/${id}`, jsonInit("PATCH", patch));
  if (!res.ok) throw await failure(res, ASSET_SAVE_ERROR);
  const parsed: unknown = await res.json();
  if (!isAsset(parsed)) throw new MarkowitzApiError(ASSET_SAVE_ERROR, 200);
  return parsed;
}

export interface WriteProblem {
  /** A message for the bottom of the modal. */
  form?: string;
  /** Messages for the fields they belong to. */
  fields: { name?: string; slugs?: string; value?: string };
  /** The asset (or one of them) no longer exists: the page should read the matrix again. */
  gone: boolean;
  /** The matrix changed while the modal was open: read it again and let the user finish. */
  stale: boolean;
}

const GENERIC = "No se pudo completar la acción. Inténtalo de nuevo.";

/** What to tell the user about a failed cell write. */
export function describeCellError(err: unknown): WriteProblem {
  if (!(err instanceof MarkowitzApiError)) {
    return { form: GENERIC, fields: {}, gone: false, stale: false };
  }
  if (err.status === 404) {
    return {
      form: "Uno de los dos activos ya no existe. Se actualizó la matriz.",
      fields: {},
      gone: true,
      stale: false,
    };
  }
  if (err.status === 422) {
    return { fields: { value: `${VALUE_HELP}` }, gone: false, stale: false };
  }
  return { form: err.message, fields: {}, gone: false, stale: false };
}

/** What to tell the user about a failed asset write (create or edit). */
export function describeAssetError(err: unknown): WriteProblem {
  if (!(err instanceof MarkowitzApiError)) {
    return { form: GENERIC, fields: {}, gone: false, stale: false };
  }
  if (err.status === 409 && err.code === "slug_taken" && err.slug) {
    return {
      fields: { slugs: slugTakenError(err.slug, err.asset ?? "otro activo") },
      gone: false,
      stale: false,
    };
  }
  if (err.status === 409) {
    return { fields: { name: NAME_TAKEN_ERROR }, gone: false, stale: false };
  }
  if (err.status === 404) {
    return {
      form: "Este activo ya no existe. Se actualizó la matriz.",
      fields: {},
      gone: true,
      stale: false,
    };
  }
  if (err.status === 422 && err.code === "incomplete") {
    return {
      form: "Se agregó otro activo mientras tanto. Ya aparece en la lista: escribe su valor.",
      fields: {},
      gone: false,
      stale: true,
    };
  }
  if (err.status === 422) {
    const fields: WriteProblem["fields"] = {};
    if (err.fields.includes("name")) fields.name = NAME_ERROR;
    if (err.fields.includes("slugs")) fields.slugs = SLUGS_ERROR;
    return Object.keys(fields).length > 0
      ? { fields, gone: false, stale: false }
      : { form: "Revisa los datos del formulario.", fields: {}, gone: false, stale: false };
  }
  return { form: err.message, fields: {}, gone: false, stale: false };
}

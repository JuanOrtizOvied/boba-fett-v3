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

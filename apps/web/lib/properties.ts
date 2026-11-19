/**
 * Types, response checks and display helpers of the properties section
 * (`/admin/propiedades`). Own file: nothing here is shared with the catalog.
 *
 * The backend serves numbers as plain JSON numbers and a missing one as `null`.
 * Ownership, flows and return are fractions (0.0384 is 3.84%); the percentages
 * inside an allocation are already whole percents (60 is 60%).
 */

export const NO_DATA = "Sin dato";

export interface Allocation {
  name: string;
  percentage: number;
}

export interface PropertySummary {
  code: string;
  name: string;
  usage: string;
  manager: string;
  administrator: string;
  estimated_value_usd: number | null;
  ownership: number;
  asset_class: Allocation[];
  geographic_focus: Allocation[];
  underlying: Allocation[];
}

export interface PropertyOwner {
  client: string;
  ownership_pct: number | null;
  flows_min: number | null;
  flows_max: number | null;
  return_min: number | null;
  return_max: number | null;
  monthly_rent_usd: number | null;
}

export interface PropertyDetail {
  code: string;
  name: string;
  usage: string;
  manager: string;
  administrator: string;
  currency: string;
  investment_horizon: string;
  estimated_value_usd: number | null;
  asset_class: Allocation[];
  geographic_focus: Allocation[];
  underlying: Allocation[];
  owners: PropertyOwner[];
}

// -- Response checks ----------------------------------------------------------

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNumberOrNull = (value: unknown): value is number | null =>
  value === null || isNumber(value);

function isAllocations(value: unknown): value is Allocation[] {
  return (
    Array.isArray(value) &&
    value.every((a) => isRec(a) && isText(a.name) && isNumber(a.percentage))
  );
}

function isSummary(value: unknown): value is PropertySummary {
  return (
    isRec(value) &&
    isText(value.code) &&
    isText(value.name) &&
    isText(value.usage) &&
    isText(value.manager) &&
    isText(value.administrator) &&
    isNumberOrNull(value.estimated_value_usd) &&
    isNumber(value.ownership) &&
    isAllocations(value.asset_class) &&
    isAllocations(value.geographic_focus) &&
    isAllocations(value.underlying)
  );
}

function isOwner(value: unknown): value is PropertyOwner {
  return (
    isRec(value) &&
    isText(value.client) &&
    isNumberOrNull(value.ownership_pct) &&
    isNumberOrNull(value.flows_min) &&
    isNumberOrNull(value.flows_max) &&
    isNumberOrNull(value.return_min) &&
    isNumberOrNull(value.return_max) &&
    isNumberOrNull(value.monthly_rent_usd)
  );
}

function isDetail(value: unknown): value is PropertyDetail {
  return (
    isRec(value) &&
    isText(value.code) &&
    isText(value.name) &&
    isText(value.usage) &&
    isText(value.manager) &&
    isText(value.administrator) &&
    isText(value.currency) &&
    isText(value.investment_horizon) &&
    isNumberOrNull(value.estimated_value_usd) &&
    isAllocations(value.asset_class) &&
    isAllocations(value.geographic_focus) &&
    isAllocations(value.underlying) &&
    Array.isArray(value.owners) &&
    value.owners.every(isOwner)
  );
}

/** The list answer, or null when it is not the shape the page expects. */
export function parsePropertyList(raw: unknown): PropertySummary[] | null {
  return Array.isArray(raw) && raw.every(isSummary) ? raw : null;
}

/** The detail answer, or null when it is not the shape the page expects. */
export function parsePropertyDetail(raw: unknown): PropertyDetail | null {
  return isDetail(raw) ? raw : null;
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

// -- Display ------------------------------------------------------------------

/** Fraction (0.0384) as a percent ("3.84%"), at most two decimals; null is "Sin dato". */
export function formatFractionPercent(value: number | null): string {
  if (value === null) return NO_DATA;
  return `${Number((value * 100).toFixed(2))}%`;
}

/** Whole-number percent of an allocation ("60%"). */
function formatAllocationPercent(value: number): string {
  return `${Number(value.toFixed(2))}%`;
}

export function formatUsd(value: number | null): string {
  if (value === null) return NO_DATA;
  return `USD ${value.toLocaleString("en-US")}`;
}

export function formatAllocations(rows: Allocation[]): string {
  if (rows.length === 0) return NO_DATA;
  return rows.map((r) => `${r.name} ${formatAllocationPercent(r.percentage)}`).join(", ");
}

/** A range of fractions as percents: "4% – 6%", one bound as "desde"/"hasta". */
export function formatRange(min: number | null, max: number | null): string {
  if (min === null && max === null) return NO_DATA;
  if (min !== null && max !== null) {
    return min === max
      ? formatFractionPercent(min)
      : `${formatFractionPercent(min)} – ${formatFractionPercent(max)}`;
  }
  return min !== null
    ? `desde ${formatFractionPercent(min)}`
    : `hasta ${formatFractionPercent(max)}`;
}

/** A text that may be empty ("" is what the backend sends for a blank cell). */
export function textOrNoData(value: string): string {
  return value.trim() === "" ? NO_DATA : value;
}

/** "2 propietarios" for the list tag; nothing for a single owner. */
export function ownerCountLabel(count: number): string {
  return count > 1 ? `${count} propietarios` : "";
}

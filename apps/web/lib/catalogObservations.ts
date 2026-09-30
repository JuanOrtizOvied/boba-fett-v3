import type { AssetAllocation, CatalogProduct } from "@/lib/portfolio-types";

/**
 * Catalog "Observaciones": rows that are incomplete or hold values outside
 * the official lists. Computed client-side over `CatalogProduct` (see
 * `openspec/changes/catalog-sharepoint-sync`, catalog-observations spec).
 */

export type ObservationField =
  | "commission"
  | "currency"
  | "return_rate"
  | "manager"
  | "administrator"
  | "asset_class"
  | "geographic_focus"
  | "underlying";

export type ObservationIssue =
  | "empty"
  | "missing_score"
  | "score_without_name"
  | "allocation_sum"
  | "not_in_list";

export interface Observation {
  field: ObservationField;
  issue: ObservationIssue;
  /** The offending value: the name, the allocation total, or "" for empty. */
  value: string;
}

/** Official spellings per finite-set field. A missing list (`null` or
 * `undefined`, e.g. managers still loading) skips the membership check for
 * that field instead of flagging every value. */
export interface ObservationLists {
  asset_class: readonly string[];
  geographic_focus: readonly string[];
  underlying: readonly string[];
  currency: readonly string[];
  manager?: readonly string[] | null;
  administrator?: readonly string[] | null;
}

// Same tolerance as the backend's allocation sum check.
const ALLOCATION_SUM_TOLERANCE = 0.5;

const isBlank = (value: string | null | undefined) => (value ?? "").trim() === "";

function allocationObservations(
  field: "asset_class" | "geographic_focus" | "underlying",
  rows: AssetAllocation[] | null | undefined,
  official: readonly string[],
): Observation[] {
  const items = rows ?? [];
  if (items.length === 0) return [{ field, issue: "empty", value: "" }];

  const observations: Observation[] = [];
  const total = items.reduce((sum, row) => sum + (row.percentage || 0), 0);
  if (Math.abs(total - 100) >= ALLOCATION_SUM_TOLERANCE) {
    observations.push({ field, issue: "allocation_sum", value: `${total}%` });
  }
  for (const row of items) {
    // Exact membership: the sync already writes official spellings for
    // anything it recognized, so a non-member is a genuine observation.
    if (!official.includes(row.name)) {
      observations.push({ field, issue: "not_in_list", value: row.name });
    }
  }
  return observations;
}

function scoredEntityObservations(
  field: "manager" | "administrator",
  name: string,
  score: number | null,
  official: readonly string[] | null | undefined,
): Observation[] {
  const observations: Observation[] = [];
  if (isBlank(name)) {
    observations.push({ field, issue: "empty", value: "" });
    if (score !== null) {
      observations.push({ field, issue: "score_without_name", value: String(score) });
    }
    return observations;
  }
  if (score === null) {
    observations.push({ field, issue: "missing_score", value: name });
  }
  if (official && !official.includes(name)) {
    observations.push({ field, issue: "not_in_list", value: name });
  }
  return observations;
}

/** Every observation for one catalog entry, in a stable field order. An
 * entry with none is complete and within the official lists. */
export function getObservations(
  entry: CatalogProduct,
  lists: ObservationLists,
): Observation[] {
  const observations: Observation[] = [];

  if (isBlank(entry.commission)) {
    observations.push({ field: "commission", issue: "empty", value: "" });
  }

  if (isBlank(entry.currency)) {
    observations.push({ field: "currency", issue: "empty", value: "" });
  } else if (!lists.currency.includes(entry.currency)) {
    observations.push({ field: "currency", issue: "not_in_list", value: entry.currency });
  }

  if (isBlank(entry.return_rate)) {
    observations.push({ field: "return_rate", issue: "empty", value: "" });
  }

  observations.push(
    ...scoredEntityObservations(
      "manager",
      entry.manager,
      entry.manager_score ?? null,
      lists.manager,
    ),
    ...scoredEntityObservations(
      "administrator",
      entry.administrator,
      entry.administrator_score ?? null,
      lists.administrator,
    ),
    ...allocationObservations("asset_class", entry.asset_class, lists.asset_class),
    ...allocationObservations(
      "geographic_focus",
      entry.geographic_focus,
      lists.geographic_focus,
    ),
    ...allocationObservations("underlying", entry.underlying, lists.underlying),
  );

  return observations;
}

export interface ObservationGroup {
  field: ObservationField;
  issue: ObservationIssue;
  /** Number of entries (not observations) affected. */
  count: number;
}

const ISSUE_ORDER: ObservationIssue[] = [
  "empty",
  "missing_score",
  "score_without_name",
  "allocation_sum",
  "not_in_list",
];

const FIELD_ORDER: ObservationField[] = [
  "commission",
  "currency",
  "return_rate",
  "manager",
  "administrator",
  "asset_class",
  "geographic_focus",
  "underlying",
];

/** Counts entries per (field, issue) for the banner. Deleted entries are
 * never counted. An entry with two bad values in the same field counts
 * once for that group. */
export function summarizeObservations(
  entries: readonly CatalogProduct[],
  lists: ObservationLists,
): ObservationGroup[] {
  const counts = new Map<string, ObservationGroup>();
  for (const entry of entries) {
    if (entry.is_deleted) continue;
    const seen = new Set<string>();
    for (const { field, issue } of getObservations(entry, lists)) {
      const key = `${field}:${issue}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = counts.get(key);
      if (group) group.count += 1;
      else counts.set(key, { field, issue, count: 1 });
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      ISSUE_ORDER.indexOf(a.issue) - ISSUE_ORDER.indexOf(b.issue) ||
      FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field),
  );
}

/** Number of active entries with at least one observation. */
export function countEntriesWithObservations(
  entries: readonly CatalogProduct[],
  lists: ObservationLists,
): number {
  return entries.filter(
    (entry) => !entry.is_deleted && getObservations(entry, lists).length > 0,
  ).length;
}

// -- Spanish labels -----------------------------------------------------

const FIELD_NOUN: Record<ObservationField, { label: string; feminine: boolean }> = {
  commission: { label: "comisión", feminine: true },
  currency: { label: "moneda", feminine: true },
  return_rate: { label: "rentabilidad", feminine: true },
  manager: { label: "gestor", feminine: false },
  administrator: { label: "administrador", feminine: false },
  asset_class: { label: "clase de activo", feminine: true },
  geographic_focus: { label: "foco geográfico", feminine: false },
  underlying: { label: "subyacente", feminine: false },
};

/** Field name as shown in the UI ("foco geográfico", "gestor"). */
export function observationFieldLabel(field: ObservationField): string {
  return FIELD_NOUN[field].label;
}

const productos = (count: number) => (count === 1 ? "producto" : "productos");

/** Banner line for a group, e.g. "2 productos sin gestor". */
export function observationGroupLabel(group: ObservationGroup): string {
  const { field, issue, count } = group;
  const noun = FIELD_NOUN[field];
  const subject = `${count} ${productos(count)}`;
  switch (issue) {
    case "empty":
      return `${subject} sin ${noun.label}`;
    case "missing_score":
      return `${subject} con ${noun.label} sin score`;
    case "score_without_name":
      return `${subject} con score de ${noun.label} sin ${noun.label}`;
    case "allocation_sum":
      return `${subject} cuy${noun.feminine ? "a" : "o"} ${noun.label} no suma 100%`;
    case "not_in_list":
      return `${subject} con ${noun.label} fuera de la lista oficial`;
  }
}

/** Per-row detail, e.g. "Subyacente: fuera de la lista oficial (Bonos Peru)". */
export function observationDetail(observation: Observation): string {
  const name = observationFieldLabel(observation.field);
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  const { issue, value } = observation;
  switch (issue) {
    case "empty":
      return `${label}: vacío`;
    case "missing_score":
      return `${label}: "${value}" sin score`;
    case "score_without_name":
      return `${label}: tiene score (${value}) pero no nombre`;
    case "allocation_sum":
      return `${label}: suma ${value}, debe sumar 100%`;
    case "not_in_list":
      return `${label}: fuera de la lista oficial ("${value}")`;
  }
}

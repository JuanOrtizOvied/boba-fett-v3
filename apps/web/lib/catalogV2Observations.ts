import type { CatalogV2Options, CatalogV2Product, V2Allocation } from "@/lib/catalogV2Types";

/**
 * v2 catalog "Observaciones": products that are incomplete, still pending or hold
 * values outside the official lists. Computed client-side over the list the API
 * returns, which already carries each product's administrators and a count of
 * its incomplete series (`openspec/changes/catalog-v2-sharepoint-sync`,
 * catalog-v2-observations spec).
 */

export type V2ObservationField =
  | "manager"
  | "administrator"
  | "currency"
  | "investment_horizon"
  | "asset_class"
  | "geographic_focus"
  | "underlying"
  | "series";

export type V2ObservationIssue =
  | "empty"
  | "pending"
  | "missing_score"
  | "allocation_sum"
  | "not_in_list"
  | "incomplete_rates";

export interface V2Observation {
  field: V2ObservationField;
  issue: V2ObservationIssue;
  /** The offending value: a name, a total, a count, or "" for empty. */
  value: string;
}

/** The value that stands for "not defined yet", as the backend stores it. */
export const PENDING_VALUE = "Por confirmar";

// Same tolerance as the current catalog's allocation check.
const ALLOCATION_SUM_TOLERANCE = 0.5;

const isBlank = (value: string | null | undefined) => (value ?? "").trim() === "";

function allocationObservations(
  field: "asset_class" | "geographic_focus" | "underlying",
  rows: V2Allocation[] | null | undefined,
  official: readonly string[],
): V2Observation[] {
  const items = rows ?? [];
  // A `por confirmar` cell is stored as an empty composite, so it is reported here.
  if (items.length === 0) return [{ field, issue: "empty", value: "" }];

  const observations: V2Observation[] = [];
  const total = items.reduce((sum, row) => sum + (row.percentage || 0), 0);
  if (Math.abs(total - 100) >= ALLOCATION_SUM_TOLERANCE) {
    observations.push({ field, issue: "allocation_sum", value: `${total}%` });
  }
  for (const row of items) {
    // Exact membership: the sync already writes the official spelling of every
    // name it recognized, so a non-member is a genuine observation.
    if (!official.includes(row.name)) {
      observations.push({ field, issue: "not_in_list", value: row.name });
    }
  }
  return observations;
}

function choiceObservations(
  field: "currency" | "investment_horizon",
  value: string,
  official: readonly string[],
): V2Observation[] {
  if (isBlank(value)) return [{ field, issue: "empty", value: "" }];
  if (value === PENDING_VALUE) return [{ field, issue: "pending", value }];
  if (!official.includes(value)) return [{ field, issue: "not_in_list", value }];
  return [];
}

/** Every observation of one product, in a stable field order. A product with
 * none is complete and within the official lists. */
export function getV2Observations(
  product: CatalogV2Product,
  options: CatalogV2Options,
): V2Observation[] {
  const observations: V2Observation[] = [];

  if (isBlank(product.manager)) {
    observations.push({ field: "manager", issue: "empty", value: "" });
  } else if (product.manager_score === null || product.manager_score === undefined) {
    observations.push({ field: "manager", issue: "missing_score", value: product.manager });
  }

  for (const administrator of product.administrators ?? []) {
    if (administrator.score === null || administrator.score === undefined) {
      observations.push({
        field: "administrator",
        issue: "missing_score",
        value: administrator.name,
      });
    }
  }

  observations.push(
    ...choiceObservations("currency", product.currency, options.currency),
    ...choiceObservations(
      "investment_horizon",
      product.investment_horizon,
      options.investment_horizon,
    ),
    ...allocationObservations("asset_class", product.asset_class, options.asset_class),
    ...allocationObservations(
      "geographic_focus",
      product.geographic_focus,
      options.geographic_focus,
    ),
    ...allocationObservations("underlying", product.underlying, options.underlying),
  );

  if ((product.incomplete_series ?? 0) > 0) {
    observations.push({
      field: "series",
      issue: "incomplete_rates",
      value: String(product.incomplete_series),
    });
  }
  return observations;
}

export interface V2ObservationGroup {
  field: V2ObservationField;
  issue: V2ObservationIssue;
  /** Number of products (not observations) affected. */
  count: number;
}

const ISSUE_ORDER: V2ObservationIssue[] = [
  "empty",
  "pending",
  "missing_score",
  "allocation_sum",
  "not_in_list",
  "incomplete_rates",
];

const FIELD_ORDER: V2ObservationField[] = [
  "manager",
  "administrator",
  "currency",
  "investment_horizon",
  "asset_class",
  "geographic_focus",
  "underlying",
  "series",
];

/** Counts products per (field, issue) for the banner. Deleted products are never
 * counted, and a product with two bad values in the same field counts once for
 * that group (two administrators without score are one product). */
export function summarizeV2Observations(
  products: readonly CatalogV2Product[],
  options: CatalogV2Options,
): V2ObservationGroup[] {
  const counts = new Map<string, V2ObservationGroup>();
  for (const product of products) {
    if (product.is_deleted) continue;
    const seen = new Set<string>();
    for (const { field, issue } of getV2Observations(product, options)) {
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

/** Number of active products with at least one observation. */
export function countV2ProductsWithObservations(
  products: readonly CatalogV2Product[],
  options: CatalogV2Options,
): number {
  return products.filter(
    (product) => !product.is_deleted && getV2Observations(product, options).length > 0,
  ).length;
}

// -- Spanish labels -----------------------------------------------------

const FIELD_NOUN: Record<V2ObservationField, { label: string; feminine: boolean }> = {
  manager: { label: "gestor", feminine: false },
  administrator: { label: "administrador", feminine: false },
  currency: { label: "moneda", feminine: true },
  investment_horizon: { label: "horizonte de inversión", feminine: false },
  asset_class: { label: "clase de activo", feminine: true },
  geographic_focus: { label: "foco geográfico", feminine: false },
  underlying: { label: "subyacente", feminine: false },
  series: { label: "serie", feminine: true },
};

/** Field name as shown in the UI ("foco geográfico", "gestor"). */
export function v2ObservationFieldLabel(field: V2ObservationField): string {
  return FIELD_NOUN[field].label;
}

const productos = (count: number) => (count === 1 ? "producto" : "productos");

/** Banner line for a group, e.g. "2 productos con gestor sin score". */
export function v2ObservationGroupLabel(group: V2ObservationGroup): string {
  const { field, issue, count } = group;
  const noun = FIELD_NOUN[field];
  const subject = `${count} ${productos(count)}`;
  switch (issue) {
    case "empty":
      return `${subject} sin ${noun.label}`;
    case "pending":
      return `${subject} con ${noun.label} por confirmar`;
    case "missing_score":
      return `${subject} con ${noun.label} sin score`;
    case "allocation_sum":
      return `${subject} cuy${noun.feminine ? "a" : "o"} ${noun.label} no suma 100%`;
    case "not_in_list":
      return `${subject} con ${noun.label} fuera de la lista oficial`;
    case "incomplete_rates":
      return `${subject} con series sin TER o sin rentabilidad`;
  }
}

/** Per-row detail, e.g. "Administrador: "BBVA" sin score". */
export function v2ObservationDetail(observation: V2Observation): string {
  const name = v2ObservationFieldLabel(observation.field);
  const label = name.charAt(0).toUpperCase() + name.slice(1);
  const { issue, value } = observation;
  switch (issue) {
    case "empty":
      return `${label}: vacío`;
    case "pending":
      return `${label}: por confirmar`;
    case "missing_score":
      return `${label}: "${value}" sin score`;
    case "allocation_sum":
      return `${label}: suma ${value}, debe sumar 100%`;
    case "not_in_list":
      return `${label}: fuera de la lista oficial ("${value}")`;
    case "incomplete_rates":
      return `${value === "1" ? "1 serie" : `${value} series`} sin TER o sin rentabilidad`;
  }
}

import type {
  CatalogObservation,
  ProductObservations,
} from "@/lib/normalized-catalog-types";

/**
 * Observations of the normalized catalog come from the backend
 * (`GET /api/admin/normalized-catalog/observations`): what a product is still
 * missing or holds outside the official lists, at product, series and
 * administrator level. These helpers only index them and word them.
 */

/** Observations by product code. Products with none are absent. */
export function indexObservations(
  items: readonly ProductObservations[],
): Map<string, CatalogObservation[]> {
  return new Map(items.map((item) => [item.code, item.observations]));
}

/** Where an observation sits: on the product itself, on one series, or on
 * one administrator of a series. */
export type ObservationScope =
  | { level: "product" }
  | { level: "series"; series: string }
  | { level: "admin"; series: string; administrator: string };

/** Text shown under the field (or in place of the empty list) it refers to. */
export function observationMessage(observation: CatalogObservation): string {
  switch (observation.issue) {
    case "empty":
      return "Falta este dato";
    case "allocation_sum":
      return `Suma ${observation.value}, debe sumar 100%`;
    case "not_in_list":
      return `Fuera de la lista oficial: ${observation.value}`;
    case "no_series":
      return "Este producto aún no tiene series";
    case "no_administrators":
      return "Sin administradores en esta serie";
  }
}

/** Messages for one field of one product, series or administrator. */
export function observationMessages(
  observations: readonly CatalogObservation[],
  scope: ObservationScope,
  field: string,
): string[] {
  return observations
    .filter(
      (o) =>
        o.level === scope.level &&
        o.field === field &&
        (scope.level === "product" || o.series === scope.series) &&
        (scope.level !== "admin" || o.administrator === scope.administrator),
    )
    .map(observationMessage);
}

/** "1 observación" / "3 observaciones". */
export function observationCountLabel(count: number): string {
  return `${count} ${count === 1 ? "observación" : "observaciones"}`;
}

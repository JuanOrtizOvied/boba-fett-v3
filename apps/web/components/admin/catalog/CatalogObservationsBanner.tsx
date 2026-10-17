import {
  observationGroupLabel,
  type ObservationGroup,
} from "@/lib/catalogObservations";

/**
 * Always-visible summary above the catalog table: how many active entries
 * have observations, grouped by issue ("2 productos sin gestor"). It is
 * computed over the whole active catalog, so it never changes with the
 * search term or the filters. `groups` is `null` while that catalog is
 * still loading.
 */
export function CatalogObservationsBanner({
  groups,
  entriesWithObservations,
  failed = false,
}: {
  groups: ObservationGroup[] | null;
  entriesWithObservations: number;
  /** The unfiltered catalog could not be loaded, so nothing can be counted. */
  failed?: boolean;
}) {
  if (groups === null && failed) {
    return (
      <div
        role="status"
        className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
      >
        No se pudieron calcular las observaciones del catálogo.
      </div>
    );
  }

  if (groups === null) {
    return (
      <div
        role="status"
        className="rounded-xl border border-sabbi-neutral-200 bg-sabbi-neutral-50 px-4 py-3 text-sm text-sabbi-neutral-600"
      >
        Calculando observaciones…
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div
        role="status"
        className="rounded-xl border border-sabbi-neutral-200 bg-sabbi-neutral-50 px-4 py-3 text-sm text-sabbi-neutral-700"
      >
        Sin observaciones: todos los productos activos están completos.
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-label="Resumen de observaciones"
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <p className="font-medium">
        {entriesWithObservations}{" "}
        {entriesWithObservations === 1
          ? "producto con observaciones"
          : "productos con observaciones"}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
        {groups.map((group) => (
          <li key={`${group.field}:${group.issue}`}>{observationGroupLabel(group)}</li>
        ))}
      </ul>
    </div>
  );
}

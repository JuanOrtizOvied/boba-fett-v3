"use client";

import { useId, useState } from "react";
import { ChevronDownIcon } from "@/components/icons/Icons";
import {
  observationGroupLabel,
  type ObservationGroup,
} from "@/lib/catalogObservations";

/**
 * Always-visible summary above the catalog table: how many active entries
 * have observations. The breakdown by issue ("2 productos sin gestor") is
 * collapsed by default and opens when the admin clicks the count, so a long
 * list never crowds the table. It is computed over the whole active catalog,
 * so it never changes with the search term or the filters. `groups` is
 * `null` while that catalog is still loading.
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
    <ObservationsSummary
      groups={groups}
      entriesWithObservations={entriesWithObservations}
    />
  );
}

/** The collapsible part, split out so its state is only created when there
 * is something to expand. */
function ObservationsSummary({
  groups,
  entriesWithObservations,
}: {
  groups: ObservationGroup[];
  entriesWithObservations: number;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();

  return (
    <section
      aria-label="Resumen de observaciones"
      className="rounded-xl border border-amber-200 bg-amber-50 text-sm text-amber-900"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left font-medium hover:bg-amber-100"
      >
        <span>
          {entriesWithObservations}{" "}
          {entriesWithObservations === 1
            ? "producto con observaciones"
            : "productos con observaciones"}
        </span>
        <ChevronDownIcon
          size={16}
          className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <ul
          id={detailId}
          className="flex flex-wrap gap-x-4 gap-y-0.5 px-4 pb-3"
        >
          {groups.map((group) => (
            <li key={`${group.field}:${group.issue}`}>
              {observationGroupLabel(group)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

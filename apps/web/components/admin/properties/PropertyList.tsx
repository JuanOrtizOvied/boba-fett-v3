"use client";

import { ownerCountLabel, type PropertySummary } from "@/lib/properties";

interface PropertyListProps {
  /** `null` while the first load is still going. */
  properties: PropertySummary[] | null;
  error: string | null;
  selectedCode: string | null;
  /** True when the list was filtered by a search term. */
  searching: boolean;
  onSelect: (code: string) => void;
}

/** The properties on the left: name on top, code below, small tags beside the name. */
export function PropertyList({
  properties,
  error,
  selectedCode,
  searching,
  onSelect,
}: PropertyListProps) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }
  if (properties === null) {
    return <p className="text-sm text-sabbi-neutral-600">Cargando…</p>;
  }
  if (properties.length === 0) {
    return (
      <p className="text-sm text-sabbi-neutral-600">
        {searching ? "No se encontraron propiedades." : "No hay propiedades."}
      </p>
    );
  }

  return (
    <ul className="max-h-[70vh] divide-y divide-sabbi-neutral-200 overflow-auto rounded-xl border border-sabbi-neutral-200 bg-white">
      {properties.map((p) => {
        const active = p.code === selectedCode;
        const owners = ownerCountLabel(p.ownership);
        return (
          <li key={p.code}>
            <button
              type="button"
              onClick={() => onSelect(p.code)}
              aria-current={active ? "true" : undefined}
              className={`flex w-full flex-col gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-[#f0fcd4] ${
                active ? "bg-[#f0fcd4]" : ""
              }`}
            >
              <span className="text-sm font-medium text-sabbi-neutral-900">
                {p.name.trim() === "" ? p.code : p.name}
                {p.usage.trim() !== "" && (
                  <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-sky-800 uppercase">
                    {p.usage}
                  </span>
                )}
                {owners && (
                  <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-amber-800 uppercase">
                    {owners}
                  </span>
                )}
              </span>
              <span className="text-xs text-sabbi-neutral-500">{p.code}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

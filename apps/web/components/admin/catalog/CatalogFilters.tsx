"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "@/components/icons/Icons";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { AdministratorEntity, ManagerEntity } from "@/lib/portfolio-types";
import {
  ASSET_CLASS_OPTIONS,
  CURRENCY_OPTIONS,
  GEOGRAPHIC_FOCUS_OPTIONS,
  UNDERLYING_OPTIONS,
} from "@/lib/catalogOptions";

/**
 * Multi-value filter state for the admin catalog table
 * (`openspec/changes/catalog-export-and-filters` — "Catalog Listing").
 * Every field accepts several values at once: values within one field
 * combine with OR, different fields combine with AND (design.md ADR-4,
 * ADR-6).
 */
export interface CatalogFilterState {
  currency: string[];
  administrator: string[];
  manager: string[];
  asset_class: string[];
  geographic_focus: string[];
  underlying: string[];
}

export const EMPTY_CATALOG_FILTERS: CatalogFilterState = {
  currency: [],
  administrator: [],
  manager: [],
  asset_class: [],
  geographic_focus: [],
  underlying: [],
};

export function hasActiveCatalogFilters(filters: CatalogFilterState): boolean {
  return Object.values(filters).some((values) => values.length > 0);
}

interface CatalogFiltersProps {
  value: CatalogFilterState;
  onChange: (next: CatalogFilterState) => void;
}

/**
 * Row of multiselect filters next to `CatalogSearch`. Administrator/manager
 * options are fetched live from the same entity endpoints the create/edit
 * modals already use, so a filter option can never be a value no catalog
 * entry could actually have (design.md, "Field name note").
 */
export function CatalogFilters({ value, onChange }: CatalogFiltersProps) {
  const [administratorEntities, setAdministratorEntities] = useState<AdministratorEntity[]>([]);
  const [managerEntities, setManagerEntities] = useState<ManagerEntity[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [adminRes, managerRes] = await Promise.all([
          fetchWithAuth("/api/admin/administrators"),
          fetchWithAuth("/api/admin/managers"),
        ]);
        if (adminRes.ok) setAdministratorEntities(await adminRes.json());
        if (managerRes.ok) setManagerEntities(await managerRes.json());
      } catch {
        // Administrador/Gestor filters just stay empty; other filters still work.
      }
    })();
  }, []);

  const update = (key: keyof CatalogFilterState, next: string[]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="flex flex-wrap items-end gap-3">
      <MultiSelectDropdown
        label="Clase de activo"
        options={ASSET_CLASS_OPTIONS}
        selected={value.asset_class}
        onChange={(next) => update("asset_class", next)}
      />
      <MultiSelectDropdown
        label="Foco geográfico"
        options={GEOGRAPHIC_FOCUS_OPTIONS}
        selected={value.geographic_focus}
        onChange={(next) => update("geographic_focus", next)}
      />
      <MultiSelectDropdown
        label="Subyacente"
        options={UNDERLYING_OPTIONS}
        selected={value.underlying}
        onChange={(next) => update("underlying", next)}
      />
      <MultiSelectDropdown
        label="Moneda"
        options={CURRENCY_OPTIONS}
        selected={value.currency}
        onChange={(next) => update("currency", next)}
      />
      <MultiSelectDropdown
        label="Administrador"
        options={administratorEntities.map((a) => a.name)}
        selected={value.administrator}
        onChange={(next) => update("administrator", next)}
      />
      <MultiSelectDropdown
        label="Gestor"
        options={managerEntities.map((m) => m.name)}
        selected={value.manager}
        onChange={(next) => update("manager", next)}
      />
      {hasActiveCatalogFilters(value) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_CATALOG_FILTERS)}
          className="rounded-md px-2 py-1.5 text-xs font-medium text-sabbi-neutral-500 hover:bg-sabbi-neutral-100"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggleValue = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);
  };

  const summary =
    selected.length === 0
      ? "Todos"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} seleccionados`;

  return (
    <div ref={containerRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-sabbi-neutral-500">{label}</label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-44 items-center justify-between gap-1.5 rounded-md border border-sabbi-neutral-200 bg-white px-2.5 py-1.5 text-sm text-sabbi-neutral-900 hover:bg-sabbi-neutral-50"
      >
        <span className={`truncate ${selected.length === 0 ? "text-sabbi-neutral-400" : ""}`}>
          {summary}
        </span>
        <ChevronDownIcon size={14} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-sabbi-neutral-200 bg-white p-1 shadow-lg">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-sabbi-neutral-400">Sin opciones</p>
          ) : (
            options.map((option) => {
              const checked = selected.includes(option);
              return (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-sabbi-neutral-900 hover:bg-sabbi-neutral-50"
                >
                  <span
                    className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                      checked
                        ? "border-sabbi-primary bg-sabbi-primary text-white"
                        : "border-sabbi-neutral-300"
                    }`}
                  >
                    {checked && <CheckIcon size={10} />}
                  </span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleValue(option)}
                    className="sr-only"
                  />
                  <span className="truncate">{option}</span>
                </label>
              );
            })
          )}
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-sabbi-neutral-500 hover:bg-sabbi-neutral-50"
            >
              Limpiar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

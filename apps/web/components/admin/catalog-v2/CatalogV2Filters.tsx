"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon } from "@/components/icons/Icons";

/**
 * Filters of the v2 catalog table: only the manager and the administrator,
 * both multi-value (values of one filter combine with OR, the two filters and
 * the search with AND). They hold ids because that is what the API takes.
 */
export interface CatalogV2FilterState {
  managerIds: number[];
  administratorIds: number[];
}

export const EMPTY_CATALOG_V2_FILTERS: CatalogV2FilterState = {
  managerIds: [],
  administratorIds: [],
};

export function hasActiveCatalogV2Filters(filters: CatalogV2FilterState): boolean {
  return filters.managerIds.length > 0 || filters.administratorIds.length > 0;
}

export interface FilterOption {
  id: number;
  name: string;
}

interface CatalogV2FiltersProps {
  value: CatalogV2FilterState;
  onChange: (next: CatalogV2FilterState) => void;
  managers: readonly FilterOption[];
  administrators: readonly FilterOption[];
}

export function CatalogV2Filters({
  value,
  onChange,
  managers,
  administrators,
}: CatalogV2FiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <MultiSelect
        label="Gestor"
        options={managers}
        selected={value.managerIds}
        onChange={(managerIds) => onChange({ ...value, managerIds })}
      />
      <MultiSelect
        label="Administrador"
        options={administrators}
        selected={value.administratorIds}
        onChange={(administratorIds) => onChange({ ...value, administratorIds })}
      />
      {hasActiveCatalogV2Filters(value) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_CATALOG_V2_FILTERS)}
          className="rounded-md px-2 py-1.5 text-xs font-medium text-sabbi-neutral-500 hover:bg-sabbi-neutral-100"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  );
}

function MultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: readonly FilterOption[];
  selected: number[];
  onChange: (next: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  const toggle = (id: number) =>
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);

  const names = new Map(options.map((option) => [option.id, option.name]));
  const summary =
    selected.length === 0
      ? "Todos"
      : selected.length === 1
        ? (names.get(selected[0]) ?? "1 seleccionado")
        : `${selected.length} seleccionados`;

  // The lists run to over a hundred names, so the dropdown has its own search.
  const needle = query.trim().toLocaleLowerCase("es");
  const shown = needle
    ? options.filter((option) => option.name.toLocaleLowerCase("es").includes(needle))
    : options;

  return (
    <div ref={containerRef} className="relative">
      <span className="mb-1 block text-xs font-medium text-sabbi-neutral-500">{label}</span>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-52 items-center justify-between gap-1.5 rounded-md border border-sabbi-neutral-200 bg-white px-2.5 py-1.5 text-sm text-sabbi-neutral-900 hover:bg-sabbi-neutral-50"
      >
        <span className={`truncate ${selected.length === 0 ? "text-sabbi-neutral-400" : ""}`}>
          {summary}
        </span>
        <ChevronDownIcon
          size={14}
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-64 rounded-lg border border-sabbi-neutral-200 bg-white p-1 shadow-lg">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Buscar ${label.toLocaleLowerCase("es")}...`}
            aria-label={`Buscar ${label.toLocaleLowerCase("es")}`}
            className="mb-1 block w-full rounded-md border border-sabbi-neutral-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-sabbi-neutral-900"
          />
          <div className="max-h-64 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-sabbi-neutral-400">Sin opciones</p>
            ) : (
              shown.map((option) => {
                const checked = selected.includes(option.id);
                return (
                  <label
                    key={option.id}
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
                      onChange={() => toggle(option.id)}
                      className="sr-only"
                    />
                    <span className="truncate">{option.name}</span>
                  </label>
                );
              })
            )}
          </div>
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

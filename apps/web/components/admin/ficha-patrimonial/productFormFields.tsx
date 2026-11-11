"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  allocationOptionExists,
  type AllocationOptionGroup,
} from "@/lib/allocationOptions";
import { searchCatalogProducts, getCatalogProductAsSearchResult } from "@/lib/fichaApi";
import type { AssetAllocation, SearchResult } from "@/lib/portfolio-types";
import type { CatalogProductRow } from "@/lib/normalized-catalog-types";
import {
  blankEditableAdminRow,
  blankEditableSeriesRow,
  type EditableAdminRow,
  type EditableSeriesRow,
} from "./reviewTableShared";

/**
 * Presentational building blocks for the product review/lookup forms. Extracted
 * from `ReviewTable.tsx` so the ficha review card AND the standalone
 * "Buscar producto" form render the SAME editable fields and tables without
 * duplicating ~370 lines. Pure (props in, callbacks out) — no feature logic.
 */

export const inputClass =
  "w-full rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

// -- Allocation editor --------------------------------------------------------

export function AllocationEditor({
  label,
  allocations,
  onChange,
  confidence,
  optionGroups,
}: {
  label: string;
  allocations: AssetAllocation[];
  onChange: (next: AssetAllocation[]) => void;
  confidence?: number;
  optionGroups: AllocationOptionGroup[];
}) {
  const total = allocations.reduce((sum, a) => sum + a.percentage, 0);
  const isValid = allocations.length === 0 || Math.abs(total - 100) < 0.01;

  const update = (i: number, patch: Partial<AssetAllocation>) => {
    onChange(allocations.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const remove = (i: number) => onChange(allocations.filter((_, idx) => idx !== i));
  const add = () => onChange([...allocations, { name: "", percentage: 0 }]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-sabbi-neutral-500">{label}</span>
        <ConfidenceTag value={confidence} />
        {allocations.length > 0 && (
          <span
            title="Suma de la asignación (debe dar 100%)"
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              isValid ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            Σ {total.toFixed(0)}%
          </span>
        )}
      </div>

      {allocations.length === 0 && (
        <p className="text-xs text-sabbi-neutral-400">Sin asignación</p>
      )}

      <div className="flex flex-col gap-1.5">
        {allocations.map((a, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={a.name}
              onChange={(e) => update(i, { name: e.target.value })}
              aria-label={`${label} — asignación ${i + 1}`}
              className={inputClass + " min-w-0 flex-1"}
            >
              <option value="">Seleccionar…</option>
              {a.name && !allocationOptionExists(optionGroups, a.name) && (
                <option value={a.name}>{a.name}</option>
              )}
              {optionGroups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="flex items-center gap-0.5">
              <input
                type="number"
                value={a.percentage}
                onChange={(e) => update(i, { percentage: Number(e.target.value) || 0 })}
                className="w-14 rounded-lg border border-sabbi-neutral-200 px-1.5 py-1 text-right text-sm outline-none focus:border-sabbi-primary"
                min={0}
                max={100}
              />
              <span className="text-xs text-sabbi-neutral-400">%</span>
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded p-0.5 text-sabbi-neutral-400 hover:text-red-500"
              aria-label={`Eliminar ${a.name || "entrada"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="self-start rounded-lg border border-dashed border-sabbi-neutral-300 px-2 py-1 text-xs text-sabbi-neutral-600 hover:border-sabbi-primary hover:text-sabbi-primary"
      >
        + Agregar
      </button>
    </div>
  );
}

// -- Field label + input helper -----------------------------------------------

/**
 * Small pill showing Claude's self-reported confidence (0..100) for a field it
 * filled from the web research. Hidden when there is no score. Color bands:
 * >=80 green, >=50 amber, else red.
 */
export function ConfidenceTag({ value }: { value?: number }) {
  if (value == null) return null;
  const band =
    value >= 80
      ? "bg-green-50 text-green-700"
      : value >= 50
        ? "bg-amber-50 text-amber-700"
        : "bg-red-50 text-red-700";
  return (
    <span
      title={`Confianza de Claude (búsqueda web): ${value}%`}
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${band}`}
    >
      <span aria-hidden="true">✨</span>
      {value}%
    </span>
  );
}

export function Field({
  label,
  confidence,
  children,
}: {
  label: string;
  confidence?: number;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 text-xs font-medium text-sabbi-neutral-500">
        {label}
        <ConfidenceTag value={confidence} />
      </label>
      {children}
    </div>
  );
}

// -- Series table (editable catalog series) -----------------------------------

const SERIES_COLUMNS: { key: keyof EditableSeriesRow; label: string }[] = [
  { key: "ter", label: "TER c/IGV" },
  { key: "flowsMin", label: "Flujos mín" },
  { key: "flowsMax", label: "Flujos máx" },
  { key: "returnMin", label: "Rent. mín" },
  { key: "returnMax", label: "Rent. máx" },
  { key: "minimumUsd", label: "Mínimo USD" },
  { key: "howCalculated", label: "Cómo se calculó" },
];

/** Small "sugerido por Claude" pill shown on a series/admin row the web research
 * suggested, carrying its self-reported confidence %. Nothing for catalog/manual
 * rows (confidence undefined). Color-banded like `ConfidenceTag`. */
export function SuggestedBadge({ confidence }: { confidence?: number }) {
  if (confidence === undefined) return null;
  const band =
    confidence >= 80
      ? "bg-green-100 text-green-800 ring-green-300"
      : confidence >= 50
        ? "bg-amber-100 text-amber-800 ring-amber-300"
        : "bg-red-100 text-red-700 ring-red-300";
  return (
    <span
      title={`Sugerido por Claude (búsqueda web): ${confidence}% de confianza`}
      className={`inline-flex items-center gap-0.5 self-start rounded-full px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${band}`}
    >
      <span aria-hidden="true">✨</span>
      {confidence}%
    </span>
  );
}

export function SeriesTable({
  series,
  onChange,
}: {
  series: EditableSeriesRow[];
  onChange: (next: EditableSeriesRow[]) => void;
}) {
  const update = (index: number, patch: Partial<EditableSeriesRow>) => {
    onChange(series.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };
  const add = () => onChange([...series, blankEditableSeriesRow()]);
  const remove = (index: number) =>
    onChange(series.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-sabbi-neutral-500">
        Series (porcentajes en %)
      </span>
      {series.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-sabbi-neutral-500">
                <th className="px-1 py-1 font-medium">Serie</th>
                {SERIES_COLUMNS.map((c) => (
                  <th key={c.key} className="px-1 py-1 font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-1 py-1" />
              </tr>
            </thead>
            <tbody>
              {series.map((s, i) => (
                <tr key={i}>
                  <td className="px-1 py-1">
                    <div className="flex flex-col items-start gap-0.5">
                      <input
                        value={s.series}
                        aria-label={`Nombre de la serie ${i + 1}`}
                        onChange={(e) => update(i, { series: e.target.value })}
                        className="w-24 rounded border border-sabbi-neutral-200 px-1.5 py-1 font-medium outline-none focus:border-sabbi-primary"
                      />
                      <SuggestedBadge confidence={s.suggestedConfidence} />
                    </div>
                  </td>
                  {SERIES_COLUMNS.map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      <input
                        value={s[c.key]}
                        aria-label={`${c.label} serie ${s.series}`}
                        onChange={(e) => update(i, { [c.key]: e.target.value })}
                        className="w-20 rounded border border-sabbi-neutral-200 px-1.5 py-1 outline-none focus:border-sabbi-primary"
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="rounded p-0.5 text-sabbi-neutral-400 hover:text-red-500"
                      aria-label={`Eliminar serie ${i + 1}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={add}
        className="self-start rounded-lg border border-dashed border-sabbi-neutral-300 px-2 py-1 text-xs text-sabbi-neutral-600 hover:border-sabbi-primary hover:text-sabbi-primary"
      >
        + Agregar serie
      </button>
    </div>
  );
}

// -- Administradores table (editable catalog admins) --------------------------

const ADMIN_COLUMNS: { key: keyof EditableAdminRow; label: string }[] = [
  { key: "custody", label: "Custodia %" },
  { key: "buy", label: "Compra %" },
  { key: "sell", label: "Venta %" },
  { key: "minimumUsd", label: "Mínimo USD" },
];

export function AdminTable({
  admins,
  onChange,
}: {
  admins: EditableAdminRow[];
  onChange: (next: EditableAdminRow[]) => void;
}) {
  const update = (index: number, patch: Partial<EditableAdminRow>) => {
    onChange(admins.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };
  const add = () => onChange([...admins, blankEditableAdminRow()]);
  const remove = (index: number) =>
    onChange(admins.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-sabbi-neutral-500">
        Administradores
      </span>
      {admins.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-sabbi-neutral-500">
                <th className="px-1 py-1 font-medium">Administrador</th>
                <th className="px-1 py-1 font-medium">Serie</th>
                {ADMIN_COLUMNS.map((c) => (
                  <th key={c.key} className="px-1 py-1 font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-1 py-1" />
              </tr>
            </thead>
            <tbody>
              {admins.map((a, i) => (
                <tr key={i}>
                  <td className="px-1 py-1">
                    <div className="flex flex-col items-start gap-0.5">
                      <input
                        value={a.administrator}
                        aria-label={`Nombre del administrador ${i + 1}`}
                        onChange={(e) => update(i, { administrator: e.target.value })}
                        className="w-28 rounded border border-sabbi-neutral-200 px-1.5 py-1 font-medium outline-none focus:border-sabbi-primary"
                      />
                      <SuggestedBadge confidence={a.suggestedConfidence} />
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      value={a.series}
                      aria-label={`Serie del administrador ${i + 1}`}
                      onChange={(e) => update(i, { series: e.target.value })}
                      className="w-20 rounded border border-sabbi-neutral-200 px-1.5 py-1 outline-none focus:border-sabbi-primary"
                    />
                  </td>
                  {ADMIN_COLUMNS.map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      <input
                        value={a[c.key]}
                        aria-label={`${c.label} ${a.administrator} serie ${a.series}`}
                        onChange={(e) => update(i, { [c.key]: e.target.value })}
                        className="w-20 rounded border border-sabbi-neutral-200 px-1.5 py-1 outline-none focus:border-sabbi-primary"
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="rounded p-0.5 text-sabbi-neutral-400 hover:text-red-500"
                      aria-label={`Eliminar administrador ${i + 1}`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={add}
        className="self-start rounded-lg border border-dashed border-sabbi-neutral-300 px-2 py-1 text-xs text-sabbi-neutral-600 hover:border-sabbi-primary hover:text-sabbi-primary"
      >
        + Agregar administrador
      </button>
    </div>
  );
}

// -- Catalog product picker ---------------------------------------------------

/**
 * Catalog product search for a review card. Lets the investments team correct a
 * wrong or low-confidence fuzzy match by searching the catalog (name or code)
 * and picking the right product; the choice is loaded into the card as a catalog
 * match. `emphasize` highlights it when the current match is low-confidence.
 */
export function CatalogProductPicker({
  emphasize,
  onSelect,
}: {
  emphasize: boolean;
  onSelect: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProductRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchCatalogProducts(q);
        if (!active) return;
        setResults(rows);
        setOpen(true);
      } catch {
        if (active) setError("No se pudo buscar en el catálogo.");
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const choose = async (code: string) => {
    setError(null);
    try {
      const result = await getCatalogProductAsSearchResult(code);
      onSelect(result);
      setQuery("");
      setResults([]);
      setOpen(false);
    } catch {
      setError("No se pudo cargar el producto seleccionado.");
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-1">
      <label className="text-[11px] font-medium text-sabbi-neutral-600">
        {emphasize
          ? "¿Match incorrecto? Busca el producto correcto en el catálogo"
          : "Buscar producto en el catálogo"}
      </label>
      <input
        type="text"
        aria-label="Buscar producto en el catálogo"
        placeholder="Nombre o código (ej. BD-00352)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={inputClass + (emphasize ? " border-orange-300" : "")}
      />
      {loading && (
        <span className="text-[11px] text-sabbi-neutral-400">Buscando…</span>
      )}
      {open && results.length > 0 && (
        <ul className="max-h-40 overflow-y-auto rounded-lg border border-sabbi-neutral-200 bg-white text-xs">
          {results.map((p) => (
            <li key={p.code}>
              <button
                type="button"
                onClick={() => void choose(p.code)}
                className="flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left hover:bg-sabbi-neutral-50"
              >
                <span className="font-medium text-sabbi-neutral-900">{p.name}</span>
                <span className="text-sabbi-neutral-500">
                  {p.code}
                  {p.currency ? ` · ${p.currency}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && results.length === 0 && query.trim().length >= 2 && (
        <span className="text-[11px] text-sabbi-neutral-400">Sin resultados.</span>
      )}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

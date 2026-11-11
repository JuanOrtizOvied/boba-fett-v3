"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  GEOGRAPHIC_FOCUS_GROUPS,
  UNDERLYING_GROUPS,
  allocationOptionExists,
  type AllocationOptionGroup,
} from "@/lib/allocationOptions";
import { searchCatalogProducts, getCatalogProductAsSearchResult } from "@/lib/fichaApi";
import type {
  AssetAllocation,
  FichaEnrichedRow,
  SearchResult,
} from "@/lib/portfolio-types";
import type { CatalogProductRow } from "@/lib/normalized-catalog-types";
import CatalogHistory from "./CatalogHistory";
import {
  ASSET_CLASS_LABELS,
  SOURCE_BADGES,
  applyCatalogSelectionToRow,
  applySeriesAdminSelection,
  blankEditableAdminRow,
  blankEditableSeriesRow,
  formatDeclaredSummary,
  formatSimilarityPercent,
  nameDifferenceWords,
  resolveConfidence,
  type EditableAdminRow,
  type EditableFichaRow,
  type EditableSeriesRow,
  type FichaAssetClassKey,
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
          <table className="w-full table-fixed border-collapse text-xs">
            <thead>
              <tr className="text-left text-sabbi-neutral-500">
                <th className="px-1 py-1 font-medium">Serie</th>
                {SERIES_COLUMNS.map((c) => (
                  <th key={c.key} className="px-1 py-1 font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="w-8 px-1 py-1" />
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
                        className="w-full min-w-0 rounded border border-sabbi-neutral-200 px-1.5 py-1 font-medium outline-none focus:border-sabbi-primary"
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
                        className="w-full min-w-0 rounded border border-sabbi-neutral-200 px-1.5 py-1 outline-none focus:border-sabbi-primary"
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
          <table className="w-full table-fixed border-collapse text-xs">
            <thead>
              <tr className="text-left text-sabbi-neutral-500">
                <th className="px-1 py-1 font-medium">Administrador</th>
                <th className="px-1 py-1 font-medium">Serie</th>
                {ADMIN_COLUMNS.map((c) => (
                  <th key={c.key} className="px-1 py-1 font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="w-8 px-1 py-1" />
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
                        className="w-full min-w-0 rounded border border-sabbi-neutral-200 px-1.5 py-1 font-medium outline-none focus:border-sabbi-primary"
                      />
                      <SuggestedBadge confidence={a.suggestedConfidence} />
                    </div>
                  </td>
                  <td className="px-1 py-1">
                    <input
                      value={a.series}
                      aria-label={`Serie del administrador ${i + 1}`}
                      onChange={(e) => update(i, { series: e.target.value })}
                      className="w-full min-w-0 rounded border border-sabbi-neutral-200 px-1.5 py-1 outline-none focus:border-sabbi-primary"
                    />
                  </td>
                  {ADMIN_COLUMNS.map((c) => (
                    <td key={c.key} className="px-1 py-1">
                      <input
                        value={a[c.key]}
                        aria-label={`${c.label} ${a.administrator} serie ${a.series}`}
                        onChange={(e) => update(i, { [c.key]: e.target.value })}
                        className="w-full min-w-0 rounded border border-sabbi-neutral-200 px-1.5 py-1 outline-none focus:border-sabbi-primary"
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

// -- Product review card ------------------------------------------------------

/**
 * The two-column product card shared by the Ficha Patrimonial review table and
 * the standalone "Buscar producto" form, so both have the SAME design: a left
 * rail (declared name, origin badge, "Buscar con Claude", catalog picker,
 * Fuentes) and a right editable panel (enriched fields + Series/Administradores
 * tables). The ficha-only pieces are controlled by props:
 *  - `footer` renders the action bar (ficha: Aprobar/Descartar; lookup: Guardar).
 *  - `showClientSelection` toggles the "Serie/Administrador del cliente" block,
 *    which only makes sense when creating a client holding (ficha).
 */
export function ProductReviewCard({
  row,
  rawRow,
  onUpdate,
  onResearch,
  researching,
  footer,
  showClientSelection = true,
}: {
  row: EditableFichaRow;
  rawRow: FichaEnrichedRow;
  onUpdate: (patch: Partial<EditableFichaRow>) => void;
  onResearch: () => void;
  researching: boolean;
  footer?: ReactNode;
  showClientSelection?: boolean;
}) {
  const isUnmapped = row.assetClass === "";
  // Enriched-derived display reads the EDITABLE copy (`row.enriched`/`row.source`)
  // so a web re-investigation updates the badge, confidence, and Fuentes live;
  // the left rail (declared/raw values) stays on `rawRow`.
  const effectiveRow: FichaEnrichedRow = { ...rawRow, enriched: row.enriched };
  const badge = SOURCE_BADGES[row.source];
  const confidence = resolveConfidence(effectiveRow);
  const declaredSummary = formatDeclaredSummary(rawRow);
  const similarity = formatSimilarityPercent(row.enriched?.similarity);
  // Color band for the similarity pill, aligned with the catalog-match tiers
  // (>=0.6 strong, >=0.4 acceptable, below weak) so a bad match is visually loud.
  const similarityValue = row.enriched?.similarity ?? 0;
  const similarityBand =
    similarityValue >= 0.6
      ? "bg-green-100 text-green-800 ring-green-300"
      : similarityValue >= 0.4
        ? "bg-amber-100 text-amber-800 ring-amber-300"
        : "bg-red-100 text-red-700 ring-red-300";
  // Words that differ between the declared name and the matched catalog name —
  // the "argument" for why the similarity is below 100%.
  const similarityDiff = similarity
    ? nameDifferenceWords(rawRow.raw_name, rawRow.enriched?.name ?? "")
    : [];
  const catalogMatched = row.enriched?.catalog_matched ?? false;
  const dataAsof = row.enriched?.data_asof || "—";
  // Per-field self-reported confidence from "Buscar con Claude" (keyed by the
  // backend field name); absent for catalog/parse results.
  const fc = row.enriched?.field_confidence ?? {};

  return (
    <div
      className={`rounded-xl border p-4 ${
        isUnmapped
          ? "border-amber-300 bg-amber-50/50"
          : "border-sabbi-neutral-200 bg-white"
      }`}
    >
      <div className="flex flex-col gap-4 md:flex-row">
        {/* Left rail: declared (raw) product — read-only */}
        <div className="flex w-full flex-col gap-2 md:w-80 md:shrink-0">
          <p className="text-sm font-medium italic text-sabbi-neutral-900">
            “{rawRow.raw_name}”
          </p>
          {declaredSummary && (
            <p className="text-xs text-sabbi-neutral-600">{declaredSummary}</p>
          )}
          <span
            className={`self-start rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
          {similarity && (
            <span
              title="Similitud del match con el catálogo"
              className={`self-start rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${similarityBand}`}
            >
              Similitud {similarity}
            </span>
          )}
          {similarityDiff.length > 0 && (
            <span
              className="text-[11px] text-sabbi-neutral-500"
              title={`“${rawRow.raw_name}” vs “${rawRow.enriched?.name ?? ""}”`}
            >
              se diferencia por:{" "}
              <span className="font-medium text-sabbi-neutral-700">
                {similarityDiff.join(", ")}
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={onResearch}
            disabled={researching}
            title="Investiga el producto con la búsqueda web de Claude"
            className="mt-1 inline-flex items-center gap-1.5 self-start rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60"
          >
            <span aria-hidden="true">✨</span>
            {researching ? "Buscando…" : "Buscar con Claude"}
          </button>

          <CatalogProductPicker
            emphasize={confidence.level === "baja"}
            onSelect={(result) => onUpdate(applyCatalogSelectionToRow(row, result))}
          />

          {(row.enriched?.sources?.length ?? 0) > 0 && (
            <div className="mt-1 flex flex-col gap-1 rounded-lg border border-sabbi-neutral-200 bg-sabbi-neutral-50 p-2">
              <span className="text-xs font-semibold text-sabbi-neutral-600">
                Fuentes ({row.enriched?.sources?.length})
              </span>
              <ol className="list-decimal pl-4 text-xs text-sabbi-neutral-600">
                {row.enriched?.sources?.map((source, i) => (
                  <li key={`${source.url}-${i}`} className="break-words">
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sabbi-primary underline hover:no-underline"
                    >
                      {source.title || source.url}
                    </a>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {/* Right panel: enriched (editable) product */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Confidence + status line */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${confidence.className}`}
            >
              {confidence.label}
            </span>
            <span className="text-xs text-sabbi-neutral-500">
              {catalogMatched ? "Producto existente" : "Producto nuevo"} · dato al{" "}
              {dataAsof}
            </span>
          </div>

          {/* Enriched fields */}
          <div className="flex flex-col gap-3">
            <Field label="Código del producto">
              <input
                value={row.enriched?.catalog_product_code ?? ""}
                aria-label="Código del producto"
                readOnly
                placeholder="Se asignará al crear el producto"
                className={inputClass + " bg-sabbi-neutral-50"}
              />
            </Field>

            <Field label="Nombre del producto" confidence={fc.name}>
              <input
                value={row.name}
                aria-label="Nombre del producto"
                onChange={(e) => onUpdate({ name: e.target.value })}
                className={inputClass}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Gestor" confidence={fc.manager}>
                <input
                  value={row.manager}
                  aria-label="Gestor"
                  onChange={(e) => onUpdate({ manager: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Ticker / ISIN">
                <input
                  value={row.enriched?.ticker_isin ?? ""}
                  aria-label="Ticker / ISIN"
                  readOnly
                  className={inputClass + " bg-sabbi-neutral-50"}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Moneda" confidence={fc.currency}>
                <input
                  value={row.currency}
                  aria-label="Moneda"
                  onChange={(e) => onUpdate({ currency: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Horizonte">
                <input
                  value={row.enriched?.investment_horizon ?? ""}
                  aria-label="Horizonte"
                  readOnly
                  className={inputClass + " bg-sabbi-neutral-50"}
                />
              </Field>
            </div>

            <Field
              label="Clase de activo"
              confidence={row.assetClass ? fc.asset_class : undefined}
            >
              <select
                value={row.assetClass}
                onChange={(e) =>
                  onUpdate({ assetClass: e.target.value as FichaAssetClassKey | "" })
                }
                className={inputClass + (isUnmapped ? " border-amber-400" : "")}
              >
                <option value="">Seleccionar…</option>
                {(Object.keys(ASSET_CLASS_LABELS) as FichaAssetClassKey[]).map((key) => (
                  <option key={key} value={key}>
                    {ASSET_CLASS_LABELS[key]}
                  </option>
                ))}
              </select>
              {isUnmapped && (
                <p className="text-[11px] text-amber-700">
                  Sin mapear — seleccioná una clase de activo
                </p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <AllocationEditor
                label="Foco geográfico"
                allocations={row.geographicFocus}
                onChange={(next) => onUpdate({ geographicFocus: next })}
                confidence={fc.geographic_focus}
                optionGroups={GEOGRAPHIC_FOCUS_GROUPS}
              />
              <AllocationEditor
                label="Subyacente"
                allocations={row.underlying}
                onChange={(next) => onUpdate({ underlying: next })}
                confidence={fc.underlying}
                optionGroups={UNDERLYING_GROUPS}
              />
            </div>
          </div>

          <SeriesTable
            series={row.editableSeries}
            onChange={(next) => onUpdate({ editableSeries: next })}
          />

          <AdminTable
            admins={row.editableAdmins}
            onChange={(next) => onUpdate({ editableAdmins: next })}
          />

          {showClientSelection && row.seriesOptions.length > 0 && (
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-sabbi-neutral-50 p-2">
              <Field label="Serie del cliente">
                <select
                  value={row.selectedSeries}
                  aria-label="Serie"
                  onChange={(e) =>
                    onUpdate(applySeriesAdminSelection(row, e.target.value, ""))
                  }
                  className={inputClass}
                >
                  <option value="">Seleccionar…</option>
                  {row.seriesOptions.map((s) => (
                    <option key={s.series} value={s.series}>
                      {s.series}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Administrador del cliente">
                <select
                  value={row.selectedAdministrator}
                  aria-label="Administrador del catálogo"
                  disabled={!row.selectedSeries}
                  onChange={(e) =>
                    onUpdate(
                      applySeriesAdminSelection(row, row.selectedSeries, e.target.value),
                    )
                  }
                  className={inputClass + (!row.selectedSeries ? " opacity-60" : "")}
                >
                  <option value="">Seleccionar…</option>
                  {(
                    row.seriesOptions.find((s) => s.series === row.selectedSeries)
                      ?.administrators ?? []
                  ).map((a) => (
                    <option key={a.administrator} value={a.administrator}>
                      {a.administrator}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {rawRow.enriched?.catalog_product_code && (
            <CatalogHistory code={rawRow.enriched.catalog_product_code} />
          )}

          {footer && (
            <div className="flex flex-wrap items-center gap-2 border-t border-sabbi-neutral-100 pt-3">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

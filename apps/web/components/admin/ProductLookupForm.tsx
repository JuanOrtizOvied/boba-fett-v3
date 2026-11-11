"use client";

import { useEffect, useState } from "react";
import {
  AdminTable,
  AllocationEditor,
  Field,
  SeriesTable,
  inputClass,
} from "@/components/admin/ficha-patrimonial/productFormFields";
import {
  ASSET_CLASS_LABELS,
  SOURCE_BADGES,
  applyResearchToRow,
  buildCatalogSaveRequest,
  searchResultToEditableRow,
  type EditableFichaRow,
  type FichaAssetClassKey,
} from "@/components/admin/ficha-patrimonial/reviewTableShared";
import { GEOGRAPHIC_FOCUS_GROUPS, UNDERLYING_GROUPS } from "@/lib/allocationOptions";
import { saveProductToCatalog } from "@/lib/catalogLookupApi";
import { researchFichaLine } from "@/lib/fichaApi";
import type { SearchResult } from "@/lib/portfolio-types";

const CONFIDENCE_PILL: Record<string, { label: string; className: string }> = {
  alta: { label: "Confianza alta", className: "border-green-200 bg-green-50 text-green-700" },
  media: { label: "Confianza media", className: "border-amber-200 bg-amber-50 text-amber-700" },
  baja: { label: "Confianza baja", className: "border-red-200 bg-red-50 text-red-700" },
  sin_datos: {
    label: "Sin datos",
    className: "border-sabbi-neutral-200 bg-sabbi-neutral-50 text-sabbi-neutral-600",
  },
};

function insufficientNotice(result: SearchResult): string | null {
  return result.web_search_insufficient
    ? `No se encontró información suficiente en la web para «${result.name}». ` +
        "Revisá o completá los datos manualmente."
    : null;
}

/**
 * Editable form for a single looked-up product, mirroring the Ficha Patrimonial
 * review card (same field grid + Series/Administradores tables, via the shared
 * `productFormFields`). The admin can correct the enriched values, re-investigate
 * with Claude's web search, and SAVE the product to the normalized catalog
 * (`POST /admin/product-lookup/save`) — no client or holding is involved.
 */
export default function ProductLookupForm({ result }: { result: SearchResult }) {
  const [row, setRow] = useState<EditableFichaRow>(() => searchResultToEditableRow(result));
  const [researching, setResearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => insufficientNotice(result));

  // Reset the form when a new search comes in (the component stays mounted).
  useEffect(() => {
    setRow(searchResultToEditableRow(result));
    setSavedCode(null);
    setError(null);
    setNotice(insufficientNotice(result));
  }, [result]);

  const update = (patch: Partial<EditableFichaRow>) =>
    setRow((r) => ({ ...r, ...patch }));

  const badge = SOURCE_BADGES[row.source];
  const confidence = row.enriched?.confidence
    ? CONFIDENCE_PILL[row.enriched.confidence]
    : undefined;
  const catalogMatched = row.enriched?.catalog_matched ?? false;
  const isUnmapped = row.assetClass === "";

  const research = async () => {
    setError(null);
    setResearching(true);
    try {
      const web = await researchFichaLine(row.name);
      setRow((r) => ({ ...r, ...applyResearchToRow(r, web) }));
      setNotice(insufficientNotice(web));
    } catch {
      setError("No se pudo investigar el producto con la búsqueda web.");
    } finally {
      setResearching(false);
    }
  };

  const save = async () => {
    setError(null);
    setSavedCode(null);
    setSaving(true);
    try {
      const res = await saveProductToCatalog(buildCatalogSaveRequest(row));
      setSavedCode(res.catalog_product_code);
    } catch {
      setError("No se pudo guardar el producto en el catálogo. Intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-sabbi-neutral-200 bg-background p-4">
      {/* Header: name + origin/confidence/matched badges */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-sabbi-neutral-900">{result.name}</h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
        {confidence && (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${confidence.className}`}
          >
            {confidence.label}
          </span>
        )}
        <span className="text-xs text-sabbi-neutral-500">
          {catalogMatched ? "Producto existente" : "Producto nuevo"}
        </span>
      </div>

      <button
        type="button"
        onClick={() => void research()}
        disabled={researching}
        title="Investiga el producto con la búsqueda web de Claude"
        className="inline-flex items-center gap-1.5 self-start rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60"
      >
        <span aria-hidden="true">✨</span>
        {researching ? "Buscando…" : "Buscar con Claude"}
      </button>

      {notice && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {notice}
        </p>
      )}

      {/* Editable fields */}
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

        <Field label="Nombre del producto">
          <input
            value={row.name}
            aria-label="Nombre del producto"
            onChange={(e) => update({ name: e.target.value })}
            className={inputClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Gestor">
            <input
              value={row.manager}
              aria-label="Gestor"
              onChange={(e) => update({ manager: e.target.value })}
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
          <Field label="Moneda">
            <input
              value={row.currency}
              aria-label="Moneda"
              onChange={(e) => update({ currency: e.target.value })}
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

        <Field label="Clase de activo">
          <select
            value={row.assetClass}
            aria-label="Clase de activo"
            onChange={(e) =>
              update({ assetClass: e.target.value as FichaAssetClassKey | "" })
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
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <AllocationEditor
            label="Foco geográfico"
            allocations={row.geographicFocus}
            onChange={(next) => update({ geographicFocus: next })}
            optionGroups={GEOGRAPHIC_FOCUS_GROUPS}
          />
          <AllocationEditor
            label="Subyacente"
            allocations={row.underlying}
            onChange={(next) => update({ underlying: next })}
            optionGroups={UNDERLYING_GROUPS}
          />
        </div>
      </div>

      <SeriesTable
        series={row.editableSeries}
        onChange={(next) => update({ editableSeries: next })}
      />
      <AdminTable
        admins={row.editableAdmins}
        onChange={(next) => update({ editableAdmins: next })}
      />

      {(row.enriched?.sources?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-sabbi-neutral-500">Fuentes</span>
          <ol className="list-decimal pl-4 text-sm text-sabbi-neutral-600">
            {row.enriched?.sources?.map((src, i) => (
              <li key={`${src.url}-${i}`} className="break-words">
                <a
                  href={src.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sabbi-primary underline hover:no-underline"
                >
                  {src.title || src.url}
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Save action */}
      <div className="flex flex-wrap items-center gap-3 border-t border-sabbi-neutral-100 pt-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
        >
          {saving ? "Guardando…" : "Guardar en catálogo"}
        </button>
        {savedCode && (
          <span className="text-sm font-medium text-green-700">
            Guardado en el catálogo ({savedCode}).
          </span>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}

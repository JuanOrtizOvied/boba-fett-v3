"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductReviewCard } from "@/components/admin/ficha-patrimonial/productFormFields";
import {
  applyResearchToRow,
  buildCatalogSaveRequest,
  searchResultToFichaRow,
  toEditableRow,
  type EditableFichaRow,
} from "@/components/admin/ficha-patrimonial/reviewTableShared";
import { saveProductToCatalog } from "@/lib/catalogLookupApi";
import { researchFichaLine } from "@/lib/fichaApi";
import type { SearchResult } from "@/lib/portfolio-types";

function insufficientNotice(result: SearchResult): string | null {
  return result.web_search_insufficient
    ? `No se encontró información suficiente en la web para «${result.name}». ` +
        "Revisá o completá los datos manualmente."
    : null;
}

/**
 * Editable form for a single looked-up product. Renders the SAME card as the
 * Ficha Patrimonial review table (`ProductReviewCard`) — two columns, left rail
 * (name, origin badge, "Buscar con Claude", catalog picker, Fuentes) and right
 * editable panel (fields + Series/Administradores). The client-holding block is
 * hidden (`showClientSelection={false}`) and the footer saves the product to the
 * normalized catalog (`POST /admin/product-lookup/save`) instead of approving a
 * ficha line — no client or holding is involved.
 */
export default function ProductLookupForm({ result }: { result: SearchResult }) {
  const rawRow = useMemo(() => searchResultToFichaRow(result), [result]);
  const [row, setRow] = useState<EditableFichaRow>(() => toEditableRow(rawRow));
  const [researching, setResearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedCode, setSavedCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => insufficientNotice(result));

  // Reset the form when a new search comes in (the component stays mounted).
  useEffect(() => {
    setRow(toEditableRow(rawRow));
    setSavedCode(null);
    setError(null);
    setNotice(insufficientNotice(result));
  }, [rawRow, result]);

  const update = (patch: Partial<EditableFichaRow>) =>
    setRow((r) => ({ ...r, ...patch }));

  const research = async () => {
    setError(null);
    setResearching(true);
    try {
      // Re-investigate by the looked-up name, not the edited field.
      const web = await researchFichaLine(rawRow.raw_name);
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
    <div className="flex flex-col gap-3">
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {notice}
        </p>
      )}

      <ProductReviewCard
        row={row}
        rawRow={rawRow}
        onUpdate={update}
        onResearch={() => void research()}
        researching={researching}
        showClientSelection={false}
        footer={
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-sabbi-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              {saving ? "Guardando…" : "Guardar en catálogo"}
            </button>
            {savedCode && (
              <span className="text-sm font-medium text-green-700">
                Guardado en el catálogo ({savedCode}).
              </span>
            )}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </>
        }
      />
    </div>
  );
}

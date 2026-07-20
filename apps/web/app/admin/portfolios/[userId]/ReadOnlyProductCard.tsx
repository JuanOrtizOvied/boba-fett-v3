"use client";

import { useEffect, useState, type FC, type ReactNode } from "react";
import { CheckIcon, XIcon } from "@/components/icons/Icons";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { compositionColor } from "@/lib/compositionPalette";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatUsd } from "@/lib/format";
import type { CatalogProduct, Category, Product } from "@/lib/portfolio-types";

/**
 * Not a Next.js route file (no `page`/`layout`/`route` export constraints
 * apply here) — a sibling module in the same route segment so these
 * components stay page-scoped without violating the App Router's rule that
 * `page.tsx` may only export `default`/`metadata`/etc.
 *
 * Visually mirrors `ProductCard`'s "view" state but drops the edit/delete
 * affordances entirely, adding a single "Aprobar" affordance instead
 * (`admin-panel/spec.md` -> "Approve to Catalog Affordance on Portfolio
 * View"). Implemented as a local, page-scoped component rather than adding
 * an optional read-only prop to the shared `ProductCard` (used by the
 * mutable portfolio-builder flow) — keeps that component's contract
 * unchanged for its existing consumers.
 */
export function ReadOnlyProductCard({
  product,
  onApprove,
  isApproved = false,
}: {
  product: Product;
  onApprove: (product: Product) => void;
  isApproved?: boolean;
}) {
  const meta = CATEGORY_META[product.category];

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border bg-background transition-colors ${
        isApproved
          ? "animate-product-added border-emerald-400"
          : "border-sabbi-neutral-200"
      }`}
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-words text-sm font-semibold text-sabbi-neutral-900">
              {product.name}
            </p>
            {product.provider && (
              <p className="break-words text-xs text-sabbi-neutral-600">
                {product.provider}
              </p>
            )}
          </div>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: `var(${meta.cssVar})` }}
          >
            {meta.shortLabel}
          </span>
        </div>

        <p className="font-display text-xl font-semibold text-sabbi-neutral-900">
          {formatUsd(product.amount)}
        </p>

        {product.subcategory && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-sabbi-neutral-500">Subcategoría:</span>
            <span className="text-xs font-medium text-sabbi-neutral-700">
              {product.subcategory}
            </span>
          </div>
        )}

        {product.composition.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex h-2 overflow-hidden rounded-full bg-sabbi-neutral-100">
              {product.composition.map((asset, index) => (
                <div
                  key={`${asset.name}-${index}`}
                  style={{
                    width: `${asset.percentage}%`,
                    backgroundColor: compositionColor(index),
                  }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {product.composition.map((asset, index) => (
                <span
                  key={`${asset.name}-${index}`}
                  className="flex items-center gap-1 text-[10px] text-sabbi-neutral-600"
                >
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: compositionColor(index) }}
                  />
                  {asset.name} ({asset.percentage}%)
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={isApproved}
        onClick={() => onApprove(product)}
        className="mt-auto flex w-full items-center justify-center gap-2 border-t border-sabbi-neutral-200 py-2.5 text-sm font-semibold transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:hover:opacity-100"
        style={{
          backgroundColor: isApproved ? "#dcfce7" : "var(--sabbi-lime)",
          color: isApproved ? "#166534" : "var(--sabbi-green)",
        }}
      >
        <CheckIcon size={16} />
        {isApproved ? "Aprobado" : "Aprobar al catálogo"}
      </button>
    </div>
  );
}

/**
 * Enrichment fields the backend accepts on `POST /admin/catalog/approve`
 * beyond the product's own identifying fields, per
 * `apps/backend/src/db/models.py::CatalogProductCreate`.
 */
interface EnrichmentFields {
  assetClass: string;
  geographicFocus: string;
  underlying: string;
  commission: string;
  currency: string;
  administrator: string;
  manager: string;
  liquidity: string;
  returnRate: string;
}

const EMPTY_ENRICHMENT: EnrichmentFields = {
  assetClass: "",
  geographicFocus: "",
  underlying: "",
  commission: "",
  currency: "",
  administrator: "",
  manager: "",
  liquidity: "",
  returnRate: "",
};

export interface ApproveProductModalProps {
  /** `null` closes the modal. */
  product: Product | null;
  catalogEntry?: CatalogProduct | null;
  onClose: () => void;
  onApproved?: (productId: string) => void;
}

/**
 * "Approve to catalog" modal (`admin-panel/spec.md` -> "Approve to Catalog
 * Affordance on Portfolio View"). Pre-fills `name`/`category`/`subcategory`
 * from the source product and leaves every enrichment field empty for the
 * admin to fill in. Cancel closes with no side effects. Confirm posts to
 * `POST /api/admin/catalog/approve`; successful approval notifies the parent
 * and closes the modal, while duplicate/error responses stay inline.
 */
export const ApproveProductModal: FC<ApproveProductModalProps> = ({
  product,
  catalogEntry = null,
  onClose,
  onApproved,
}) => {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<Category>("directas");
  const [subcategory, setSubcategory] = useState("");
  const [enrichment, setEnrichment] = useState<EnrichmentFields>(EMPTY_ENRICHMENT);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setCategory(product.category);
    setSubcategory(product.subcategory);
    setEnrichment({
      assetClass: product.asset_class || "",
      geographicFocus: product.geographic_focus || "",
      underlying: product.underlying || "",
      commission: product.commission || "",
      currency: product.currency || "",
      administrator: product.administrator || "",
      manager: product.manager || "",
      liquidity: product.liquidity || "",
      returnRate: product.return_rate || "",
    });
    setErrorMessage(null);
  }, [product]);

  useEffect(() => {
    if (!product) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [product, onClose]);

  if (!product) return null;

  const updateEnrichment = (patch: Partial<EnrichmentFields>) =>
    setEnrichment((prev) => ({ ...prev, ...patch }));

  const handleApprove = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/admin/catalog/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          category,
          subcategory: subcategory.trim(),
          asset_class: enrichment.assetClass.trim(),
          geographic_focus: enrichment.geographicFocus.trim(),
          underlying: enrichment.underlying.trim(),
          commission: enrichment.commission.trim(),
          currency: enrichment.currency.trim(),
          administrator: enrichment.administrator.trim(),
          manager: enrichment.manager.trim(),
          liquidity: enrichment.liquidity.trim(),
          return_rate: enrichment.returnRate.trim(),
          approved_from_product_id: product.id,
          catalog_product_id: product.catalog_product_id,
        }),
      });

      if (res.status === 409) {
        setErrorMessage("Ya existe un producto igual en el catálogo.");
        return;
      }
      if (!res.ok) {
        throw new Error(`No se pudo aprobar (status ${res.status})`);
      }
      onApproved?.(product.id);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudo aprobar el producto",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-background shadow-xl sm:max-w-4xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-sabbi-neutral-900">
            Aprobar al catálogo
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-0 overflow-y-auto">
          {catalogEntry ? (
            <>
              <div className="bg-amber-50 px-5 py-3 text-sm font-medium text-amber-800">
                Este producto ya existe en el catálogo. Los campos modificados se resaltan.
              </div>
              <div className="flex flex-col divide-y divide-sabbi-neutral-100">
                <ComparisonRow label="Nombre" currentValue={catalogEntry.name} newValue={name}>
                  <input value={name} onChange={(e) => setName(e.target.value)} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Categoría" currentValue={catalogEntry.category} newValue={category}>
                  <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={modalInputClass}>
                    {CATEGORY_ORDER.map((cat) => (
                      <option key={cat} value={cat}>{CATEGORY_META[cat].label}</option>
                    ))}
                  </select>
                </ComparisonRow>
                <ComparisonRow label="Subcategoría" currentValue={catalogEntry.subcategory} newValue={subcategory}>
                  <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Clase de activo" currentValue={catalogEntry.asset_class} newValue={enrichment.assetClass}>
                  <input value={enrichment.assetClass} onChange={(e) => updateEnrichment({ assetClass: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Foco geográfico" currentValue={catalogEntry.geographic_focus} newValue={enrichment.geographicFocus}>
                  <input value={enrichment.geographicFocus} onChange={(e) => updateEnrichment({ geographicFocus: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Subyacente" currentValue={catalogEntry.underlying} newValue={enrichment.underlying}>
                  <input value={enrichment.underlying} onChange={(e) => updateEnrichment({ underlying: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Comisión" currentValue={catalogEntry.commission} newValue={enrichment.commission}>
                  <input value={enrichment.commission} onChange={(e) => updateEnrichment({ commission: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Moneda" currentValue={catalogEntry.currency} newValue={enrichment.currency}>
                  <input value={enrichment.currency} onChange={(e) => updateEnrichment({ currency: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Administradora" currentValue={catalogEntry.administrator} newValue={enrichment.administrator}>
                  <input value={enrichment.administrator} onChange={(e) => updateEnrichment({ administrator: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Gestor" currentValue={catalogEntry.manager} newValue={enrichment.manager}>
                  <input value={enrichment.manager} onChange={(e) => updateEnrichment({ manager: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Liquidez" currentValue={catalogEntry.liquidity} newValue={enrichment.liquidity}>
                  <input value={enrichment.liquidity} onChange={(e) => updateEnrichment({ liquidity: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
                <ComparisonRow label="Rentabilidad" currentValue={catalogEntry.return_rate} newValue={enrichment.returnRate}>
                  <input value={enrichment.returnRate} onChange={(e) => updateEnrichment({ returnRate: e.target.value })} className={modalInputClass} />
                </ComparisonRow>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-4 p-5">
              <ModalField label="Nombre">
                <input value={name} onChange={(e) => setName(e.target.value)} className={modalInputClass} />
              </ModalField>
              <ModalField label="Categoría">
                <select value={category} onChange={(e) => setCategory(e.target.value as Category)} className={modalInputClass}>
                  {CATEGORY_ORDER.map((cat) => (
                    <option key={cat} value={cat}>{CATEGORY_META[cat].label}</option>
                  ))}
                </select>
              </ModalField>
              <ModalField label="Subcategoría">
                <input value={subcategory} onChange={(e) => setSubcategory(e.target.value)} className={modalInputClass} />
              </ModalField>
              <ModalField label="Clase de activo">
                <input value={enrichment.assetClass} onChange={(e) => updateEnrichment({ assetClass: e.target.value })} className={modalInputClass} />
              </ModalField>
              <ModalField label="Foco geográfico">
                <input value={enrichment.geographicFocus} onChange={(e) => updateEnrichment({ geographicFocus: e.target.value })} className={modalInputClass} />
              </ModalField>
              <ModalField label="Subyacente">
                <input value={enrichment.underlying} onChange={(e) => updateEnrichment({ underlying: e.target.value })} className={modalInputClass} />
              </ModalField>
              <ModalField label="Comisión">
                <input value={enrichment.commission} onChange={(e) => updateEnrichment({ commission: e.target.value })} className={modalInputClass} />
              </ModalField>
              <ModalField label="Moneda">
                <input value={enrichment.currency} onChange={(e) => updateEnrichment({ currency: e.target.value })} className={modalInputClass} />
              </ModalField>
              <ModalField label="Administradora">
                <input value={enrichment.administrator} onChange={(e) => updateEnrichment({ administrator: e.target.value })} className={modalInputClass} />
              </ModalField>
              <ModalField label="Gestor">
                <input value={enrichment.manager} onChange={(e) => updateEnrichment({ manager: e.target.value })} className={modalInputClass} />
              </ModalField>
              <ModalField label="Liquidez">
                <input value={enrichment.liquidity} onChange={(e) => updateEnrichment({ liquidity: e.target.value })} className={modalInputClass} />
              </ModalField>
              <ModalField label="Rentabilidad">
                <input value={enrichment.returnRate} onChange={(e) => updateEnrichment({ returnRate: e.target.value })} className={modalInputClass} />
              </ModalField>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-sabbi-neutral-200 px-5 py-4">
          <p
            className="min-h-4 text-sm text-red-600"
          >
            {errorMessage}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => void handleApprove()}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              Aprobar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const modalInputClass =
  "rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

const ModalField: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="text-xs font-medium text-sabbi-neutral-700">{label}</span>
    {children}
  </label>
);

const ComparisonRow: FC<{
  label: string;
  currentValue: string;
  newValue: string;
  children: ReactNode;
}> = ({ label, currentValue, newValue, children }) => {
  const current = (currentValue || "").trim();
  const next = (newValue || "").trim();
  const hasChanged = current !== next;

  return (
    <div
      className={`grid grid-cols-2 gap-4 px-5 py-3 transition-colors ${
        hasChanged ? "border-l-3 border-l-amber-400 bg-amber-50/40" : ""
      }`}
    >
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-xs font-medium text-sabbi-neutral-500">
          {label}
          {hasChanged && (
            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
              Modificado
            </span>
          )}
        </span>
        {children}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-sabbi-neutral-500">Valor actual</span>
        <span className="text-sm text-sabbi-neutral-600">{current || "—"}</span>
      </div>
    </div>
  );
};

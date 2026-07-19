"use client";

import type { FC, ReactNode } from "react";
import { XIcon } from "@/components/icons/Icons";
import { CATEGORY_META } from "@/lib/categories";
import { formatDateTime, formatUsd } from "@/lib/format";
import type { AssetAllocation, Category, Product } from "@/lib/portfolio-types";
import type {
  Snapshot,
  SnapshotDiff,
  SnapshotDiffModifiedEntry,
} from "@/lib/usePortfolioVersioning";

export interface ComparisonViewProps {
  isOpen: boolean;
  onClose: () => void;
  /** Baseline snapshot metadata (query param `a`) — for the header label. */
  snapshotA: Snapshot | null;
  /** Comparison snapshot metadata (query param `b`) — for the header label. */
  snapshotB: Snapshot | null;
  comparison: SnapshotDiff | null;
  isComparing: boolean;
  /** CMP-005: surfaced instead of a blank/partial render. */
  compareError: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  provider: "Proveedor",
  amount: "Monto",
  category: "Categoría",
  subcategory: "Subcategoría",
  composition: "Composición",
  asset_class: "Clase de activo",
  geographic_focus: "Foco geográfico",
  underlying: "Subyacente",
  commission: "Comisión",
  currency: "Moneda",
  administrator: "Administrador",
  manager: "Gestor",
  liquidity: "Liquidez",
  return_rate: "Rentabilidad",
  catalog_product_id: "Producto de catálogo",
};

/**
 * Renders one field's before/after value for the inline delta list
 * (CMP-004 "Modified product shows field-level deltas inline"). Amounts use
 * the existing `formatUsd` helper; `category` resolves to its display
 * label; `composition` renders as a compact allocation list.
 */
function formatFieldValue(field: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (field === "amount") return formatUsd(Number(value));
  if (field === "category" && typeof value === "string") {
    return CATEGORY_META[value as Category]?.label ?? value;
  }
  if (field === "composition") {
    const allocations = value as AssetAllocation[];
    if (!Array.isArray(allocations) || allocations.length === 0) return "—";
    return allocations.map((a) => `${a.name} ${a.percentage}%`).join(", ");
  }
  return String(value);
}

/**
 * Full-width modal comparing two snapshots: Added (green), Removed (red),
 * Modified (amber, with per-field before→after deltas). `comparison.spec.md`
 * → CMP-004, CMP-005. `design.md` → Frontend Architecture → Component
 * Hierarchy → `ComparisonView` / `DiffSection`.
 */
export const ComparisonView: FC<ComparisonViewProps> = ({
  isOpen,
  onClose,
  snapshotA,
  snapshotB,
  comparison,
  isComparing,
  compareError,
}) => {
  if (!isOpen) return null;

  const hasNoChanges =
    comparison != null &&
    comparison.added.length === 0 &&
    comparison.removed.length === 0 &&
    comparison.modified.length === 0;

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-background shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-sabbi-neutral-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-sabbi-neutral-900">
              Comparar versiones
            </h2>
            {snapshotA && snapshotB && (
              <p className="text-sm text-sabbi-neutral-600">
                {snapshotA.name} ({formatDateTime(snapshotA.created_at)}) vs.{" "}
                {snapshotB.name} ({formatDateTime(snapshotB.created_at)})
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {isComparing ? (
            <div
              className="flex items-center justify-center gap-3 py-12"
              role="status"
              aria-live="polite"
            >
              <div className="size-6 animate-spin rounded-full border-2 border-sabbi-neutral-200 border-t-sabbi-primary" />
              <p className="text-sm text-sabbi-neutral-600">Comparando versiones…</p>
            </div>
          ) : compareError ? (
            <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              No se pudo comparar las versiones: {compareError}
            </p>
          ) : comparison == null ? null : hasNoChanges ? (
            <p className="rounded-lg bg-sabbi-neutral-50 px-4 py-6 text-center text-sm text-sabbi-neutral-600">
              Sin cambios entre estas dos versiones.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {comparison.added.length > 0 && (
                <DiffSection
                  title={`Agregados (${comparison.added.length})`}
                  colorClass="border-emerald-200 bg-emerald-50"
                >
                  {comparison.added.map((product) => (
                    <ProductDiffRow key={product.id} product={product} />
                  ))}
                </DiffSection>
              )}
              {comparison.removed.length > 0 && (
                <DiffSection
                  title={`Eliminados (${comparison.removed.length})`}
                  colorClass="border-red-200 bg-red-50"
                >
                  {comparison.removed.map((product) => (
                    <ProductDiffRow key={product.id} product={product} />
                  ))}
                </DiffSection>
              )}
              {comparison.modified.length > 0 && (
                <DiffSection
                  title={`Modificados (${comparison.modified.length})`}
                  colorClass="border-amber-200 bg-amber-50"
                >
                  {comparison.modified.map((entry) => (
                    <ModifiedDiffRow key={entry.product_id} entry={entry} />
                  ))}
                </DiffSection>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export interface DiffSectionProps {
  title: string;
  /** Tailwind border+background utility pair — green/red/amber per CMP-004. */
  colorClass: string;
  children: ReactNode;
}

/** Color-coded container for one diff category (Added/Removed/Modified). */
export const DiffSection: FC<DiffSectionProps> = ({ title, colorClass, children }) => (
  <section className={`flex flex-col gap-2 rounded-xl border p-4 ${colorClass}`}>
    <h3 className="text-sm font-semibold text-sabbi-neutral-900">{title}</h3>
    <div className="flex flex-col gap-2">{children}</div>
  </section>
);

const ProductDiffRow: FC<{ product: Product }> = ({ product }) => (
  <div className="flex items-center justify-between gap-3 rounded-lg bg-background/60 px-3 py-2 text-sm">
    <span className="font-medium text-sabbi-neutral-900">{product.name}</span>
    <span className="text-sabbi-neutral-600">{formatUsd(product.amount)}</span>
  </div>
);

const ModifiedDiffRow: FC<{ entry: SnapshotDiffModifiedEntry }> = ({ entry }) => (
  <div className="flex flex-col gap-1.5 rounded-lg bg-background/60 px-3 py-2 text-sm">
    <span className="font-medium text-sabbi-neutral-900">{entry.name}</span>
    <ul className="flex flex-col gap-1 text-sabbi-neutral-700">
      {Object.entries(entry.changes).map(([field, delta]) => (
        <li key={field}>
          <span className="font-medium">{FIELD_LABELS[field] ?? field}:</span>{" "}
          {formatFieldValue(field, delta.before)} → {formatFieldValue(field, delta.after)}
        </li>
      ))}
    </ul>
  </div>
);

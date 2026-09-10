"use client";

import { useState } from "react";
import { extractErrorDetail } from "./fichaUploadShared";
import {
  ASSET_CLASS_LABELS,
  SOURCE_BADGES,
  buildConfirmProducts,
  hasUnmappedRow,
  resolveRowSource,
  toEditableRow,
  type EditableFichaRow,
  type FichaAssetClassKey,
} from "./reviewTableShared";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { AssetAllocation, FichaEnrichedRow } from "@/lib/portfolio-types";

interface ReviewTableProps {
  rows: FichaEnrichedRow[];
  userId: string;
  onConfirmed: (createdCount: number) => void;
}

const inputClass =
  "w-full rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

// -- Allocation editor --------------------------------------------------------

function AllocationEditor({
  label,
  allocations,
  onChange,
}: {
  label: string;
  allocations: AssetAllocation[];
  onChange: (next: AssetAllocation[]) => void;
}) {
  const total = allocations.reduce((sum, a) => sum + a.percentage, 0);
  const isValid = allocations.length === 0 || Math.abs(total - 100) < 0.01;

  const update = (i: number, patch: Partial<AssetAllocation>) => {
    onChange(allocations.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const remove = (i: number) => onChange(allocations.filter((_, idx) => idx !== i));
  const add = () => onChange([...allocations, { name: "", percentage: 0 }]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-sabbi-neutral-500">{label}</span>
        {allocations.length > 0 && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              isValid ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {total.toFixed(0)}%
          </span>
        )}
      </div>

      {allocations.length === 0 && (
        <p className="text-xs text-sabbi-neutral-400">Sin asignación</p>
      )}

      <div className="flex flex-col gap-1.5">
        {allocations.map((a, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={a.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Nombre"
              className="flex-1 rounded-lg border border-sabbi-neutral-200 px-2 py-1 text-sm outline-none focus:border-sabbi-primary"
            />
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

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-sabbi-neutral-500">{label}</label>
      {children}
    </div>
  );
}

// -- Product card -------------------------------------------------------------

function ProductCard({
  row,
  rawRow,
  onUpdate,
}: {
  row: EditableFichaRow;
  rawRow: FichaEnrichedRow;
  onUpdate: (patch: Partial<EditableFichaRow>) => void;
}) {
  const isUnmapped = row.assetClass === "";
  const source = resolveRowSource(rawRow);
  const badge = SOURCE_BADGES[source];

  return (
    <div
      className={`rounded-xl border p-4 ${
        isUnmapped
          ? "border-amber-300 bg-amber-50/50"
          : "border-sabbi-neutral-200 bg-white"
      }`}
    >
      {/* Header: name + source badge */}
      <div className="mb-4 flex items-start gap-3">
        <input
          value={row.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="flex-1 rounded-lg border border-sabbi-neutral-200 px-3 py-2 text-sm font-medium text-sabbi-neutral-900 outline-none focus:border-sabbi-primary"
        />
        <span
          className={`mt-1 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      {/* Body: two-column grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {/* Left column: simple fields */}
        <div className="flex flex-col gap-3">
          <Field label="Clase de activo">
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

          <div className="grid grid-cols-2 gap-3">
            <Field label="Comisión">
              <input
                value={row.commission}
                onChange={(e) => onUpdate({ commission: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Moneda">
              <input
                value={row.currency}
                onChange={(e) => onUpdate({ currency: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>

          <Field label="Administrador">
            <input
              value={row.administrator}
              onChange={(e) => onUpdate({ administrator: e.target.value })}
              className={inputClass}
            />
          </Field>

          <Field label="Liquidez">
            <input
              value={row.liquidity}
              onChange={(e) => onUpdate({ liquidity: e.target.value })}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Rent. Min">
              <input
                value={row.returnRateMin}
                onChange={(e) => onUpdate({ returnRateMin: e.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="Rent. Max">
              <input
                value={row.returnRateMax}
                onChange={(e) => onUpdate({ returnRateMax: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </div>

        {/* Right column: allocation editors */}
        <div className="flex flex-col gap-4">
          <AllocationEditor
            label="Foco geográfico"
            allocations={row.geographicFocus}
            onChange={(next) => onUpdate({ geographicFocus: next })}
          />
          <div className="border-t border-sabbi-neutral-100 pt-4">
            <AllocationEditor
              label="Subyacente"
              allocations={row.underlying}
              onChange={(next) => onUpdate({ underlying: next })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Main review component ----------------------------------------------------

export default function ReviewTable({ rows, userId, onConfirmed }: ReviewTableProps) {
  const [editableRows, setEditableRows] = useState<EditableFichaRow[]>(() =>
    rows.map(toEditableRow),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateRow = (index: number, patch: Partial<EditableFichaRow>) => {
    setEditableRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  };

  const confirmDisabled =
    isSubmitting || editableRows.length === 0 || hasUnmappedRow(editableRows);

  const handleConfirm = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const products = buildConfirmProducts(editableRows);
      const res = await fetchWithAuth("/api/admin/ficha-patrimonial/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, products }),
      });

      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          // not JSON
        }
        throw new Error(
          extractErrorDetail(
            body,
            `No se pudo confirmar la importación (status ${res.status})`,
          ),
        );
      }

      const data: { created_count: number } = await res.json();
      onConfirmed(data.created_count);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1">
        {editableRows.map((row, index) => (
          <ProductCard
            key={row.excelRow}
            row={row}
            rawRow={rows[index]}
            onUpdate={(patch) => updateRow(index, patch)}
          />
        ))}
      </div>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-sabbi-neutral-600">
          {editableRows.length} producto{editableRows.length !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          disabled={confirmDisabled}
          onClick={() => void handleConfirm()}
          className="rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sabbi-primary-hover disabled:opacity-60"
        >
          {isSubmitting ? "Confirmando…" : "Confirmar"}
        </button>
      </div>
    </div>
  );
}

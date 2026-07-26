"use client";

import { useEffect, useState, type FC, type ReactNode } from "react";
import { XIcon } from "@/components/icons/Icons";
import { useToast } from "@/components/ui/Toast";
import {
  ASSET_CLASS_META,
  ASSET_CLASS_ORDER,
  ASSET_CLASS_SUBCATEGORIES,
  primaryAssetClass,
} from "@/lib/categories";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { AssetAllocation, AssetClass, Product } from "@/lib/portfolio-types";

export interface EditProductModalProps {
  isOpen: boolean;
  /** `null` when adding a new product. */
  product: Product | null;
  /** Pre-selected asset class when adding from a specific section. */
  defaultAssetClass: AssetClass | null;
  onClose: () => void;
  /** Called after a successful save, before the modal closes. Should refetch. */
  onSaved: () => void | Promise<void>;
}

/** One asset-class allocation row — same shape as `CompositionRow`, reused for the allocation editor. */
type AssetClassRow = CompositionRow;

interface CompositionRow {
  key: string;
  name: string;
  percentage: string;
}

let rowKeySeq = 0;
const nextRowKey = () => `row-${++rowKeySeq}`;

interface SubcategoryOption {
  value: string;
  group: string;
}

function getSubcategoryLeaves(assetClass: AssetClass): SubcategoryOption[] {
  return (ASSET_CLASS_SUBCATEGORIES[assetClass] ?? []).flatMap(({ group, leaves }) =>
    leaves.map((leaf) => ({
      value: leaf === group ? leaf : `${group} ${leaf}`,
      group,
    })),
  );
}

const inputClass =
  "rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

export const EditProductModal: FC<EditProductModalProps> = ({
  isOpen,
  product,
  defaultAssetClass,
  onClose,
  onSaved,
}) => {
  const isEditing = product != null;
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [assetClassRows, setAssetClassRows] = useState<AssetClassRow[]>([]);
  const [rows, setRows] = useState<CompositionRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    if (product) {
      setName(product.name);
      setProvider(product.provider);
      setAmount(String(product.amount));
      setAssetClassRows(
        product.asset_class.length
          ? product.asset_class.map((a) => ({
              key: nextRowKey(),
              name: a.name,
              percentage: String(a.percentage),
            }))
          : [{ key: nextRowKey(), name: defaultAssetClass ?? "inversiones_directas", percentage: "100" }],
      );
      setRows(
        product.underlying.length
          ? product.underlying.map((a) => ({
              key: nextRowKey(),
              name: a.name,
              percentage: String(a.percentage),
            }))
          : [],
      );
    } else {
      setName("");
      setProvider("");
      setAmount("");
      setAssetClassRows([
        { key: nextRowKey(), name: defaultAssetClass ?? "inversiones_directas", percentage: "100" },
      ]);
      setRows([]);
    }
  }, [isOpen, product, defaultAssetClass]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const total = rows.reduce((sum, row) => sum + (parseFloat(row.percentage) || 0), 0);
  const isTotalValid = rows.length > 0 && Math.abs(total - 100) < 0.5;

  const updateRow = (key: string, patch: Partial<CompositionRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeRow = (key: string) => setRows((prev) => prev.filter((row) => row.key !== key));

  // Subcategory taxonomy is keyed by the product's PRIMARY asset class
  // (highest allocated percentage) — composition itself is independent of
  // how many asset classes the product spans.
  const primaryAC = primaryAssetClass(
    assetClassRows.map((row) => ({ name: row.name, percentage: parseFloat(row.percentage) || 0 })),
  );
  const allLeaves = getSubcategoryLeaves(primaryAC);
  const usedNames = new Set(rows.map((r) => r.name));
  const selectableLeaves = allLeaves.filter((l) => !usedNames.has(l.value));

  const groupedSelectable = selectableLeaves.reduce<Record<string, SubcategoryOption[]>>(
    (acc, leaf) => {
      (acc[leaf.group] ??= []).push(leaf);
      return acc;
    },
    {},
  );

  const addLeaf = (value: string) => {
    setRows((prev) => [...prev, { key: nextRowKey(), name: value, percentage: "" }]);
  };

  // Asset class allocation editor helpers — mirrors the composition editor
  // above but operates over the 6 asset class taxonomy keys instead of
  // subcategory leaves.
  const assetClassTotal = assetClassRows.reduce(
    (sum, row) => sum + (parseFloat(row.percentage) || 0),
    0,
  );
  const isAssetClassTotalValid =
    assetClassRows.length > 0 && Math.abs(assetClassTotal - 100) < 0.5;

  const updateAssetClassRow = (key: string, patch: Partial<AssetClassRow>) => {
    setAssetClassRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeAssetClassRow = (key: string) =>
    setAssetClassRows((prev) => prev.filter((row) => row.key !== key));

  const usedAssetClasses = new Set(assetClassRows.map((r) => r.name));
  const selectableAssetClasses = ASSET_CLASS_ORDER.filter((ac) => !usedAssetClasses.has(ac));

  const addAssetClass = (value: AssetClass) => {
    setAssetClassRows((prev) => [...prev, { key: nextRowKey(), name: value, percentage: "" }]);
  };

  const handleSave = async () => {
    setFormError(null);
    const trimmedName = name.trim();
    const parsedAmount = parseFloat(amount);
    const composition: AssetAllocation[] = rows
      .filter((row) => parseFloat(row.percentage) > 0)
      .map((row) => ({ name: row.name, percentage: parseFloat(row.percentage) }));
    const assetClassAlloc: AssetAllocation[] = assetClassRows
      .filter((row) => parseFloat(row.percentage) > 0)
      .map((row) => ({ name: row.name, percentage: parseFloat(row.percentage) }));

    if (!trimmedName) {
      setFormError("Ingresa un nombre");
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      setFormError("Ingresa un monto");
      return;
    }
    if (assetClassAlloc.length === 0) {
      setFormError("Agrega al menos una clase de activo");
      return;
    }
    const assetClassAllocTotal = assetClassAlloc.reduce((s, c) => s + c.percentage, 0);
    if (Math.abs(assetClassAllocTotal - 100) >= 0.5) {
      setFormError(
        `La clase de activo debe sumar 100% (actual: ${assetClassAllocTotal.toFixed(1)}%)`,
      );
      return;
    }
    if (composition.length === 0) {
      setFormError("Agrega al menos una subcategoría a la composición");
      return;
    }
    const compositionTotal = composition.reduce((s, c) => s + c.percentage, 0);
    if (Math.abs(compositionTotal - 100) >= 0.5) {
      setFormError(`La composición debe sumar 100% (actual: ${compositionTotal.toFixed(1)}%)`);
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: trimmedName,
        provider: provider.trim(),
        amount: parsedAmount,
        asset_class: assetClassAlloc,
        underlying: composition,
      };
      const res = isEditing
        ? await fetchWithAuth(`/api/products/${product.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetchWithAuth("/api/portfolio/me/products", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) throw new Error(`No se pudo guardar (status ${res.status})`);
      await onSaved();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo guardar el producto";
      setFormError(msg);
      toast(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-background shadow-xl sm:max-w-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-sabbi-neutral-900">
            {isEditing ? "Editar producto" : "Agregar producto"}
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

        <div className="grid flex-1 gap-6 overflow-y-auto p-5 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-wide text-sabbi-neutral-600 uppercase">
              Datos del producto
            </p>
            <Field label="Nombre del producto">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Proveedor">
              <input
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Monto (USD)">
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={inputClass}
              />
            </Field>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-sabbi-neutral-700">Clase de activo</p>

              {selectableAssetClasses.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) addAssetClass(e.target.value as AssetClass);
                  }}
                  className={inputClass}
                >
                  <option value="" disabled>
                    Agregar clase de activo...
                  </option>
                  {selectableAssetClasses.map((ac) => (
                    <option key={ac} value={ac}>
                      {ASSET_CLASS_META[ac].label}
                    </option>
                  ))}
                </select>
              )}

              {assetClassRows.length > 0 && (
                <div className="flex flex-col gap-2">
                  {assetClassRows.map((row) => (
                    <div key={row.key} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-medium text-sabbi-neutral-900">
                        {ASSET_CLASS_META[row.name as AssetClass]?.label ?? row.name}
                      </span>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="any"
                          placeholder="%"
                          value={row.percentage}
                          onChange={(event) =>
                            updateAssetClassRow(row.key, { percentage: event.target.value })
                          }
                          className={`${inputClass} w-20 text-right`}
                        />
                        <span className="text-xs text-sabbi-neutral-500">%</span>
                      </div>
                      <button
                        type="button"
                        aria-label={`Eliminar ${ASSET_CLASS_META[row.name as AssetClass]?.label ?? row.name}`}
                        onClick={() => removeAssetClassRow(row.key)}
                        className="flex size-7 shrink-0 items-center justify-center rounded-md text-sabbi-neutral-500 hover:bg-sabbi-neutral-100"
                      >
                        <XIcon size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {assetClassRows.length > 0 && (
                <p
                  className={`text-sm font-medium ${isAssetClassTotalValid ? "text-emerald-600" : "text-red-600"}`}
                >
                  Total: {assetClassTotal.toFixed(1)}%
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-wide text-sabbi-neutral-600 uppercase">
              Composición por subcategoría
            </p>

            {selectableLeaves.length > 0 && (
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) addLeaf(e.target.value);
                }}
                className={inputClass}
              >
                <option value="" disabled>
                  Agregar subcategoría...
                </option>
                {Object.entries(groupedSelectable).map(([group, leaves]) => (
                  <optgroup key={group} label={group}>
                    {leaves.map((leaf) => (
                      <option key={leaf.value} value={leaf.value}>
                        {leaf.value}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}

            {rows.length > 0 && (
              <div className="flex flex-col gap-2">
                {rows.map((row) => (
                  <div key={row.key} className="flex items-center gap-2">
                    <span className="flex-1 truncate text-sm font-medium text-sabbi-neutral-900">
                      {row.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="any"
                        placeholder="%"
                        value={row.percentage}
                        onChange={(event) =>
                          updateRow(row.key, { percentage: event.target.value })
                        }
                        className={`${inputClass} w-20 text-right`}
                      />
                      <span className="text-xs text-sabbi-neutral-500">%</span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Eliminar ${row.name}`}
                      onClick={() => removeRow(row.key)}
                      className="flex size-7 shrink-0 items-center justify-center rounded-md text-sabbi-neutral-500 hover:bg-sabbi-neutral-100"
                    >
                      <XIcon size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {rows.length === 0 && (
              <p className="text-xs text-sabbi-neutral-500">
                Selecciona subcategorías para definir la composición del producto.
              </p>
            )}

            {rows.length > 0 && (
              <p
                className={`text-sm font-medium ${isTotalValid ? "text-emerald-600" : "text-red-600"}`}
              >
                Total: {total.toFixed(1)}%
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-sabbi-neutral-200 px-5 py-4">
          <p className="min-h-4 text-sm text-red-600">{formError}</p>
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
              disabled={isSaving}
              onClick={() => void handleSave()}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              Guardar producto
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="text-xs font-medium text-sabbi-neutral-700">{label}</span>
    {children}
  </label>
);

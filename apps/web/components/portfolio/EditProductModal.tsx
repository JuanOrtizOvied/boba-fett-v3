"use client";

import { useEffect, useState, type FC, type ReactNode } from "react";
import { PlusIcon, XIcon } from "@/components/icons/Icons";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import type { AssetAllocation, Category, Product } from "@/lib/portfolio-types";

export interface EditProductModalProps {
  isOpen: boolean;
  /** `null` when adding a new product. */
  product: Product | null;
  /** Pre-selected category when adding from a specific section. */
  defaultCategory: Category | null;
  portfolioId: string;
  onClose: () => void;
  /** Called after a successful save, before the modal closes. Should refetch. */
  onSaved: () => void | Promise<void>;
}

interface CompositionRow {
  key: string;
  name: string;
  percentage: string;
}

let rowKeySeq = 0;
const nextRowKey = () => `row-${++rowKeySeq}`;
const emptyRow = (): CompositionRow => ({ key: nextRowKey(), name: "", percentage: "" });

const inputClass =
  "rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

/**
 * Two-column overlay modal for creating/editing a product. Closes on
 * Escape or overlay click without persisting changes. Validates required
 * fields and shows a real-time (non-blocking) percentage-total indicator.
 * `product-cards-crud.spec.md` → "Editar producto abre modal de dos columnas",
 * "Validación de porcentajes en modal de edición", "Agregar/Eliminar asset
 * class en modal de edición", "Guardar cambios en modal de edición",
 * "Cancelar edición en modal", "Validación de campos requeridos al guardar",
 * "Agregar producto manualmente", "CRUD manual via REST API (sin LLM)".
 */
export const EditProductModal: FC<EditProductModalProps> = ({
  isOpen,
  product,
  defaultCategory,
  portfolioId,
  onClose,
  onSaved,
}) => {
  const isEditing = product != null;

  const [name, setName] = useState("");
  const [provider, setProvider] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>(defaultCategory ?? "directas");
  const [rows, setRows] = useState<CompositionRow[]>([emptyRow()]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setFormError(null);
    if (product) {
      setName(product.name);
      setProvider(product.provider);
      setAmount(String(product.amount));
      setCategory(product.category);
      setRows(
        product.composition.length
          ? product.composition.map((a) => ({
              key: nextRowKey(),
              name: a.name,
              percentage: String(a.percentage),
            }))
          : [emptyRow()],
      );
    } else {
      setName("");
      setProvider("");
      setAmount("");
      setCategory(defaultCategory ?? "directas");
      setRows([emptyRow()]);
    }
  }, [isOpen, product, defaultCategory]);

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
  const isTotalValid = Math.abs(total - 100) < 0.01;

  const updateRow = (key: string, patch: Partial<CompositionRow>) => {
    setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (key: string) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((row) => row.key !== key) : prev));

  const handleSave = async () => {
    setFormError(null);
    const trimmedName = name.trim();
    const parsedAmount = parseFloat(amount);
    const composition: AssetAllocation[] = rows
      .filter((row) => row.name.trim() && parseFloat(row.percentage) > 0)
      .map((row) => ({ name: row.name.trim(), percentage: parseFloat(row.percentage) }));

    if (!trimmedName) {
      setFormError("Ingresa un nombre");
      return;
    }
    if (!parsedAmount || parsedAmount <= 0) {
      setFormError("Ingresa un monto");
      return;
    }
    if (composition.length === 0) {
      setFormError("Agrega al menos un asset class");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: trimmedName,
        provider: provider.trim(),
        amount: parsedAmount,
        category,
        composition,
      };
      const res = isEditing
        ? await fetch(`/api/products/${product.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/portfolio/${portfolioId}/products`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) throw new Error(`No se pudo guardar (status ${res.status})`);
      await onSaved();
      onClose();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "No se pudo guardar el producto");
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
            <Field label="Categoría">
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as Category)}
                className={inputClass}
              >
                {CATEGORY_ORDER.map((cat) => (
                  <option key={cat} value={cat}>
                    {CATEGORY_META[cat].label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold tracking-wide text-sabbi-neutral-600 uppercase">
              Composición por asset class
            </p>
            <div className="flex flex-col gap-2">
              {rows.map((row) => (
                <div key={row.key} className="flex items-center gap-2">
                  <input
                    placeholder="Nombre"
                    value={row.name}
                    onChange={(event) => updateRow(row.key, { name: event.target.value })}
                    className={`${inputClass} flex-1`}
                  />
                  <input
                    type="number"
                    min={0}
                    max={100}
                    placeholder="%"
                    value={row.percentage}
                    onChange={(event) =>
                      updateRow(row.key, { percentage: event.target.value })
                    }
                    className={`${inputClass} w-20`}
                  />
                  <button
                    type="button"
                    aria-label="Eliminar fila"
                    onClick={() => removeRow(row.key)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-md text-sabbi-neutral-500 hover:bg-sabbi-neutral-100"
                  >
                    <XIcon size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addRow}
              className="flex w-fit items-center gap-1.5 rounded-lg border border-dashed border-sabbi-neutral-300 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-600 hover:border-sabbi-primary hover:text-sabbi-primary"
            >
              <PlusIcon size={14} />
              Agregar asset class
            </button>
            <p
              className={`text-sm font-medium ${isTotalValid ? "text-emerald-600" : "text-red-600"}`}
            >
              Total: {total.toFixed(1)}%
            </p>
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

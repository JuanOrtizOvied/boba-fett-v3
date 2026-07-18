"use client";

import { useEffect, useState, type FC, type ReactNode } from "react";
import { EditIcon, TrashIcon, XIcon } from "@/components/icons/Icons";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { Category, CatalogProduct } from "@/lib/portfolio-types";
import { useToast } from "@/components/ui/Toast";

const CATALOG_COLUMNS: { key: keyof CatalogProduct; label: string }[] = [
  { key: "category", label: "Categoría" },
  { key: "subcategory", label: "Subcategoría" },
  { key: "asset_class", label: "Clase de activo" },
  { key: "geographic_focus", label: "Foco geográfico" },
  { key: "underlying", label: "Subyacente" },
  { key: "commission", label: "Comisión" },
  { key: "currency", label: "Moneda" },
  { key: "administrator", label: "Administrador" },
  { key: "manager", label: "Gestor" },
  { key: "liquidity", label: "Liquidez" },
  { key: "return_rate", label: "Rendimiento" },
];

export default function AdminCatalogPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<CatalogProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<CatalogProduct | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/catalog/entries");
        if (!res.ok) {
          throw new Error(
            `No se pudo cargar el catálogo (status ${res.status})`,
          );
        }
        const data: CatalogProduct[] = await res.json();
        setEntries(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, []);

  const handleDelete = async (id: number) => {
    const previous = entries ?? [];
    setDeletingId(id);
    setConfirmDeleteId(null);

    try {
      const res = await fetchWithAuth(`/api/admin/catalog/entries/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`No se pudo eliminar la entrada (status ${res.status})`);
      }
      await new Promise((r) => setTimeout(r, 400));
      setEntries(previous.filter((entry) => entry.id !== id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setDeletingId(null);
    }
  };

  const handleUpdated = (updated: CatalogProduct) => {
    setEntries((prev) =>
      (prev ?? []).map((e) => (e.id === updated.id ? updated : e)),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">Catálogo</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {entries === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : entries && entries.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">
          No hay entradas en el catálogo.
        </p>
      ) : (
        entries && (
          <div className="max-h-[75vh] overflow-auto rounded-xl border border-sabbi-neutral-200">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-30 bg-sabbi-neutral-50 text-xs font-medium tracking-wide text-sabbi-neutral-600 uppercase">
                <tr>
                  <th className="sticky top-0 left-0 z-40 bg-sabbi-neutral-50 px-4 py-2 whitespace-nowrap after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-sabbi-neutral-200">
                    Nombre
                  </th>
                  {CATALOG_COLUMNS.map((column) => (
                    <th key={column.key} className="px-4 py-2 whitespace-nowrap">
                      {column.label}
                    </th>
                  ))}
                  <th className="sticky top-0 right-0 z-40 bg-sabbi-neutral-50 px-4 py-2 text-center whitespace-nowrap before:absolute before:top-0 before:left-0 before:h-full before:w-px before:bg-sabbi-neutral-200">
                    Opciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => {
                  const isOdd = index % 2 === 1;
                  const rowBg = isOdd ? "bg-sabbi-neutral-50" : "bg-white";
                  const hoverBg = "group-hover:bg-[#f0fcd4]";
                  const isDeleting = deletingId === entry.id;
                  return (
                    <tr
                      key={entry.id}
                      className={`group transition-colors ${isDeleting ? "animate-row-delete" : `${rowBg} ${hoverBg}`}`}
                    >
                      <td
                        className={`sticky left-0 z-10 px-4 py-2 font-medium whitespace-nowrap text-sabbi-neutral-900 after:absolute after:top-0 after:right-0 after:h-full after:w-px after:bg-sabbi-neutral-200 ${isDeleting ? "" : `${rowBg} ${hoverBg}`}`}
                      >
                        {entry.name || "—"}
                      </td>
                      {CATALOG_COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          className="px-4 py-2 whitespace-nowrap text-sabbi-neutral-900"
                        >
                          {entry[column.key] || "—"}
                        </td>
                      ))}
                      <td
                        className={`sticky right-0 z-10 px-4 py-2 whitespace-nowrap before:absolute before:top-0 before:left-0 before:h-full before:w-px before:bg-sabbi-neutral-200 ${isDeleting ? "" : `${rowBg} ${hoverBg}`}`}
                      >
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            title="Editar"
                            onClick={() => setEditingEntry(entry)}
                            className="rounded-md p-1.5 text-sabbi-neutral-500 transition-colors hover:bg-sabbi-neutral-100 hover:text-sabbi-neutral-900"
                          >
                            <EditIcon size={16} />
                          </button>
                          <button
                            type="button"
                            title="Eliminar"
                            disabled={deletingId === entry.id}
                            onClick={() => setConfirmDeleteId(entry.id)}
                            className="rounded-md p-1.5 text-sabbi-neutral-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                          >
                            <TrashIcon size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      <ConfirmDeleteDialog
        open={confirmDeleteId !== null}
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId !== null) void handleDelete(confirmDeleteId);
        }}
      />

      <EditCatalogModal
        entry={editingEntry}
        onClose={() => setEditingEntry(null)}
        onSaved={handleUpdated}
      />
    </div>
  );
}

// -- Confirm delete dialog ------------------------------------------------

function ConfirmDeleteDialog({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="animate-modal-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-sabbi-neutral-900">
          Eliminar entrada
        </h3>
        <p className="mt-2 text-sm text-sabbi-neutral-600">
          Esta acción no se puede deshacer. ¿Confirmar eliminación?
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

// -- Edit catalog modal ---------------------------------------------------

const EDITABLE_FIELDS: { key: string; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "category", label: "Categoría" },
  { key: "subcategory", label: "Subcategoría" },
  { key: "asset_class", label: "Clase de activo" },
  { key: "geographic_focus", label: "Foco geográfico" },
  { key: "underlying", label: "Subyacente" },
  { key: "commission", label: "Comisión" },
  { key: "currency", label: "Moneda" },
  { key: "administrator", label: "Administrador" },
  { key: "manager", label: "Gestor" },
  { key: "liquidity", label: "Liquidez" },
  { key: "return_rate", label: "Rendimiento" },
];

function EditCatalogModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: CatalogProduct | null;
  onClose: () => void;
  onSaved: (updated: CatalogProduct) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!entry) return;
    const initial: Record<string, string> = {};
    for (const field of EDITABLE_FIELDS) {
      initial[field.key] = String(entry[field.key as keyof CatalogProduct] ?? "");
    }
    setForm(initial);
    setErrorMessage(null);
  }, [entry]);

  useEffect(() => {
    if (!entry) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [entry, onClose]);

  if (!entry) return null;

  const handleSave = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const patch: Record<string, string> = {};
      for (const field of EDITABLE_FIELDS) {
        const current = form[field.key]?.trim() ?? "";
        const original = String(entry[field.key as keyof CatalogProduct] ?? "");
        if (current !== original) {
          patch[field.key] = current;
        }
      }
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      const res = await fetchWithAuth(`/api/admin/catalog/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        throw new Error(`No se pudo actualizar (status ${res.status})`);
      }
      const updated: CatalogProduct = await res.json();
      onSaved(updated);
      onClose();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "No se pudo actualizar",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-sabbi-neutral-900">
            Editar entrada del catálogo
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

        <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          {EDITABLE_FIELDS.map((field) =>
            field.key === "category" ? (
              <ModalField key={field.key} label={field.label}>
                <select
                  value={form[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className={modalInputClass}
                >
                  {CATEGORY_ORDER.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_META[cat].label}
                    </option>
                  ))}
                </select>
              </ModalField>
            ) : (
              <ModalField key={field.key} label={field.label}>
                <input
                  value={form[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className={modalInputClass}
                />
              </ModalField>
            ),
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-sabbi-neutral-200 px-5 py-4">
          <p className="min-h-4 text-sm text-red-600">{errorMessage}</p>
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
              onClick={() => void handleSave()}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const modalInputClass =
  "rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

const ModalField: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="text-xs font-medium text-sabbi-neutral-700">{label}</span>
    {children}
  </label>
);

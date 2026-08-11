import React, { useEffect, useState } from "react";
import { XIcon } from "@/components/icons/Icons";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { CatalogProduct } from "@/lib/portfolio-types";
import { useToast } from "@/components/ui/Toast";

// --- Shared UI Constants (Mirrored from EditCatalogModal) ---
// --- Shared UI Constants (Mirrored from EditCatalogModal) ---
const EDITABLE_FIELDS: { key: string; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "alternative_names", label: "Nombres alternativos" },
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

const INITIAL_FORM_STATE: Record<string, string> = {};
EDITABLE_FIELDS.forEach(field => {
  INITIAL_FORM_STATE[field.key] = "";
});

const PERCENTAGE_FIELDS = ["underlying", "geographic_focus", "asset_class"];

const modalInputClass =
  "rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

const ModalField: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="flex flex-col gap-1 text-sm">
    <span className="text-xs font-medium text-sabbi-neutral-700">{label}</span>
    {children}
  </label>
);

export default function CreateCatalogModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void; 
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>(INITIAL_FORM_STATE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize form with empty strings (EMPTY_FORM logic)
  useEffect(() => {
    const initial: Record<string, string> = {};
    for (const field of EDITABLE_FIELDS) {
      initial[field.key] = "";
    }
    setForm(initial);
    setErrorMessage(null);
  }, []);

  const handleSave = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const patch: Record<string, any> = {};

      for (const field of EDITABLE_FIELDS) {
        const value = form[field.key] ?? "";

        if (field.key === "alternative_names") {
          const current = value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
          if (current.length > 0) {
            patch[field.key] = current;
          }
        } else if (PERCENTAGE_FIELDS.includes(field.key)) {
          const lines = value
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);

          if (lines.length === 0) {
            // Specific Logic: asset_class is mandatory, others are optional
            if (field.key === "asset_class") {
              throw new Error(`Clase de activo debe contener al menos una asignación.`);
            }
            // For underlying/geographic_focus, we simply skip them if empty
            continue; 
          } else {
            const parsedLines = lines.map((line) => {
              // Regex now requires the % sign as per blueprint
              const match = line.match(/^(.+?):\s*(\d+(?:\.\d+)?)%$/);
              if (!match) {
                throw new Error(`Error de formato en ${field.label}: "${line}". Use el formato "Nombre: 50%".`);
              }
              const percentage = parseFloat(match[2]);
              
              if (percentage < 0 || percentage > 100) {
                throw new Error(`${field.label}: el porcentaje debe estar entre 0% y 100%.`);
              }

              return {
                name: match[1].trim(),
                percentage,
              };
            });

            // Validation: Sum must be 100% (±0.5 tolerance per backend audit)
            const total = parsedLines.reduce((acc, curr) => acc + curr.percentage, 0);
            if (Math.abs(total - 100) > 0.5) {
              throw new Error(
                `${field.label} debe sumar 100% (Actual: ${total.toFixed(1)}%)`
              );
            }

            patch[field.key] = parsedLines;
          }
        } else {
          const trimmed = value.trim();
          if (trimmed !== "") {
            patch[field.key] = trimmed;
          }
        }
      }

      const res = await fetchWithAuth(`/api/admin/catalog/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });

      if (!res.ok) {
        if (res.status === 409) {
          throw new Error("Este producto ya existe en el catálogo.");
        }
        throw new Error(`No se pudo crear el producto (status ${res.status})`);
      }

      onSaved(); // Trigger refetch in page.tsx
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
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
            Crear nueva entrada del catálogo
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
            field.key === "alternative_names" ? (
              <ModalField key={field.key} label={field.label}>
                <textarea
                  rows={3}
                  placeholder="Un nombre por línea"
                  value={form[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className={modalInputClass + " resize-y"}
                />
              </ModalField>
            ) : PERCENTAGE_FIELDS.includes(field.key) ? (
              <ModalField key={field.key} label={field.label}>
                <textarea
                  rows={3}
                  placeholder="Nombre: porcentaje% (uno por línea)"
                  value={form[field.key] ?? ""}
                  onChange={(e) => updateField(field.key, e.target.value)}
                  className={modalInputClass + " resize-y"}
                />
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
              {isSubmitting ? "Creando..." : "Crear"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

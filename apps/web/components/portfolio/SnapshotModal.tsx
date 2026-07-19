"use client";

import { useEffect, useState, type FC } from "react";
import { XIcon } from "@/components/icons/Icons";
import { useToast } from "@/components/ui/Toast";
import type { Snapshot } from "@/lib/usePortfolioVersioning";

export interface SnapshotModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called on submit. Should reject on failure so the modal can surface the error. */
  onCreate: (name: string, description?: string) => Promise<Snapshot>;
}

const inputClass =
  "rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

/**
 * Overlay modal for saving the current portfolio as a named, immutable
 * snapshot. Follows `EditProductModal.tsx`'s conventions — Escape/overlay
 * click closes without saving, required name input, optional description.
 * Empty-name submission is blocked client-side before any request is sent.
 * `snapshots.spec.md` → SNAP-007 "Snapshot Creation UI".
 */
export const SnapshotModal: FC<SnapshotModalProps> = ({ isOpen, onClose, onCreate }) => {
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    setDescription("");
    setFormError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async () => {
    setFormError(null);
    const trimmedName = name.trim();

    if (!trimmedName) {
      setFormError("Ingresa un nombre para la versión");
      return;
    }

    setIsSaving(true);
    try {
      await onCreate(trimmedName, description.trim());
      toast(`Versión "${trimmedName}" guardada`, "success");
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo guardar la versión";
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
        className="animate-modal-panel flex w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-background shadow-xl sm:max-w-md"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-sabbi-neutral-900">
            Guardar versión del portafolio
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

        <div className="flex flex-col gap-3 p-5">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-sabbi-neutral-700">Nombre</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              placeholder="Ej. Pre-revisión Q3"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-sabbi-neutral-700">
              Descripción (opcional)
            </span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className={`${inputClass} resize-none`}
            />
          </label>
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
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

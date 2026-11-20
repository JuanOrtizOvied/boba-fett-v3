"use client";

import { useEffect, useId, useState } from "react";
import {
  KIND_TEXT,
  deleteEntityScore,
  describeWriteError,
  type EntityKind,
  type EntityScore,
} from "@/lib/entityScores";

interface EntityScoreDeleteModalProps {
  kind: EntityKind;
  entity: EntityScore;
  onClose: () => void;
  /** Called once the server deleted the row; the page refreshes and says so. */
  onDeleted: (entity: EntityScore) => void;
  /** Called when the server says the row is already gone, so the page can refresh. */
  onGone: () => void;
}

/** Asks before a soft delete. The row stays in the table and can be restored. */
export function EntityScoreDeleteModal({
  kind,
  entity,
  onClose,
  onDeleted,
  onGone,
}: EntityScoreDeleteModalProps) {
  const titleId = useId();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => opener?.focus?.(), [opener]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, deleting]);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteEntityScore(kind, entity.id);
      onDeleted(entity);
    } catch (err) {
      const described = describeWriteError(err, kind);
      setError(described.form ?? "No se pudo eliminar. Inténtalo de nuevo.");
      setDeleting(false);
      if (described.gone) onGone();
    }
  };

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!deleting) onClose();
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-modal-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-base font-semibold text-sabbi-neutral-900">
          ¿Eliminar {entity.name}?
        </h2>
        <p className="mt-2 text-sm text-sabbi-neutral-600">
          Dejará de aparecer en la lista y en las opciones del catálogo. Los productos que ya usan
          este {KIND_TEXT[kind].singular} no cambian, y puedes restaurarlo desde &quot;Mostrar
          eliminados&quot;.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void confirm()}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? "Eliminando..." : "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}

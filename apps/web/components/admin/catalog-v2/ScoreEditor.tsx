"use client";

import { useState } from "react";
import { EditIcon } from "@/components/icons/Icons";
import { formatV2Score } from "@/lib/catalogV2Format";

export const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * The score of a manager or an administrator, with a pencil to change it. It is
 * the only thing of v2 that is edited in the web: the workbook has no column for
 * it. The score belongs to the entity, so changing it changes it in every
 * product that entity appears in, and the editor says so.
 *
 * `onSave` rejects with an `Error` whose message is shown under the editor.
 */
export function ScoreEditor({
  entityName,
  score,
  onSave,
}: {
  entityName: string;
  score: number | null;
  onSave: (score: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setDraft(score === null ? "" : String(score));
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(draft === "" ? null : Number(draft));
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className={score === null ? "text-amber-700" : ""}>{formatV2Score(score)}</span>
        <button
          type="button"
          title="Editar score"
          aria-label={`Editar score de ${entityName}`}
          onClick={open}
          className="rounded-md p-1 text-sabbi-neutral-500 transition-colors hover:bg-sabbi-neutral-100 hover:text-sabbi-neutral-900"
        >
          <EditIcon size={14} />
        </button>
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="inline-flex items-center gap-1.5">
        <select
          aria-label={`Score de ${entityName}`}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          className="rounded-md border border-sabbi-neutral-200 bg-white px-1.5 py-1 text-sm"
        >
          <option value="">Sin score</option>
          {SCORES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="rounded-md bg-sabbi-neutral-900 px-2 py-1 text-xs font-medium text-white hover:bg-sabbi-neutral-700 disabled:opacity-50"
        >
          {saving ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => setEditing(false)}
          className="rounded-md px-2 py-1 text-xs font-medium text-sabbi-neutral-600 hover:bg-sabbi-neutral-100 disabled:opacity-50"
        >
          Cancelar
        </button>
      </span>
      <span className="text-xs text-sabbi-neutral-500">
        Cambia el score de {entityName} en todos sus productos.
      </span>
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
    </span>
  );
}

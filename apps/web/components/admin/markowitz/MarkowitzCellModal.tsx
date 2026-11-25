"use client";

import { useId, useState } from "react";
import {
  describeCellError,
  formatValue,
  setMarkowitzCell,
  valueError,
  valueFromText,
  valueToText,
  type MarkowitzMatrix,
  type SavedCell,
} from "@/lib/markowitz";
import { INPUT, INPUT_BAD, MarkowitzModal } from "@/components/admin/markowitz/MarkowitzModal";

interface MarkowitzCellModalProps {
  matrix: MarkowitzMatrix;
  /** The row asset and the column asset, by position in the matrix. Never the same. */
  rowIndex: number;
  colIndex: number;
  onClose: () => void;
  /** Called once the server saved; the page refreshes and says so. */
  onSaved: (cells: SavedCell[]) => void;
  /** Called when the server says an asset is gone: the page reads the matrix again and
   * tells the user why the form went away. */
  onGone: (message: string) => void;
}

/** Edit one correlation: the row asset against the column asset. By default the opposite
 * cell gets the same value, because a correlation is normally the same both ways; turning
 * "ambas direcciones" off writes just this one (the way to fix a pair that differs). */
export function MarkowitzCellModal({
  matrix,
  rowIndex,
  colIndex,
  onClose,
  onSaved,
  onGone,
}: MarkowitzCellModalProps) {
  const valueId = useId();
  const bothId = useId();
  const row = matrix.assets[rowIndex];
  const col = matrix.assets[colIndex];
  const current = matrix.values[rowIndex][colIndex];
  const opposite = matrix.values[colIndex][rowIndex];
  const differs = current !== null && opposite !== null && current !== opposite;

  const [text, setText] = useState(current === null ? "" : valueToText(current));
  const [both, setBoth] = useState(true);
  const [serverError, setServerError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const typedError = text.trim() === "" ? null : valueError(text);
  const error = typedError ?? serverError;
  const invalid = valueError(text) !== null;

  const submit = async () => {
    if (invalid) return;
    const value = valueFromText(text);
    // Nothing would change: close without asking the server.
    if (current === value && (!both || opposite === value)) {
      onClose();
      return;
    }
    setSubmitting(true);
    setServerError(null);
    setFormError(null);
    try {
      const cells = await setMarkowitzCell({
        rowId: row.id,
        colId: col.id,
        value,
        bothDirections: both,
      });
      onSaved(cells);
    } catch (err) {
      const problem = describeCellError(err);
      setServerError(problem.fields.value ?? null);
      setFormError(problem.form ?? null);
      setSubmitting(false);
      if (problem.gone) onGone(problem.form ?? "El activo ya no existe.");
    }
  };

  return (
    <MarkowitzModal
      title="Editar correlación"
      submitLabel="Guardar"
      submitting={submitting}
      submitDisabled={invalid}
      formError={formError}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {() => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-sabbi-neutral-500">Fila</dt>
            <dd className="font-medium text-sabbi-neutral-900">{row.name}</dd>
            <dt className="text-sabbi-neutral-500">Columna</dt>
            <dd className="font-medium text-sabbi-neutral-900">{col.name}</dd>
            <dt className="text-sabbi-neutral-500">Valor actual</dt>
            <dd className="tabular-nums" data-testid="current-value">
              {formatValue(current)}
            </dd>
          </dl>

          {differs && (
            <p
              role="note"
              className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800"
              data-testid="opposite-note"
            >
              El valor opuesto ({col.name} frente a {row.name}) es{" "}
              <strong className="tabular-nums">{formatValue(opposite)}</strong>: los dos son
              distintos.
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor={valueId} className="text-xs font-medium text-sabbi-neutral-700">
              Nuevo valor<span className="text-red-600"> *</span>
            </label>
            <input
              id={valueId}
              type="text"
              inputMode="decimal"
              autoFocus
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setServerError(null);
              }}
              aria-invalid={error ? true : undefined}
              placeholder="-1 a 1"
              className={`${INPUT} w-32 tabular-nums` + (error ? INPUT_BAD : "")}
            />
            {error ? (
              <p className="text-xs text-red-600">{error}</p>
            ) : (
              <p className="text-xs text-sabbi-neutral-500">
                Un número de -1 a 1, con hasta 4 decimales.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={bothId} className="flex cursor-pointer items-center gap-2">
              <input
                id={bothId}
                type="checkbox"
                checked={both}
                onChange={(e) => setBoth(e.target.checked)}
              />
              <span className="font-medium text-sabbi-neutral-700">
                Guardar en ambas direcciones
              </span>
            </label>
            <p className="text-xs text-sabbi-neutral-500">
              {both
                ? `Se escribirá el mismo valor para ${row.name} frente a ${col.name} y para ${col.name} frente a ${row.name}.`
                : `Solo cambia ${row.name} frente a ${col.name}. El valor opuesto se queda como está.`}
            </p>
          </div>

          <p className="text-xs text-sabbi-neutral-500">
            Cuando el cálculo de riesgo use esta matriz, este valor afectará el puntaje de todos
            los portafolios que tengan estos dos activos.
          </p>
        </>
      )}
    </MarkowitzModal>
  );
}

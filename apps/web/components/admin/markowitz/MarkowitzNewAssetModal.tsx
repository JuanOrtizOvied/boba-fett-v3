"use client";

import { useId, useState } from "react";
import {
  addSlug,
  cleanName,
  createMarkowitzAsset,
  describeAssetError,
  missingValues,
  validateAssetForm,
  valueError,
  valueFromText,
  valuesFromRow,
  type AssetFormErrors,
  type MarkowitzAsset,
  type MarkowitzMatrix,
} from "@/lib/markowitz";
import { MarkowitzAssetFields } from "@/components/admin/markowitz/MarkowitzAssetFields";
import { INPUT, INPUT_BAD, MarkowitzModal } from "@/components/admin/markowitz/MarkowitzModal";

interface MarkowitzNewAssetModalProps {
  matrix: MarkowitzMatrix;
  onClose: () => void;
  /** Called once the server saved; the page refreshes and says so. */
  onSaved: (created: MarkowitzAsset) => void;
  /** Called when the matrix changed under the modal (another asset was added), so the page
   * can read it again. The values already typed are kept. */
  onStale: () => void;
}

/** Add an asset: its name, its alternative names and one correlation against every asset
 * that is already in the matrix. The server writes each value in both directions and gives
 * the new asset its own diagonal. A partial asset is not allowed: the save button stays off
 * until every value is a good number, and says how many are missing. */
export function MarkowitzNewAssetModal({
  matrix,
  onClose,
  onSaved,
  onStale,
}: MarkowitzNewAssetModalProps) {
  const copyId = useId();
  const { assets } = matrix;

  const [name, setName] = useState("");
  const [slugs, setSlugs] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  // What is typed for each existing asset, by asset id. It lives by id, not by position, so
  // it survives the matrix being read again with one more asset.
  const [texts, setTexts] = useState<Record<number, string>>({});
  const [copyFrom, setCopyFrom] = useState("");
  const [errors, setErrors] = useState<AssetFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const missing = missingValues(assets, texts);

  const commitDraft = () => {
    setSlugs((prev) => addSlug(prev, draft));
    setDraft("");
  };

  const handleCopy = (value: string) => {
    setCopyFrom(value);
    if (value === "") return;
    const index = assets.findIndex((a) => String(a.id) === value);
    if (index >= 0) setTexts(valuesFromRow(matrix, index));
  };

  const copied = assets.find((a) => String(a.id) === copyFrom) ?? null;

  const submit = async () => {
    const finalSlugs = addSlug(slugs, draft);
    const found = validateAssetForm({ name, slugs: finalSlugs }, assets, null);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0 || missing > 0) return;

    setSubmitting(true);
    try {
      const created = await createMarkowitzAsset({
        name: cleanName(name),
        slugs: finalSlugs,
        correlations: assets.map((a) => ({
          asset_id: a.id,
          value: valueFromText(texts[a.id] ?? ""),
        })),
      });
      onSaved(created);
    } catch (err) {
      const problem = describeAssetError(err);
      setErrors(problem.fields);
      setFormError(problem.form ?? null);
      setSubmitting(false);
      if (problem.stale) onStale();
    }
  };

  return (
    <MarkowitzModal
      title="Nuevo activo"
      submitLabel="Crear"
      submittingLabel="Creando..."
      submitting={submitting}
      submitDisabled={missing > 0}
      formError={formError}
      footnote={
        missing > 0
          ? `Faltan ${missing} de ${assets.length} valores.`
          : `Los ${assets.length} valores están listos.`
      }
      onClose={onClose}
      onSubmit={() => void submit()}
      wide
    >
      {() => (
        <>
          <MarkowitzAssetFields
            name={name}
            onName={setName}
            slugs={slugs}
            onRemoveSlug={(slug) => setSlugs((prev) => prev.filter((s) => s !== slug))}
            draft={draft}
            onDraft={setDraft}
            onAddDraft={commitDraft}
            errors={errors}
          />

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-sabbi-neutral-700">
              Correlación con cada activo<span className="text-red-600"> *</span>
            </span>
            <p className="text-xs text-sabbi-neutral-500">
              Un valor de -1 a 1 por cada activo de la matriz. Se guarda igual en las dos
              direcciones; después se puede ajustar una celda por separado.
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={copyId} className="text-xs text-sabbi-neutral-600">
                Copiar valores de
              </label>
              <select
                id={copyId}
                value={copyFrom}
                onChange={(e) => handleCopy(e.target.value)}
                className={`${INPUT} w-auto max-w-full min-w-0 flex-1`}
              >
                <option value="">Elegir un activo...</option>
                {assets.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            {copied && (
              <p className="text-xs text-sabbi-neutral-500">
                Se copió la fila de {copied.name}. El valor contra {copied.name} queda vacío, porque
                hay que escribirlo.
              </p>
            )}

            <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto rounded-lg border border-sabbi-neutral-200 p-2">
              {assets.map((a) => {
                const text = texts[a.id] ?? "";
                const error = text.trim() === "" ? null : valueError(text);
                return (
                  <li key={a.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-sabbi-neutral-800" title={a.name}>
                        {a.name}
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Correlación con ${a.name}`}
                        aria-invalid={error ? true : undefined}
                        value={text}
                        onChange={(e) => setTexts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                        placeholder="-1 a 1"
                        className={`${INPUT} w-24 tabular-nums` + (error ? INPUT_BAD : "")}
                      />
                    </div>
                    {error && <p className="text-right text-xs text-red-600">{error}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </MarkowitzModal>
  );
}

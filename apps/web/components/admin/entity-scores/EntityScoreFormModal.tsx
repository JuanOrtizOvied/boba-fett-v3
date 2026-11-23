"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { XIcon } from "@/components/icons/Icons";
import {
  KIND_TEXT,
  addSlug,
  cleanName,
  clashMessage,
  createEntityScore,
  describeWriteError,
  findNameClash,
  holdersOfSlug,
  scoreFromField,
  slugifyName,
  updateEntityScore,
  validateForm,
  type EntityKind,
  type EntityScore,
  type FormErrors,
} from "@/lib/entityScores";

interface EntityScoreFormModalProps {
  kind: EntityKind;
  mode: "create" | "edit";
  /** The row being edited; `null` when creating. */
  entity: EntityScore | null;
  /** The whole table of this kind, deleted rows included: used for the name check and for
   * the note about a slug other rows already hold. */
  rows: EntityScore[];
  onClose: () => void;
  /** Called once the server saved the row; the page refreshes and says so. */
  onSaved: (saved: EntityScore, mode: "create" | "edit") => void;
  /** Called when the server says the row is gone, so the page can refresh. */
  onGone: () => void;
}

const INPUT =
  "w-full rounded-lg border border-sabbi-neutral-200 bg-white px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";
const INPUT_BAD = " border-red-400 focus:border-red-500";

/** One modal to create or edit an administrator or a manager: name, score and slugs. The
 * checks the server makes are made here first; the server still has the last word, and a
 * refusal of it shows under the field it belongs to. */
export function EntityScoreFormModal({
  kind,
  mode,
  entity,
  rows,
  onClose,
  onSaved,
  onGone,
}: EntityScoreFormModalProps) {
  const titleId = useId();
  const nameId = useId();
  const scoreId = useId();
  const slugId = useId();
  const text = KIND_TEXT[kind];

  const [name, setName] = useState(entity?.name ?? "");
  const [score, setScore] = useState(entity?.score === null || !entity ? "" : String(entity.score));
  const [slugs, setSlugs] = useState<string[]>(entity?.slugs ?? []);
  const [draft, setDraft] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Escape closes the modal, and the focus goes back to what opened it. The opener is
  // read in the first render, before the name box takes the focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => opener?.focus?.(), [opener]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const renamed = mode === "edit" && entity !== null && cleanName(name) !== "" && cleanName(name) !== entity.name;

  // Slugs other active rows already hold, the one of the name included. A note, never a block.
  const ownSlug = slugifyName(cleanName(name));
  const noted = Array.from(new Set(ownSlug ? [ownSlug, ...slugs] : slugs))
    .map((slug) => ({ slug, others: holdersOfSlug(rows, slug, entity?.id ?? null) }))
    .filter((n) => n.others.length > 0);

  const commitDraft = () => {
    setSlugs((prev) => addSlug(prev, draft));
    setDraft("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const finalSlugs = addSlug(slugs, draft);
    const found = validateForm({ name, score, slugs: finalSlugs });
    if (!found.name) {
      const clash = findNameClash(rows, name, entity?.id ?? null);
      if (clash) found.name = clashMessage(kind, clash);
    }
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    const body = { name: cleanName(name), score: scoreFromField(score), slugs: finalSlugs };
    setSubmitting(true);
    try {
      let saved: EntityScore;
      if (mode === "create" || entity === null) {
        saved = await createEntityScore(kind, body);
      } else {
        const patch: Partial<typeof body> = {};
        if (body.name !== entity.name) patch.name = body.name;
        if (body.score !== entity.score) patch.score = body.score;
        if (JSON.stringify(body.slugs) !== JSON.stringify(entity.slugs)) patch.slugs = body.slugs;
        if (Object.keys(patch).length === 0) {
          onClose();
          return;
        }
        saved = await updateEntityScore(kind, entity.id, patch);
      }
      onSaved(saved, mode);
    } catch (err) {
      const described = describeWriteError(err, kind);
      setErrors(described.fields);
      setFormError(described.form ?? null);
      setSubmitting(false);
      if (described.gone) onGone();
    }
  };

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        noValidate
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-w-lg"
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-sabbi-neutral-900">
            {mode === "edit" ? `Editar ${text.singular}` : `Nuevo ${text.singular}`}
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={submitting}
            className="flex size-8 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 text-sm">
          <div className="flex flex-col gap-1">
            <label htmlFor={nameId} className="text-xs font-medium text-sabbi-neutral-700">
              Nombre<span className="text-red-600"> *</span>
            </label>
            <input
              id={nameId}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              placeholder="Ej. Credicorp Capital SAF"
              className={INPUT + (errors.name ? INPUT_BAD : "")}
            />
            {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
            {renamed && (
              <p className="text-xs text-sabbi-neutral-500">
                Los productos que ya usan el nombre anterior no cambian. El nombre anterior se conserva
                como nombre alternativo.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor={scoreId} className="text-xs font-medium text-sabbi-neutral-700">
              Score
            </label>
            <input
              id={scoreId}
              type="number"
              min={1}
              max={10}
              step={1}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              aria-invalid={errors.score ? true : undefined}
              placeholder="1 a 10"
              className={`${INPUT} w-28` + (errors.score ? INPUT_BAD : "")}
            />
            {errors.score ? (
              <p className="text-xs text-red-600">{errors.score}</p>
            ) : (
              <p className="text-xs text-sabbi-neutral-500">
                Déjalo vacío si el score depende de cada producto.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={slugId} className="text-xs font-medium text-sabbi-neutral-700">
              Nombres alternativos
            </label>
            {slugs.length === 0 ? (
              <p className="text-xs text-sabbi-neutral-500 italic">Sin nombres alternativos todavía.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {slugs.map((slug) => (
                  <li
                    key={slug}
                    className="flex max-w-full items-center gap-1 rounded-md bg-sabbi-primary-soft px-2 py-0.5 font-mono text-xs break-all text-sabbi-primary"
                  >
                    {slug}
                    <button
                      type="button"
                      aria-label={`Quitar ${slug}`}
                      onClick={() => setSlugs((prev) => prev.filter((s) => s !== slug))}
                      className="rounded px-0.5 text-sm leading-none hover:bg-black/10"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {noted.map(({ slug, others }) => (
              <p
                key={slug}
                className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800"
              >
                <code>{slug}</code> también lo tiene: {others.map((o) => o.name).join(", ")}
              </p>
            ))}
            <div className="flex gap-2">
              <input
                id={slugId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitDraft();
                  }
                }}
                placeholder="Agregar nombre alternativo y presionar Enter"
                className={`${INPUT} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={commitDraft}
                disabled={slugifyName(draft) === ""}
                className="shrink-0 rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Agregar
              </button>
            </div>
            {errors.slugs && <p className="text-xs text-red-600">{errors.slugs}</p>}
            <p className="text-xs text-sabbi-neutral-500">
              El nombre alternativo que corresponde al propio nombre se agrega solo al guardar. Los
              demás sirven para reconocer otras formas de escribirlo.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-sabbi-neutral-200 px-5 py-4">
          <p role={formError ? "alert" : undefined} className="min-h-4 text-sm text-red-600">
            {formError}
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              {submitting ? "Guardando..." : mode === "edit" ? "Guardar cambios" : "Crear"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

"use client";

import { useId } from "react";
import { INPUT, INPUT_BAD } from "@/components/admin/markowitz/MarkowitzModal";
import { slugifyName, type AssetFormErrors } from "@/lib/markowitz";

interface MarkowitzAssetFieldsProps {
  name: string;
  onName: (value: string) => void;
  /** The alternative names already added (the stored form). */
  slugs: string[];
  onRemoveSlug: (slug: string) => void;
  /** What is typed in the box of alternative names and not added yet. */
  draft: string;
  onDraft: (value: string) => void;
  onAddDraft: () => void;
  errors: AssetFormErrors;
  /** A note under the name, such as the one about renaming. */
  nameNote?: string | null;
}

/** The two fields the asset forms share: the name and the list of alternative names (chips
 * with an x, and a box that adds on Enter or on the button). The data is kept by the parent. */
export function MarkowitzAssetFields({
  name,
  onName,
  slugs,
  onRemoveSlug,
  draft,
  onDraft,
  onAddDraft,
  errors,
  nameNote = null,
}: MarkowitzAssetFieldsProps) {
  const nameId = useId();
  const slugId = useId();

  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor={nameId} className="text-xs font-medium text-sabbi-neutral-700">
          Nombre<span className="text-red-600"> *</span>
        </label>
        <input
          id={nameId}
          autoFocus
          value={name}
          onChange={(e) => onName(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
          placeholder="Ej. US Large Cap"
          className={INPUT + (errors.name ? INPUT_BAD : "")}
        />
        {errors.name && <p className="text-xs text-red-600">{errors.name}</p>}
        {nameNote && <p className="text-xs text-sabbi-neutral-500">{nameNote}</p>}
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
                  onClick={() => onRemoveSlug(slug)}
                  className="rounded px-0.5 text-sm leading-none hover:bg-black/10"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            id={slugId}
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onAddDraft();
              }
            }}
            aria-invalid={errors.slugs ? true : undefined}
            placeholder="Agregar nombre alternativo y presionar Enter"
            className={`${INPUT} min-w-0 flex-1` + (errors.slugs ? INPUT_BAD : "")}
          />
          <button
            type="button"
            onClick={onAddDraft}
            disabled={slugifyName(draft) === ""}
            className="shrink-0 rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Agregar
          </button>
        </div>
        {errors.slugs && <p className="text-xs text-red-600">{errors.slugs}</p>}
        <p className="text-xs text-sabbi-neutral-500">
          El nombre alternativo que corresponde al propio nombre se agrega solo al guardar. Cada
          nombre alternativo pertenece a un solo activo: sirve para reconocerlo cuando un producto
          lo escribe de otra forma.
        </p>
      </div>
    </>
  );
}

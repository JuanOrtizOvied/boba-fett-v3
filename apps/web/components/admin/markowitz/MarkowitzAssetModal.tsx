"use client";

import { useState } from "react";
import {
  addSlug,
  cleanName,
  describeAssetError,
  updateMarkowitzAsset,
  validateAssetForm,
  type AssetFormErrors,
  type MarkowitzAsset,
} from "@/lib/markowitz";
import { MarkowitzAssetFields } from "@/components/admin/markowitz/MarkowitzAssetFields";
import { MarkowitzModal } from "@/components/admin/markowitz/MarkowitzModal";

interface MarkowitzAssetModalProps {
  asset: MarkowitzAsset;
  /** Every asset of the matrix: used for the name and alternative name checks. */
  assets: MarkowitzAsset[];
  onClose: () => void;
  /** Called once the server saved; the page refreshes and says so. */
  onSaved: (saved: MarkowitzAsset) => void;
  /** Called when the server says the asset is gone: the page reads the matrix again and
   * tells the user why the form went away. */
  onGone: (message: string) => void;
}

/** Edit the name and the alternative names of an asset. It never deletes: there is no way to
 * remove an asset, and no cell changes here. */
export function MarkowitzAssetModal({
  asset,
  assets,
  onClose,
  onSaved,
  onGone,
}: MarkowitzAssetModalProps) {
  const [name, setName] = useState(asset.name);
  const [slugs, setSlugs] = useState<string[]>(asset.slugs);
  const [draft, setDraft] = useState("");
  const [errors, setErrors] = useState<AssetFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const renamed = cleanName(name) !== "" && cleanName(name) !== asset.name;

  const commitDraft = () => {
    setSlugs((prev) => addSlug(prev, draft));
    setDraft("");
  };

  const submit = async () => {
    const finalSlugs = addSlug(slugs, draft);
    const found = validateAssetForm({ name, slugs: finalSlugs }, assets, asset.id);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    const patch: { name?: string; slugs?: string[] } = {};
    if (cleanName(name) !== asset.name) patch.name = cleanName(name);
    if (JSON.stringify(finalSlugs) !== JSON.stringify(asset.slugs)) patch.slugs = finalSlugs;
    // Nothing changed: close without asking the server.
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSubmitting(true);
    try {
      onSaved(await updateMarkowitzAsset(asset.id, patch));
    } catch (err) {
      const problem = describeAssetError(err);
      setErrors(problem.fields);
      setFormError(problem.form ?? null);
      setSubmitting(false);
      if (problem.gone) onGone(problem.form ?? "El activo ya no existe.");
    }
  };

  return (
    <MarkowitzModal
      title="Editar activo"
      submitLabel="Guardar cambios"
      submitting={submitting}
      formError={formError}
      onClose={onClose}
      onSubmit={() => void submit()}
    >
      {() => (
        <MarkowitzAssetFields
          name={name}
          onName={setName}
          slugs={slugs}
          onRemoveSlug={(slug) => setSlugs((prev) => prev.filter((s) => s !== slug))}
          draft={draft}
          onDraft={setDraft}
          onAddDraft={commitDraft}
          errors={errors}
          nameNote={
            renamed
              ? "Los productos que ya usan el nombre anterior no cambian. El nombre anterior se conserva como nombre alternativo."
              : null
          }
        />
      )}
    </MarkowitzModal>
  );
}

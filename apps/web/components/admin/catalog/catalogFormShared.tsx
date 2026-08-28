import { useState, type FC, type ReactNode } from "react";
import { PlusIcon, XIcon } from "@/components/icons/Icons";
import type { AssetAllocation } from "@/lib/portfolio-types";

/**
 * Shared building blocks for the admin catalog Create/Edit modals
 * (`apps/web/components/admin/catalog/CreateCatalogModal.tsx` and
 * `EditCatalogModal` in `apps/web/app/admin/catalog/page.tsx`). The two
 * modals must stay in lockstep field-for-field — they previously drifted
 * apart (Create shipped as a plain-text/textarea form while Edit gained
 * structured widgets and validation) which is exactly what this module
 * exists to prevent going forward.
 */

export const EDITABLE_FIELDS: { key: string; label: string }[] = [
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
  { key: "return_rate", label: "Rentabilidad" },
];

export const modalInputClass =
  "rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

export const ModalField: FC<{ label: string; children: ReactNode; required?: boolean }> = ({
  label,
  children,
  required,
}) => (
  // Plain <div>, not <label> — a bare <label> auto-forwards clicks on any
  // non-interactive spot inside it to the first form control it contains,
  // which silently "steals" clicks meant for other rows/buttons once a
  // field has more than one control (AllocationListField, NameListField,
  // ScoredVocabularyField, the return_rate min/max pair).
  <div className="flex flex-col gap-1 text-sm">
    <span className="text-xs font-medium text-sabbi-neutral-700">
      {label}
      {required && <span className="text-red-600"> *</span>}
    </span>
    {children}
  </div>
);

export function allocationSum(rows: AssetAllocation[]): number {
  return rows.reduce((sum, a) => sum + (a.percentage || 0), 0);
}

export function isAllocationInvalid(rows: AssetAllocation[]): boolean {
  return rows.length > 0 && Math.abs(allocationSum(rows) - 100) >= 0.5;
}

/**
 * Parses the return_rate format — either "min% - max%" or, since max is
 * optional, a bare "min%". Legacy free-text values (e.g. "8% anual") or an
 * already-empty field fall back to {min: "", max: ""} so they're left
 * untouched on save instead of being reformatted.
 */
export function parseReturnRate(raw: string): { min: string; max: string } {
  const trimmed = raw.trim();
  const rangeMatch = trimmed.match(/^(\d+(?:\.\d+)?)%\s*-\s*(\d+(?:\.\d+)?)%$/);
  if (rangeMatch) return { min: rangeMatch[1], max: rangeMatch[2] };
  const singleMatch = trimmed.match(/^(\d+(?:\.\d+)?)%$/);
  if (singleMatch) return { min: singleMatch[1], max: "" };
  return { min: "", max: "" };
}

/**
 * Administrador/Gestor field: a <select> of real entities (fetched from
 * `GET /admin/administrators` / `/managers`, plus the current value as an
 * extra option when it's a legacy/free-text value not in the list) paired
 * with a score input, plus an always-visible "add new" text input below.
 *
 * Selecting an entity autofills its score, locked read-only — unless
 * `score_is_fixed` is false ("Cash o efectivo": the real risk depends on
 * which bank holds the cash for that specific product, so it's entered
 * manually per product instead of coming from the entity). Typing a brand
 * new name always requires a manually-entered score, since there's no
 * entity to autofill from yet — the caller persists it as a new entity via
 * POST before saving the catalog entry itself.
 *
 * Pass a `key` from the caller so the draft input resets when the
 * underlying record changes (e.g. a different catalog entry loaded for edit).
 */
export function ScoredVocabularyField({
  entities,
  name,
  score,
  onNameChange,
  onScoreChange,
  addPlaceholder,
  nameInvalid,
  scoreInvalid,
}: {
  entities: { name: string; score: number | null; score_is_fixed?: boolean }[];
  name: string;
  score: number | null;
  onNameChange: (name: string) => void;
  onScoreChange: (score: number | null) => void;
  addPlaceholder: string;
  nameInvalid?: boolean;
  scoreInvalid?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const matched = entities.find((e) => e.name === name);
  const scoreEditable = !matched || matched.score_is_fixed === false;
  const nameInvalidClass = nameInvalid ? " border-red-400 focus:border-red-500" : "";
  const scoreInvalidClass = scoreInvalid ? " border-red-400 focus:border-red-500" : "";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <select
          value={name}
          onChange={(e) => {
            setDraft("");
            const selectedName = e.target.value;
            onNameChange(selectedName);
            const found = entities.find((en) => en.name === selectedName);
            onScoreChange(found && found.score_is_fixed !== false ? found.score : null);
          }}
          className={modalInputClass + " min-w-0 flex-1" + nameInvalidClass}
        >
          <option value="">—</option>
          {name && !entities.some((e) => e.name === name) && (
            <option value={name}>{name}</option>
          )}
          {entities.map((e) => (
            <option key={e.name} value={e.name}>
              {e.name}
            </option>
          ))}
        </select>
        <input
          type="number"
          min={1}
          max={10}
          step={1}
          value={score ?? ""}
          disabled={!scoreEditable}
          onChange={(e) =>
            onScoreChange(e.target.value === "" ? null : Number(e.target.value))
          }
          placeholder="Score"
          aria-label={`Score de ${addPlaceholder.replace("+ Agregar ", "")}`}
          className={
            modalInputClass +
            " w-20 shrink-0" +
            scoreInvalidClass +
            (!scoreEditable ? " bg-sabbi-neutral-100 text-sabbi-neutral-500" : "")
          }
        />
      </div>
      <input
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          if (draft === "" && next !== "") {
            // Starting a brand-new free-text entry — any previously
            // autofilled/locked score no longer applies to this name.
            onScoreChange(null);
          }
          setDraft(next);
          onNameChange(next);
        }}
        placeholder={addPlaceholder}
        className={modalInputClass}
      />
    </div>
  );
}

/**
 * Free-text list field: shows existing entries as removable rows, plus an
 * always-visible "add new" input. Unlike a single-value field, this appends
 * to an array — a new entry only commits on Enter, since there's no single
 * slot to update in place. Case/whitespace-insensitive duplicates are
 * silently ignored.
 *
 * Pass a `key` from the caller so the draft input resets when the
 * underlying record changes.
 */
export function NameListField({
  value,
  onChange,
  addPlaceholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  addPlaceholder: string;
}) {
  const [draft, setDraft] = useState("");
  const canAdd = draft.trim().length >= 3;

  const addName = () => {
    const trimmed = draft.trim();
    if (trimmed.length < 3) return;
    const isDuplicate = value.some(
      (v) => v.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (!isDuplicate) {
      onChange([...value, trimmed]);
    }
    setDraft("");
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-3">
      {value.map((name, index) => (
        <div key={name} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900">
            {name}
          </span>
          <button
            type="button"
            aria-label={`Quitar ${name}`}
            onClick={() => removeAt(index)}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-sabbi-neutral-500 hover:bg-sabbi-neutral-100 hover:text-red-600"
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          name="alternative_name_draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addName();
            }
          }}
          placeholder={addPlaceholder}
          className={modalInputClass + " min-w-0 flex-1"}
        />
        <button
          type="button"
          aria-label="Agregar nombre alternativo"
          disabled={!canAdd}
          onClick={addName}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-sabbi-primary hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PlusIcon size={14} />
        </button>
      </div>
    </div>
  );
}

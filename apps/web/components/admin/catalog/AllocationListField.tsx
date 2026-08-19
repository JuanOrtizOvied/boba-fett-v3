import { PlusIcon, XIcon } from "@/components/icons/Icons";
import type { AssetAllocation } from "@/lib/portfolio-types";

/**
 * Row editor for catalog fields with a closed vocabulary
 * (`{name, percentage}[]`), e.g. `geographic_focus`. Each row combines a
 * `<select>` (avoids typos) with a numeric percentage input, and never lets
 * the same value be picked twice across rows.
 *
 * If a row carries a `name` outside of `options` (legacy data from when
 * the field was free text), it's shown as-is as an extra option for that
 * row instead of being lost — it only "normalizes" once the admin touches it.
 */
export function AllocationListField({
  options,
  value,
  onChange,
  addLabel,
}: {
  options: readonly string[];
  value: AssetAllocation[];
  onChange: (next: AssetAllocation[]) => void;
  addLabel: string;
}) {
  const total = value.reduce((sum, row) => sum + (row.percentage || 0), 0);
  const isBalanced = value.length === 0 || Math.abs(total - 100) < 0.5;
  const allUsed = options.every((o) => value.some((row) => row.name === o));

  const optionsForRow = (index: number): string[] => {
    const usedElsewhere = new Set(
      value.filter((_, i) => i !== index).map((row) => row.name),
    );
    const current = value[index]?.name ?? "";
    const available = options.filter((o) => !usedElsewhere.has(o));
    if (current && !available.includes(current)) {
      return [current, ...available];
    }
    return available;
  };

  const updateRow = (index: number, patch: Partial<AssetAllocation>) => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addRow = () => {
    const nextOption = options.find((o) => !value.some((row) => row.name === o));
    if (!nextOption) return;
    onChange([...value, { name: nextOption, percentage: 0 }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {value.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <select
            value={row.name}
            onChange={(e) => updateRow(index, { name: e.target.value })}
            className="min-w-0 flex-1 rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary"
          >
            {optionsForRow(index).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={row.percentage}
            onChange={(e) =>
              updateRow(index, { percentage: Number(e.target.value) || 0 })
            }
            className="w-20 rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary"
          />
          <span className="text-sm text-sabbi-neutral-500">%</span>
          <button
            type="button"
            aria-label="Quitar"
            onClick={() => removeRow(index)}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-sabbi-neutral-500 hover:bg-sabbi-neutral-100 hover:text-red-600"
          >
            <XIcon size={14} />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        disabled={allUsed}
        className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-sabbi-primary hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <PlusIcon size={12} />
        {addLabel}
      </button>

      <p className={`text-xs ${isBalanced ? "text-sabbi-neutral-500" : "text-red-600"}`}>
        Total: {total.toFixed(1)}%{!isBalanced && " — debe sumar 100%"}
      </p>
    </div>
  );
}

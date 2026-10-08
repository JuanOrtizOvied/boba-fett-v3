import type { V2Allocation } from "@/lib/catalogV2Types";

const EMPTY = "—";

const percentFormat = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const amountFormat = new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 });

/** A rate stored as a fraction (0.0384) as a percentage ("3,84%"). A zero is a
 * real value and is shown; only a missing one is a dash. */
export function formatV2Rate(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  return `${percentFormat.format(value * 100)}%`;
}

/** An amount in US dollars ("US$200,000"). */
export function formatV2Usd(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY;
  return `US$${amountFormat.format(value)}`;
}

/** A product's composite ("Renta fija 60%, Efectivo 40%"), whose percentages are
 * already on a 0 to 100 scale. */
export function formatV2Allocations(allocations: readonly V2Allocation[]): string {
  if (allocations.length === 0) return EMPTY;
  return allocations
    .map(({ name, percentage }) => `${name} ${amountFormat.format(percentage)}%`)
    .join(", ");
}

/** The range of a series ("2,00% - 4,00%"), or one end when only one is set. */
export function formatV2Range(
  min: number | null | undefined,
  max: number | null | undefined,
  format: (value: number | null | undefined) => string = formatV2Rate,
): string {
  const hasMin = min !== null && min !== undefined;
  const hasMax = max !== null && max !== undefined;
  if (!hasMin && !hasMax) return EMPTY;
  if (hasMin && hasMax) return `${format(min)} - ${format(max)}`;
  return format(hasMin ? min : max);
}

export function formatV2Score(score: number | null | undefined): string {
  return score === null || score === undefined ? "Sin score" : String(score);
}

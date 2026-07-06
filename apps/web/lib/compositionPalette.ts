/**
 * Backend composition entries (`AssetAllocation`) carry only `name` and
 * `percentage` — no color. Segment/legend colors are assigned deterministically
 * by index so the same composition always renders with the same colors.
 */
const COMPOSITION_PALETTE = [
  "#7c3aed",
  "#6d28d9",
  "#0d9488",
  "#2563eb",
  "#64748b",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
];

export function compositionColor(index: number): string {
  return COMPOSITION_PALETTE[index % COMPOSITION_PALETTE.length];
}

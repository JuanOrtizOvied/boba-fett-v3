/** Full USD amount with thousands separators, e.g. `$150,000`. */
export function formatUsd(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** Abbreviated USD amount for metric cards, e.g. `$150K`, `$1.2M`. */
export function formatAbbreviatedUsd(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `$${trimTrailingZeros((amount / 1_000_000).toFixed(2))}M`;
  }
  if (abs >= 1_000) {
    return `$${trimTrailingZeros((amount / 1_000).toFixed(1))}K`;
  }
  return formatUsd(amount);
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

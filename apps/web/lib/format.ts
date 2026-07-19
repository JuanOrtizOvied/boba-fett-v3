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

/**
 * Short relative-time label for a recent ISO timestamp, e.g. "recién",
 * "hace 5m", "hace 2h". Falls back to a short date (`es-PE`) once older than
 * a day. Used by `VersioningBar`'s recent-activity indicator and `ChangeLog`
 * (AL-008).
 */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  if (diffSec < 30) return "recién";
  if (diffSec < 60) return `hace ${diffSec}s`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin}m`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `hace ${diffHour}h`;

  return date.toLocaleDateString("es-PE", { day: "numeric", month: "short" });
}

/** Full date + time label (`es-PE`), e.g. "14 jul 2026, 09:30". */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-PE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

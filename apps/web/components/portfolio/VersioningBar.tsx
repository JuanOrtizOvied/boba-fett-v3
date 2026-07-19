"use client";

import type { FC } from "react";
import { formatRelativeTime } from "@/lib/format";
import type { ChangeLogEntry, Snapshot } from "@/lib/usePortfolioVersioning";

export interface VersioningBarProps {
  snapshots: Snapshot[];
  isLoadingSnapshots: boolean;
  /** Reverse-chronological — `changes[0]` is the latest mutation (AL-008). */
  changes: ChangeLogEntry[];
  onOpenDrawer: () => void;
}

const OPERATION_VERB: Record<ChangeLogEntry["operation"], string> = {
  create: "agregado",
  update: "actualizado",
  delete: "eliminado",
};

function describeLatestChange(entry: ChangeLogEntry): string {
  const name = entry.after_state?.name ?? entry.before_state?.name ?? "Producto";
  return `${name} ${OPERATION_VERB[entry.operation]} · ${formatRelativeTime(entry.created_at)}`;
}

/**
 * Thin strip between the metrics/category-tabs header and the scrollable
 * category content, showing the current snapshot count, a recent-activity
 * indicator (AL-008 "Recent activity indicator shows latest mutation"), and
 * a "Ver historial" link that opens `VersioningDrawer` (T-025).
 * `design.md` → Frontend Architecture → "Where components mount".
 */
export const VersioningBar: FC<VersioningBarProps> = ({
  snapshots,
  isLoadingSnapshots,
  changes,
  onOpenDrawer,
}) => {
  const count = snapshots.length;
  const label = isLoadingSnapshots
    ? "Cargando versiones…"
    : count === 1
      ? "1 versión guardada"
      : `${count} versiones guardadas`;

  const latestChange = changes[0] ?? null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-sabbi-neutral-200 bg-sabbi-neutral-50 px-6 py-2 text-sm text-sabbi-neutral-600">
      <div className="flex min-w-0 items-center gap-3">
        <span className="shrink-0">{label}</span>
        {latestChange && (
          <span
            data-testid="recent-activity-indicator"
            className="flex min-w-0 items-center gap-1.5 truncate text-sabbi-neutral-500"
          >
            <span
              className="size-1.5 shrink-0 rounded-full bg-sabbi-primary"
              aria-hidden="true"
            />
            <span className="truncate">{describeLatestChange(latestChange)}</span>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenDrawer}
        className="shrink-0 font-medium text-sabbi-primary hover:underline"
      >
        Ver historial
      </button>
    </div>
  );
};

"use client";

import type { FC } from "react";
import { EditIcon, RobotIcon, WarningIcon } from "@/components/icons/Icons";
import { formatDateTime } from "@/lib/format";
import type { ChangeLogEntry, ChangeOperation, ChangeSource } from "@/lib/usePortfolioVersioning";

export interface ChangeLogProps {
  changes: ChangeLogEntry[];
  isLoadingChanges: boolean;
  changesTotal: number;
  changesHasMore: boolean;
  onLoadMore: () => void;
}

const OPERATION_META: Record<ChangeOperation, { label: string; className: string }> = {
  create: { label: "Creado", className: "bg-emerald-100 text-emerald-700" },
  update: { label: "Actualizado", className: "bg-amber-100 text-amber-700" },
  delete: { label: "Eliminado", className: "bg-red-100 text-red-700" },
};

const SOURCE_META: Record<ChangeSource, { label: string; Icon: typeof RobotIcon }> = {
  agent: { label: "Agente", Icon: RobotIcon },
  api: { label: "Manual", Icon: EditIcon },
  admin: { label: "Admin", Icon: WarningIcon },
};

/**
 * Paginated, reverse-chronological change history for the drawer's
 * "Changes" tab (AL-008 "Expandable history shows a chronological list").
 * Each row shows the operation badge, affected product name, source icon,
 * and a human-readable timestamp. `design.md` → Component Hierarchy →
 * `ChangeLog` / `ChangeLogItem`.
 */
export const ChangeLog: FC<ChangeLogProps> = ({
  changes,
  isLoadingChanges,
  changesTotal,
  changesHasMore,
  onLoadMore,
}) => {
  if (isLoadingChanges && changes.length === 0) {
    return <p className="text-sm text-sabbi-neutral-600">Cargando historial de cambios…</p>;
  }

  if (changes.length === 0) {
    return (
      <p className="text-sm text-sabbi-neutral-600">
        Todavía no hay cambios registrados en tu portafolio.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-sabbi-neutral-500">{changesTotal} cambios en total</p>
      <ul className="flex flex-col gap-2">
        {changes.map((entry) => (
          <ChangeLogItem key={entry.id} entry={entry} />
        ))}
      </ul>
      {changesHasMore && (
        <button
          type="button"
          disabled={isLoadingChanges}
          onClick={onLoadMore}
          className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50 disabled:opacity-60"
        >
          {isLoadingChanges ? "Cargando…" : "Cargar más"}
        </button>
      )}
    </div>
  );
};

const ChangeLogItem: FC<{ entry: ChangeLogEntry }> = ({ entry }) => {
  const operation = OPERATION_META[entry.operation];
  const source = SOURCE_META[entry.source];
  const productName = entry.after_state?.name ?? entry.before_state?.name ?? "Producto";

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-sabbi-neutral-200 px-3 py-2 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${operation.className}`}
        >
          {operation.label}
        </span>
        <span className="truncate font-medium text-sabbi-neutral-900">{productName}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-xs text-sabbi-neutral-500">
        <span
          className="flex items-center gap-1"
          title={`Origen: ${source.label}`}
          aria-label={`Origen: ${source.label}`}
        >
          <source.Icon size={12} />
          {source.label}
        </span>
        <span>{formatDateTime(entry.created_at)}</span>
      </div>
    </li>
  );
};

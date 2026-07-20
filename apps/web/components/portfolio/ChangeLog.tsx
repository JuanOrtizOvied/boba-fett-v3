"use client";

import type { FC } from "react";
import { EditIcon, RobotIcon, WarningIcon } from "@/components/icons/Icons";
import { CATEGORY_META, categoryColorVar, resolveCategoryKey } from "@/lib/categories";
import { formatAbbreviatedUsd, formatRelativeTime } from "@/lib/format";
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

function describeChanges(entry: ChangeLogEntry): string | null {
  if (entry.operation !== "update" || !entry.before_state || !entry.after_state) return null;
  const diffs: string[] = [];
  const b = entry.before_state;
  const a = entry.after_state;
  if (b.amount !== a.amount)
    diffs.push(`${formatAbbreviatedUsd(b.amount)} → ${formatAbbreviatedUsd(a.amount)}`);
  if (b.category !== a.category) {
    const from = CATEGORY_META[resolveCategoryKey(b.category)].shortLabel;
    const to = CATEGORY_META[resolveCategoryKey(a.category)].shortLabel;
    diffs.push(`${from} → ${to}`);
  }
  if (b.name !== a.name) diffs.push(`"${b.name}" → "${a.name}"`);
  return diffs.length > 0 ? diffs.join(" · ") : null;
}

const ChangeLogItem: FC<{ entry: ChangeLogEntry }> = ({ entry }) => {
  const operation = OPERATION_META[entry.operation];
  const source = SOURCE_META[entry.source];
  const product = entry.after_state ?? entry.before_state;
  const productName = product?.name ?? "Producto";
  const amount = product?.amount;
  const categoryKey = product?.category ? resolveCategoryKey(product.category) : null;
  const catMeta = categoryKey ? CATEGORY_META[categoryKey] : null;
  const changes = describeChanges(entry);

  const provider = product?.provider;

  return (
    <li className="rounded-xl border border-sabbi-neutral-200 bg-background p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${operation.className}`}
            >
              {operation.label}
            </span>
            <span className="truncate text-sm font-semibold text-sabbi-neutral-900">
              {productName}
            </span>
          </div>
          {provider && (
            <p className="text-xs text-sabbi-neutral-600">
              {provider}
            </p>
          )}
          {changes && (
            <p className="text-xs text-sabbi-neutral-500 italic">{changes}</p>
          )}
        </div>
        {amount != null && (
          <span className="font-display shrink-0 text-sm font-bold text-sabbi-neutral-900">
            {formatAbbreviatedUsd(amount)}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-3 text-xs text-sabbi-neutral-500">
        {catMeta && (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: categoryColorVar(categoryKey!) }}
          >
            {catMeta.shortLabel}
          </span>
        )}
        <span className="flex items-center gap-1" title={`Origen: ${source.label}`}>
          <source.Icon size={11} />
          {source.label}
        </span>
        <span>{formatRelativeTime(entry.created_at)}</span>
      </div>
    </li>
  );
};

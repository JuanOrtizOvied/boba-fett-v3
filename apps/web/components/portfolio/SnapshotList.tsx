"use client";

import type { FC } from "react";
import { CATEGORY_META, categoryColorVar, resolveCategoryKey } from "@/lib/categories";
import { formatAbbreviatedUsd, formatDateTime } from "@/lib/format";
import type { Snapshot, SnapshotDetail } from "@/lib/usePortfolioVersioning";

export interface SnapshotListProps {
  snapshots: Snapshot[];
  isLoadingSnapshots: boolean;
  /** Set once `onSelectSnapshot` resolves — read-only detail view (SNAP-008). */
  selectedDetail: SnapshotDetail | null;
  isLoadingDetail: boolean;
  detailError: string | null;
  onSelectSnapshot: (snapshot: Snapshot) => void;
  onCloseDetail: () => void;
  /** Two-step compare selection — `design.md` → "Comparison selection". */
  compareSelection: [string | null, string | null];
  onToggleCompare: (snapshotId: string) => void;
  onCompareSelected: () => void;
  isComparing: boolean;
}

/**
 * Snapshot timeline (SNAP-008) — newest-first list with name/date/product
 * count, a two-step "select two to compare" affordance (CMP-004: "the
 * investor has selected two snapshots in the timeline view"), and a
 * read-only detail view with no edit/delete controls, matching the live
 * `products.ts` shape. `design.md` → Component Hierarchy → `SnapshotList` /
 * `SnapshotItem`.
 */
export const SnapshotList: FC<SnapshotListProps> = ({
  snapshots,
  isLoadingSnapshots,
  selectedDetail,
  isLoadingDetail,
  detailError,
  onSelectSnapshot,
  onCloseDetail,
  compareSelection,
  onToggleCompare,
  onCompareSelected,
  isComparing,
}) => {
  if (selectedDetail || isLoadingDetail || detailError) {
    return (
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onCloseDetail}
          className="w-fit text-sm font-medium text-sabbi-primary hover:underline"
        >
          ← Volver a versiones
        </button>
        {isLoadingDetail ? (
          <p className="text-sm text-sabbi-neutral-600">Cargando versión…</p>
        ) : detailError ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {detailError}
          </p>
        ) : selectedDetail ? (
          <SnapshotDetailView detail={selectedDetail} />
        ) : null}
      </div>
    );
  }

  if (isLoadingSnapshots) {
    return <p className="text-sm text-sabbi-neutral-600">Cargando versiones…</p>;
  }

  if (snapshots.length === 0) {
    return (
      <p className="text-sm text-sabbi-neutral-600">
        Aún no guardaste ninguna versión de tu portafolio.
      </p>
    );
  }

  const bothSelected = compareSelection[0] != null && compareSelection[1] != null;

  return (
    <div className="flex flex-col gap-3">
      {bothSelected && (
        <button
          type="button"
          disabled={isComparing}
          onClick={onCompareSelected}
          className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
        >
          {isComparing ? "Comparando…" : "Comparar versiones seleccionadas"}
        </button>
      )}
      <ul className="flex flex-col gap-2">
        {snapshots.map((snapshot) => (
          <SnapshotItem
            key={snapshot.id}
            snapshot={snapshot}
            isSelectedForCompare={compareSelection.includes(snapshot.id)}
            onView={() => onSelectSnapshot(snapshot)}
            onToggleCompare={() => onToggleCompare(snapshot.id)}
          />
        ))}
      </ul>
    </div>
  );
};

const SnapshotItem: FC<{
  snapshot: Snapshot;
  isSelectedForCompare: boolean;
  onView: () => void;
  onToggleCompare: () => void;
}> = ({ snapshot, isSelectedForCompare, onView, onToggleCompare }) => {
  const merged = (snapshot.category_summary ?? []).reduce<Record<string, number>>((acc, c) => {
    const key = resolveCategoryKey(c.category);
    acc[key] = (acc[key] ?? 0) + c.percentage;
    return acc;
  }, {});
  const categories = Object.entries(merged)
    .map(([key, percentage]) => ({ key, percentage }))
    .sort((a, b) => b.percentage - a.percentage);

  return (
    <li
      className={`rounded-xl border bg-background transition-all duration-200 ${
        isSelectedForCompare
          ? "border-sabbi-primary/40 bg-sabbi-primary/5"
          : "border-sabbi-neutral-200 hover:border-sabbi-neutral-400 hover:shadow-md"
      }`}
    >
      <button
        type="button"
        onClick={onView}
        className="flex w-full flex-col gap-2.5 p-4 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-semibold text-sabbi-neutral-900">
            {snapshot.name}
          </span>
          <span className="font-display shrink-0 text-base font-bold text-sabbi-neutral-900">
            {formatAbbreviatedUsd(snapshot.total_amount)}
          </span>
        </div>

        {categories.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-sabbi-neutral-100">
              {categories.map((c) => (
                <div
                  key={c.key}
                  style={{
                    width: `${c.percentage}%`,
                    backgroundColor: categoryColorVar(c.key as import("@/lib/portfolio-types").Category),
                  }}
                />
              ))}
            </div>
            <div className="flex flex-col gap-0.5">
              {categories.map((c) => {
                const meta = CATEGORY_META[c.key as keyof typeof CATEGORY_META];
                return (
                  <span key={c.key} className="flex items-center gap-1.5 text-xs text-sabbi-neutral-600">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: categoryColorVar(c.key as import("@/lib/portfolio-types").Category) }}
                    />
                    {meta.shortLabel}
                    <span className="ml-auto tabular-nums">{c.percentage.toFixed(0)}%</span>
                  </span>
                );
              })}
            </div>
          </div>
        )}

        <span className="text-xs text-sabbi-neutral-500">
          {formatDateTime(snapshot.created_at)}
        </span>
      </button>

      <div className="border-t border-sabbi-neutral-100 px-4 py-2">
        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className={`flex size-3.5 items-center justify-center rounded border transition-colors ${
              isSelectedForCompare
                ? "border-sabbi-primary bg-sabbi-primary text-white"
                : "border-sabbi-neutral-300 bg-background"
            }`}
          >
            {isSelectedForCompare && (
              <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 6l3 3 5-5" />
              </svg>
            )}
          </span>
          <input
            type="checkbox"
            checked={isSelectedForCompare}
            onChange={onToggleCompare}
            className="sr-only"
            aria-label={`Seleccionar "${snapshot.name}" para comparar`}
          />
          <span className={isSelectedForCompare ? "font-medium text-sabbi-primary" : "text-sabbi-neutral-500"}>
            Seleccionar para comparar
          </span>
        </label>
      </div>
    </li>
  );
};

const SnapshotDetailView: FC<{ detail: SnapshotDetail }> = ({ detail }) => (
  <div className="flex flex-col gap-3">
    <div className="rounded-xl border border-sabbi-neutral-200 bg-background p-3.5">
      <h3 className="text-sm font-semibold text-sabbi-neutral-900">{detail.name}</h3>
      <p className="mt-0.5 text-xs text-sabbi-neutral-500">
        {formatDateTime(detail.created_at)}
      </p>
      {detail.description && (
        <p className="mt-1.5 text-sm text-sabbi-neutral-700">{detail.description}</p>
      )}
      <div className="mt-2 flex items-center gap-3 text-xs text-sabbi-neutral-600">
        <span className="font-medium">{detail.product_count} productos</span>
        <span className="font-semibold text-sabbi-neutral-900">
          {formatAbbreviatedUsd(detail.total_amount)}
        </span>
      </div>
    </div>
    <ul className="flex flex-col gap-2" data-testid="snapshot-detail-products">
      {detail.products.map((product) => (
        <li
          key={product.id}
          className="flex items-center justify-between gap-3 rounded-xl border border-sabbi-neutral-200 bg-background px-3.5 py-2.5 text-sm"
        >
          <span className="font-medium text-sabbi-neutral-900">{product.name}</span>
          <span className="font-semibold text-sabbi-neutral-900">
            {formatAbbreviatedUsd(product.amount)}
          </span>
        </li>
      ))}
    </ul>
  </div>
);

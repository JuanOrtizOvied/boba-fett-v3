"use client";

import type { FC } from "react";
import { formatDateTime, formatUsd } from "@/lib/format";
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
}> = ({ snapshot, isSelectedForCompare, onView, onToggleCompare }) => (
  <li className="flex items-center justify-between gap-3 rounded-lg border border-sabbi-neutral-200 px-3 py-2">
    <button
      type="button"
      onClick={onView}
      className="flex min-w-0 flex-1 flex-col items-start text-left"
    >
      <span className="truncate text-sm font-medium text-sabbi-neutral-900">
        {snapshot.name}
      </span>
      <span className="text-xs text-sabbi-neutral-600">
        {formatDateTime(snapshot.created_at)} · {snapshot.product_count} productos ·{" "}
        {formatUsd(snapshot.total_amount)}
      </span>
    </button>
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-sabbi-neutral-600">
      <input
        type="checkbox"
        checked={isSelectedForCompare}
        onChange={onToggleCompare}
        aria-label={`Seleccionar "${snapshot.name}" para comparar`}
      />
      Comparar
    </label>
  </li>
);

/** Read-only — intentionally exposes no edit/delete affordance (SNAP-008). */
const SnapshotDetailView: FC<{ detail: SnapshotDetail }> = ({ detail }) => (
  <div className="flex flex-col gap-3">
    <div>
      <h3 className="text-sm font-semibold text-sabbi-neutral-900">{detail.name}</h3>
      <p className="text-xs text-sabbi-neutral-600">
        {formatDateTime(detail.created_at)} · {detail.product_count} productos ·{" "}
        {formatUsd(detail.total_amount)}
      </p>
      {detail.description && (
        <p className="mt-1 text-sm text-sabbi-neutral-700">{detail.description}</p>
      )}
    </div>
    <ul className="flex flex-col gap-2" data-testid="snapshot-detail-products">
      {detail.products.map((product) => (
        <li
          key={product.id}
          className="flex items-center justify-between gap-3 rounded-lg border border-sabbi-neutral-200 px-3 py-2 text-sm"
        >
          <span className="font-medium text-sabbi-neutral-900">{product.name}</span>
          <span className="text-sabbi-neutral-600">{formatUsd(product.amount)}</span>
        </li>
      ))}
    </ul>
  </div>
);

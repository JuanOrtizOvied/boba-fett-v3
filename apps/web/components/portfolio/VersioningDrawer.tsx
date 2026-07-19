"use client";

import { useEffect, useState, type FC, type ReactNode } from "react";
import { ChangeLog } from "@/components/portfolio/ChangeLog";
import { ComparisonView } from "@/components/portfolio/ComparisonView";
import { SnapshotList } from "@/components/portfolio/SnapshotList";
import { XIcon } from "@/components/icons/Icons";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  ChangeLogEntry,
  Snapshot,
  SnapshotDetail,
  SnapshotDiff,
} from "@/lib/usePortfolioVersioning";

export interface VersioningDrawerProps {
  isOpen: boolean;
  onClose: () => void;

  snapshots: Snapshot[];
  isLoadingSnapshots: boolean;

  changes: ChangeLogEntry[];
  isLoadingChanges: boolean;
  changesTotal: number;
  changesHasMore: boolean;
  onLoadMoreChanges: () => void;

  comparison: SnapshotDiff | null;
  isComparing: boolean;
  compareError: string | null;
  onCompare: (aId: string, bId: string) => Promise<void>;
  onClearComparison: () => void;
}

type DrawerTab = "snapshots" | "changes";
type CompareSelection = [string | null, string | null];

/**
 * Right-side slide-over: "Snapshots" | "Changes" tabs (SNAP-008, AL-008).
 * Owns the two-step compare selection and the read-only snapshot detail
 * fetch (`GET /portfolio/me/snapshots/:id` — not part of the T-024 hook
 * slice, fetched directly via `fetchWithAuth` the same way `PortfolioPanel`
 * calls it ad hoc for one-off actions like product deletion).
 * `design.md` → Frontend Architecture → Component Hierarchy →
 * `VersioningDrawer`.
 */
export const VersioningDrawer: FC<VersioningDrawerProps> = ({
  isOpen,
  onClose,
  snapshots,
  isLoadingSnapshots,
  changes,
  isLoadingChanges,
  changesTotal,
  changesHasMore,
  onLoadMoreChanges,
  comparison,
  isComparing,
  compareError,
  onCompare,
  onClearComparison,
}) => {
  const [activeTab, setActiveTab] = useState<DrawerTab>("snapshots");
  const [compareSelection, setCompareSelection] = useState<CompareSelection>([null, null]);
  const [selectedDetail, setSelectedDetail] = useState<SnapshotDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);

  // Reset all transient drawer state when it closes, so reopening never
  // shows a stale selection, detail view, or comparison result.
  useEffect(() => {
    if (isOpen) return;
    setActiveTab("snapshots");
    setCompareSelection([null, null]);
    setSelectedDetail(null);
    setIsLoadingDetail(false);
    setDetailError(null);
    setIsComparisonOpen(false);
    onClearComparison();
  }, [isOpen, onClearComparison]);

  if (!isOpen) return null;

  const handleSelectSnapshot = async (snapshot: Snapshot) => {
    setDetailError(null);
    setSelectedDetail(null);
    setIsLoadingDetail(true);
    try {
      const res = await fetchWithAuth(`/api/portfolio/me/snapshots/${snapshot.id}`);
      if (!res.ok) throw new Error(`No se pudo cargar la versión (status ${res.status})`);
      const detail: SnapshotDetail = await res.json();
      setSelectedDetail(detail);
    } catch (err) {
      setDetailError(
        err instanceof Error ? err.message : "No se pudo cargar la versión seleccionada",
      );
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleCloseDetail = () => {
    setSelectedDetail(null);
    setIsLoadingDetail(false);
    setDetailError(null);
  };

  const handleToggleCompare = (snapshotId: string) => {
    setCompareSelection((prev) => {
      if (prev.includes(snapshotId)) {
        return prev.map((id) => (id === snapshotId ? null : id)) as CompareSelection;
      }
      if (prev[0] == null) return [snapshotId, prev[1]];
      if (prev[1] == null) return [prev[0], snapshotId];
      // Both slots taken — the newest selection replaces the older one (A).
      return [prev[1], snapshotId];
    });
  };

  const handleCompareSelected = async () => {
    const [id1, id2] = compareSelection;
    if (!id1 || !id2) return;
    const s1 = snapshots.find((s) => s.id === id1);
    const s2 = snapshots.find((s) => s.id === id2);
    if (!s1 || !s2) return;
    const [aId, bId] =
      new Date(s1.created_at) <= new Date(s2.created_at)
        ? [id1, id2]
        : [id2, id1];
    setIsComparisonOpen(true);
    await onCompare(aId, bId);
  };

  const [orderedA, orderedB] = (() => {
    const s1 = compareSelection[0] ? snapshots.find((s) => s.id === compareSelection[0]) : null;
    const s2 = compareSelection[1] ? snapshots.find((s) => s.id === compareSelection[1]) : null;
    if (!s1 || !s2) return [s1 ?? null, s2 ?? null];
    return new Date(s1.created_at) <= new Date(s2.created_at) ? [s1, s2] : [s2, s1];
  })();
  const snapshotA = orderedA;
  const snapshotB = orderedB;

  return (
    <>
      <div
        className="animate-modal-overlay fixed inset-0 z-50 bg-black/40"
        onClick={onClose}
      >
        <div
          className="animate-drawer-panel ml-auto flex h-full w-full max-w-md flex-col overflow-hidden bg-background shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
            <h2 className="text-base font-semibold text-sabbi-neutral-900">
              Historial del portafolio
            </h2>
            <button
              type="button"
              aria-label="Cerrar"
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
            >
              <XIcon size={16} />
            </button>
          </div>

          <div
            className="flex shrink-0 gap-2 border-b border-sabbi-neutral-200 px-5 py-3"
            role="tablist"
            aria-label="Historial del portafolio"
          >
            <DrawerTabButton
              active={activeTab === "snapshots"}
              onClick={() => setActiveTab("snapshots")}
            >
              Versiones
            </DrawerTabButton>
            <DrawerTabButton
              active={activeTab === "changes"}
              onClick={() => setActiveTab("changes")}
            >
              Cambios
            </DrawerTabButton>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {activeTab === "snapshots" ? (
              <SnapshotList
                snapshots={snapshots}
                isLoadingSnapshots={isLoadingSnapshots}
                selectedDetail={selectedDetail}
                isLoadingDetail={isLoadingDetail}
                detailError={detailError}
                onSelectSnapshot={(snapshot) => void handleSelectSnapshot(snapshot)}
                onCloseDetail={handleCloseDetail}
                compareSelection={compareSelection}
                onToggleCompare={handleToggleCompare}
                onCompareSelected={() => void handleCompareSelected()}
                isComparing={isComparing}
              />
            ) : (
              <ChangeLog
                changes={changes}
                isLoadingChanges={isLoadingChanges}
                changesTotal={changesTotal}
                changesHasMore={changesHasMore}
                onLoadMore={onLoadMoreChanges}
              />
            )}
          </div>
        </div>
      </div>

      <ComparisonView
        isOpen={isComparisonOpen}
        onClose={() => {
          setIsComparisonOpen(false);
          onClearComparison();
        }}
        snapshotA={snapshotA}
        snapshotB={snapshotB}
        comparison={comparison}
        isComparing={isComparing}
        compareError={compareError}
      />
    </>
  );
};

const DrawerTabButton: FC<{
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "border-transparent bg-[var(--sabbi-lime)] text-sabbi-neutral-900"
        : "border-sabbi-neutral-200 text-sabbi-neutral-600 hover:bg-sabbi-neutral-50"
    }`}
  >
    {children}
  </button>
);

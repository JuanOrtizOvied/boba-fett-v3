"use client";

import { useState, type FC } from "react";
import { CameraIcon } from "@/components/icons/Icons";
import { SnapshotModal } from "@/components/portfolio/SnapshotModal";
import type { Snapshot } from "@/lib/usePortfolioVersioning";

export interface SnapshotButtonProps {
  createSnapshot: (name: string, description?: string) => Promise<Snapshot>;
}

/**
 * Inline affordance (near `MetricsRow` in `PortfolioPanel`'s header area)
 * that opens `SnapshotModal` to save the current portfolio state as a
 * named, immutable snapshot. Never disabled on an empty portfolio — the
 * backend supports empty-portfolio snapshots (SNAP-009).
 * `snapshots.spec.md` → SNAP-007 "Snapshot Creation UI".
 */
export const SnapshotButton: FC<SnapshotButtonProps> = ({ createSnapshot }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-sabbi-neutral-200 bg-background px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
      >
        <CameraIcon size={14} />
        Guardar versión
      </button>
      <SnapshotModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={createSnapshot}
      />
    </>
  );
};

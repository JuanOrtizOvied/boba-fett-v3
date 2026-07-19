"use client";

import { useState, type FC } from "react";
import { CameraIcon } from "@/components/icons/Icons";
import { SnapshotModal } from "@/components/portfolio/SnapshotModal";
import type { Snapshot } from "@/lib/usePortfolioVersioning";

export interface SnapshotButtonProps {
  createSnapshot: (name: string, description?: string) => Promise<Snapshot>;
  disabled?: boolean;
}

export const SnapshotButton: FC<SnapshotButtonProps> = ({ createSnapshot, disabled }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsModalOpen(true)}
        title={disabled ? "Sin cambios respecto a la última versión" : undefined}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-sabbi-neutral-200 bg-background px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
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

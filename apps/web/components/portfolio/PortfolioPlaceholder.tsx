import type { FC } from "react";
import { PieIcon } from "@/components/icons/Icons";

/**
 * Empty-state placeholder for the portfolio panel (right side).
 *
 * Phase 3 replaces this with the real `PortfolioPanel` (metrics, category
 * tabs, product cards). Kept as its own component so the split-layout scroll
 * behavior (`portfolio-dashboard.spec.md` → "Scroll vertical solo en el panel
 * de portafolio") can be wired now and reused unchanged later.
 */
export const PortfolioPlaceholder: FC = () => {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-sabbi-neutral-50 px-6 py-6">
      <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-sabbi-primary-soft text-sabbi-primary">
          <PieIcon size={26} />
        </div>
        <p className="text-base font-medium text-sabbi-neutral-900">
          Sin productos aún
        </p>
        <p className="text-sm text-sabbi-neutral-600">
          Comparte tus inversiones con el asistente — por texto, captura, PDF
          o factsheet — y aparecerán aquí organizadas por categoría.
        </p>
      </div>
    </div>
  );
};

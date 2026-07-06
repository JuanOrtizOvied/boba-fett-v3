"use client";

import type { FC } from "react";
import { DownloadIcon, RobotIcon, SendIcon } from "@/components/icons/Icons";

export type PortfolioView = "builder" | "resumen";

type TopbarProps = {
  activeView: PortfolioView;
  onChangeView: (view: PortfolioView) => void;
  /** Portfolio identity for the "Exportar" download link. */
  portfolioId: string;
};

/**
 * Fixed top navigation bar: brand, view tabs ("Construir portafolio" /
 * "Resumen final"), and the export/send actions. Stays pinned above the
 * split layout — only the panels below scroll.
 */
export const Topbar: FC<TopbarProps> = ({ activeView, onChangeView, portfolioId }) => {
  const handleExport = () => {
    if (!portfolioId) return;
    // Direct navigation, not fetch+blob — the browser handles the
    // Content-Disposition download itself, zero extra JS bundle impact
    // (`portfolio-dashboard.spec.md` → "Exportar portafolio a Excel").
    window.open(`/api/portfolio/${portfolioId}/export`, "_blank");
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-sabbi-neutral-200 bg-background px-4">
      <div className="flex items-center gap-2">
        <RobotIcon size={22} className="text-sabbi-primary" />
        <span className="text-sm font-semibold tracking-wide text-sabbi-neutral-900">
          SABBI
        </span>
      </div>

      <nav className="flex items-center gap-1" aria-label="Vistas del portafolio">
        <TabButton
          active={activeView === "builder"}
          onClick={() => onChangeView("builder")}
        >
          Construir portafolio
        </TabButton>
        <TabButton
          active={activeView === "resumen"}
          onClick={() => onChangeView("resumen")}
        >
          Resumen final
        </TabButton>
      </nav>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={!portfolioId}
          aria-label="Exportar"
          className="flex items-center gap-1.5 rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 transition-colors hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DownloadIcon size={16} />
          <span className="hidden sm:inline">Exportar</span>
        </button>
        <span className="group relative">
          <button
            type="button"
            disabled
            aria-label="Enviar a SABBI"
            aria-describedby="sabbi-submit-tooltip"
            className="flex items-center gap-1.5 rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white opacity-50 disabled:cursor-not-allowed"
          >
            <SendIcon size={16} />
            <span className="hidden sm:inline">Enviar a SABBI</span>
          </button>
          <span
            id="sabbi-submit-tooltip"
            role="tooltip"
            className="pointer-events-none absolute top-full right-0 mt-1 hidden whitespace-nowrap rounded-md bg-sabbi-neutral-900 px-2 py-1 text-xs text-white group-hover:block"
          >
            Próximamente
          </span>
        </span>
      </div>
    </header>
  );
};

const TabButton: FC<{
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}> = ({ active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? "bg-sabbi-primary-soft text-sabbi-primary"
        : "text-sabbi-neutral-600 hover:bg-sabbi-neutral-50"
    }`}
  >
    {children}
  </button>
);

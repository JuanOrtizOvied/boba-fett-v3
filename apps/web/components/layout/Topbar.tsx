"use client";

import { useState, type FC } from "react";
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { DownloadIcon, SendIcon } from "@/components/icons/Icons";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

export type PortfolioView = "builder" | "resumen";

type TopbarProps = {
  activeView: PortfolioView;
  onChangeView: (view: PortfolioView) => void;
};

/**
 * Fixed top navigation bar: brand, view tabs ("Construir portafolio" /
 * "Resumen final"), and the export/send actions. Stays pinned above the
 * split layout — only the panels below scroll.
 */
export const Topbar: FC<TopbarProps> = ({ activeView, onChangeView }) => {
  const { user, logout } = useAuth();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetchWithAuth("/api/portfolio/me/export");
      if (!res.ok) return;
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="(.+)"/);
      const filename = match?.[1] ?? "portafolio-sabbi.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-sabbi-neutral-200 bg-background px-4">
      <div className="flex items-center gap-2">
        <div
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
          style={{ background: "var(--sabbi-lime)", color: "var(--sabbi-green)" }}
        >
          S
        </div>
        <span className="text-sm font-semibold tracking-wide text-sabbi-neutral-900">
          SABBI Portfolio Builder
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
          onClick={() => void handleExport()}
          disabled={isExporting}
          aria-label="Exportar"
          className="flex items-center gap-1.5 rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 transition-colors hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <DownloadIcon size={16} />
          <span className="hidden sm:inline">{isExporting ? "Exportando…" : "Exportar"}</span>
        </button>
        <span className="group relative">
          <button
            type="button"
            disabled
            aria-label="Enviar a SABBI"
            aria-describedby="sabbi-submit-tooltip"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--sabbi-lime)", color: "var(--sabbi-green)" }}
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
        {user?.role === "admin" && (
          <Link
            href="/admin"
            className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 transition-colors hover:bg-sabbi-neutral-50"
          >
            Admin
          </Link>
        )}
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Cerrar sesión"
          className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 transition-colors hover:bg-red-50 hover:text-red-600"
        >
          Salir
        </button>
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
        ? "text-sabbi-neutral-900"
        : "text-sabbi-neutral-600 hover:bg-sabbi-neutral-50"
    }`}
    style={active ? { backgroundColor: "var(--sabbi-lime)" } : undefined}
  >
    {children}
  </button>
);

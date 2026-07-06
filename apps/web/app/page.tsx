"use client";

import { useMemo, useState } from "react";
import { MyAssistant } from "./assistant";
import { Topbar, type PortfolioView } from "@/components/layout/Topbar";
import { PortfolioPanel } from "@/components/portfolio/PortfolioPanel";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";
import { getPortfolioId } from "@/lib/portfolioId";

/**
 * Root page: fixed topbar + view-dependent body.
 *
 * "Construir portafolio" (builder) renders the split layout — a fixed-width
 * chat panel and a fluid, independently-scrolling portfolio panel. Only the
 * portfolio panel scrolls; the topbar and the chat's header/input stay
 * pinned (`portfolio-dashboard.spec.md` → "Scroll vertical solo en el panel
 * de portafolio").
 *
 * "Resumen final" renders `PortfolioSummary` full-width, without the chat
 * panel (`portfolio-dashboard.spec.md` → "Vista de resumen final",
 * "Navegación entre vistas").
 *
 * Both `PortfolioPanel` and `PortfolioSummary` own their own data fetching
 * via independent `usePortfolio()` calls rather than lifted state — the
 * hook's 5s poll keeps them in sync with the same Postgres-backed portfolio,
 * so switching views never loses state (products live server-side, not in
 * this component tree).
 */
export default function Home() {
  const [view, setView] = useState<PortfolioView>("builder");
  const portfolioId = useMemo(() => getPortfolioId(), []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Topbar activeView={view} onChangeView={setView} portfolioId={portfolioId} />

      {view === "builder" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr]">
          <MyAssistant />
          <PortfolioPanel />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PortfolioSummary />
        </div>
      )}
    </div>
  );
}

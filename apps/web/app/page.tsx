"use client";

import { useState } from "react";
import { MyAssistant } from "./assistant";
import { Topbar, type PortfolioView } from "@/components/layout/Topbar";
import { PortfolioPlaceholder } from "@/components/portfolio/PortfolioPlaceholder";

/**
 * Root page: fixed topbar + view-dependent body.
 *
 * "Construir portafolio" (builder) renders the split layout — a fixed-width
 * chat panel and a fluid, independently-scrolling portfolio panel. Only the
 * portfolio panel scrolls; the topbar and the chat's header/input stay
 * pinned (`portfolio-dashboard.spec.md` → "Scroll vertical solo en el panel
 * de portafolio").
 *
 * "Resumen final" renders full-width, without the chat panel. The real
 * summary (donut chart + consolidated table) is built in Phase 4 (T-400+);
 * a placeholder keeps the view-switching state machinery testable now.
 */
export default function Home() {
  const [view, setView] = useState<PortfolioView>("builder");

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Topbar activeView={view} onChangeView={setView} />

      {view === "builder" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[340px_1fr]">
          <MyAssistant />
          <PortfolioPlaceholder />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-8">
          <p className="text-sm text-sabbi-neutral-600">
            Resumen final — próximamente.
          </p>
        </div>
      )}
    </div>
  );
}

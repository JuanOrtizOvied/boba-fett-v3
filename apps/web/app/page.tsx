"use client";

import { useState } from "react";
import { MyAssistant } from "./assistant";
import { Topbar, type PortfolioView } from "@/components/layout/Topbar";
import { PortfolioPanel } from "@/components/portfolio/PortfolioPanel";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";

// Auth-protected: `middleware.ts` redirects to `/login` before this page
// renders when the `sabbi_access` cookie is absent — no explicit auth check
// needed here.
export default function Home() {
  const [view, setView] = useState<PortfolioView>("builder");

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Topbar activeView={view} onChangeView={setView} />

      {view === "builder" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[40%_1fr]">
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

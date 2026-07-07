"use client";

import { useEffect, useState } from "react";
import { MyAssistant } from "./assistant";
import { Topbar, type PortfolioView } from "@/components/layout/Topbar";
import { PortfolioPanel } from "@/components/portfolio/PortfolioPanel";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";
import { getPortfolioId } from "@/lib/portfolioId";

export default function Home() {
  const [view, setView] = useState<PortfolioView>("builder");
  const [portfolioId, setPortfolioId] = useState("");

  useEffect(() => {
    setPortfolioId(getPortfolioId());
  }, []);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Topbar activeView={view} onChangeView={setView} portfolioId={portfolioId} />

      {view === "builder" ? (
        <div className="grid min-h-0 flex-1 grid-cols-[35%_1fr]">
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

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MyAssistant } from "./assistant";
import { Topbar, type PortfolioView } from "@/components/layout/Topbar";
import { PortfolioPanel } from "@/components/portfolio/PortfolioPanel";
import { PortfolioSummary } from "@/components/portfolio/PortfolioSummary";
import { useAuth } from "@/components/auth/AuthProvider";

export default function Home() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<PortfolioView>("builder");

  useEffect(() => {
    if (!isLoading && user?.role === "admin") {
      router.replace("/admin");
    }
  }, [user, isLoading, router]);

  if (isLoading || user?.role === "admin") return null;

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

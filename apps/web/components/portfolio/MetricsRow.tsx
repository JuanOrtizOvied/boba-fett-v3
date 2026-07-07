import type { FC } from "react";
import { CATEGORY_ORDER } from "@/lib/categories";
import { formatAbbreviatedUsd } from "@/lib/format";
import type { LargestPosition } from "@/lib/usePortfolio";

export interface MetricsRowProps {
  totalAmount: number;
  productCount: number;
  largestPosition: LargestPosition | null;
  categoriesUsedCount: number;
}

/**
 * Four at-a-glance metric cards: total invested, largest single position,
 * category coverage, and readiness status. Recomputed on every render from
 * `usePortfolio`'s derived values.
 * `portfolio-dashboard.spec.md` → "Métricas del portafolio en tiempo real".
 */
export const MetricsRow: FC<MetricsRowProps> = ({
  totalAmount,
  productCount,
  largestPosition,
  categoriesUsedCount,
}) => {
  const totalCategories = CATEGORY_ORDER.length;
  const isComplete = categoriesUsedCount === totalCategories;
  const isReady = productCount > 0;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard
        label="Total"
        value={formatAbbreviatedUsd(totalAmount)}
        subtext={`${productCount} producto${productCount === 1 ? "" : "s"}`}
      />
      <MetricCard
        label="Mayor posición"
        value={largestPosition ? `${largestPosition.percentage.toFixed(1)}%` : "—"}
        subtext={largestPosition?.product.name ?? "Sin productos"}
      />
      <MetricCard
        label="Categorías"
        value={`${categoriesUsedCount} de ${totalCategories}`}
        subtext={isComplete ? "Completo" : "Incompleto"}
      />
      <MetricCard
        label="Estado"
        value={isReady ? "Listo" : "Vacío"}
        subtext={isReady ? "Puedes enviarlo" : "Agrega productos"}
        tone={isReady ? "success" : "neutral"}
      />
    </div>
  );
};

const MetricCard: FC<{
  label: string;
  value: string;
  subtext: string;
  tone?: "success" | "neutral";
}> = ({ label, value, subtext, tone = "neutral" }) => (
  <div className="rounded-xl border border-sabbi-neutral-200 bg-background p-4">
    <p className="text-xs font-medium text-sabbi-neutral-600">{label}</p>
    <p
      className={`font-display mt-1 text-xl font-semibold ${
        tone === "success" ? "text-emerald-600" : "text-sabbi-neutral-900"
      }`}
    >
      {value}
    </p>
    <p className="mt-0.5 truncate text-xs text-sabbi-neutral-600">{subtext}</p>
  </div>
);

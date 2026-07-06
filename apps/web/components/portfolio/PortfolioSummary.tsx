"use client";

import { useMemo, type FC } from "react";
import { SummaryTable } from "@/components/portfolio/SummaryTable";
import { CATEGORY_META, CATEGORY_ORDER, categoryColorVar } from "@/lib/categories";
import { formatAbbreviatedUsd } from "@/lib/format";
import type { Category } from "@/lib/portfolio-types";
import { usePortfolio } from "@/lib/usePortfolio";

const DONUT_SIZE = 220;
const DONUT_STROKE = 28;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

interface CategorySlice {
  category: Category;
  amount: number;
  percentage: number;
}

/**
 * Full-width "Resumen final" view — the equivalent of the "Portafolio Final"
 * Excel sheet: a pure-SVG donut chart with a per-category legend, plus the
 * consolidated table. Uses its own `usePortfolio()` call (rather than lifted
 * state) so the builder and resumen views can be mounted independently; the
 * hook's 5s poll keeps both in sync with the same Postgres-backed portfolio.
 * `portfolio-dashboard.spec.md` → "Vista de resumen final", "Donut chart de
 * distribución".
 */
export const PortfolioSummary: FC = () => {
  const { products, isLoading, error, totalAmount, productCount } = usePortfolio();

  const slices = useMemo<CategorySlice[]>(() => {
    return CATEGORY_ORDER.map((category) => {
      const amount = products
        .filter((p) => p.category === category)
        .reduce((sum, p) => sum + p.amount, 0);
      return {
        category,
        amount,
        percentage: totalAmount > 0 ? (amount / totalAmount) * 100 : 0,
      };
    }).filter((slice) => slice.amount > 0);
  }, [products, totalAmount]);

  const isEmpty = !isLoading && products.length === 0;

  // Donut segments are drawn as stacked circles: each segment's dash-array
  // covers only its own arc length, and its dash-offset is the cumulative
  // percentage of every segment drawn before it. The whole group is rotated
  // -90deg so the first segment starts at 12 o'clock instead of 3 o'clock.
  let cumulativePercent = 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-xl font-semibold text-sabbi-neutral-900">
          Resumen final del portafolio
        </h1>
        <p className="mt-1 text-sm text-sabbi-neutral-600">
          Vista consolidada equivalente a la hoja &quot;Portafolio Final&quot;.
        </p>
      </header>

      {error && (
        <p className="text-sm text-red-600">
          No se pudo cargar el portafolio: {error}
        </p>
      )}

      {isEmpty ? (
        <p className="text-sm text-sabbi-neutral-600">
          Todavía no hay productos en el portafolio.
        </p>
      ) : (
        <>
          <section className="grid grid-cols-1 gap-8 lg:grid-cols-[auto_1fr] lg:items-center">
            <div
              className="relative mx-auto shrink-0"
              style={{ width: DONUT_SIZE, height: DONUT_SIZE }}
            >
              <svg
                width={DONUT_SIZE}
                height={DONUT_SIZE}
                viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
                role="img"
                aria-label="Distribución del portafolio por categoría"
              >
                <circle
                  cx={DONUT_SIZE / 2}
                  cy={DONUT_SIZE / 2}
                  r={DONUT_RADIUS}
                  fill="none"
                  stroke="var(--sabbi-neutral-100)"
                  strokeWidth={DONUT_STROKE}
                />
                {slices.map((slice) => {
                  const dashLength = (slice.percentage / 100) * DONUT_CIRCUMFERENCE;
                  const dashArray = `${dashLength} ${DONUT_CIRCUMFERENCE - dashLength}`;
                  const dashOffset = -((cumulativePercent / 100) * DONUT_CIRCUMFERENCE);
                  cumulativePercent += slice.percentage;
                  return (
                    <circle
                      key={slice.category}
                      cx={DONUT_SIZE / 2}
                      cy={DONUT_SIZE / 2}
                      r={DONUT_RADIUS}
                      fill="none"
                      stroke={categoryColorVar(slice.category)}
                      strokeWidth={DONUT_STROKE}
                      strokeDasharray={dashArray}
                      strokeDashoffset={dashOffset}
                      transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}
                    />
                  );
                })}
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-semibold text-sabbi-neutral-900">
                  {formatAbbreviatedUsd(totalAmount)}
                </span>
                <span className="text-xs text-sabbi-neutral-600">
                  {productCount} producto{productCount === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-3">
              {slices.map((slice) => {
                const meta = CATEGORY_META[slice.category];
                return (
                  <div key={slice.category} className="flex items-center gap-2 text-sm">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: categoryColorVar(slice.category) }}
                    />
                    <span className="truncate text-sabbi-neutral-700">{meta.label}</span>
                    <span className="ml-auto font-medium text-sabbi-neutral-900">
                      {slice.percentage.toFixed(1)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <SummaryTable products={products} totalAmount={totalAmount} />
        </>
      )}
    </div>
  );
};

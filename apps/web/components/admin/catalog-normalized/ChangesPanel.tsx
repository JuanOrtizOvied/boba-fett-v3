"use client";

import { useState } from "react";
import {
  productDayLabel,
  formatDay,
  totalProducts,
  totalsLabel,
  type DaySummary,
} from "@/lib/normalized-sync-events";
import { HistoryBody, useProductHistory } from "./ProductHistory";

/** Events of a product that is soft-deleted, read in place: the normal detail
 * does not load deleted products. */
function DeletedProductEvents({
  code,
  highlightDay,
}: {
  code: string;
  highlightDay: string;
}) {
  const history = useProductHistory(code);
  return (
    <div className="px-4 pb-3">
      <HistoryBody history={history} highlightDay={highlightDay} />
    </div>
  );
}

/** "Cambios de hoy": what the sync changed on one day, collapsed to a single
 * line with the totals. Read only. */
export default function ChangesPanel({
  summary,
  loading,
  error,
  selectedDate,
  onDateChange,
  filterOn,
  onToggleFilter,
  onSelectProduct,
  onRetry,
}: {
  summary: DaySummary | null;
  loading: boolean;
  error: string | null;
  /** `null` means today in Lima; the backend decides which day that is. */
  selectedDate: string | null;
  onDateChange: (date: string | null) => void;
  filterOn: boolean;
  onToggleFilter: () => void;
  onSelectProduct: (code: string) => void;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [expandedDeleted, setExpandedDeleted] = useState<string | null>(null);

  const hasEvents = summary !== null && totalProducts(summary.totals) > 0;
  const title =
    selectedDate === null ? "Cambios de hoy" : `Cambios del ${formatDay(selectedDate)}`;
  const status = error
    ? "no se pudo cargar"
    : summary === null
      ? "cargando…"
      : totalsLabel(summary.totals);
  const expanded = open && hasEvents;

  return (
    <section
      aria-label="Cambios de la sincronización"
      aria-busy={loading}
      className="rounded-xl border border-sabbi-neutral-200 bg-white"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
        <button
          type="button"
          aria-expanded={expanded}
          disabled={!hasEvents}
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          <span aria-hidden="true" className="text-xs text-sabbi-neutral-500">
            {expanded ? "▾" : "▸"}
          </span>
          <span className="text-sm font-semibold text-sabbi-neutral-900">{title}</span>{" "}
          <span
            className={`text-sm ${error ? "text-red-600" : "text-sabbi-neutral-600"}`}
          >
            {status}
          </span>
        </button>
        {error && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md px-2 py-1 text-xs font-medium text-sabbi-primary hover:bg-sabbi-neutral-50"
          >
            Reintentar
          </button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-sabbi-neutral-600">
          Fecha
          <input
            type="date"
            value={selectedDate ?? summary?.date ?? ""}
            onChange={(e) => onDateChange(e.target.value || null)}
            className="rounded-md border border-sabbi-neutral-200 px-2 py-1 text-xs text-sabbi-neutral-900"
          />
        </label>
      </div>

      {expanded && summary && (
        <div className="border-t border-sabbi-neutral-200">
          <ul className="max-h-80 divide-y divide-sabbi-neutral-200 overflow-auto">
            {summary.products.map((p) => {
              const isOpen = p.deleted && expandedDeleted === p.product_code;
              return (
                <li key={p.product_code}>
                  <button
                    type="button"
                    aria-expanded={p.deleted ? isOpen : undefined}
                    onClick={() =>
                      p.deleted
                        ? setExpandedDeleted(isOpen ? null : p.product_code)
                        : onSelectProduct(p.product_code)
                    }
                    className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2 text-left transition-colors hover:bg-[#f0fcd4]"
                  >
                    <span className="text-xs text-sabbi-neutral-500">
                      {p.product_code}
                    </span>{" "}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-sabbi-neutral-900">
                      {p.name}
                    </span>{" "}
                    {p.deleted && (
                      <>
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium tracking-wide whitespace-nowrap text-red-700 uppercase">
                          eliminado
                        </span>{" "}
                      </>
                    )}
                    <span className="text-xs text-sabbi-neutral-600">
                      {productDayLabel(p)}
                    </span>
                  </button>
                  {isOpen && (
                    <DeletedProductEvents
                      code={p.product_code}
                      highlightDay={summary.date}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <div className="border-t border-sabbi-neutral-200 px-4 py-2.5">
            <button
              type="button"
              aria-pressed={filterOn}
              onClick={onToggleFilter}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                filterOn
                  ? "border-sabbi-primary bg-sabbi-primary text-white"
                  : "border-sabbi-neutral-200 text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
              }`}
            >
              Filtrar productos con cambios
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

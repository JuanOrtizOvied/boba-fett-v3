"use client";

import type { AssetAllocation, SearchResult } from "@/lib/portfolio-types";
import { SOURCE_BADGES } from "@/components/admin/ficha-patrimonial/reviewTableShared";

const CONFIDENCE_PILL: Record<string, { label: string; className: string }> = {
  alta: { label: "Confianza alta", className: "bg-green-100 text-green-800 ring-green-300" },
  media: { label: "Confianza media", className: "bg-amber-100 text-amber-800 ring-amber-300" },
  baja: { label: "Confianza baja", className: "bg-red-100 text-red-700 ring-red-300" },
  sin_datos: {
    label: "Sin datos",
    className: "bg-sabbi-neutral-100 text-sabbi-neutral-600 ring-sabbi-neutral-300",
  },
};

function formatFraction(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

function AllocationList({ title, items }: { title: string; items: AssetAllocation[] }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-sabbi-neutral-500">{title}</span>
      <ul className="flex flex-col gap-0.5 text-sm text-sabbi-neutral-900">
        {items.map((a, i) => (
          <li key={i}>
            {a.name} — {a.percentage}%
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Read-only view of a `SearchResult` returned by the product-lookup cascade. */
export default function ProductLookupResult({ result }: { result: SearchResult }) {
  const badge = SOURCE_BADGES[result.primary_source] ?? SOURCE_BADGES.catalog;
  const confidence = result.confidence ? CONFIDENCE_PILL[result.confidence] : undefined;

  const fields: { label: string; value: string }[] = [
    { label: "Gestor", value: result.manager },
    { label: "Moneda", value: result.currency },
    { label: "Administrador", value: result.administrator },
    { label: "Comisión", value: result.commission },
    { label: "Liquidez", value: result.liquidity },
    { label: "Rentabilidad", value: result.return_rate },
    { label: "Ticker / ISIN", value: result.ticker_isin ?? "" },
    { label: "Horizonte", value: result.investment_horizon ?? "" },
  ].filter((f) => f.value && f.value.trim() !== "");

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-sabbi-neutral-200 bg-background p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-sabbi-neutral-900">{result.name}</h2>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
        {confidence && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${confidence.className}`}
          >
            {confidence.label}
          </span>
        )}
        {result.catalog_matched && (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
            En catálogo
          </span>
        )}
      </div>

      {result.web_search_insufficient && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          No se encontró información suficiente en la web para este producto. Los datos pueden
          estar incompletos.
        </p>
      )}

      {fields.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {fields.map((f) => (
            <div key={f.label} className="flex flex-col">
              <dt className="text-xs font-medium text-sabbi-neutral-500">{f.label}</dt>
              <dd className="text-sm text-sabbi-neutral-900">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <AllocationList title="Clase de activo" items={result.asset_class} />
        <AllocationList title="Foco geográfico" items={result.geographic_focus} />
        <AllocationList title="Subyacente" items={result.underlying} />
      </div>

      {result.series_options && result.series_options.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-sabbi-neutral-500">Series</span>
          <ul className="flex flex-col gap-2">
            {result.series_options.map((s, i) => (
              <li
                key={i}
                className="rounded-lg border border-sabbi-neutral-200 px-3 py-2 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sabbi-neutral-900">Serie {s.series}</span>
                  {s.confidence != null && (
                    <span
                      title={`Sugerido por Claude (búsqueda web): ${s.confidence}% de confianza`}
                      className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-300"
                    >
                      ✨ {s.confidence}%
                    </span>
                  )}
                  <span className="text-xs text-sabbi-neutral-500">
                    TER {formatFraction(s.management_fee_ter)}
                  </span>
                </div>
                {s.administrators.length > 0 && (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-sabbi-neutral-600">
                    {s.administrators.map((a, j) => (
                      <li key={j}>{a.administrator}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.sources && result.sources.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-sabbi-neutral-500">Fuentes</span>
          <ul className="flex flex-col gap-0.5 text-sm">
            {result.sources.map((src, i) => (
              <li key={i}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sabbi-primary underline hover:no-underline"
                >
                  {src.title || src.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

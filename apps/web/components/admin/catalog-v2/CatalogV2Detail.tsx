"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import {
  formatV2Allocations,
  formatV2Number,
  formatV2Range,
  formatV2Rate,
  formatV2Usd,
} from "@/lib/catalogV2Format";
import { ScoreEditor } from "./ScoreEditor";
import { v2ObservationDetail, type V2Observation } from "@/lib/catalogV2Observations";
import type { CatalogV2Product, CatalogV2ProductDetail, V2Series } from "@/lib/catalogV2Types";

export const EXCEL_HINT = "Este campo se edita desde el Excel";

const API = "/api/admin/catalog-v2";

export type ScoreKind = "managers" | "administrators";

/** Saves the score of a manager or an administrator. Rejects with a message the
 * editor shows when the API refuses. */
async function patchScore(kind: ScoreKind, id: number, score: number | null): Promise<void> {
  const res = await fetchWithAuth(`${API}/${kind}/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ score }),
  });
  if (!res.ok) throw new Error(`No se pudo guardar el score (status ${res.status})`);
}

/**
 * Nested detail of one product: its fields, then each series with its
 * administrators under it (custody, buy, sell and minimum). The workbook owns
 * all of it, so it is read-only here. The detail is fetched when the row opens.
 */
export function CatalogV2Detail({
  product,
  observations,
  onScoreChange,
}: {
  product: CatalogV2Product;
  observations: readonly V2Observation[];
  /** Called after a score is saved, so the page reloads its lists and banner. */
  onScoreChange: () => void;
}) {
  const [detail, setDetail] = useState<CatalogV2ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const params = product.is_deleted ? "?include_deleted=true" : "";
        const res = await fetchWithAuth(`/api/admin/catalog-v2/entries/${product.id}${params}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`No se pudo cargar el detalle (status ${res.status})`);
        setDetail(await res.json());
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
    return () => controller.abort();
  }, [product.id, product.is_deleted]);

  const saveManagerScore = async (score: number | null) => {
    if (product.manager_id === null) return;
    await patchScore("managers", product.manager_id, score);
    onScoreChange();
  };

  // The score belongs to the administrator, so it changes in every series that
  // lists it, not only in the one that was edited.
  const saveAdministratorScore = async (administratorId: number, score: number | null) => {
    await patchScore("administrators", administratorId, score);
    setDetail((current) =>
      current && {
        ...current,
        series: current.series.map((series) => ({
          ...series,
          administrators: series.administrators.map((link) =>
            link.administrator_id === administratorId
              ? { ...link, administrator_score: score }
              : link,
          ),
        })),
      },
    );
    onScoreChange();
  };

  return (
    <div className="flex flex-col gap-4 px-4 py-3 text-sm text-sabbi-neutral-900">
      <p className="text-xs text-sabbi-neutral-500">
        Este producto se gestiona desde el Excel (
        <span className="font-semibold">{product.codigo}</span>). Los campos se editan allá.
      </p>

      {observations.length > 0 && (
        <ul className="list-disc rounded-lg bg-amber-50 py-2 pr-3 pl-7 text-amber-900">
          {observations.map((observation) => (
            <li key={`${observation.field}:${observation.issue}:${observation.value}`}>
              {v2ObservationDetail(observation)}
            </li>
          ))}
        </ul>
      )}

      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="ISIN" value={product.isin} />
        <div>
          <dt className="text-xs font-medium text-sabbi-neutral-500">Gestor</dt>
          <dd className="flex flex-wrap items-center gap-x-2">
            <span title={EXCEL_HINT} className="rounded bg-sabbi-neutral-100 px-2 py-1 text-sabbi-neutral-700">
              {product.manager || "—"}
            </span>
            {product.manager_id !== null && (
              <span className="inline-flex items-center gap-1 text-xs text-sabbi-neutral-500">
                Score:
                <ScoreEditor
                  entityName={product.manager}
                  score={product.manager_score}
                  onSave={saveManagerScore}
                />
              </span>
            )}
          </dd>
        </div>
        <Field label="Clase de activo" value={formatV2Allocations(product.asset_class)} />
        <Field label="Foco geográfico" value={formatV2Allocations(product.geographic_focus)} />
        <Field label="Subyacente" value={formatV2Allocations(product.underlying)} />
        <Field label="Moneda" value={product.currency} />
        <Field label="Horizonte de inversión" value={product.investment_horizon} />
      </dl>

      {error && <p className="text-red-600">{error}</p>}
      {!detail && !error && <p className="text-sabbi-neutral-600">Cargando series…</p>}
      {detail &&
        (detail.series.length === 0 ? (
          <p className="text-sabbi-neutral-600">Este producto no tiene series.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.series.map((series) => (
              <SeriesBlock
                key={series.id}
                series={series}
                onSaveAdministratorScore={saveAdministratorScore}
              />
            ))}
          </ul>
        ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div title={EXCEL_HINT}>
      <dt className="text-xs font-medium text-sabbi-neutral-500">{label}</dt>
      <dd className="rounded bg-sabbi-neutral-100 px-2 py-1 text-sabbi-neutral-700">
        {value || "—"}
      </dd>
    </div>
  );
}

function SeriesBlock({
  series,
  onSaveAdministratorScore,
}: {
  series: V2Series;
  onSaveAdministratorScore: (administratorId: number, score: number | null) => Promise<void>;
}) {
  return (
    <li
      className={`rounded-lg border border-sabbi-neutral-200 bg-white ${series.is_deleted ? "opacity-60" : ""}`}
    >
      <div
        title={EXCEL_HINT}
        className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-sabbi-neutral-200 bg-sabbi-neutral-50 px-3 py-2"
      >
        <span className="font-medium">Serie {series.series || "—"}</span>
        {series.is_deleted && (
          <span className="rounded-full bg-sabbi-neutral-200 px-2 py-0.5 text-[10px] font-medium tracking-wide text-sabbi-neutral-600 uppercase">
            Eliminada
          </span>
        )}
        <span>TER: {formatV2Rate(series.ter)}</span>
        <span>Flujos: {formatV2Range(series.flows_min, series.flows_max, formatV2Number)}</span>
        <span>Rentabilidad: {formatV2Range(series.return_min, series.return_max)}</span>
      </div>
      {series.administrators.length === 0 ? (
        <p className="px-3 py-2 text-sabbi-neutral-600">Sin administradores.</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-xs font-medium tracking-wide text-sabbi-neutral-500 uppercase">
            <tr>
              <th className="px-3 py-1.5">Administrador</th>
              <th className="px-3 py-1.5">Score</th>
              <th className="px-3 py-1.5">Custodia</th>
              <th className="px-3 py-1.5">Compra</th>
              <th className="px-3 py-1.5">Venta</th>
              <th className="px-3 py-1.5">Mínimo</th>
              <th className="px-3 py-1.5">Comisión mínima</th>
            </tr>
          </thead>
          <tbody>
            {series.administrators.map((link) => (
              <tr
                key={link.id}
                className={`border-t border-sabbi-neutral-100 ${link.is_deleted ? "opacity-60" : ""}`}
              >
                <td className="px-3 py-1.5 font-medium">{link.administrator}</td>
                <td className="px-3 py-1.5">
                  <ScoreEditor
                    entityName={link.administrator}
                    score={link.administrator_score}
                    onSave={(score) => onSaveAdministratorScore(link.administrator_id, score)}
                  />
                </td>
                <td title={EXCEL_HINT} className="px-3 py-1.5">
                  {formatV2Rate(link.custody)}
                </td>
                <td title={EXCEL_HINT} className="px-3 py-1.5">
                  {formatV2Rate(link.buy_commission)}
                </td>
                <td title={EXCEL_HINT} className="px-3 py-1.5">
                  {formatV2Rate(link.sell_commission)}
                </td>
                <td title={EXCEL_HINT} className="px-3 py-1.5">
                  {formatV2Usd(link.minimum_usd)}
                </td>
                <td title={EXCEL_HINT} className="px-3 py-1.5">
                  {formatV2Usd(link.min_commission_usd)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

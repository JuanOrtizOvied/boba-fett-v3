"use client";

import { useState } from "react";
import { extractErrorDetail } from "./fichaUploadShared";
import {
  ASSET_CLASS_LABELS,
  SOURCE_BADGES,
  applySeriesAdminSelection,
  buildConfirmProducts,
  formatDeclaredSummary,
  formatSimilarityPercent,
  resolveConfidence,
  resolveRowSource,
  selectApprovedRows,
  toEditableRow,
  type EditableAdminRow,
  type EditableFichaRow,
  type EditableSeriesRow,
  type FichaAssetClassKey,
  type FichaLineStatus,
} from "./reviewTableShared";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { AssetAllocation, FichaEnrichedRow } from "@/lib/portfolio-types";

interface ReviewTableProps {
  rows: FichaEnrichedRow[];
  userId: string;
  onConfirmed: (createdCount: number) => void;
  /** Persist a per-line decision (Slice 3b) — only fired for rows with a
   * persisted `lineId` (i.e. a reloaded ficha). */
  onLineDecision?: (lineId: number, status: FichaLineStatus) => void;
}

const inputClass =
  "w-full rounded-lg border border-sabbi-neutral-200 px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

// -- Allocation editor --------------------------------------------------------

function AllocationEditor({
  label,
  allocations,
  onChange,
}: {
  label: string;
  allocations: AssetAllocation[];
  onChange: (next: AssetAllocation[]) => void;
}) {
  const total = allocations.reduce((sum, a) => sum + a.percentage, 0);
  const isValid = allocations.length === 0 || Math.abs(total - 100) < 0.01;

  const update = (i: number, patch: Partial<AssetAllocation>) => {
    onChange(allocations.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };
  const remove = (i: number) => onChange(allocations.filter((_, idx) => idx !== i));
  const add = () => onChange([...allocations, { name: "", percentage: 0 }]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-sabbi-neutral-500">{label}</span>
        {allocations.length > 0 && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              isValid ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {total.toFixed(0)}%
          </span>
        )}
      </div>

      {allocations.length === 0 && (
        <p className="text-xs text-sabbi-neutral-400">Sin asignación</p>
      )}

      <div className="flex flex-col gap-1.5">
        {allocations.map((a, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              value={a.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Nombre"
              className="flex-1 rounded-lg border border-sabbi-neutral-200 px-2 py-1 text-sm outline-none focus:border-sabbi-primary"
            />
            <div className="flex items-center gap-0.5">
              <input
                type="number"
                value={a.percentage}
                onChange={(e) => update(i, { percentage: Number(e.target.value) || 0 })}
                className="w-14 rounded-lg border border-sabbi-neutral-200 px-1.5 py-1 text-right text-sm outline-none focus:border-sabbi-primary"
                min={0}
                max={100}
              />
              <span className="text-xs text-sabbi-neutral-400">%</span>
            </div>
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded p-0.5 text-sabbi-neutral-400 hover:text-red-500"
              aria-label={`Eliminar ${a.name || "entrada"}`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={add}
        className="self-start rounded-lg border border-dashed border-sabbi-neutral-300 px-2 py-1 text-xs text-sabbi-neutral-600 hover:border-sabbi-primary hover:text-sabbi-primary"
      >
        + Agregar
      </button>
    </div>
  );
}

// -- Field label + input helper -----------------------------------------------

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-sabbi-neutral-500">{label}</label>
      {children}
    </div>
  );
}

// -- Series table (editable catalog series) -----------------------------------

const SERIES_COLUMNS: { key: keyof EditableSeriesRow; label: string }[] = [
  { key: "ter", label: "TER c/IGV" },
  { key: "flowsMin", label: "Flujos mín" },
  { key: "flowsMax", label: "Flujos máx" },
  { key: "returnMin", label: "Rent. mín" },
  { key: "returnMax", label: "Rent. máx" },
  { key: "minimumUsd", label: "Mínimo USD" },
  { key: "howCalculated", label: "Cómo se calculó" },
];

function SeriesTable({
  series,
  onChange,
}: {
  series: EditableSeriesRow[];
  onChange: (next: EditableSeriesRow[]) => void;
}) {
  const update = (index: number, patch: Partial<EditableSeriesRow>) => {
    onChange(series.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-sabbi-neutral-500">
        Series (porcentajes en %)
      </span>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-sabbi-neutral-500">
              <th className="px-1 py-1 font-medium">Serie</th>
              {SERIES_COLUMNS.map((c) => (
                <th key={c.key} className="px-1 py-1 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s, i) => (
              <tr key={s.series || i}>
                <td className="px-1 py-1 font-medium text-sabbi-neutral-700">
                  {s.series || "—"}
                </td>
                {SERIES_COLUMNS.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    <input
                      value={s[c.key]}
                      aria-label={`${c.label} serie ${s.series}`}
                      onChange={(e) => update(i, { [c.key]: e.target.value })}
                      className="w-20 rounded border border-sabbi-neutral-200 px-1.5 py-1 outline-none focus:border-sabbi-primary"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -- Administradores table (editable catalog admins) --------------------------

const ADMIN_COLUMNS: { key: keyof EditableAdminRow; label: string }[] = [
  { key: "custody", label: "Custodia %" },
  { key: "buy", label: "Compra %" },
  { key: "sell", label: "Venta %" },
  { key: "minimumUsd", label: "Mínimo USD" },
];

function AdminTable({
  admins,
  onChange,
}: {
  admins: EditableAdminRow[];
  onChange: (next: EditableAdminRow[]) => void;
}) {
  const update = (index: number, patch: Partial<EditableAdminRow>) => {
    onChange(admins.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-sabbi-neutral-500">
        Administradores
      </span>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-sabbi-neutral-500">
              <th className="px-1 py-1 font-medium">Administrador</th>
              <th className="px-1 py-1 font-medium">Serie</th>
              {ADMIN_COLUMNS.map((c) => (
                <th key={c.key} className="px-1 py-1 font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {admins.map((a, i) => (
              <tr key={`${a.administrator}-${a.series}-${i}`}>
                <td className="px-1 py-1 font-medium text-sabbi-neutral-700">
                  {a.administrator || "—"}
                </td>
                <td className="px-1 py-1 text-sabbi-neutral-700">
                  {a.series || "—"}
                </td>
                {ADMIN_COLUMNS.map((c) => (
                  <td key={c.key} className="px-1 py-1">
                    <input
                      value={a[c.key]}
                      aria-label={`${c.label} ${a.administrator} serie ${a.series}`}
                      onChange={(e) => update(i, { [c.key]: e.target.value })}
                      className="w-20 rounded border border-sabbi-neutral-200 px-1.5 py-1 outline-none focus:border-sabbi-primary"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -- Product card -------------------------------------------------------------

function ProductCard({
  row,
  rawRow,
  onUpdate,
}: {
  row: EditableFichaRow;
  rawRow: FichaEnrichedRow;
  onUpdate: (patch: Partial<EditableFichaRow>) => void;
}) {
  const isUnmapped = row.assetClass === "";
  const source = resolveRowSource(rawRow);
  const badge = SOURCE_BADGES[source];
  const confidence = resolveConfidence(rawRow);
  const declaredSummary = formatDeclaredSummary(rawRow);
  const similarity = formatSimilarityPercent(rawRow.enriched?.similarity);
  const catalogMatched = rawRow.enriched?.catalog_matched ?? false;
  const dataAsof = rawRow.enriched?.data_asof || "—";

  return (
    <div
      className={`rounded-xl border p-4 ${
        isUnmapped
          ? "border-amber-300 bg-amber-50/50"
          : "border-sabbi-neutral-200 bg-white"
      }`}
    >
      <div className="flex flex-col gap-4 md:flex-row">
        {/* Left rail: declared (raw) product — read-only */}
        <div className="flex w-full flex-col gap-2 md:w-56 md:shrink-0">
          <p className="text-sm font-medium italic text-sabbi-neutral-900">
            “{rawRow.raw_name}”
          </p>
          {declaredSummary && (
            <p className="text-xs text-sabbi-neutral-600">{declaredSummary}</p>
          )}
          <span
            className={`self-start rounded-full border px-2 py-0.5 text-[11px] font-medium ${badge.className}`}
          >
            {badge.label}
          </span>
          {similarity && (
            <span className="text-[11px] text-sabbi-neutral-500">
              similitud {similarity}
            </span>
          )}
        </div>

        {/* Right panel: enriched (editable) product */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {/* Confidence + status line */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${confidence.className}`}
            >
              {confidence.label}
            </span>
            <span className="text-xs text-sabbi-neutral-500">
              {catalogMatched ? "Producto existente" : "Producto nuevo"} · dato al{" "}
              {dataAsof}
            </span>
          </div>

          {/* Enriched fields */}
          <div className="flex flex-col gap-3">
            <Field label="Nombre del producto">
              <input
                value={row.name}
                aria-label="Nombre del producto"
                onChange={(e) => onUpdate({ name: e.target.value })}
                className={inputClass}
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Gestor">
                <input
                  value={row.manager}
                  aria-label="Gestor"
                  onChange={(e) => onUpdate({ manager: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Ticker / ISIN">
                <input
                  value={rawRow.enriched?.ticker_isin ?? ""}
                  aria-label="Ticker / ISIN"
                  readOnly
                  className={inputClass + " bg-sabbi-neutral-50"}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Moneda">
                <input
                  value={row.currency}
                  aria-label="Moneda"
                  onChange={(e) => onUpdate({ currency: e.target.value })}
                  className={inputClass}
                />
              </Field>
              <Field label="Horizonte">
                <input
                  value={rawRow.enriched?.investment_horizon ?? ""}
                  aria-label="Horizonte"
                  readOnly
                  className={inputClass + " bg-sabbi-neutral-50"}
                />
              </Field>
            </div>

            <Field label="Clase de activo">
              <select
                value={row.assetClass}
                onChange={(e) =>
                  onUpdate({ assetClass: e.target.value as FichaAssetClassKey | "" })
                }
                className={inputClass + (isUnmapped ? " border-amber-400" : "")}
              >
                <option value="">Seleccionar…</option>
                {(Object.keys(ASSET_CLASS_LABELS) as FichaAssetClassKey[]).map((key) => (
                  <option key={key} value={key}>
                    {ASSET_CLASS_LABELS[key]}
                  </option>
                ))}
              </select>
              {isUnmapped && (
                <p className="text-[11px] text-amber-700">
                  Sin mapear — seleccioná una clase de activo
                </p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <AllocationEditor
                label="Foco geográfico"
                allocations={row.geographicFocus}
                onChange={(next) => onUpdate({ geographicFocus: next })}
              />
              <AllocationEditor
                label="Subyacente"
                allocations={row.underlying}
                onChange={(next) => onUpdate({ underlying: next })}
              />
            </div>
          </div>

          {row.editableSeries.length > 0 && (
            <SeriesTable
              series={row.editableSeries}
              onChange={(next) => onUpdate({ editableSeries: next })}
            />
          )}

          {row.editableAdmins.length > 0 && (
            <AdminTable
              admins={row.editableAdmins}
              onChange={(next) => onUpdate({ editableAdmins: next })}
            />
          )}

          {row.seriesOptions.length > 0 && (
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-sabbi-neutral-50 p-2">
              <Field label="Serie del cliente">
                <select
                  value={row.selectedSeries}
                  aria-label="Serie"
                  onChange={(e) =>
                    onUpdate(applySeriesAdminSelection(row, e.target.value, ""))
                  }
                  className={inputClass}
                >
                  <option value="">Seleccionar…</option>
                  {row.seriesOptions.map((s) => (
                    <option key={s.series} value={s.series}>
                      {s.series}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Administrador del cliente">
                <select
                  value={row.selectedAdministrator}
                  aria-label="Administrador del catálogo"
                  disabled={!row.selectedSeries}
                  onChange={(e) =>
                    onUpdate(
                      applySeriesAdminSelection(row, row.selectedSeries, e.target.value),
                    )
                  }
                  className={inputClass + (!row.selectedSeries ? " opacity-60" : "")}
                >
                  <option value="">Seleccionar…</option>
                  {(
                    row.seriesOptions.find((s) => s.series === row.selectedSeries)
                      ?.administrators ?? []
                  ).map((a) => (
                    <option key={a.administrator} value={a.administrator}>
                      {a.administrator}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}

          {/* Per-line actions */}
          <div className="flex flex-wrap items-center gap-2 border-t border-sabbi-neutral-100 pt-3">
            <button
              type="button"
              onClick={() => onUpdate({ lineStatus: "approved" })}
              disabled={isUnmapped}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              Aprobar y crear producto
            </button>
            <button
              type="button"
              disabled
              title="Disponible en una próxima etapa"
              className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm text-sabbi-neutral-500 opacity-60"
            >
              Es un producto existente
            </button>
            <button
              type="button"
              disabled
              title="Disponible en una próxima etapa"
              className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm text-sabbi-neutral-500 opacity-60"
            >
              Volver a investigar
            </button>
            <button
              type="button"
              onClick={() => onUpdate({ lineStatus: "discarded" })}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
            >
              Descartar línea
            </button>
            {row.lineStatus === "approved" && (
              <span className="text-xs font-medium text-green-700">Aprobada</span>
            )}
            {row.lineStatus === "discarded" && (
              <span className="text-xs font-medium text-red-600">Descartada</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Main review component ----------------------------------------------------

export default function ReviewTable({
  rows,
  userId,
  onConfirmed,
  onLineDecision,
}: ReviewTableProps) {
  const [editableRows, setEditableRows] = useState<EditableFichaRow[]>(() =>
    rows.map(toEditableRow),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateRow = (index: number, patch: Partial<EditableFichaRow>) => {
    setEditableRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
    // Persist an approve/discard decision for a reloaded (persisted) line.
    if (patch.lineStatus && patch.lineStatus !== "pending") {
      const lineId = editableRows[index]?.lineId;
      if (lineId != null) onLineDecision?.(lineId, patch.lineStatus);
    }
  };

  const approvedRows = selectApprovedRows(editableRows);
  const confirmDisabled = isSubmitting || approvedRows.length === 0;

  const handleConfirm = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const products = buildConfirmProducts(selectApprovedRows(editableRows));
      const res = await fetchWithAuth("/api/admin/ficha-patrimonial/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, products }),
      });

      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          // not JSON
        }
        throw new Error(
          extractErrorDetail(
            body,
            `No se pudo confirmar la importación (status ${res.status})`,
          ),
        );
      }

      const data: { created_count: number } = await res.json();
      onConfirmed(data.created_count);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-4 max-h-[70vh] overflow-y-auto pr-1">
        {editableRows.map((row, index) => (
          <ProductCard
            key={row.excelRow}
            row={row}
            rawRow={rows[index]}
            onUpdate={(patch) => updateRow(index, patch)}
          />
        ))}
      </div>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      <div className="flex items-center justify-between">
        <p className="text-sm text-sabbi-neutral-600">
          {editableRows.length} producto{editableRows.length !== 1 ? "s" : ""}
        </p>
        <button
          type="button"
          disabled={confirmDisabled}
          onClick={() => void handleConfirm()}
          className="rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sabbi-primary-hover disabled:opacity-60"
        >
          {isSubmitting ? "Confirmando…" : "Confirmar"}
        </button>
      </div>
    </div>
  );
}

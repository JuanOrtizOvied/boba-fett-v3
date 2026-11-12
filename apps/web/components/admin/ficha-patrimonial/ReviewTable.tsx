"use client";

import { useState } from "react";
import { extractErrorDetail } from "./fichaUploadShared";
import { ProductReviewCard, inputClass } from "./productFormFields";
import {
  applyResearchToRow,
  buildApproveRequest,
  buildConfirmProducts,
  selectApprovedRows,
  toEditableRow,
  type EditableFichaRow,
  type FichaLineStatus,
} from "./reviewTableShared";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { researchFichaLine } from "@/lib/fichaApi";
import type { FichaApproveRequest, FichaEnrichedRow } from "@/lib/portfolio-types";

interface ReviewTableProps {
  rows: FichaEnrichedRow[];
  userId: string;
  onConfirmed: (createdCount: number) => void;
  /** Persist a per-line decision (Slice 3b) — only fired for rows with a
   * persisted `lineId` (i.e. a reloaded ficha). */
  onLineDecision?: (lineId: number, status: FichaLineStatus) => void;
  /** Approve one line (Slice: catalog curation) — curate the catalog + create
   * the client holding via the /approve endpoint. */
  onApprove?: (request: FichaApproveRequest) => void;
}


// -- Main review component ----------------------------------------------------

export default function ReviewTable({
  rows,
  userId,
  onConfirmed,
  onLineDecision,
  onApprove,
}: ReviewTableProps) {
  const [editableRows, setEditableRows] = useState<EditableFichaRow[]>(() =>
    rows.map(toEditableRow),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [researchingIndex, setResearchingIndex] = useState<number | null>(null);
  // When the ficha has no associated user, the admin creates one here
  // (email + nombres + apellidos + contraseña) and the products are created
  // under it. See `confirm_ficha_patrimonial` (backend) `new_client`.
  const [newClient, setNewClient] = useState({
    email: "",
    first_name: "",
    last_name: "",
    password: "",
  });

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

  const approveRow = (index: number) => {
    updateRow(index, { lineStatus: "approved" });
    onApprove?.(buildApproveRequest(editableRows[index], userId));
  };

  const researchRow = async (index: number) => {
    const current = editableRows[index];
    if (!current) return;
    setErrorMessage(null);
    setNotice(null);
    setResearchingIndex(index);
    const declaredName = rows[index].raw_name || current.name;
    try {
      // Search by the ficha's DECLARED name (left rail), not the editable form
      // field — which may hold a wrong prior enrichment.
      const result = await researchFichaLine(declaredName);
      updateRow(index, applyResearchToRow(current, result));
      // The search ran but found no useful data (even after the backend's
      // reformulated retry) — tell the admin instead of leaving empty fields
      // that look like a failure.
      if (result.web_search_insufficient) {
        setNotice(
          `No se encontró información suficiente en la web para «${declaredName}». ` +
            "Revisá o completá los datos manualmente.",
        );
      }
    } catch {
      setErrorMessage("No se pudo investigar el producto con la búsqueda web.");
    } finally {
      setResearchingIndex(null);
    }
  };

  const approvedRows = selectApprovedRows(editableRows);
  const hasUser = userId.trim().length > 0;
  const newClientComplete =
    newClient.email.trim().length > 0 &&
    newClient.first_name.trim().length > 0 &&
    newClient.last_name.trim().length > 0 &&
    newClient.password.length >= 8;
  const confirmDisabled =
    isSubmitting ||
    approvedRows.length === 0 ||
    (!hasUser && !newClientComplete);

  const handleConfirm = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const products = buildConfirmProducts(selectApprovedRows(editableRows));
      // Existing user → confirm under it. No user → create the client account
      // from the form (`new_client`); the backend creates user + products
      // atomically. 409 means the email is already taken.
      const payload = hasUser
        ? { user_id: userId, products }
        : {
            user_id: "",
            new_client: {
              email: newClient.email.trim(),
              first_name: newClient.first_name.trim(),
              last_name: newClient.last_name.trim(),
              password: newClient.password,
            },
            products,
          };
      const res = await fetchWithAuth("/api/admin/ficha-patrimonial/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
        {editableRows.map((row, index) => {
          const catalogMatched = row.enriched?.catalog_matched ?? false;
          const isUnmapped = row.assetClass === "";
          return (
            <ProductReviewCard
              key={row.excelRow}
              row={row}
              rawRow={rows[index]}
              onUpdate={(patch) => updateRow(index, patch)}
              onResearch={() => researchRow(index)}
              researching={researchingIndex === index}
              footer={
                <>
                  <button
                    type="button"
                    onClick={() => approveRow(index)}
                    disabled={isUnmapped}
                    className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
                  >
                    {catalogMatched
                      ? "Es un producto existente"
                      : "Aprobar y crear producto"}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateRow(index, { lineStatus: "discarded" })}
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
                </>
              }
            />
          );
        })}
      </div>

      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {notice}
        </p>
      )}

      {!hasUser && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm text-amber-700">
            Esta ficha no tiene un cliente asociado. Crea la cuenta del cliente
            para poder confirmar la importación.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-sabbi-neutral-700">
              Email
              <input
                type="email"
                aria-label="Email del cliente"
                value={newClient.email}
                onChange={(e) =>
                  setNewClient((c) => ({ ...c, email: e.target.value }))
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-sabbi-neutral-700">
              Contraseña
              <input
                type="password"
                aria-label="Contraseña del cliente"
                value={newClient.password}
                onChange={(e) =>
                  setNewClient((c) => ({ ...c, password: e.target.value }))
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-sabbi-neutral-700">
              Nombres
              <input
                type="text"
                aria-label="Nombres del cliente"
                value={newClient.first_name}
                onChange={(e) =>
                  setNewClient((c) => ({ ...c, first_name: e.target.value }))
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-sabbi-neutral-700">
              Apellidos
              <input
                type="text"
                aria-label="Apellidos del cliente"
                value={newClient.last_name}
                onChange={(e) =>
                  setNewClient((c) => ({ ...c, last_name: e.target.value }))
                }
                className={inputClass}
              />
            </label>
          </div>
          <p className="text-xs text-sabbi-neutral-500">
            La contraseña debe tener al menos 8 caracteres.
          </p>
        </div>
      )}

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

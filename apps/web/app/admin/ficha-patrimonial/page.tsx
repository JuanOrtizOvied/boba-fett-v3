"use client";

import { useCallback, useEffect, useState } from "react";
import FichaSidebar, {
  type FichaFilter,
} from "@/components/admin/ficha-patrimonial/FichaSidebar";
import FichaSummaryBar from "@/components/admin/ficha-patrimonial/FichaSummaryBar";
import ReviewTable from "@/components/admin/ficha-patrimonial/ReviewTable";
import UploadZone from "@/components/admin/ficha-patrimonial/UploadZone";
import {
  extractBase64Payload,
  extractErrorDetail,
  readFileAsBase64,
} from "@/components/admin/ficha-patrimonial/fichaUploadShared";
import {
  approveFichaLine,
  confirmFicha,
  deleteFicha,
  downloadFichaFile,
  fichaToEnrichedRows,
  getFicha,
  listFichas,
  updateLineStatus,
} from "@/lib/fichaApi";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/components/ui/Toast";
import type {
  FichaApproveRequest,
  FichaEnrichedRow,
  FichaListItem,
  FichaParseResponse,
  LineStatus,
} from "@/lib/portfolio-types";

type PageState = "idle" | "loading" | "review" | "success";

interface ReviewData {
  clientName: string;
  clientEmail: string;
  userId: string;
  rows: FichaEnrichedRow[];
}

/**
 * Admin "Ficha Patrimonial" validation workbench. Left sidebar lists the saved
 * fichas (by status); the main pane uploads/parses a new ficha or loads a saved
 * one for review and confirm.
 */
export default function FichaPatrimonialPage() {
  const { toast } = useToast();
  const [state, setState] = useState<PageState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewData | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const [fichas, setFichas] = useState<FichaListItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<FichaFilter>("todas");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const refreshList = useCallback(async (filter: FichaFilter) => {
    try {
      const data = await listFichas(filter === "todas" ? undefined : filter);
      setFichas(Array.isArray(data) ? data : []);
    } catch {
      setFichas([]);
    }
  }, []);

  useEffect(() => {
    void refreshList(activeFilter);
  }, [activeFilter, refreshList]);

  const handleFileSelected = async (file: File) => {
    setError(null);
    setState("loading");
    try {
      const dataUrl = await readFileAsBase64(file);
      const res = await fetchWithAuth("/api/admin/ficha-patrimonial/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_data: extractBase64Payload(dataUrl),
          file_name: file.name,
        }),
      });

      if (!res.ok) {
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          // Response wasn't JSON; fall back to the generic message below.
        }
        throw new Error(
          extractErrorDetail(
            body,
            `No se pudo analizar la ficha (status ${res.status})`,
          ),
        );
      }

      const data: FichaParseResponse = await res.json();
      setReview({
        clientName: data.client.name,
        clientEmail: data.client.email,
        userId: data.client.user_id,
        rows: data.rows,
      });
      setSelectedId(data.ficha_id ?? null);
      setState("review");
      void refreshList(activeFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setReview(null);
      setState("idle");
    }
  };

  const handleSelectFicha = async (id: number) => {
    setError(null);
    try {
      const ficha = await getFicha(id);
      setReview({
        clientName: ficha.client_name,
        clientEmail: ficha.client_email,
        userId: ficha.user_id ?? "",
        rows: fichaToEnrichedRows(ficha),
      });
      setSelectedId(id);
      setState("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar la ficha");
    }
  };

  const handleReset = () => {
    setReview(null);
    setError(null);
    setImportedCount(0);
    setSelectedId(null);
    setState("idle");
  };

  const handleConfirmed = (createdCount: number) => {
    setImportedCount(createdCount);
    setReview(null);
    setState("success");
    if (selectedId != null) void confirmFicha(selectedId).catch(() => {});
    void refreshList(activeFilter);
  };

  const handleLineDecision = (lineId: number, status: LineStatus) => {
    void updateLineStatus(lineId, status).catch(() => {});
  };

  const handleApprove = (request: FichaApproveRequest) => {
    void approveFichaLine(request)
      .then((res) => {
        const created = (res.catalog_changes as { created?: string })?.created;
        toast(
          created
            ? `Producto creado en el catálogo (${created})`
            : "Producto actualizado en el catálogo",
          "success",
        );
        return refreshList(activeFilter);
      })
      .catch(() => {
        toast("No se pudo actualizar el producto. Intenta de nuevo.", "error");
      });
  };

  const handleDeleteFicha = (id: number) => {
    void deleteFicha(id)
      .then(() => {
        if (selectedId === id) handleReset();
        return refreshList(activeFilter);
      })
      .catch(() => {});
  };

  const handleDownloadFicha = (id: number) => {
    void downloadFichaFile(id).catch((err) =>
      setError(err instanceof Error ? err.message : "No se pudo descargar el archivo"),
    );
  };

  return (
    <div className="flex gap-4">
      <FichaSidebar
        fichas={fichas}
        activeFilter={activeFilter}
        selectedId={selectedId}
        onFilterChange={setActiveFilter}
        onSelect={(id) => void handleSelectFicha(id)}
        onUpload={handleReset}
        onDelete={handleDeleteFicha}
        onDownload={handleDownloadFicha}
      />

      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">
          Ficha Patrimonial
        </h1>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {(state === "idle" || state === "loading") && (
          <UploadZone
            onFileSelected={(file) => void handleFileSelected(file)}
            disabled={state === "loading"}
          />
        )}

        {state === "loading" && (
          <div className="flex items-center gap-2 text-sm text-sabbi-neutral-600">
            <div className="size-4 animate-spin rounded-full border-2 border-sabbi-neutral-200 border-t-sabbi-primary" />
            Analizando ficha patrimonial… esto puede tardar hasta un minuto.
          </div>
        )}

        {state === "review" && review && (
          <div className="flex flex-col gap-3">
            <div className="rounded-xl border border-sabbi-neutral-200 p-4">
              <p className="text-sm text-sabbi-neutral-900">
                Cliente: {review.clientName || "—"} ({review.clientEmail})
              </p>
              <p className="text-sm text-sabbi-neutral-600">
                {review.rows.length} fila
                {review.rows.length === 1 ? "" : "s"} lista
                {review.rows.length === 1 ? "" : "s"} para revisar.
              </p>
            </div>
            <FichaSummaryBar rows={review.rows} />
            <ReviewTable
              rows={review.rows}
              userId={review.userId}
              onConfirmed={handleConfirmed}
              onLineDecision={handleLineDecision}
              onApprove={handleApprove}
            />
            <button
              type="button"
              onClick={handleReset}
              className="self-start rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
            >
              Cargar otra ficha
            </button>
          </div>
        )}

        {state === "success" && (
          <div className="flex flex-col gap-3 rounded-xl border border-sabbi-neutral-200 p-4">
            <p className="text-sm text-sabbi-neutral-900">
              Se importaron {importedCount} producto
              {importedCount === 1 ? "" : "s"} correctamente.
            </p>
            <button
              type="button"
              onClick={handleReset}
              className="self-start rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover"
            >
              Cargar otra ficha
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

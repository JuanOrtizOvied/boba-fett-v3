"use client";

import { useState } from "react";
import ReviewTable from "@/components/admin/ficha-patrimonial/ReviewTable";
import UploadZone from "@/components/admin/ficha-patrimonial/UploadZone";
import {
  extractBase64Payload,
  extractErrorDetail,
  readFileAsBase64,
} from "@/components/admin/ficha-patrimonial/fichaUploadShared";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { FichaParseResponse } from "@/lib/portfolio-types";

type PageState = "idle" | "loading" | "review" | "success";

/**
 * Admin page for bulk-importing a "Ficha Patrimonial" Excel workbook
 * (`sdd/admin-ficha-patrimonial/spec` -> "Ficha Upload Page"). Four states:
 * `idle` (upload zone), `loading` (parse+enrich in flight, ~60s), `review`
 * (parsed rows in `ReviewTable` for admin editing + confirm), `success`
 * (post-confirm summary — spec: "Bulk Confirm and Success Summary").
 */
export default function FichaPatrimonialPage() {
  const [state, setState] = useState<PageState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<FichaParseResponse | null>(
    null,
  );
  const [importedCount, setImportedCount] = useState(0);

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
      setParseResult(data);
      setState("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
      setParseResult(null);
      setState("idle");
    }
  };

  const handleReset = () => {
    setParseResult(null);
    setError(null);
    setImportedCount(0);
    setState("idle");
  };

  const handleConfirmed = (createdCount: number) => {
    setImportedCount(createdCount);
    setParseResult(null);
    setState("success");
  };

  return (
    <div className="flex flex-col gap-4">
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

      {state === "review" && parseResult && (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-sabbi-neutral-200 p-4">
            <p className="text-sm text-sabbi-neutral-900">
              Cliente: {parseResult.client.name || "—"} (
              {parseResult.client.email})
            </p>
            <p className="text-sm text-sabbi-neutral-600">
              {parseResult.rows.length} fila
              {parseResult.rows.length === 1 ? "" : "s"} lista
              {parseResult.rows.length === 1 ? "" : "s"} para revisar.
            </p>
          </div>
          <ReviewTable
            rows={parseResult.rows}
            userId={parseResult.client.user_id}
            onConfirmed={handleConfirmed}
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
    </div>
  );
}

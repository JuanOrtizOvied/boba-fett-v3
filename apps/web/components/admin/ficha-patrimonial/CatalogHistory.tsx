"use client";

import { useState } from "react";
import { getCatalogHistory } from "@/lib/fichaApi";
import type { CatalogHistoryEntry } from "@/lib/portfolio-types";
import { summarizeCatalogHistoryEntry } from "./reviewTableShared";

/** Formats an ISO timestamp as a short local date; returns "" when absent. */
function formatDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

/**
 * Collapsible "Historial de cambios" section for a matched V2 catalog product.
 * Loads the product's change history on demand (`GET .../history`) and renders
 * each entry's action, date, and summarized field changes.
 */
export default function CatalogHistory({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<CatalogHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && entries === null && !loading) {
      setLoading(true);
      setError(null);
      try {
        setEntries(await getCatalogHistory(code));
      } catch {
        setError("No se pudo cargar el historial");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="self-start text-xs font-medium text-sabbi-primary underline hover:no-underline"
      >
        Historial de cambios {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="flex flex-col gap-2 text-xs text-sabbi-neutral-600">
          {loading && <p>Cargando…</p>}
          {error && <p className="text-red-600">{error}</p>}
          {!loading && !error && entries?.length === 0 && (
            <p className="text-sabbi-neutral-400">Sin cambios registrados</p>
          )}
          {!loading &&
            !error &&
            entries?.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-sabbi-neutral-200 p-2"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                      entry.action === "create"
                        ? "bg-green-50 text-green-700"
                        : "bg-blue-50 text-blue-700"
                    }`}
                  >
                    {entry.action === "create" ? "Creación" : "Actualización"}
                  </span>
                  <span className="text-sabbi-neutral-400">
                    {formatDate(entry.created_at)}
                  </span>
                </div>
                <ul className="mt-1 list-disc pl-5">
                  {summarizeCatalogHistoryEntry(entry).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

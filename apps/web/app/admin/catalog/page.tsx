"use client";

import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { CatalogProduct } from "@/lib/portfolio-types";
import { useToast } from "@/components/ui/Toast";

const CATALOG_COLUMNS: { key: keyof CatalogProduct; label: string }[] = [
  { key: "name", label: "Nombre" },
  { key: "category", label: "Categoría" },
  { key: "subcategory", label: "Subcategoría" },
  { key: "asset_class", label: "Clase de activo" },
  { key: "geographic_focus", label: "Foco geográfico" },
  { key: "underlying", label: "Subyacente" },
  { key: "commission", label: "Comisión" },
  { key: "currency", label: "Moneda" },
  { key: "administrator", label: "Administrador" },
  { key: "manager", label: "Gestor" },
  { key: "liquidity", label: "Liquidez" },
  { key: "return_rate", label: "Rendimiento" },
];

/**
 * Catalog management page (`sdd/product-catalog-approval/spec` -> "Catalog
 * Listing", "Catalog Entry Deletion"). Lists every `product_catalog` row and
 * lets an admin delete entries — no inline editing in this version, deletion
 * is the only supported mutation after approval.
 */
export default function AdminCatalogPage() {
  const { toast } = useToast();
  const [entries, setEntries] = useState<CatalogProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/catalog/entries");
        if (!res.ok) {
          throw new Error(
            `No se pudo cargar el catálogo (status ${res.status})`,
          );
        }
        const data: CatalogProduct[] = await res.json();
        setEntries(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, []);

  const handleDelete = async (id: number) => {
    const previous = entries ?? [];
    setDeletingId(id);
    setEntries(previous.filter((entry) => entry.id !== id));

    try {
      const res = await fetchWithAuth(`/api/admin/catalog/entries/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`No se pudo eliminar la entrada (status ${res.status})`);
      }
    } catch (err) {
      // Delete failed — restore the row instead of leaving the list stale.
      setEntries(previous);
      toast(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">Catálogo</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {entries === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : entries && entries.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">
          No hay entradas en el catálogo.
        </p>
      ) : (
        entries && (
          <div className="overflow-x-auto rounded-xl border border-sabbi-neutral-200 bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-sabbi-neutral-50 text-xs font-medium tracking-wide text-sabbi-neutral-600 uppercase">
                <tr>
                  {CATALOG_COLUMNS.map((column) => (
                    <th key={column.key} className="px-4 py-2 whitespace-nowrap">
                      {column.label}
                    </th>
                  ))}
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-sabbi-neutral-200">
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    {CATALOG_COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className="px-4 py-2 whitespace-nowrap text-sabbi-neutral-900"
                      >
                        {entry[column.key] || "—"}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        disabled={deletingId === entry.id}
                        onClick={() => void handleDelete(entry.id)}
                        className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50"
                      >
                        {deletingId === entry.id ? "Eliminando…" : "Eliminar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { formatUsd } from "@/lib/format";

interface AdminPortfolioSummary {
  user_id: string;
  email: string;
  product_count: number;
  total: number;
}

/**
 * All-portfolios overview (`admin-panel/spec.md` -> "Admin lists all
 * portfolios").
 */
export default function AdminPortfoliosPage() {
  const [portfolios, setPortfolios] = useState<AdminPortfolioSummary[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/portfolios");
        if (!res.ok) {
          throw new Error(
            `No se pudo cargar la lista de portafolios (status ${res.status})`,
          );
        }
        const data: AdminPortfolioSummary[] = await res.json();
        setPortfolios(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">Portafolios</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {portfolios === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : portfolios && portfolios.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">No hay portafolios.</p>
      ) : (
        portfolios && (
          <div className="overflow-hidden rounded-xl border border-sabbi-neutral-200 bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-sabbi-neutral-50 text-xs font-medium tracking-wide text-sabbi-neutral-600 uppercase">
                <tr>
                  <th className="px-4 py-2">Usuario</th>
                  <th className="px-4 py-2">Productos</th>
                  <th className="px-4 py-2">Total</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-sabbi-neutral-200">
                {portfolios.map((p) => (
                  <tr key={p.user_id}>
                    <td className="px-4 py-2 text-sabbi-neutral-900">{p.email}</td>
                    <td className="px-4 py-2 text-sabbi-neutral-600">
                      {p.product_count}
                    </td>
                    <td className="px-4 py-2 font-display font-medium text-sabbi-neutral-900">
                      {formatUsd(p.total)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/admin/portfolios/${p.user_id}`}
                        className="text-sm font-medium text-sabbi-primary hover:underline"
                      >
                        Ver
                      </Link>
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

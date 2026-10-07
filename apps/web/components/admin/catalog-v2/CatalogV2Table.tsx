"use client";

import { Fragment, useState } from "react";
import { ChevronDownIcon, RestoreIcon } from "@/components/icons/Icons";
import { formatV2Score } from "@/lib/catalogV2Format";
import { getV2Observations } from "@/lib/catalogV2Observations";
import type { CatalogV2Options, CatalogV2Product } from "@/lib/catalogV2Types";
import { CatalogV2Detail } from "./CatalogV2Detail";

const COLUMN_COUNT = 9;

/**
 * Read-only table of the v2 catalog. A row opens into its detail (series with
 * their administrators). The only action is restoring a deleted product; the
 * workbook decides everything else.
 */
export function CatalogV2Table({
  products,
  options,
  restoringId,
  onRestore,
  onScoreChange,
}: {
  products: readonly CatalogV2Product[];
  options: CatalogV2Options;
  restoringId: number | null;
  onRestore: (id: number) => void;
  onScoreChange: () => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="max-h-[75vh] overflow-auto rounded-xl border border-sabbi-neutral-200">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-sabbi-neutral-50 text-xs font-medium tracking-wide text-sabbi-neutral-600 uppercase">
          <tr>
            <th className="w-10 px-3 py-2" aria-label="Detalle" />
            <th className="px-4 py-2 whitespace-nowrap">Código</th>
            <th className="px-4 py-2 whitespace-nowrap">Producto</th>
            <th className="px-4 py-2 whitespace-nowrap">Gestor</th>
            <th className="px-4 py-2 whitespace-nowrap">Administradores</th>
            <th className="px-4 py-2 whitespace-nowrap">Moneda</th>
            <th className="px-4 py-2 whitespace-nowrap">Horizonte</th>
            <th className="px-4 py-2 whitespace-nowrap">Series</th>
            <th className="px-4 py-2 text-center whitespace-nowrap">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sabbi-neutral-100 bg-white">
          {products.map((product) => {
            const observations = getV2Observations(product, options);
            const expanded = expandedId === product.id;
            return (
              <Fragment key={product.id}>
                <tr
                  className={`transition-colors hover:bg-sabbi-neutral-50 ${product.is_deleted ? "bg-sabbi-neutral-50 text-sabbi-neutral-500" : ""}`}
                >
                  <td className="w-10 px-3 py-2">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "Ocultar" : "Ver"} detalle de ${product.name}`}
                      onClick={() => setExpandedId(expanded ? null : product.id)}
                      className="rounded-md p-1 text-sabbi-neutral-500 hover:bg-sabbi-neutral-100"
                    >
                      <ChevronDownIcon
                        size={16}
                        className={`transition-transform ${expanded ? "rotate-180" : ""}`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{product.codigo}</td>
                  <td className="px-4 py-2 font-medium text-sabbi-neutral-900">
                    <span className={product.is_deleted ? "text-sabbi-neutral-500" : ""}>
                      {product.name || "—"}
                    </span>
                    {product.is_deleted && (
                      <span className="ml-2 rounded-full bg-sabbi-neutral-200 px-2 py-0.5 text-[10px] font-medium tracking-wide text-sabbi-neutral-600 uppercase">
                        Eliminado
                      </span>
                    )}
                    {observations.length > 0 && (
                      <button
                        type="button"
                        aria-label={`Ver observaciones de ${product.name}`}
                        onClick={() => setExpandedId(product.id)}
                        className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium tracking-wide text-amber-800 uppercase hover:bg-amber-200"
                      >
                        {observations.length}{" "}
                        {observations.length === 1 ? "observación" : "observaciones"}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {product.manager || "—"}
                    {product.manager && (
                      <span
                        className={`ml-1.5 text-xs ${product.manager_score === null ? "text-amber-700" : "text-sabbi-neutral-500"}`}
                      >
                        ({formatV2Score(product.manager_score)})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {product.administrators.length === 0
                      ? "—"
                      : product.administrators.map((administrator, index) => (
                          <span key={administrator.id} className="whitespace-nowrap">
                            {index > 0 && ", "}
                            {administrator.name}
                            {administrator.score === null && (
                              <span className="ml-1 text-xs text-amber-700">(sin score)</span>
                            )}
                          </span>
                        ))}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{product.currency || "—"}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {product.investment_horizon || "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{product.series_count}</td>
                  <td className="px-4 py-2 text-center whitespace-nowrap">
                    {product.is_deleted && (
                      <button
                        type="button"
                        title="Restaurar"
                        aria-label={`Restaurar ${product.name}`}
                        disabled={restoringId === product.id}
                        onClick={() => onRestore(product.id)}
                        className="rounded-md p-1.5 text-sabbi-neutral-500 transition-colors hover:bg-green-50 hover:text-green-700 disabled:opacity-50"
                      >
                        <RestoreIcon size={16} />
                      </button>
                    )}
                  </td>
                </tr>
                {expanded && (
                  <tr className="bg-sabbi-neutral-50">
                    <td colSpan={COLUMN_COUNT} className="p-0">
                      <CatalogV2Detail
                        product={product}
                        observations={observations}
                        onScoreChange={onScoreChange}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

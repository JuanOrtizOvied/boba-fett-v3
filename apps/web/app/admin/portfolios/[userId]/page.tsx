"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CATEGORY_META } from "@/lib/categories";
import { compositionColor } from "@/lib/compositionPalette";
import { formatUsd } from "@/lib/format";
import type { Product } from "@/lib/portfolio-types";

/**
 * Read-only view of a single user's portfolio (`admin-panel/spec.md` ->
 * "Admin views a user's portfolio"). No edit/delete/add-product controls
 * exist here on purpose — the backend exposes no mutation endpoint under
 * `/admin/portfolios/:userId` either (`admin-panel/spec.md` -> "Admin
 * cannot mutate another user's portfolio").
 */
export default function AdminPortfolioViewPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/admin/portfolios/${userId}`);
        if (!res.ok) {
          throw new Error(
            `No se pudo cargar el portafolio (status ${res.status})`,
          );
        }
        const data: { products: Product[] } = await res.json();
        setProducts(data.products);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, [userId]);

  const total = (products ?? []).reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">Portafolio</h1>
        {products && (
          <span className="font-display text-base font-semibold text-sabbi-neutral-900">
            {formatUsd(total)}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {products === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : products && products.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">
          Este usuario no tiene productos.
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
          {products?.map((product) => (
            <ReadOnlyProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Visually mirrors `ProductCard`'s "view" state but drops the edit/delete
 * affordances entirely. Implemented as a local, page-scoped component
 * rather than adding an optional read-only prop to the shared `ProductCard`
 * (used by the mutable portfolio-builder flow) — keeps that component's
 * contract unchanged for its existing consumers.
 */
function ReadOnlyProductCard({ product }: { product: Product }) {
  const meta = CATEGORY_META[product.category];

  return (
    <div className="flex flex-col gap-3 overflow-hidden rounded-xl border border-sabbi-neutral-200 bg-background p-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-sabbi-neutral-900">
          {product.name}
        </p>
        {product.provider && (
          <p className="truncate text-xs text-sabbi-neutral-600">
            {product.provider}
          </p>
        )}
      </div>

      <p className="font-display text-lg font-semibold text-sabbi-neutral-900">
        {formatUsd(product.amount)}
      </p>

      {product.composition.length > 0 && (
        <div className="flex h-2 overflow-hidden rounded-full bg-sabbi-neutral-100">
          {product.composition.map((asset, index) => (
            <div
              key={`${asset.name}-${index}`}
              style={{
                width: `${asset.percentage}%`,
                backgroundColor: compositionColor(index),
              }}
            />
          ))}
        </div>
      )}

      <span
        className="w-fit rounded-full px-2 py-0.5 text-xs font-medium text-white"
        style={{ backgroundColor: `var(${meta.cssVar})` }}
      >
        {meta.shortLabel}
      </span>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { CATEGORY_META, CATEGORY_ORDER } from "@/lib/categories";
import { formatUsd } from "@/lib/format";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { CatalogProduct, Product } from "@/lib/portfolio-types";
import { ApproveProductModal, ReadOnlyProductCard } from "./ReadOnlyProductCard";

interface UserInfo {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export default function AdminPortfolioViewPage() {
  const params = useParams<{ userId: string }>();
  const userId = params.userId;
  const [products, setProducts] = useState<Product[] | null>(null);
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvingProduct, setApprovingProduct] = useState<Product | null>(null);
  const [approvedProductIds, setApprovedProductIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void (async () => {
      try {
        const [portfolioRes, usersRes, catalogRes] = await Promise.all([
          fetch(`/api/admin/portfolios/${userId}`),
          fetch("/api/admin/users"),
          fetchWithAuth("/api/admin/catalog/entries"),
        ]);
        if (!portfolioRes.ok) {
          throw new Error(
            `No se pudo cargar el portafolio (status ${portfolioRes.status})`,
          );
        }
        const data: { products: Product[] } = await portfolioRes.json();
        setProducts(data.products);

        if (usersRes.ok) {
          const users: UserInfo[] = await usersRes.json();
          const match = users.find((u) => u.id === userId);
          if (match) setUserInfo(match);
        }

        if (catalogRes.ok) {
          const entries: CatalogProduct[] = await catalogRes.json();
          const ids = new Set(
            entries
              .map((e) => e.approved_from_product_id)
              .filter((id): id is string => id != null),
          );
          setApprovedProductIds(ids);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, [userId]);

  const total = (products ?? []).reduce((sum, p) => sum + p.amount, 0);
  const categoriesUsed = new Set((products ?? []).map((p) => p.category));
  const isComplete = CATEGORY_ORDER.every((cat) => categoriesUsed.has(cat));
  const lastUpdated = userInfo?.updated_at
    ? new Date(userInfo.updated_at).toLocaleDateString("es-PE", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-sabbi-neutral-900">
            Portafolio de {userInfo?.email ?? userId}
          </h1>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isComplete
                ? "bg-emerald-100 text-emerald-700"
                : "bg-amber-100 text-amber-700"
            }`}
          >
            {isComplete ? "Completo" : `${categoriesUsed.size}/6 categorías`}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-sabbi-neutral-600">
          {products && (
            <>
              <span>{products.length} productos</span>
              <span className="text-sabbi-neutral-300">·</span>
              <span className="font-medium text-sabbi-neutral-900">{formatUsd(total)}</span>
            </>
          )}
          {lastUpdated && (
            <>
              <span className="text-sabbi-neutral-300">·</span>
              <span>Actualizado: {lastUpdated}</span>
            </>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {products === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : products && products.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">
          Este usuario no tiene productos.
        </p>
      ) : (
        CATEGORY_ORDER.map((cat) => {
          const catProducts = (products ?? []).filter((p) => p.category === cat);
          if (catProducts.length === 0) return null;
          const meta = CATEGORY_META[cat];
          return (
            <div key={cat} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: `var(${meta.cssVar})` }}
                />
                <h2 className="text-sm font-semibold text-sabbi-neutral-900">
                  {meta.label}
                </h2>
                <span className="text-xs text-sabbi-neutral-500">
                  {catProducts.length} producto{catProducts.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
                {catProducts.map((product) => (
                  <ReadOnlyProductCard
                    key={product.id}
                    product={product}
                    onApprove={setApprovingProduct}
                    isApproved={approvedProductIds.has(product.id)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}

      <ApproveProductModal
        product={approvingProduct}
        onClose={() => setApprovingProduct(null)}
        onApproved={(productId) =>
          setApprovedProductIds((prev) => new Set(prev).add(productId))
        }
      />
    </div>
  );
}

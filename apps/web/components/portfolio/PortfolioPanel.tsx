"use client";

import type { FC } from "react";
import { CategorySection } from "@/components/portfolio/CategorySection";
import { CategoryTabs } from "@/components/portfolio/CategoryTabs";
import { EditProductModal } from "@/components/portfolio/EditProductModal";
import { MetricsRow } from "@/components/portfolio/MetricsRow";
import { PieIcon } from "@/components/icons/Icons";
import { useToast } from "@/components/ui/Toast";
import { CATEGORY_ORDER } from "@/lib/categories";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { Category, Product } from "@/lib/portfolio-types";
import { usePortfolio } from "@/lib/usePortfolio";

/**
 * Right-side panel: metrics, category filter tabs, and per-category product
 * grids, capped off by the shared edit/add modal. Independently scrolling —
 * the topbar and chat panel stay pinned.
 * `portfolio-dashboard.spec.md` → "Scroll vertical solo en el panel de
 * portafolio". Design: `design.md` → Frontend Architecture → `PortfolioPanel`.
 */
export const PortfolioPanel: FC = () => {
  const { toast } = useToast();
  const {
    products,
    isLoading,
    error,
    refetch,
    activeCategory,
    setActiveCategory,
    editingProduct,
    isModalOpen,
    createCategory,
    openCreateModal,
    openEditModal,
    closeModal,
    totalAmount,
    productCount,
    largestPosition,
    newProductIds,
  } = usePortfolio();

  const productsByCategory = CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = products.filter((p) => p.category === category);
      return acc;
    },
    {} as Record<Category, Product[]>,
  );

  const countsByCategory = CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = productsByCategory[category].length;
      return acc;
    },
    {} as Record<Category, number>,
  );

  const categoriesUsedCount = CATEGORY_ORDER.filter(
    (category) => countsByCategory[category] > 0,
  ).length;

  const visibleCategories =
    activeCategory === "todos" ? CATEGORY_ORDER : [activeCategory];

  const handleDeleteProduct = async (productId: string) => {
    const res = await fetchWithAuth(`/api/products/${productId}`, { method: "DELETE" });
    if (!res.ok) {
      const msg = `No se pudo eliminar el producto (status ${res.status})`;
      toast(msg);
      throw new Error(msg);
    }
    await refetch();
  };

  const isInitialLoading = isLoading && products.length === 0;
  const isEmpty = !isLoading && products.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col bg-sabbi-neutral-50">
      {isInitialLoading ? (
        <div
          className="m-auto flex flex-col items-center gap-3"
          role="status"
          aria-live="polite"
        >
          <div className="size-8 animate-spin rounded-full border-2 border-sabbi-neutral-200 border-t-sabbi-primary" />
          <p className="text-sm text-sabbi-neutral-600">Cargando portafolio…</p>
        </div>
      ) : isEmpty ? (
        <div className="m-auto flex max-w-sm flex-col items-center gap-3 px-6 text-center">
          <div
            className="flex size-14 items-center justify-center rounded-full"
            style={{ backgroundColor: "var(--sabbi-lime)", color: "var(--sabbi-green)" }}
          >
            <PieIcon size={26} />
          </div>
          <p className="text-base font-medium text-sabbi-neutral-900">
            Sin productos aún
          </p>
          <p className="text-sm text-sabbi-neutral-600">
            Comparte tus inversiones con el asistente — por texto, captura, PDF
            o factsheet — y aparecerán aquí organizadas por categoría.
          </p>
          <button
            type="button"
            onClick={() => openCreateModal()}
            className="mt-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--sabbi-lime)", color: "var(--sabbi-green)" }}
          >
            Agregar producto manualmente
          </button>
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-sabbi-neutral-200 bg-sabbi-neutral-50 px-6 pt-6 pb-5">
            <div className="flex flex-col gap-5">
              <MetricsRow
                totalAmount={totalAmount}
                productCount={productCount}
                largestPosition={largestPosition}
                categoriesUsedCount={categoriesUsedCount}
              />

              <CategoryTabs
                activeCategory={activeCategory}
                onChange={setActiveCategory}
                totalCount={productCount}
                countsByCategory={countsByCategory}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {error && (
              <p className="mb-4 text-sm text-red-600">
                No se pudo cargar el portafolio: {error}
              </p>
            )}

            <div className="flex flex-col gap-6">
              {visibleCategories.map((category) => {
                const categoryProducts = productsByCategory[category];
                if (activeCategory === "todos" && categoryProducts.length === 0) {
                  return null;
                }
                return (
                  <CategorySection
                    key={category}
                    category={category}
                    index={CATEGORY_ORDER.indexOf(category)}
                    products={categoryProducts}
                    newProductIds={newProductIds}
                    onEditProduct={openEditModal}
                    onDeleteProduct={handleDeleteProduct}
                    onAddProduct={openCreateModal}
                  />
                );
              })}
            </div>
          </div>
        </>
      )}

      <EditProductModal
        isOpen={isModalOpen}
        product={editingProduct}
        defaultCategory={createCategory}
        onClose={closeModal}
        onSaved={refetch}
      />
    </div>
  );
};

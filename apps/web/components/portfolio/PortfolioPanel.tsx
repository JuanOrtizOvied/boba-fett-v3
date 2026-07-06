"use client";

import type { FC } from "react";
import { CategorySection } from "@/components/portfolio/CategorySection";
import { CategoryTabs } from "@/components/portfolio/CategoryTabs";
import { EditProductModal } from "@/components/portfolio/EditProductModal";
import { MetricsRow } from "@/components/portfolio/MetricsRow";
import { PieIcon } from "@/components/icons/Icons";
import { CATEGORY_ORDER } from "@/lib/categories";
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
  const {
    portfolioId,
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
    await fetch(`/api/products/${productId}`, { method: "DELETE" });
    await refetch();
  };

  const isEmpty = !isLoading && products.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-sabbi-neutral-50 px-6 py-6">
      {isEmpty ? (
        <div className="m-auto flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-sabbi-primary-soft text-sabbi-primary">
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
            className="mt-2 rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium text-white hover:bg-sabbi-primary-hover"
          >
            Agregar producto manualmente
          </button>
        </div>
      ) : (
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

          {error && (
            <p className="text-sm text-red-600">
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
                  onEditProduct={openEditModal}
                  onDeleteProduct={handleDeleteProduct}
                  onAddProduct={openCreateModal}
                />
              );
            })}
          </div>
        </div>
      )}

      <EditProductModal
        isOpen={isModalOpen}
        product={editingProduct}
        defaultCategory={createCategory}
        portfolioId={portfolioId}
        onClose={closeModal}
        onSaved={refetch}
      />
    </div>
  );
};

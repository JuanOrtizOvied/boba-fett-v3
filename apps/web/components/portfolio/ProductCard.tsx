"use client";

import { useEffect, useRef, useState, type FC } from "react";
import { EditIcon, TrashIcon, WarningIcon } from "@/components/icons/Icons";
import { CATEGORY_META, categoryColorVar } from "@/lib/categories";
import { compositionColor } from "@/lib/compositionPalette";
import { formatUsd } from "@/lib/format";
import type { Product } from "@/lib/portfolio-types";

export interface ProductCardProps {
  product: Product;
  isNew?: boolean;
  onEdit: (product: Product) => void;
  /** Performs the DELETE request + refetch. Awaited before unmount. */
  onDelete: (productId: string) => Promise<void>;
}

const DELETE_ANIMATION_MS = 300;

/**
 * Product card with two mutually-exclusive states:
 * - `view`: name, provider, amount, composition bar + legend, category badge,
 *   hover-revealed edit/delete buttons.
 * - `confirm-delete`: replaces the card content inline (no separate dialog)
 *   with a red-bordered confirmation, then fades out before removal.
 * `product-cards-crud.spec.md` → "Visualización de una card",
 * "Card con composición multi-asset class",
 * "Eliminar producto — confirmación inline", "Confirmar eliminación de producto".
 */
export const ProductCard: FC<ProductCardProps> = ({ product, isNew, onEdit, onDelete }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"view" | "confirm-delete">("view");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew && cardRef.current) {
      const timer = setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isNew]);
  const meta = CATEGORY_META[product.category];
  const color = categoryColorVar(product.category);
  const isConfirming = mode === "confirm-delete";

  const handleConfirmDelete = async () => {
    setDeleteError(null);
    setIsDeleting(true);
    await new Promise((resolve) => setTimeout(resolve, DELETE_ANIMATION_MS));
    try {
      await onDelete(product.id);
      // On success the parent removes this product from `products` and the
      // card unmounts naturally — no need to reset `isDeleting` here.
    } catch (err) {
      // Delete failed (network/backend error) — restore the card instead of
      // leaving it stuck invisible (`opacity-0` from `isDeleting`).
      setIsDeleting(false);
      setDeleteError(
        err instanceof Error ? err.message : "No se pudo eliminar el producto",
      );
    }
  };

  return (
    <div
      ref={cardRef}
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-background transition-all duration-300 ${
        isNew ? "animate-product-added" : "animate-card-enter"
      } ${
        isConfirming ? "border-2 border-red-500" : "border-sabbi-neutral-200"
      } ${isDeleting ? "scale-95 opacity-0" : "scale-100 opacity-100"}`}
    >
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: isConfirming ? "#ef4444" : color }}
      />

      {isConfirming ? (
        <div className="flex flex-col gap-3 p-4 pl-5">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-red-100 text-red-600">
              <WarningIcon size={16} />
            </span>
            <p className="text-sm font-semibold text-sabbi-neutral-900">
              ¿Eliminar este producto?
            </p>
          </div>
          <p className="text-xs text-sabbi-neutral-600">
            Los porcentajes de la categoría se recalcularán al eliminarlo.
          </p>
          <div className="rounded-lg bg-sabbi-neutral-50 px-3 py-2 text-sm">
            <p className="font-medium text-sabbi-neutral-900">{product.name}</p>
            <p className="text-sabbi-neutral-600">{formatUsd(product.amount)}</p>
          </div>
          {deleteError && (
            <p className="text-xs font-medium text-red-600">{deleteError}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => setMode("view")}
              className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => void handleConfirmDelete()}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <TrashIcon size={14} />
              {isDeleting ? "Eliminando…" : "Eliminar"}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 p-4 pl-5">
          <div className="flex items-start justify-between gap-2">
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
            <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                aria-label="Editar producto"
                onClick={() => onEdit(product)}
                className="flex size-7 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
              >
                <EditIcon size={14} />
              </button>
              <button
                type="button"
                aria-label="Eliminar producto"
                onClick={() => setMode("confirm-delete")}
                className="flex size-7 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-red-50 hover:text-red-600"
              >
                <TrashIcon size={14} />
              </button>
            </div>
          </div>

          <p className="font-display text-lg font-semibold text-sabbi-neutral-900">
            {formatUsd(product.amount)}
          </p>

          {product.composition.length > 0 && (
            <div className="flex flex-col gap-1.5">
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
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {product.composition.map((asset, index) => (
                  <span
                    key={`${asset.name}-${index}`}
                    className="flex items-center gap-1 text-xs text-sabbi-neutral-600"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: compositionColor(index) }}
                    />
                    {asset.name} · {asset.percentage.toFixed(0)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          <span
            className="w-fit rounded-full px-2 py-0.5 text-xs font-medium text-white"
            style={{ backgroundColor: color }}
          >
            {meta.shortLabel}
          </span>
        </div>
      )}
    </div>
  );
};

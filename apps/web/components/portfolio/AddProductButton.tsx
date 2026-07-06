import type { FC } from "react";
import { PlusIcon } from "@/components/icons/Icons";

export interface AddProductButtonProps {
  onClick: () => void;
}

/**
 * Dashed-border card at the end of each category grid. Opens the edit modal
 * pre-scoped to that category.
 * `product-cards-crud.spec.md` → "Agregar producto manualmente",
 * "Cada categoría tiene botón de agregar producto".
 */
export const AddProductButton: FC<AddProductButtonProps> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sabbi-neutral-300 text-sm font-medium text-sabbi-neutral-600 transition-colors hover:border-sabbi-primary hover:bg-sabbi-primary-soft hover:text-sabbi-primary"
  >
    <PlusIcon size={20} />
    Agregar producto
  </button>
);

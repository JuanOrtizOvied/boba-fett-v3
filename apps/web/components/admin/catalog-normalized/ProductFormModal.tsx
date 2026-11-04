"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type { AssetAllocation } from "@/lib/portfolio-types";
import type {
  CatalogProductCreateInput,
  CatalogProductRow,
  CatalogProductUpdateInput,
} from "@/lib/normalized-catalog-types";
import { AllocationListField } from "@/components/admin/catalog/AllocationListField";
import {
  ModalField,
  isAllocationInvalid,
} from "@/components/admin/catalog/catalogFormShared";
import {
  ASSET_CLASS_OPTIONS,
  CURRENCY_OPTIONS,
  GEOGRAPHIC_FOCUS_OPTIONS,
  UNDERLYING_OPTIONS,
} from "@/lib/normalizedCatalogOptions";
import { ModalShell, SelectField, TextField, sendJson } from "./shared";

const BASE = "/api/admin/normalized-catalog/products";

/** Create (product === null) or edit a normalized-catalog product. */
export default function ProductFormModal({
  product,
  onClose,
  onSaved,
}: {
  product: CatalogProductRow | null;
  onClose: () => void;
  /** Receives the product code that was created/edited. */
  onSaved: (code: string) => Promise<void> | void;
}) {
  const { toast } = useToast();
  const isEdit = product !== null;
  const [code, setCode] = useState(product?.code ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [tickerIsin, setTickerIsin] = useState(product?.ticker_isin ?? "");
  const [manager, setManager] = useState(product?.manager ?? "");
  const [currency, setCurrency] = useState(product?.currency ?? "");
  const [horizon, setHorizon] = useState(product?.investment_horizon ?? "");
  const [assetClass, setAssetClass] = useState<AssetAllocation[]>(
    product?.asset_class ?? [],
  );
  const [geo, setGeo] = useState<AssetAllocation[]>(
    product?.geographic_focus ?? [],
  );
  const [underlying, setUnderlying] = useState<AssetAllocation[]>(
    product?.underlying ?? [],
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const invalid =
    (!isEdit && code.trim() === "") ||
    name.trim() === "" ||
    isAllocationInvalid(assetClass) ||
    isAllocationInvalid(geo) ||
    isAllocationInvalid(underlying);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const attrs: CatalogProductUpdateInput = {
        name: name.trim(),
        ticker_isin: tickerIsin.trim(),
        manager: manager.trim(),
        currency,
        investment_horizon: horizon.trim(),
        asset_class: assetClass,
        geographic_focus: geo,
        underlying,
      };
      let savedCode: string;
      if (isEdit) {
        savedCode = product.code;
        await sendJson(
          "PATCH",
          `${BASE}/${encodeURIComponent(product.code)}`,
          attrs,
          "No se pudo actualizar el producto",
        );
      } else {
        savedCode = code.trim();
        const body: CatalogProductCreateInput = { code: savedCode, ...attrs, name: name.trim() };
        await sendJson("POST", BASE, body, "No se pudo crear el producto");
      }
      await onSaved(savedCode);
      toast(isEdit ? "Producto actualizado." : "Producto creado con éxito.", "success");
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Error desconocido";
      setErrorMessage(message);
      toast(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ModalShell
      title={isEdit ? "Editar producto" : "Nuevo producto"}
      onClose={onClose}
      errorMessage={errorMessage}
      submitLabel={isEdit ? "Guardar" : "Crear"}
      isSubmitting={isSubmitting}
      submitDisabled={invalid}
      onSubmit={() => void handleSubmit()}
    >
      <TextField
        label="Código"
        value={code}
        onChange={setCode}
        required
        disabled={isEdit}
      />
      <TextField label="Nombre" value={name} onChange={setName} required />
      <TextField label="Ticker / ISIN" value={tickerIsin} onChange={setTickerIsin} />
      <TextField label="Gestor" value={manager} onChange={setManager} />
      <SelectField
        label="Moneda"
        value={currency}
        onChange={setCurrency}
        options={CURRENCY_OPTIONS}
      />
      <TextField
        label="Horizonte de inversión"
        value={horizon}
        onChange={setHorizon}
      />
      <ModalField label="Clase de activo">
        <AllocationListField
          options={ASSET_CLASS_OPTIONS}
          value={assetClass}
          onChange={setAssetClass}
          addLabel="Agregar clase de activo"
        />
      </ModalField>
      <ModalField label="Foco geográfico">
        <AllocationListField
          options={GEOGRAPHIC_FOCUS_OPTIONS}
          value={geo}
          onChange={setGeo}
          addLabel="Agregar foco geográfico"
        />
      </ModalField>
      <ModalField label="Subyacente">
        <AllocationListField
          options={UNDERLYING_OPTIONS}
          value={underlying}
          onChange={setUnderlying}
          addLabel="Agregar subyacente"
        />
      </ModalField>
    </ModalShell>
  );
}

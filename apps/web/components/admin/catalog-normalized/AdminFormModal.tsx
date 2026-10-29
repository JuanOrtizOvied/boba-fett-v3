"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type {
  CatalogAdminCreateInput,
  CatalogAdminUpdateInput,
  CatalogProductSeriesAdmin,
} from "@/lib/normalized-catalog-types";
import { CURRENCY_OPTIONS } from "@/lib/normalizedCatalogOptions";
import {
  AmountField,
  FractionField,
  ModalShell,
  SelectField,
  TextField,
  numberToField,
  parseOptionalNumber,
  sendJson,
} from "./shared";

const BASE = "/api/admin/normalized-catalog/admins";

/** Create (admin === null) or edit a series administrator; identity is immutable. */
export default function AdminFormModal({
  productCode,
  seriesLabel,
  admin,
  onClose,
  onSaved,
}: {
  productCode: string;
  seriesLabel: string;
  admin: CatalogProductSeriesAdmin | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const isEdit = admin !== null;
  const [name, setName] = useState(admin?.administrator ?? "");
  const [custody, setCustody] = useState(numberToField(admin?.custody_fee));
  const [buy, setBuy] = useState(numberToField(admin?.buy_commission));
  const [sell, setSell] = useState(numberToField(admin?.sell_commission));
  const [currency, setCurrency] = useState(admin?.billing_currency ?? "");
  const [minUsd, setMinUsd] = useState(numberToField(admin?.minimum_usd));
  const [minCommission, setMinCommission] = useState(
    numberToField(admin?.min_commission_usd),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      // Fractions are sent raw (no x100); USD amounts are plain numbers.
      const attrs: CatalogAdminUpdateInput = {
        custody_fee: parseOptionalNumber(custody),
        buy_commission: parseOptionalNumber(buy),
        sell_commission: parseOptionalNumber(sell),
        billing_currency: currency,
        minimum_usd: parseOptionalNumber(minUsd),
        min_commission_usd: parseOptionalNumber(minCommission),
      };
      if (isEdit) {
        await sendJson("PATCH", `${BASE}/${admin.id}`, attrs, "No se pudo actualizar el administrador");
      } else {
        const body: CatalogAdminCreateInput = {
          product_code: productCode,
          series: seriesLabel,
          administrator: name.trim(),
          ...attrs,
        };
        await sendJson("POST", BASE, body, "No se pudo crear el administrador");
      }
      await onSaved();
      toast(isEdit ? "Administrador actualizado." : "Administrador creado con éxito.", "success");
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
      title={isEdit ? "Editar administrador" : "Nuevo administrador"}
      onClose={onClose}
      errorMessage={errorMessage}
      submitLabel={isEdit ? "Guardar" : "Crear"}
      isSubmitting={isSubmitting}
      submitDisabled={name.trim() === ""}
      onSubmit={() => void handleSubmit()}
    >
      <TextField label="Producto / Serie" value={`${productCode} / ${seriesLabel}`} onChange={() => {}} disabled />
      <TextField label="Administrador" value={name} onChange={setName} required disabled={isEdit} />
      <FractionField label="Comisión de custodia" value={custody} onChange={setCustody} />
      <FractionField label="Comisión de compra" value={buy} onChange={setBuy} />
      <FractionField label="Comisión de venta" value={sell} onChange={setSell} />
      <SelectField
        label="Moneda de facturación"
        value={currency}
        onChange={setCurrency}
        options={CURRENCY_OPTIONS}
      />
      <AmountField label="Mínimo (USD)" value={minUsd} onChange={setMinUsd} />
      <AmountField label="Comisión mínima (USD)" value={minCommission} onChange={setMinCommission} />
    </ModalShell>
  );
}

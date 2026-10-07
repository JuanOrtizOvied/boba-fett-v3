"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type {
  CatalogProductSeries,
  CatalogSeriesCreateInput,
  CatalogSeriesUpdateInput,
} from "@/lib/normalized-catalog-types";
import {
  FractionField,
  ModalShell,
  TextField,
  numberToField,
  parseOptionalNumber,
  sendJson,
} from "./shared";

const BASE = "/api/admin/normalized-catalog/series";

/** Create (series === null) or edit a series; the series label is immutable. */
export default function SeriesFormModal({
  productCode,
  series,
  onClose,
  onSaved,
}: {
  productCode: string;
  series: CatalogProductSeries | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const isEdit = series !== null;
  const [label, setLabel] = useState(series?.series ?? "");
  const [ter, setTer] = useState(numberToField(series?.management_fee_ter));
  const [flowsMin, setFlowsMin] = useState(numberToField(series?.flows_min));
  const [flowsMax, setFlowsMax] = useState(numberToField(series?.flows_max));
  const [returnMin, setReturnMin] = useState(numberToField(series?.return_min));
  const [returnMax, setReturnMax] = useState(numberToField(series?.return_max));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      // Raw fractions: what is typed is what is stored (no x100 conversion).
      const numeric: CatalogSeriesUpdateInput = {
        management_fee_ter: parseOptionalNumber(ter),
        flows_min: parseOptionalNumber(flowsMin),
        flows_max: parseOptionalNumber(flowsMax),
        return_min: parseOptionalNumber(returnMin),
        return_max: parseOptionalNumber(returnMax),
      };
      if (isEdit) {
        await sendJson("PATCH", `${BASE}/${series.id}`, numeric, "No se pudo actualizar la serie");
      } else {
        const body: CatalogSeriesCreateInput = {
          product_code: productCode,
          series: label.trim(),
          ...numeric,
        };
        await sendJson("POST", BASE, body, "No se pudo crear la serie");
      }
      await onSaved();
      toast(isEdit ? "Serie actualizada." : "Serie creada con éxito.", "success");
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
      title={isEdit ? "Editar serie" : "Nueva serie"}
      onClose={onClose}
      errorMessage={errorMessage}
      submitLabel={isEdit ? "Guardar" : "Crear"}
      isSubmitting={isSubmitting}
      submitDisabled={label.trim() === ""}
      onSubmit={() => void handleSubmit()}
    >
      <TextField label="Producto" value={productCode} onChange={() => {}} disabled />
      <TextField label="Serie" value={label} onChange={setLabel} required disabled={isEdit} />
      <FractionField label="Comisión de gestión (TER)" value={ter} onChange={setTer} />
      <FractionField label="Flujos mínimo" value={flowsMin} onChange={setFlowsMin} />
      <FractionField label="Flujos máximo" value={flowsMax} onChange={setFlowsMax} />
      <FractionField label="Rentabilidad mínima" value={returnMin} onChange={setReturnMin} />
      <FractionField label="Rentabilidad máxima" value={returnMax} onChange={setReturnMax} />
    </ModalShell>
  );
}

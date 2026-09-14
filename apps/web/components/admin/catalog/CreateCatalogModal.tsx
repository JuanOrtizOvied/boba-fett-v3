"use client";

import { useEffect, useState } from "react";
import { XIcon } from "@/components/icons/Icons";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { useToast } from "@/components/ui/Toast";
import type {
  AdministratorEntity,
  AssetAllocation,
  ManagerEntity,
} from "@/lib/portfolio-types";
import { AllocationListField } from "@/components/admin/catalog/AllocationListField";
import {
  EDITABLE_FIELDS,
  ModalField,
  NameListField,
  ScoredVocabularyField,
  allocationSum,
  isAllocationInvalid,
  modalInputClass,
} from "@/components/admin/catalog/catalogFormShared";
import {
  ASSET_CLASS_OPTIONS,
  CURRENCY_OPTIONS,
  GEOGRAPHIC_FOCUS_OPTIONS,
  UNDERLYING_OPTIONS,
} from "@/lib/catalogOptions";

/**
 * Creation counterpart of `EditCatalogModal` (`apps/web/app/admin/catalog/page.tsx`).
 * Shares every field widget and validation rule with Edit via
 * `catalogFormShared` — the only real difference is that Create starts from
 * a blank template (no prefill, no original-value diffing) and does a plain
 * `POST` with the full payload instead of a `PATCH` delta. `slugs` is never
 * sent — it's server-computed on every write, and `onSaved` triggers a
 * catalog refetch so the server-computed value shows up once the entry lands.
 */
export default function CreateCatalogModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Record<string, string>>({});
  const [alternativeNames, setAlternativeNames] = useState<string[]>([]);
  const [geographicFocus, setGeographicFocus] = useState<AssetAllocation[]>([]);
  const [assetClass, setAssetClass] = useState<AssetAllocation[]>([]);
  const [underlying, setUnderlying] = useState<AssetAllocation[]>([]);
  const [returnRateMin, setReturnRateMin] = useState("");
  const [returnRateMax, setReturnRateMax] = useState("");
  const [administratorScore, setAdministratorScore] = useState<number | null>(null);
  const [managerScore, setManagerScore] = useState<number | null>(null);
  const [administratorEntities, setAdministratorEntities] = useState<AdministratorEntity[]>([]);
  const [managerEntities, setManagerEntities] = useState<ManagerEntity[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Backs the Administrador/Gestor dropdowns — same two endpoints EditCatalogModal uses.
  useEffect(() => {
    (async () => {
      try {
        const [adminRes, managerRes] = await Promise.all([
          fetchWithAuth("/api/admin/administrators"),
          fetchWithAuth("/api/admin/managers"),
        ]);
        if (adminRes.ok) setAdministratorEntities(await adminRes.json());
        if (managerRes.ok) setManagerEntities(await managerRes.json());
      } catch {
        // Dropdowns just stay empty; the free-text "add new" input still works.
      }
    })();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const nameInvalid = (form.name ?? "").trim() === "";
  const geoTotal = allocationSum(geographicFocus);
  const geoEmpty = geographicFocus.length === 0;
  const geoInvalid = isAllocationInvalid(geographicFocus);
  const assetClassTotal = allocationSum(assetClass);
  const assetClassEmpty = assetClass.length === 0;
  const assetClassInvalid = isAllocationInvalid(assetClass);
  const underlyingTotal = allocationSum(underlying);
  const underlyingEmpty = underlying.length === 0;
  const underlyingInvalid = isAllocationInvalid(underlying);
  const commissionInvalid = (form.commission ?? "").trim() === "";
  const currencyInvalid = (form.currency ?? "").trim() === "";
  const administratorInvalid = (form.administrator ?? "").trim() === "";
  const managerInvalid = (form.manager ?? "").trim() === "";
  const administratorScoreMissing = !administratorInvalid && administratorScore === null;
  const managerScoreMissing = !managerInvalid && managerScore === null;
  const returnRateMinRequired = returnRateMin.trim() === "";
  const returnRateOrderInvalid =
    returnRateMin !== "" &&
    returnRateMax !== "" &&
    parseFloat(returnRateMin) > parseFloat(returnRateMax);

  const handleSave = async () => {
    setErrorMessage(null);
    const invalidMessages: string[] = [];
    if (nameInvalid) {
      invalidMessages.push("El nombre es obligatorio");
    }
    if (assetClassEmpty) {
      invalidMessages.push("Clase de activo es obligatorio");
    } else if (assetClassInvalid) {
      invalidMessages.push(
        `Clase de activo debe sumar 100% (actual: ${assetClassTotal.toFixed(1)}%)`,
      );
    }
    if (geoEmpty) {
      invalidMessages.push("Foco geográfico es obligatorio");
    } else if (geoInvalid) {
      invalidMessages.push(
        `Foco geográfico debe sumar 100% (actual: ${geoTotal.toFixed(1)}%)`,
      );
    }
    if (underlyingEmpty) {
      invalidMessages.push("Subyacente es obligatorio");
    } else if (underlyingInvalid) {
      invalidMessages.push(
        `Subyacentes debe sumar 100% (actual: ${underlyingTotal.toFixed(1)}%)`,
      );
    }
    if (commissionInvalid) {
      invalidMessages.push("La comisión es obligatoria");
    }
    if (currencyInvalid) {
      invalidMessages.push("La moneda es obligatoria");
    }
    if (administratorInvalid) {
      invalidMessages.push("El administrador es obligatorio");
    }
    if (managerInvalid) {
      invalidMessages.push("El gestor es obligatorio");
    }
    if (administratorScoreMissing) {
      invalidMessages.push("El score del administrador es obligatorio");
    }
    if (managerScoreMissing) {
      invalidMessages.push("El score del gestor es obligatorio");
    }
    if (returnRateMinRequired) {
      invalidMessages.push("Rentabilidad: el mínimo es obligatorio");
    }
    if (returnRateOrderInvalid) {
      invalidMessages.push("Rentabilidad: el mínimo no puede ser mayor al máximo");
    }
    if (invalidMessages.length > 0) {
      setErrorMessage(invalidMessages.join(" · "));
      return;
    }

    setIsSubmitting(true);
    try {
      // A brand-new name typed into "+ Agregar..." isn't in the fetched
      // entity list yet — persist it as a reusable entity, mirroring
      // EditCatalogModal.handleSave. Best-effort: a failure here doesn't
      // block creating the catalog entry itself, which stores this
      // name+score directly either way.
      const administratorName = form.administrator?.trim() ?? "";
      if (
        administratorName &&
        administratorScore !== null &&
        !administratorEntities.some((a) => a.name === administratorName)
      ) {
        try {
          await fetchWithAuth("/api/admin/administrators", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: administratorName, score: administratorScore }),
          });
        } catch {
          // best-effort — see comment above
        }
      }
      const managerName = form.manager?.trim() ?? "";
      if (
        managerName &&
        managerScore !== null &&
        !managerEntities.some((m) => m.name === managerName)
      ) {
        try {
          await fetchWithAuth("/api/admin/managers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: managerName, score: managerScore }),
          });
        } catch {
          // best-effort — see comment above
        }
      }

      // No original entry to diff against — the full form state is the
      // payload. `slugs` is never included: it's server-computed from
      // name + alternative_names on every write.
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        asset_class: assetClass,
        geographic_focus: geographicFocus,
        underlying: underlying,
        commission: form.commission.trim(),
        currency: form.currency.trim(),
        administrator: form.administrator.trim(),
        manager: form.manager.trim(),
        liquidity: (form.liquidity ?? "").trim(),
        return_rate:
          returnRateMin === ""
            ? ""
            : returnRateMax === ""
              ? `${returnRateMin}%`
              : `${returnRateMin}% - ${returnRateMax}%`,
        isin: (form.isin ?? "").trim(),
        distribution: (form.distribution ?? "").trim(),
        alternative_names: alternativeNames,
        administrator_score: administratorScore,
        manager_score: managerScore,
      };

      const res = await fetchWithAuth(`/api/admin/catalog/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 409) {
          throw new Error("Este producto ya existe en el catálogo.");
        }
        let detail = `No se pudo crear el producto (status ${res.status})`;
        try {
          const body = await res.json();
          if (body?.detail) {
            detail = Array.isArray(body.detail)
              ? body.detail
                  .map((d: unknown) =>
                    d && typeof d === "object" && "msg" in d
                      ? String((d as { msg: unknown }).msg)
                      : JSON.stringify(d),
                  )
                  .join("; ")
              : String(body.detail);
          }
        } catch {
          // Response wasn't JSON; keep the generic message.
        }
        throw new Error(detail);
      }

      await onSaved();
      toast("Producto creado con éxito.", "success");
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (key: string, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-sabbi-neutral-900">
            Crear nueva entrada del catálogo
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          {EDITABLE_FIELDS.map(({ key, label }) => {
            switch (key) {
              case "alternative_names":
                return (
                  <ModalField key={key} label={label}>
                    <NameListField
                      value={alternativeNames}
                      onChange={setAlternativeNames}
                      addPlaceholder="+ Agregar nombre alternativo"
                    />
                  </ModalField>
                );
              case "asset_class":
                return (
                  <ModalField key={key} label={label} required>
                    <AllocationListField
                      options={ASSET_CLASS_OPTIONS}
                      value={assetClass}
                      onChange={setAssetClass}
                      addLabel="Agregar clase de activo"
                      required
                    />
                  </ModalField>
                );
              case "geographic_focus":
                return (
                  <ModalField key={key} label={label} required>
                    <AllocationListField
                      options={GEOGRAPHIC_FOCUS_OPTIONS}
                      value={geographicFocus}
                      onChange={setGeographicFocus}
                      addLabel="Agregar foco geográfico"
                      required
                    />
                  </ModalField>
                );
              case "underlying":
                return (
                  <ModalField key={key} label={label} required>
                    <AllocationListField
                      options={UNDERLYING_OPTIONS}
                      value={underlying}
                      onChange={setUnderlying}
                      addLabel="Agregar subyacente"
                      required
                    />
                  </ModalField>
                );
              case "commission":
                return (
                  <ModalField key={key} label={label} required>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      className={
                        modalInputClass +
                        (commissionInvalid ? " border-red-400 focus:border-red-500" : "")
                      }
                    />
                  </ModalField>
                );
              case "currency":
                return (
                  <ModalField key={key} label={label} required>
                    <select
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      className={
                        modalInputClass +
                        (currencyInvalid ? " border-red-400 focus:border-red-500" : "")
                      }
                    >
                      <option value="">—</option>
                      {form[key] && !(CURRENCY_OPTIONS as readonly string[]).includes(form[key]) && (
                        <option value={form[key]}>{form[key]}</option>
                      )}
                      {CURRENCY_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </ModalField>
                );
              case "administrator":
                return (
                  <ModalField key={key} label={label} required>
                    <ScoredVocabularyField
                      entities={administratorEntities}
                      name={form[key] ?? ""}
                      score={administratorScore}
                      onNameChange={(v) => updateField(key, v)}
                      onScoreChange={setAdministratorScore}
                      addPlaceholder="+ Agregar administrador"
                      nameInvalid={administratorInvalid}
                      scoreInvalid={administratorScoreMissing}
                    />
                  </ModalField>
                );
              case "manager":
                return (
                  <ModalField key={key} label={label} required>
                    <ScoredVocabularyField
                      entities={managerEntities}
                      name={form[key] ?? ""}
                      score={managerScore}
                      onNameChange={(v) => updateField(key, v)}
                      onScoreChange={setManagerScore}
                      addPlaceholder="+ Agregar gestor"
                      nameInvalid={managerInvalid}
                      scoreInvalid={managerScoreMissing}
                    />
                  </ModalField>
                );
              case "return_rate":
                return (
                  <ModalField key={key} label={label}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-sabbi-neutral-500">
                        min<span className="text-red-600">*</span>
                      </span>
                      <input
                        type="number"
                        step="0.01"
                        value={returnRateMin}
                        onChange={(e) => setReturnRateMin(e.target.value)}
                        className={
                          modalInputClass +
                          " w-0 min-w-0 flex-1" +
                          (returnRateMinRequired || returnRateOrderInvalid
                            ? " border-red-400 focus:border-red-500"
                            : "")
                        }
                      />
                      <span className="text-sm text-sabbi-neutral-500">%</span>
                      <span className="text-sabbi-neutral-400">-</span>
                      <span className="text-xs text-sabbi-neutral-500">max</span>
                      <input
                        type="number"
                        step="0.01"
                        value={returnRateMax}
                        onChange={(e) => setReturnRateMax(e.target.value)}
                        className={
                          modalInputClass +
                          " w-0 min-w-0 flex-1" +
                          (returnRateOrderInvalid ? " border-red-400 focus:border-red-500" : "")
                        }
                      />
                      <span className="text-sm text-sabbi-neutral-500">%</span>
                    </div>
                  </ModalField>
                );
              case "name":
                return (
                  <ModalField key={key} label={label} required>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      className={
                        modalInputClass +
                        (nameInvalid ? " border-red-400 focus:border-red-500" : "")
                      }
                    />
                  </ModalField>
                );
              case "isin":
                return (
                  <ModalField key={key} label={label}>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      placeholder="Agregar ISIN"
                      className={modalInputClass}
                    />
                  </ModalField>
                );
              case "distribution":
                return (
                  <ModalField key={key} label={label}>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      placeholder="Agregar distribución"
                      className={modalInputClass}
                    />
                  </ModalField>
                );
              default:
                return (
                  <ModalField key={key} label={label}>
                    <input
                      value={form[key] ?? ""}
                      onChange={(e) => updateField(key, e.target.value)}
                      className={modalInputClass}
                    />
                  </ModalField>
                );
            }
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-sabbi-neutral-200 px-5 py-4">
          <p className="min-h-4 text-sm text-red-600">{errorMessage}</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={
                isSubmitting ||
                nameInvalid ||
                geoEmpty ||
                geoInvalid ||
                assetClassEmpty ||
                assetClassInvalid ||
                underlyingEmpty ||
                underlyingInvalid ||
                commissionInvalid ||
                currencyInvalid ||
                administratorInvalid ||
                managerInvalid ||
                administratorScoreMissing ||
                managerScoreMissing ||
                returnRateMinRequired ||
                returnRateOrderInvalid
              }
              onClick={() => void handleSave()}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              {isSubmitting ? "Creando..." : "Crear"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

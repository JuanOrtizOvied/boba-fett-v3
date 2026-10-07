"use client";

import { useEffect, useId, type ReactNode } from "react";
import { XIcon } from "@/components/icons/Icons";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { modalInputClass } from "@/components/admin/catalog/catalogFormShared";

export { modalInputClass };

// -- Number helpers -----------------------------------------------------------

/** Fraction (0.0384) -> display percent ("3.84%"); null -> "—". */
export function formatFraction(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Number((value * 100).toFixed(6))}%`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `USD ${value.toLocaleString("en-US")}`;
}

/** Form string -> number | null ("" or unparsable -> null). */
export function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function numberToField(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

// -- API errors ---------------------------------------------------------------

/** Extracts a human-readable message from a FastAPI error response. */
export async function readApiError(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = await res.json();
    if (body?.detail) {
      return Array.isArray(body.detail)
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
    // Not JSON; keep the generic message.
  }
  return `${fallback} (status ${res.status})`;
}

/** Sends a JSON mutation; throws Error(message) with the server detail on failure. */
export async function sendJson(
  method: "POST" | "PATCH",
  url: string,
  body: unknown,
  fallback: string,
): Promise<void> {
  const res = await fetchWithAuth(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readApiError(res, fallback));
}

// -- Form widgets -------------------------------------------------------------

/** Single-control field with a real <label> so it is accessible by label. */
export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="text-xs font-medium text-sabbi-neutral-700">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </label>
      {children(id)}
      {hint}
    </div>
  );
}

export function TextField({
  label,
  value,
  onChange,
  required,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <Field label={label} required={required}>
      {(id) => (
        <input
          id={id}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={
            modalInputClass +
            (disabled ? " bg-sabbi-neutral-100 text-sabbi-neutral-500" : "")
          }
        />
      )}
    </Field>
  );
}

/** Edits the RAW fraction; shows a live "= N%" hint, no conversion on save. */
export function FractionField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const parsed = parseOptionalNumber(value);
  return (
    <Field
      label={label}
      hint={
        <span className="text-xs text-sabbi-neutral-500">
          {parsed === null ? "= —" : `= ${formatFraction(parsed)}`}
        </span>
      }
    >
      {(id) => (
        <input
          id={id}
          type="number"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={modalInputClass}
        />
      )}
    </Field>
  );
}

export function AmountField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Field label={label}>
      {(id) => (
        <input
          id={id}
          type="number"
          step="any"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={modalInputClass}
        />
      )}
    </Field>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
}) {
  return (
    <Field label={label}>
      {(id) => (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={modalInputClass}
        >
          <option value="">—</option>
          {value && !options.includes(value) && (
            <option value={value}>{value}</option>
          )}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

// -- Dialog shells ------------------------------------------------------------

export function ModalShell({
  title,
  onClose,
  children,
  errorMessage,
  submitLabel,
  isSubmitting,
  submitDisabled,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  errorMessage: string | null;
  submitLabel: string;
  isSubmitting: boolean;
  submitDisabled?: boolean;
  onSubmit: () => void;
}) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="animate-modal-panel flex max-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl sm:max-w-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 className="text-base font-semibold text-sabbi-neutral-900">
            {title}
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
          {children}
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
              disabled={isSubmitting || submitDisabled}
              onClick={onSubmit}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              {isSubmitting ? "Guardando..." : submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConfirmDeleteDialog({
  title,
  message,
  isDeleting,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="animate-modal-panel w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-sabbi-neutral-900">
          {title}
        </h3>
        <p className="mt-2 text-sm text-sabbi-neutral-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            Eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

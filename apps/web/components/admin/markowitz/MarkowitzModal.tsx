"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { XIcon } from "@/components/icons/Icons";

interface MarkowitzModalProps {
  title: string;
  submitLabel: string;
  /** The label of the submit button while the request runs. */
  submittingLabel?: string;
  submitting: boolean;
  /** Turns the submit button off (for example while values are still missing). */
  submitDisabled?: boolean;
  /** A message for the bottom of the modal. */
  formError?: string | null;
  /** A short line next to the buttons, such as how many values are missing. */
  footnote?: string | null;
  onClose: () => void;
  onSubmit: () => void;
  /** The wide variant, for the form with one value per asset. */
  wide?: boolean;
  children: (ids: { titleId: string }) => ReactNode;
}

/** The frame the three Markowitz modals share: overlay, dialog, header with the close
 * button, scrolling body and footer. Escape and a click on the overlay close it (not while
 * a request runs), and the focus goes back to what opened it. */
export function MarkowitzModal({
  title,
  submitLabel,
  submittingLabel = "Guardando...",
  submitting,
  submitDisabled = false,
  formError = null,
  footnote = null,
  onClose,
  onSubmit,
  wide = false,
  children,
}: MarkowitzModalProps) {
  const titleId = useId();

  // The opener is read in the first render, before the first field takes the focus.
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => () => opener?.focus?.(), [opener]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!submitting) onSubmit();
  };

  return (
    <div
      className="animate-modal-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        noValidate
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className={`animate-modal-panel flex max-h-[90vh] w-full max-w-[92vw] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${
          wide ? "sm:max-w-2xl" : "sm:max-w-lg"
        }`}
      >
        <div className="flex items-center justify-between border-b border-sabbi-neutral-200 px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold text-sabbi-neutral-900">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            disabled={submitting}
            className="flex size-8 items-center justify-center rounded-md text-sabbi-neutral-600 hover:bg-sabbi-neutral-100"
          >
            <XIcon size={16} />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5 text-sm">
          {children({ titleId })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sabbi-neutral-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p role={formError ? "alert" : undefined} className="min-h-4 text-sm text-red-600">
              {formError}
            </p>
            {footnote && <p className="text-xs text-sabbi-neutral-500">{footnote}</p>}
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || submitDisabled}
              className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
            >
              {submitting ? submittingLabel : submitLabel}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export const INPUT =
  "w-full rounded-lg border border-sabbi-neutral-200 bg-white px-2.5 py-1.5 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";
export const INPUT_BAD = " border-red-400 focus:border-red-500";

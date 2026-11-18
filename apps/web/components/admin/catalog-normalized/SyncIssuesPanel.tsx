"use client";

import { useState } from "react";
import {
  issueLevelLabel,
  problemLabel,
  rowLabel,
  seenSince,
  unreadRowsLabel,
  type SyncIssue,
} from "@/lib/normalized-sync-issues";
import { Author } from "./ProductHistory";

const EXPLANATION =
  "Se muestran los últimos valores válidos. La fila se aplicará completa cuando no quede ninguna columna con error.";

function ProblemList({ issue }: { issue: SyncIssue }) {
  return (
    <ul className="flex flex-col gap-0.5 text-xs font-medium text-amber-800">
      {issue.problems.map((problem, index) => (
        <li key={`${problem.kind}-${problem.field}-${index}`}>
          {problemLabel(problem)}
        </li>
      ))}
    </ul>
  );
}

function IssueLine({
  issue,
  onSelectProduct,
}: {
  issue: SyncIssue;
  onSelectProduct: (code: string) => void;
}) {
  // A product the catalog does not know (or a row with no readable code) has no
  // detail to open.
  const code = issue.product_name !== null ? issue.product_code : null;
  const content = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {issue.product_code ? (
          <span className="text-xs text-sabbi-neutral-500">{issue.product_code}</span>
        ) : (
          <span className="text-xs text-sabbi-neutral-500">Fila sin código legible</span>
        )}{" "}
        {issue.product_name && (
          <span className="text-sm font-medium text-sabbi-neutral-900">
            {issue.product_name}
          </span>
        )}{" "}
        <span className="text-xs text-sabbi-neutral-600">{issueLevelLabel(issue)}</span>
      </span>
      <ProblemList issue={issue} />
      <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-sabbi-neutral-500">
        <span>{rowLabel(issue)}</span>{" "}
        <span>desde {seenSince(issue)}</span>{" "}
        <Author changedBy={issue.first_seen_by} />
      </span>
    </>
  );
  const className = "flex w-full flex-col gap-1 px-4 py-2.5 text-left";
  return (
    <li>
      {code ? (
        <button
          type="button"
          onClick={() => onSelectProduct(code)}
          className={`${className} transition-colors hover:bg-[#f0fcd4]`}
        >
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  );
}

/** "Filas no leídas": the rows of the workbook the sync could not apply, collapsed
 * to a single line with their number. Nothing when there are none. Read only: the
 * owners fix the workbook and the next run closes the issue. */
export default function SyncIssuesPanel({
  issues,
  error,
  onSelectProduct,
  onRetry,
}: {
  issues: SyncIssue[] | null;
  error: string | null;
  onSelectProduct: (code: string) => void;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (error) {
    return (
      <section
        aria-label="Filas no leídas"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5"
      >
        <span className="text-sm font-semibold text-amber-900">Filas no leídas</span>{" "}
        <span className="text-sm text-red-600">no se pudieron cargar</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md px-2 py-1 text-xs font-medium text-sabbi-primary hover:bg-white"
        >
          Reintentar
        </button>
      </section>
    );
  }
  if (!issues || issues.length === 0) return null;

  return (
    <section
      aria-label="Filas no leídas"
      className="rounded-xl border border-amber-200 bg-white"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <span aria-hidden="true" className="text-xs text-amber-700">
          {open ? "▾" : "▸"}
        </span>
        <span className="text-sm font-semibold text-amber-900">Filas no leídas</span>{" "}
        <span className="text-sm text-amber-800">· {issues.length}</span>
      </button>
      {open && (
        <div className="border-t border-amber-200">
          <p className="px-4 py-2 text-xs text-sabbi-neutral-600">
            El sync no pudo leer {unreadRowsLabel(issues.length)} del Excel de
            SharePoint. {EXPLANATION}
          </p>
          <ul className="max-h-80 divide-y divide-sabbi-neutral-200 overflow-auto border-t border-sabbi-neutral-200">
            {issues.map((issue) => (
              <IssueLine key={issue.id} issue={issue} onSelectProduct={onSelectProduct} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The amber notice at the top of a product's detail when the sync could not read
 * one of its rows: says which, why, and that the values shown are the last valid
 * ones. Nothing when the product has no unread rows. */
export function SyncIssuesNotice({ issues }: { issues: SyncIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <section
      aria-label="Filas no leídas de este producto"
      className="rounded-xl border border-amber-200 bg-amber-50 p-4"
    >
      <h3 className="text-sm font-semibold text-amber-900">
        El sync no pudo leer {issues.length === 1 ? "esta fila" : "estas filas"} del Excel
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {issues.map((issue) => (
          <li key={issue.id} className="flex flex-col gap-0.5">
            <p className="text-xs font-medium text-amber-900">
              {rowLabel(issue)} · {issueLevelLabel(issue)}
            </p>
            <ProblemList issue={issue} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-amber-800">{EXPLANATION}</p>
    </section>
  );
}

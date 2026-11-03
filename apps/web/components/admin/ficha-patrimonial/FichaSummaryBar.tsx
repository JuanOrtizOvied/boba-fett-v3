import { computeFichaSummary, type DeclaredValue } from "./fichaSummary";
import type { FichaEnrichedRow } from "@/lib/portfolio-types";

/** Placeholder for stats whose data arrives in Slice 2/3. */
const PENDING = "—";

function formatDeclaredValue(values: DeclaredValue[]): string {
  if (values.length === 0) return PENDING;
  return values
    .map((v) => `${v.currency} ${Math.round(v.total).toLocaleString("en-US")}`)
    .join(" · ");
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div data-stat className="flex flex-col gap-0.5">
      <span
        data-testid="stat-value"
        className="text-base font-semibold text-sabbi-neutral-900"
      >
        {value}
      </span>
      <span className="text-xs text-sabbi-neutral-500">{label}</span>
    </div>
  );
}

/**
 * Header stats bar for the ficha validation workbench (target mockup). Slice 1
 * fills the two values derivable from the parsed rows and renders the rest as
 * labelled placeholders until the Slice 2/3 backend supplies them.
 */
export default function FichaSummaryBar({ rows }: { rows: FichaEnrichedRow[] }) {
  const summary = computeFichaSummary(rows);

  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-xl border border-sabbi-neutral-200 bg-white p-4">
      <Stat label="productos declarados" value={String(summary.declaredCount)} />
      <Stat
        label="valor declarado"
        value={formatDeclaredValue(summary.declaredValueByCurrency)}
      />
      <Stat label="ya estaban en la BD" value={PENDING} />
      <Stat label="investigados" value={PENDING} />
      <Stat label="por decidir" value={PENDING} />
      <Stat label="flujos que necesita (USD/mes)" value={PENDING} />
    </div>
  );
}

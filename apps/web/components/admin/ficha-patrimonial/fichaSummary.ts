/**
 * Pure summary helpers for the Ficha Patrimonial validation workbench header
 * (target mockup — the stats bar). Slice 1 only computes the values derivable
 * from the parsed rows themselves: how many products were declared and the
 * declared value per currency. The remaining header cells (`ya estaban en la
 * BD`, `investigados`, `por decidir`, `flujos`) depend on Slice 2/3 backend
 * data and are rendered as placeholders by the component, not computed here.
 */

import type { FichaEnrichedRow } from "@/lib/portfolio-types";

/** Bucket label used when a declared row carries no currency. */
const NEUTRAL_CURRENCY = "—";

export interface DeclaredValue {
  currency: string;
  total: number;
}

export interface FichaSummary {
  declaredCount: number;
  declaredValueByCurrency: DeclaredValue[];
}

/**
 * Derives the Slice-1 header stats from the parsed ficha rows. Declared value
 * is summed per currency (blank currency falls into a neutral bucket); rows
 * with a non-finite amount count as declared products but add nothing to the
 * totals. Buckets are returned sorted by currency for a stable render.
 */
export function computeFichaSummary(rows: FichaEnrichedRow[]): FichaSummary {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const amount = row.raw_amount;
    if (!Number.isFinite(amount) || amount === 0) continue;
    const currency = row.raw_currency?.trim() || NEUTRAL_CURRENCY;
    totals.set(currency, (totals.get(currency) ?? 0) + amount);
  }

  const declaredValueByCurrency = [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    declaredCount: rows.length,
    declaredValueByCurrency,
  };
}

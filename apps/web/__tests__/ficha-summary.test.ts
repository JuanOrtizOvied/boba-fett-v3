import { describe, expect, test } from "vitest";
import { computeFichaSummary } from "@/components/admin/ficha-patrimonial/fichaSummary";
import type { FichaEnrichedRow } from "@/lib/portfolio-types";

/**
 * Minimal parsed-row factory — only the fields `computeFichaSummary` reads
 * (`raw_amount`, `raw_currency`) matter; the rest satisfy the type.
 */
function row(partial: Partial<FichaEnrichedRow>): FichaEnrichedRow {
  return {
    excel_row: 8,
    raw_name: "X",
    raw_tipo_activo: "",
    raw_amount: 0,
    raw_currency: "USD",
    raw_return_rate: "",
    raw_pertenencia: "",
    mapped_asset_class: null,
    normalized_return_rate: "",
    enriched: null,
    enrichment_failed: false,
    ...partial,
  };
}

describe("computeFichaSummary", () => {
  test("counts declared products and sums declared value per currency", () => {
    const summary = computeFichaSummary([
      row({ raw_amount: 10_294, raw_currency: "USD" }),
      row({ raw_amount: 128_400, raw_currency: "USD" }),
    ]);

    expect(summary.declaredCount).toBe(2);
    expect(summary.declaredValueByCurrency).toEqual([
      { currency: "USD", total: 138_694 },
    ]);
  });

  test("groups the declared value by currency, sorted by currency", () => {
    const summary = computeFichaSummary([
      row({ raw_amount: 100, raw_currency: "USD" }),
      row({ raw_amount: 50, raw_currency: "PEN" }),
      row({ raw_amount: 25, raw_currency: "USD" }),
    ]);

    expect(summary.declaredCount).toBe(3);
    expect(summary.declaredValueByCurrency).toEqual([
      { currency: "PEN", total: 50 },
      { currency: "USD", total: 125 },
    ]);
  });

  test("treats a blank currency under a neutral bucket and skips non-finite amounts", () => {
    const summary = computeFichaSummary([
      row({ raw_amount: 200, raw_currency: "" }),
      row({ raw_amount: Number.NaN, raw_currency: "USD" }),
    ]);

    expect(summary.declaredCount).toBe(2);
    expect(summary.declaredValueByCurrency).toEqual([
      { currency: "—", total: 200 },
    ]);
  });

  test("empty input yields a zero summary", () => {
    const summary = computeFichaSummary([]);
    expect(summary.declaredCount).toBe(0);
    expect(summary.declaredValueByCurrency).toEqual([]);
    expect(summary.alreadyInDb).toBe(0);
    expect(summary.investigated).toBe(0);
    expect(summary.toDecide).toBe(0);
  });

  test("classifies rows into already-in-db, investigated, and to-decide", () => {
    const enriched = (
      partial: Partial<NonNullable<FichaEnrichedRow["enriched"]>>,
    ): FichaEnrichedRow["enriched"] =>
      partial as FichaEnrichedRow["enriched"];

    const summary = computeFichaSummary([
      row({ enriched: enriched({ catalog_matched: true, primary_source: "catalog" }) }),
      row({ enriched: enriched({ catalog_matched: false, primary_source: "web_search" }) }),
      row({ enriched: enriched({ catalog_matched: false, primary_source: "claude_knowledge" }) }),
      row({ enriched: null, enrichment_failed: true }),
    ]);

    expect(summary.alreadyInDb).toBe(1); // catalog_matched
    expect(summary.investigated).toBe(2); // web_search + claude_knowledge
    expect(summary.toDecide).toBe(3); // every row that is NOT catalog_matched
  });
});

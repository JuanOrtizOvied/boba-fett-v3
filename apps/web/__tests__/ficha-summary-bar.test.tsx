import { describe, expect, test } from "vitest";
import { render, screen, within } from "@testing-library/react";
import FichaSummaryBar from "@/components/admin/ficha-patrimonial/FichaSummaryBar";
import type { FichaEnrichedRow } from "@/lib/portfolio-types";

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

/** Finds the stat cell whose label matches and returns its value text. */
function statValue(label: RegExp): string {
  const labelEl = screen.getByText(label);
  const cell = labelEl.closest("[data-stat]") as HTMLElement;
  return within(cell).getByTestId("stat-value").textContent ?? "";
}

describe("FichaSummaryBar", () => {
  const rows = [
    row({ raw_amount: 10_294, raw_currency: "USD" }),
    row({ raw_amount: 128_400, raw_currency: "USD" }),
  ];

  test("shows the derivable Slice-1 stats: declared count and declared value", () => {
    render(<FichaSummaryBar rows={rows} />);
    expect(statValue(/productos declarados/i)).toContain("2");
    expect(statValue(/valor declarado/i)).toContain("USD 138,694");
  });

  test("renders the classification counts and leaves flujos as a placeholder", () => {
    render(<FichaSummaryBar rows={rows} />);
    // Both fixture rows have no enrichment → none matched, both to-decide.
    expect(statValue(/ya estaban en la BD/i)).toBe("0");
    expect(statValue(/investigados/i)).toBe("0");
    expect(statValue(/por decidir/i)).toBe("2");
    // Flujos still needs a data source (deferred).
    expect(statValue(/flujos que necesita/i)).toBe("—");
  });
});

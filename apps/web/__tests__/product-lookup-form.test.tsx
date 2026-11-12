import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SearchResult } from "@/lib/portfolio-types";

vi.mock("@/lib/catalogLookupApi", () => ({ saveProductToCatalog: vi.fn() }));
vi.mock("@/lib/fichaApi", () => ({ researchFichaLine: vi.fn() }));
// CatalogHistory / CatalogProductPicker hit the network on mount — not under test.
vi.mock("@/components/admin/ficha-patrimonial/CatalogHistory", () => ({
  default: () => null,
}));

import ProductLookupForm from "@/components/admin/ProductLookupForm";
import { saveProductToCatalog } from "@/lib/catalogLookupApi";
import { researchFichaLine } from "@/lib/fichaApi";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    name: "Latam Credit Fund",
    manager: "Acme Manager",
    currency: "USD",
    commission: "",
    administrator: "",
    liquidity: "",
    return_rate: "",
    asset_class: [{ name: "mercados_privados", percentage: 100 }],
    geographic_focus: [],
    underlying: [],
    catalog_product_id: null,
    catalog_product_code: "BD-00155",
    catalog_matched: true,
    sources: [],
    confidence: "alta",
    primary_source: "catalog",
    provenance: {},
    series_options: [],
    ...overrides,
  } as unknown as SearchResult;
}

describe("ProductLookupForm", () => {
  beforeEach(() => {
    vi.mocked(saveProductToCatalog).mockReset();
    vi.mocked(researchFichaLine).mockReset();
  });

  test("renders the result in the ficha-style editable card with the origin badge", () => {
    render(<ProductLookupForm result={result()} />);

    // Same card as ficha: the declared name on the left rail + editable fields.
    expect(screen.getByText(/Latam Credit Fund/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Latam Credit Fund")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Acme Manager")).toBeInTheDocument();
    expect(screen.getByText("Catálogo")).toBeInTheDocument();
    // The ficha-only "Buscar con Claude" action is part of the shared card.
    expect(
      screen.getByRole("button", { name: /buscar con claude/i }),
    ).toBeInTheDocument();
  });

  test("saves the edited product to the catalog", async () => {
    vi.mocked(saveProductToCatalog).mockResolvedValue({
      catalog_product_code: "BD-00155",
      catalog_changes: { name: { old: "Latam Credit Fund", new: "Latam Credit Fund II" } },
    });
    const user = userEvent.setup();
    render(<ProductLookupForm result={result()} />);

    const nameInput = screen.getByDisplayValue("Latam Credit Fund");
    await user.type(nameInput, " II");
    await user.click(screen.getByRole("button", { name: /guardar en catálogo/i }));

    await waitFor(() => expect(saveProductToCatalog).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(saveProductToCatalog).mock.calls[0][0];
    expect(payload.catalog_product_code).toBe("BD-00155");
    expect(payload.catalog_update.name).toBe("Latam Credit Fund II");
    // A confirmation is shown.
    await waitFor(() =>
      expect(screen.getByText(/guardado en el catálogo/i)).toBeInTheDocument(),
    );
  });

  test("shows an error when the save fails", async () => {
    vi.mocked(saveProductToCatalog).mockRejectedValue(new Error("boom"));
    const user = userEvent.setup();
    render(<ProductLookupForm result={result()} />);

    await user.click(screen.getByRole("button", { name: /guardar en catálogo/i }));

    await waitFor(() =>
      expect(screen.getByText(/no se pudo guardar/i)).toBeInTheDocument(),
    );
  });

  test("shows a confidence tag per series/admin field, not one general badge", () => {
    render(
      <ProductLookupForm
        result={result({
          catalog_matched: false,
          catalog_product_code: undefined,
          primary_source: "web_search",
          series_options: [
            {
              series: "A",
              management_fee_ter: 0.0384,
              flows_min: null,
              flows_max: null,
              return_min: null,
              return_max: null,
              confidence: 71,
              field_confidence: { management_fee_ter: 85 },
              administrators: [
                {
                  administrator: "Admin Co",
                  custody_fee: 0.001,
                  buy_commission: null,
                  sell_commission: null,
                  billing_currency: "USD",
                  minimum_usd: null,
                  min_commission_usd: null,
                  confidence: 62,
                  field_confidence: { custody_fee: 77 },
                },
              ],
            },
          ],
        })}
      />,
    );

    // Per-field tags.
    expect(screen.getByText("85%")).toBeInTheDocument();
    expect(screen.getByText("77%")).toBeInTheDocument();
    // Existence confidence now sits on the name label.
    expect(screen.getByText("71%")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
    // Existing aria-labels intact.
    expect(screen.getByLabelText("Nombre de la serie 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del administrador 1")).toBeInTheDocument();
  });
});

import { describe, expect, test, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SearchResult } from "@/lib/portfolio-types";

vi.mock("@/lib/catalogLookupApi", () => ({ lookupProduct: vi.fn() }));

import BuscarProductoPage from "@/app/admin/buscar-producto/page";
import { lookupProduct } from "@/lib/catalogLookupApi";

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
    geographic_focus: [{ name: "LatAm", percentage: 100 }],
    underlying: [],
    catalog_product_id: null,
    sources: [],
    confidence: "alta",
    catalog_matched: true,
    primary_source: "catalog",
    provenance: {},
    ...overrides,
  } as unknown as SearchResult;
}

describe("BuscarProductoPage", () => {
  beforeEach(() => vi.mocked(lookupProduct).mockReset());

  test("searches by the entered name and shows the enriched result", async () => {
    vi.mocked(lookupProduct).mockResolvedValue(result());
    const user = userEvent.setup();
    render(<BuscarProductoPage />);

    await user.type(screen.getByLabelText(/nombre del producto/i), "latam credit");
    await user.click(screen.getByRole("button", { name: /buscar/i }));

    expect(lookupProduct).toHaveBeenCalledWith("latam credit");
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Latam Credit Fund" }),
      ).toBeInTheDocument(),
    );
    // The enriched product is shown in the editable form (manager as a field).
    expect(screen.getByDisplayValue("Acme Manager")).toBeInTheDocument();
    // Origin badge (catalog) is shown.
    expect(screen.getByText("Catálogo")).toBeInTheDocument();
  });

  test("shows a not-found message when the cascade returns null", async () => {
    vi.mocked(lookupProduct).mockResolvedValue(null);
    const user = userEvent.setup();
    render(<BuscarProductoPage />);

    await user.type(screen.getByLabelText(/nombre del producto/i), "xyz");
    await user.click(screen.getByRole("button", { name: /buscar/i }));

    await waitFor(() =>
      expect(screen.getByText(/no se encontró/i)).toBeInTheDocument(),
    );
  });

  test("warns when the web result is insufficient", async () => {
    vi.mocked(lookupProduct).mockResolvedValue(
      result({
        primary_source: "web_search",
        catalog_matched: false,
        confidence: "media",
        manager: "",
        asset_class: [],
        geographic_focus: [],
        web_search_insufficient: true,
        sources: [{ url: "https://x.com", title: "X" }],
      }),
    );
    const user = userEvent.setup();
    render(<BuscarProductoPage />);

    await user.type(screen.getByLabelText(/nombre del producto/i), "obscure bond");
    await user.click(screen.getByRole("button", { name: /buscar/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/no se encontró información suficiente/i),
      ).toBeInTheDocument(),
    );
  });
});

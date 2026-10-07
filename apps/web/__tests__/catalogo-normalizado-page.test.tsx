import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NormalizedCatalogPage from "@/app/admin/catalogo-normalizado/page";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type {
  CatalogProductRow,
} from "@/lib/normalized-catalog-types";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/catalogo-normalizado",
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const LIST_ROW: CatalogProductRow = {
  id: 1,
  code: "FND-1",
  name: "Fondo Uno",
  ticker_isin: "US0000000001",
  manager: "Gestora X",
  asset_class: [{ name: "Cash y Otros", percentage: 100 }],
  geographic_focus: [{ name: "EEUU", percentage: 100 }],
  underlying: [{ name: "Cash", percentage: 100 }],
  currency: "Dólares",
  investment_horizon: "Largo plazo",
  series: [],
};

const DETAIL: CatalogProductRow = {
  ...LIST_ROW,
  series: [
    {
      id: 10,
      product_code: "FND-1",
      series: "Serie A",
      management_fee_ter: 0.0384,
      flows_min: 0.01,
      flows_max: 0.05,
      return_min: 0.06,
      return_max: 0.09,
      administrators: [
        {
          id: 100,
          product_code: "FND-1",
          series: "Serie A",
          administrator: "Admin Alfa",
          custody_fee: 0.002,
          buy_commission: 0.01,
          sell_commission: 0.015,
          billing_currency: "Dólares",
          minimum_usd: 25000,
          min_commission_usd: 50,
        },
      ],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe("NormalizedCatalogPage", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset();
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const u = String(url);
      if (u.startsWith("/api/admin/normalized-catalog/products/FND-1")) {
        return jsonResponse(DETAIL);
      }
      if (u.startsWith("/api/admin/normalized-catalog/products")) {
        return jsonResponse([LIST_ROW]);
      }
      return jsonResponse({}, 404);
    });
  });

  test("lists products from the list endpoint", async () => {
    render(<NormalizedCatalogPage />);

    expect(await screen.findByText("Fondo Uno")).toBeInTheDocument();
    expect(screen.getByText("FND-1")).toBeInTheDocument();
  });

  test("selecting a product fetches and renders nested series and administrators", async () => {
    const user = userEvent.setup();
    render(<NormalizedCatalogPage />);

    await user.click(await screen.findByText("Fondo Uno"));

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        "/api/admin/normalized-catalog/products/FND-1",
        expect.anything(),
      );
    });

    expect(await screen.findByText("Serie A")).toBeInTheDocument();
    expect(screen.getByText("Admin Alfa")).toBeInTheDocument();
    // Fractions render as percentages in read views.
    expect(screen.getAllByText(/3\.84%/).length).toBeGreaterThan(0);
    // USD amounts stay plain.
    expect(screen.getByText(/25[.,]?000/)).toBeInTheDocument();
  });

  test("+ Nuevo producto opens the product form with an editable code", async () => {
    const user = userEvent.setup();
    render(<NormalizedCatalogPage />);

    await user.click(await screen.findByRole("button", { name: /\+ Nuevo producto/ }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Nuevo producto")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Código/)).toBeEnabled();
    expect(within(dialog).getByLabelText(/^Nombre/)).toBeInTheDocument();
  });

  test("series form shows a live percent hint for fractions", async () => {
    const user = userEvent.setup();
    render(<NormalizedCatalogPage />);

    await user.click(await screen.findByText("Fondo Uno"));
    await user.click(await screen.findByRole("button", { name: /\+ Serie/ }));

    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Comisión de gestión (TER)"), "0.0384");
    expect(within(dialog).getByText("= 3.84%")).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewTable from "@/components/admin/ficha-patrimonial/ReviewTable";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { FichaEnrichedRow } from "@/lib/portfolio-types";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

const MAPPED_ROW: FichaEnrichedRow = {
  excel_row: 8,
  raw_name: "Fondo Renta Fija",
  raw_tipo_activo: "Fondos mutuos",
  raw_amount: 5000,
  raw_currency: "USD",
  raw_return_rate: "5%",
  raw_pertenencia: "Titular",
  mapped_asset_class: "Mercados Publicos - Fijo",
  normalized_return_rate: "5.0",
  enriched: {
    name: "Fondo Renta Fija",
    asset_class: [{ name: "Mercados Publicos - Fijo", percentage: 100 }],
    geographic_focus: [],
    commission: "",
    currency: "USD",
    administrator: "",
    manager: "",
    liquidity: "",
    return_rate: "5.0",
    underlying: [],
    catalog_product_id: 3,
    primary_source: "catalog",
    provenance: {},
  },
  enrichment_failed: false,
};

const UNMAPPED_ROW: FichaEnrichedRow = {
  excel_row: 9,
  raw_name: "Inversión Alternativa Rara",
  raw_tipo_activo: "Otro",
  raw_amount: 2000,
  raw_currency: "USD",
  raw_return_rate: "",
  raw_pertenencia: "Cónyuge",
  mapped_asset_class: null,
  normalized_return_rate: "",
  enriched: null,
  enrichment_failed: true,
};

describe("ReviewTable rendering", () => {
  test("renders one card per parsed product with editable fields", () => {
    render(
      <ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Fondo Renta Fija")).toBeInTheDocument();
    expect(screen.getByDisplayValue("USD")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5.0")).toBeInTheDocument();
  });

  test("flags the unmapped row with a warning", () => {
    render(
      <ReviewTable rows={[UNMAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />,
    );
    expect(
      screen.getByText(/sin mapear/i),
    ).toBeInTheDocument();
  });
});

describe("ReviewTable confirm gating", () => {
  test("disables Confirmar while any row is unmapped, enables it once an asset class is selected", async () => {
    const user = userEvent.setup();
    render(
      <ReviewTable
        rows={[UNMAPPED_ROW]}
        userId="user-1"
        onConfirmed={vi.fn()}
      />,
    );
    const confirmButton = screen.getByRole("button", { name: /confirmar/i });
    expect(confirmButton).toBeDisabled();

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "cash_y_otros");

    expect(confirmButton).toBeEnabled();
  });
});

describe("ReviewTable confirm submission", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset();
  });

  test("posts the built products payload and reports the created count on success", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ created_count: 1, product_ids: ["p1"] }),
    } as Response);

    const onConfirmed = vi.fn();
    const user = userEvent.setup();
    render(
      <ReviewTable rows={[MAPPED_ROW]} userId="user-42" onConfirmed={onConfirmed} />,
    );

    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/admin/ficha-patrimonial/confirm");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.user_id).toBe("user-42");
    expect(body.products).toHaveLength(1);
    expect(body.products[0].asset_class).toEqual([
      { name: "mercados_publicos_fijo", percentage: 100 },
    ]);

    expect(await screen.findByRole("button", { name: /confirmar/i })).toBeInTheDocument();
    expect(onConfirmed).toHaveBeenCalledWith(1);
  });

  test("keeps the review table populated and editable when confirm fails", async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Usuario 'user-42' no encontrado" }),
    } as Response);

    const onConfirmed = vi.fn();
    const user = userEvent.setup();
    render(
      <ReviewTable rows={[MAPPED_ROW]} userId="user-42" onConfirmed={onConfirmed} />,
    );

    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    expect(
      await screen.findByText("Usuario 'user-42' no encontrado"),
    ).toBeInTheDocument();
    // The row is still rendered and editable — nothing was cleared on failure.
    expect(screen.getByDisplayValue("Fondo Renta Fija")).toBeInTheDocument();
    expect(onConfirmed).not.toHaveBeenCalled();
  });
});

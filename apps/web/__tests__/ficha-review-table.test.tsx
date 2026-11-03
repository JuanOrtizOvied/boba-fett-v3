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

const V2_ROW: FichaEnrichedRow = {
  excel_row: 10,
  raw_name: "Latam Credit",
  raw_tipo_activo: "Fondos mutuos",
  raw_amount: 8000,
  raw_currency: "USD",
  raw_return_rate: "",
  raw_pertenencia: "Titular",
  mapped_asset_class: "Mercados Privados",
  normalized_return_rate: "",
  enriched: {
    name: "Latam Credit Opportunities Fund",
    asset_class: [{ name: "Mercados Privados", percentage: 100 }],
    geographic_focus: [],
    commission: "",
    currency: "USD",
    administrator: "",
    manager: "Acme Manager",
    liquidity: "",
    return_rate: "",
    underlying: [],
    catalog_product_id: null,
    catalog_product_code: "BD-00001",
    series_options: [
      {
        series: "A",
        management_fee_ter: 0.0384,
        flows_min: null,
        flows_max: null,
        return_min: 0.05,
        return_max: 0.08,
        administrators: [
          {
            administrator: "Admin Co",
            custody_fee: 0.001,
            buy_commission: null,
            sell_commission: null,
            billing_currency: "USD",
            minimum_usd: null,
            min_commission_usd: null,
          },
        ],
      },
    ],
    primary_source: "catalog",
    provenance: {},
  },
  enrichment_failed: false,
};

describe("ReviewTable V2 series/admin picker", () => {
  test("picking a series fills commission and return range; picking an admin fills its name", async () => {
    const user = userEvent.setup();
    render(<ReviewTable rows={[V2_ROW]} userId="user-1" onConfirmed={vi.fn()} />);

    // Commercial fields start blank — nothing is guessed.
    const seriesSelect = screen.getByRole("combobox", { name: "Serie" });
    const adminSelect = screen.getByRole("combobox", { name: "Administrador del catálogo" });
    expect(adminSelect).toBeDisabled();

    await user.selectOptions(seriesSelect, "A");

    expect(screen.getByDisplayValue("3.84%")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5%")).toBeInTheDocument();
    expect(screen.getByDisplayValue("8%")).toBeInTheDocument();
    expect(adminSelect).toBeEnabled();

    await user.selectOptions(adminSelect, "Admin Co");
    // The free-text Administrador field is filled from the pick.
    expect(screen.getByRole("textbox", { name: "Administrador" })).toHaveValue("Admin Co");
  });
});

describe("ReviewTable V2 editable Series table", () => {
  test("renders the catalog series as editable rows (plain percent values) and keeps edits", async () => {
    const user = userEvent.setup();
    render(<ReviewTable rows={[V2_ROW]} userId="user-1" onConfirmed={vi.fn()} />);

    const ter = screen.getByLabelText("TER c/IGV serie A");
    expect(ter).toHaveValue("3.84");
    expect(screen.getByLabelText("Rent. mín serie A")).toHaveValue("5");
    expect(screen.getByLabelText("Rent. máx serie A")).toHaveValue("8");

    await user.clear(ter);
    await user.type(ter, "4.00");
    expect(screen.getByLabelText("TER c/IGV serie A")).toHaveValue("4.00");
  });
});

describe("ReviewTable V2 editable Administradores table", () => {
  test("renders the series administrators as editable rows and keeps edits", async () => {
    const user = userEvent.setup();
    render(<ReviewTable rows={[V2_ROW]} userId="user-1" onConfirmed={vi.fn()} />);

    const custody = screen.getByLabelText("Custodia % Admin Co serie A");
    expect(custody).toHaveValue("0.1"); // custody_fee 0.001 -> 0.1%
    expect(screen.getByLabelText("Mínimo USD Admin Co serie A")).toHaveValue("");

    await user.type(custody, "5");
    expect(screen.getByLabelText("Custodia % Admin Co serie A")).toHaveValue(
      "0.15",
    );
  });
});

describe("ReviewTable rendering", () => {
  test("renders one card per parsed product with editable fields", () => {
    render(
      <ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Fondo Renta Fija")).toBeInTheDocument();
    expect(screen.getByDisplayValue("USD")).toBeInTheDocument();
    expect(screen.getByDisplayValue("5.0")).toBeInTheDocument();
  });

  test("shows a confidence badge derived from the source and the declared summary", () => {
    render(
      <ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />,
    );
    // primary_source "catalog" -> Confianza alta.
    expect(screen.getByText("Confianza alta")).toBeInTheDocument();
    // Declared (raw) summary panel, read-only.
    expect(
      screen.getByText("USD · 5,000 · declara 5%"),
    ).toBeInTheDocument();
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
  test("enables Confirmar only after a line is approved; approving needs a mapped asset class", async () => {
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

    const approve = screen.getByRole("button", {
      name: "Aprobar y crear producto",
    });
    // An unmapped row cannot be approved.
    expect(approve).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox"), "cash_y_otros");
    expect(approve).toBeEnabled();

    await user.click(approve);
    expect(confirmButton).toBeEnabled();
  });

  test("deferred per-line actions are rendered but disabled", () => {
    render(
      <ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Es un producto existente" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Volver a investigar" }),
    ).toBeDisabled();
  });

  test("discarding a line excludes it from the confirm payload", async () => {
    vi.mocked(fetchWithAuth).mockReset();
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ created_count: 1, product_ids: ["p1"] }),
    } as Response);

    const user = userEvent.setup();
    render(
      <ReviewTable
        rows={[MAPPED_ROW, { ...MAPPED_ROW, excel_row: 99 }]}
        userId="user-1"
        onConfirmed={vi.fn()}
      />,
    );

    const approveButtons = screen.getAllByRole("button", {
      name: "Aprobar y crear producto",
    });
    const discardButtons = screen.getAllByRole("button", {
      name: "Descartar línea",
    });
    // Approve the first line, discard the second.
    await user.click(approveButtons[0]);
    await user.click(discardButtons[1]);

    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    const [, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.products).toHaveLength(1);
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

    await user.click(
      screen.getByRole("button", { name: "Aprobar y crear producto" }),
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

    await user.click(
      screen.getByRole("button", { name: "Aprobar y crear producto" }),
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

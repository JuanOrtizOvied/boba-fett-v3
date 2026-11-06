import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewTable from "@/components/admin/ficha-patrimonial/ReviewTable";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { researchFichaLine } from "@/lib/fichaApi";
import type { FichaEnrichedRow } from "@/lib/portfolio-types";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("@/lib/fichaApi", () => ({
  researchFichaLine: vi.fn(),
  getCatalogHistory: vi.fn(),
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
    ticker_isin: "US0001",
    investment_horizon: "Largo plazo",
    similarity: 0.71,
    data_asof: "2026-01-19",
    confidence: "alta",
    catalog_matched: true,
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
  test("picking series+admin feeds the confirm payload's commercial fields", async () => {
    vi.mocked(fetchWithAuth).mockReset();
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ created_count: 1, product_ids: ["p1"] }),
    } as Response);

    const user = userEvent.setup();
    render(<ReviewTable rows={[V2_ROW]} userId="user-1" onConfirmed={vi.fn()} />);

    const seriesSelect = screen.getByRole("combobox", { name: "Serie" });
    const adminSelect = screen.getByRole("combobox", {
      name: "Administrador del catálogo",
    });
    // Admin picker is gated until a series is chosen.
    expect(adminSelect).toBeDisabled();

    await user.selectOptions(seriesSelect, "A");
    expect(adminSelect).toBeEnabled();
    await user.selectOptions(adminSelect, "Admin Co");

    // V2_ROW is a catalog match → the primary button reads "Es un producto existente".
    await user.click(
      screen.getByRole("button", { name: "Es un producto existente" }),
    );
    await user.click(screen.getByRole("button", { name: /confirmar/i }));

    // The picked series/admin become the client product's commercial fields.
    const [, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.products[0].commission).toBe("3.84%");
    expect(body.products[0].administrator).toBe("Admin Co");
    expect(body.products[0].return_rate).toBe("5% - 8%");
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

describe("ReviewTable A2 — add series/admins for a brand-new product", () => {
  test("adds an editable series and administrator row via the + buttons", async () => {
    const user = userEvent.setup();
    // MAPPED_ROW has no series_options → brand-new product (no catalog series).
    render(<ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />);

    // No series rows yet, but the add controls are present.
    const addSeries = screen.getByRole("button", { name: /agregar serie/i });
    const addAdmin = screen.getByRole("button", { name: /agregar administrador/i });

    await user.click(addSeries);
    const seriesName = screen.getByLabelText("Nombre de la serie 1");
    await user.type(seriesName, "Serie Nueva");
    expect(screen.getByLabelText("Nombre de la serie 1")).toHaveValue("Serie Nueva");

    await user.click(addAdmin);
    const adminName = screen.getByLabelText("Nombre del administrador 1");
    await user.type(adminName, "Admin Nuevo");
    expect(screen.getByLabelText("Nombre del administrador 1")).toHaveValue(
      "Admin Nuevo",
    );
  });
});

describe("ReviewTable re-investigate with web", () => {
  test("'Buscar con Claude' overwrites the form fields with the web result", async () => {
    vi.mocked(researchFichaLine).mockResolvedValue({
      name: "Fondo Renta Fija",
      manager: "Gestor Investigado",
      currency: "USD",
      asset_class: [],
      geographic_focus: [],
      underlying: [],
      commission: "",
      administrator: "",
      liquidity: "",
      return_rate: "",
      catalog_product_id: null,
      sources: [{ url: "https://x.com", title: "X" }],
      confidence: "baja",
      catalog_matched: false,
      primary_source: "web_search",
      provenance: {},
    } as unknown as FichaEnrichedRow["enriched"] as never);

    // The ficha's declared name (raw_name, left rail) differs from the
    // enriched/form name — research must use the DECLARED name.
    const row: FichaEnrichedRow = {
      ...MAPPED_ROW,
      raw_name: "BBVA Bonos BEST (CLN23LIA)",
      enriched: { ...MAPPED_ROW.enriched!, name: "Nombre Formulario Distinto", manager: "" },
    };

    const user = userEvent.setup();
    render(<ReviewTable rows={[row]} userId="user-1" onConfirmed={vi.fn()} />);

    // The form shows the (wrong) enriched name...
    expect(screen.getByLabelText("Nombre del producto")).toHaveValue(
      "Nombre Formulario Distinto",
    );

    await user.click(screen.getByRole("button", { name: /buscar con claude/i }));

    // ...the search uses the ficha's declared name...
    expect(researchFichaLine).toHaveBeenCalledWith("BBVA Bonos BEST (CLN23LIA)");
    // ...and the form fields are OVERWRITTEN with the web values (Option A).
    await waitFor(() =>
      expect(screen.getByLabelText("Gestor")).toHaveValue("Gestor Investigado"),
    );
    expect(screen.getByLabelText("Nombre del producto")).toHaveValue(
      "Fondo Renta Fija",
    );
  });

  test("'Buscar con Claude' shows a per-field confidence % next to each filled field", async () => {
    vi.mocked(researchFichaLine).mockResolvedValue({
      name: "Fondo Investigado",
      manager: "Gestor Investigado",
      currency: "USD",
      asset_class: [],
      geographic_focus: [],
      underlying: [],
      commission: "",
      administrator: "",
      liquidity: "",
      return_rate: "",
      catalog_product_id: null,
      sources: [{ url: "https://x.com", title: "X" }],
      confidence: "baja",
      catalog_matched: false,
      primary_source: "web_search",
      provenance: {},
      field_confidence: { name: 92, manager: 70, currency: 88 },
    } as unknown as FichaEnrichedRow["enriched"] as never);

    const user = userEvent.setup();
    render(<ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /buscar con claude/i }));

    await waitFor(() =>
      expect(screen.getByTitle("Confianza de Claude: 92%")).toHaveTextContent("92%"),
    );
    expect(screen.getByTitle("Confianza de Claude: 70%")).toBeInTheDocument();
    expect(screen.getByTitle("Confianza de Claude: 88%")).toBeInTheDocument();
  });

  test("does not show an asset-class % when the class did not map to a ficha key", async () => {
    vi.mocked(researchFichaLine).mockResolvedValue({
      name: "Fondo Investigado",
      manager: "",
      currency: "",
      // A class that normalizeAssetClass cannot map → the select stays empty,
      // so the % must NOT be shown (no "37% but nothing selected").
      asset_class: [{ name: "inversiones_directas", percentage: 100 }],
      geographic_focus: [],
      underlying: [],
      commission: "",
      administrator: "",
      liquidity: "",
      return_rate: "",
      catalog_product_id: null,
      sources: [],
      confidence: "baja",
      catalog_matched: false,
      primary_source: "web_search",
      provenance: {},
      field_confidence: { name: 95, asset_class: 37 },
    } as unknown as FichaEnrichedRow["enriched"] as never);

    const user = userEvent.setup();
    render(<ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /buscar con claude/i }));

    // The name % still shows...
    await waitFor(() =>
      expect(screen.getByTitle("Confianza de Claude: 95%")).toBeInTheDocument(),
    );
    // ...but the unmapped asset-class % does not.
    expect(screen.queryByTitle("Confianza de Claude: 37%")).toBeNull();
  });
});

describe("ReviewTable Fuentes section", () => {
  test("renders a Fuentes list with links when the enrichment has sources", () => {
    const rowWithSources: FichaEnrichedRow = {
      ...MAPPED_ROW,
      enriched: {
        ...MAPPED_ROW.enriched!,
        sources: [
          { url: "https://x.com/doc", title: "Prospecto X" },
          { url: "https://y.com/cmp", title: "Comparativa Y" },
        ],
      },
    };
    render(
      <ReviewTable rows={[rowWithSources]} userId="u" onConfirmed={vi.fn()} />,
    );
    expect(screen.getByText(/Fuentes \(/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Prospecto X" });
    expect(link).toHaveAttribute("href", "https://x.com/doc");
    expect(
      screen.getByRole("link", { name: "Comparativa Y" }),
    ).toHaveAttribute("href", "https://y.com/cmp");
  });

  test("renders no Fuentes section when there are no sources", () => {
    render(<ReviewTable rows={[MAPPED_ROW]} userId="u" onConfirmed={vi.fn()} />);
    expect(screen.queryByText(/Fuentes \(/)).not.toBeInTheDocument();
  });
});

describe("ReviewTable per-line persistence", () => {
  test("approving a persisted line fires onLineDecision with its line_id", async () => {
    const onLineDecision = vi.fn();
    const user = userEvent.setup();
    render(
      <ReviewTable
        rows={[{ ...MAPPED_ROW, line_id: 55 }]}
        userId="user-1"
        onConfirmed={vi.fn()}
        onLineDecision={onLineDecision}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Aprobar y crear producto" }),
    );
    expect(onLineDecision).toHaveBeenCalledWith(55, "approved");
  });

  test("a row without a line_id does not fire onLineDecision", async () => {
    const onLineDecision = vi.fn();
    const user = userEvent.setup();
    render(
      <ReviewTable
        rows={[MAPPED_ROW]}
        userId="user-1"
        onConfirmed={vi.fn()}
        onLineDecision={onLineDecision}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Descartar línea" }),
    );
    expect(onLineDecision).not.toHaveBeenCalled();
  });
});

describe("ReviewTable rendering", () => {
  test("renders one card per parsed product with editable fields", () => {
    render(
      <ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("Fondo Renta Fija")).toBeInTheDocument();
    expect(screen.getByDisplayValue("USD")).toBeInTheDocument();
    // Gestor and Clase de activo are part of the enriched field grid.
    expect(screen.getByLabelText("Gestor")).toBeInTheDocument();
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

  test("renders an editable Gestor field from the enrichment", async () => {
    const user = userEvent.setup();
    render(<ReviewTable rows={[V2_ROW]} userId="user-1" onConfirmed={vi.fn()} />);
    const gestor = screen.getByLabelText("Gestor");
    expect(gestor).toHaveValue("Acme Manager");
    await user.clear(gestor);
    await user.type(gestor, "Nuevo Gestor");
    expect(screen.getByLabelText("Gestor")).toHaveValue("Nuevo Gestor");
  });

  test("fills Ticker/ISIN and Horizonte from the catalog signals (read-only)", () => {
    render(<ReviewTable rows={[V2_ROW]} userId="user-1" onConfirmed={vi.fn()} />);
    expect(screen.getByLabelText("Ticker / ISIN")).toHaveValue("US0001");
    expect(screen.getByLabelText("Horizonte")).toHaveValue("Largo plazo");
  });

  test("shows backend confidence, similitud %, and catalog-match status", () => {
    render(<ReviewTable rows={[V2_ROW]} userId="user-1" onConfirmed={vi.fn()} />);
    expect(screen.getByText("Confianza alta")).toBeInTheDocument();
    expect(screen.getByText(/similitud 71%/i)).toBeInTheDocument();
    expect(screen.getByText(/Producto existente/)).toBeInTheDocument();
    expect(screen.getByText(/dato al 2026-01-19/)).toBeInTheDocument();
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

  test("'Buscar con Claude' is an enabled web-research action", () => {
    render(
      <ReviewTable rows={[MAPPED_ROW]} userId="user-1" onConfirmed={vi.fn()} />,
    );
    expect(
      screen.getByRole("button", { name: "Buscar con Claude" }),
    ).toBeEnabled();
  });

  test("approving calls onApprove with the catalog curation request", async () => {
    const onApprove = vi.fn();
    const user = userEvent.setup();
    render(
      <ReviewTable
        rows={[V2_ROW]}
        userId="user-9"
        onConfirmed={vi.fn()}
        onApprove={onApprove}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Es un producto existente" }),
    );
    expect(onApprove).toHaveBeenCalledTimes(1);
    const req = onApprove.mock.calls[0][0];
    expect(req.user_id).toBe("user-9");
    expect(req.catalog_product_code).toBe("BD-00001");
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

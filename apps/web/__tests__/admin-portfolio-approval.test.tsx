import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ApproveProductModal,
  ReadOnlyProductCard,
} from "@/app/admin/portfolios/[userId]/ReadOnlyProductCard";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { Product } from "@/lib/portfolio-types";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

const PRODUCT: Product = {
  id: "prod-1",
  user_id: "user-1",
  name: "Bono Soberano",
  provider: "BCP",
  amount: 10000,
  category: "mercados_publicos",
  underlying: [{ name: "US Treasuries", percentage: 100 }],
  asset_class: "",
  geographic_focus: "",
  commission: "",
  currency: "",
  administrator: "",
  manager: "",
  liquidity: "",
  return_rate: "",
  catalog_product_id: null,
};

const CATALOG_ENTRY = {
  id: 77,
  name: "Bono Soberano Catálogo",
  geographic_focus: "LatAm",
  asset_class: "Renta Fija",
  underlying: [{ name: "Bonos", percentage: 100 }],
  commission: "1.5%",
  currency: "USD",
  administrator: "Admin Co",
  manager: "Manager Co",
  liquidity: "T+2",
  return_rate: "8%",
  category: "mercados_publicos",
  alternative_names: [],
  approved_from_product_id: null,
  approved_at: null,
};

describe("ReadOnlyProductCard approval affordance", () => {
  test("clicking Aprobar calls onApprove with the product", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    render(<ReadOnlyProductCard product={PRODUCT} onApprove={onApprove} />);

    await user.click(screen.getByRole("button", { name: /Aprobar/ }));

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(PRODUCT);
  });

  test("shows the approved state and disables the approval button", () => {
    render(
      <ReadOnlyProductCard
        product={PRODUCT}
        onApprove={vi.fn()}
        isApproved
      />,
    );

    const button = screen.getByRole("button", { name: "Aprobado" });
    expect(button).toBeDisabled();
  });
});

describe("ApproveProductModal pre-fill", () => {
  test("pre-fills name and category, leaves enrichment fields empty", () => {
    render(<ApproveProductModal product={PRODUCT} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Nombre")).toHaveValue("Bono Soberano");
    expect(screen.getByLabelText("Categoría")).toHaveValue("mercados_publicos");
    expect(screen.getByLabelText("Clase de activo")).toHaveValue("");
    expect(screen.getByLabelText("Comisión")).toHaveValue("");
  });

  test("renders nothing when product is null", () => {
    const { container } = render(
      <ApproveProductModal product={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("shows current catalog values beside proposed values", () => {
    render(
      <ApproveProductModal
        product={{ ...PRODUCT, catalog_product_id: 77, commission: "2.0%" }}
        catalogEntry={CATALOG_ENTRY}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/valores actuales/i)).toBeInTheDocument();
    expect(screen.getByText("Bono Soberano Catálogo")).toBeInTheDocument();
    expect(screen.getByText("2.0%")).toBeInTheDocument();
  });
});

describe("ApproveProductModal cancel", () => {
  test("Cancel closes without calling fetch", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ApproveProductModal product={PRODUCT} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchWithAuth).not.toHaveBeenCalled();
  });
});

describe("ApproveProductModal confirm", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset();
  });

  test("Confirm posts enrichment fields, marks approved and closes the modal", async () => {
    const user = userEvent.setup();
    const onApproved = vi.fn();
    const onClose = vi.fn();
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({}),
    } as Response);

    render(
      <ApproveProductModal
        product={PRODUCT}
        onClose={onClose}
        onApproved={onApproved}
      />,
    );

    await user.type(screen.getByLabelText("Clase de activo"), "Renta Fija");
    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });
    const [url, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    expect(url).toBe("/api/admin/catalog/approve");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({
      name: "Bono Soberano",
      category: "mercados_publicos",
      asset_class: "Renta Fija",
      approved_from_product_id: "prod-1",
      catalog_product_id: null,
    });

    await waitFor(() => {
      expect(onApproved).toHaveBeenCalledWith("prod-1");
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  test("shows the duplicate message inline on a 409 response", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({}),
    } as Response);

    render(<ApproveProductModal product={PRODUCT} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    expect(await screen.findByText(/ya existe/i)).toBeInTheDocument();
  });

  test("includes catalog_product_id when approving a catalog-sourced product", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as Response);

    render(
      <ApproveProductModal
        product={{ ...PRODUCT, catalog_product_id: 77 }}
        catalogEntry={CATALOG_ENTRY}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Aprobar" }));

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledTimes(1);
    });
    const [, init] = vi.mocked(fetchWithAuth).mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.catalog_product_id).toBe(77);
    expect(body.approved_from_product_id).toBe("prod-1");
  });
});

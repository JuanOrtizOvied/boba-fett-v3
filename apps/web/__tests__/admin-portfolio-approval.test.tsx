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
  category: "publicos",
  subcategory: "Renta Fija US Treasuries",
  composition: [{ name: "US Treasuries", percentage: 100 }],
  asset_class: "",
  geographic_focus: "",
  underlying: "",
  commission: "",
  currency: "",
  administrator: "",
  manager: "",
  liquidity: "",
  return_rate: "",
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
  test("pre-fills name, category and subcategory, leaves enrichment fields empty", () => {
    render(<ApproveProductModal product={PRODUCT} onClose={vi.fn()} />);

    expect(screen.getByLabelText("Nombre")).toHaveValue("Bono Soberano");
    expect(screen.getByLabelText("Categoría")).toHaveValue("publicos");
    expect(screen.getByLabelText("Subcategoría")).toHaveValue(
      "Renta Fija US Treasuries",
    );
    expect(screen.getByLabelText("Clase de activo")).toHaveValue("");
    expect(screen.getByLabelText("Comisión")).toHaveValue("");
  });

  test("renders nothing when product is null", () => {
    const { container } = render(
      <ApproveProductModal product={null} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
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
      category: "publicos",
      subcategory: "Renta Fija US Treasuries",
      asset_class: "Renta Fija",
      approved_from_product_id: "prod-1",
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
});

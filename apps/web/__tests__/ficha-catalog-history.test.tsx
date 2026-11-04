import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CatalogHistory from "@/components/admin/ficha-patrimonial/CatalogHistory";
import { getCatalogHistory } from "@/lib/fichaApi";
import type { CatalogHistoryEntry } from "@/lib/portfolio-types";

vi.mock("@/lib/fichaApi", () => ({ getCatalogHistory: vi.fn() }));

const ENTRY: CatalogHistoryEntry = {
  id: 1,
  product_code: "BD-00042",
  action: "update",
  changed_by: "admin-1",
  source: "ficha",
  changes: { name: { old: "Old", new: "New" } },
  created_at: "2026-01-21T10:00:00Z",
};

beforeEach(() => vi.mocked(getCatalogHistory).mockReset());

describe("CatalogHistory", () => {
  test("loads and lists the product's change history on toggle", async () => {
    vi.mocked(getCatalogHistory).mockResolvedValue([ENTRY]);
    const user = userEvent.setup();
    render(<CatalogHistory code="BD-00042" />);

    await user.click(
      screen.getByRole("button", { name: /historial de cambios/i }),
    );

    expect(getCatalogHistory).toHaveBeenCalledWith("BD-00042");
    expect(await screen.findByText(/name/)).toBeInTheDocument();
  });

  test("shows an empty state when there is no history", async () => {
    vi.mocked(getCatalogHistory).mockResolvedValue([]);
    const user = userEvent.setup();
    render(<CatalogHistory code="BD-00042" />);

    await user.click(
      screen.getByRole("button", { name: /historial de cambios/i }),
    );

    expect(await screen.findByText(/sin cambios registrados/i)).toBeInTheDocument();
  });
});

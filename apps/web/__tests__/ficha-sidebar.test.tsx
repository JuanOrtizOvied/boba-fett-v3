import { describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FichaSidebar from "@/components/admin/ficha-patrimonial/FichaSidebar";
import type { FichaListItem } from "@/lib/portfolio-types";

const items: FichaListItem[] = [
  {
    id: 1,
    client_name: "Ana Lopez",
    client_email: "ana@x.com",
    created_at: "2026-11-01T10:00:00Z",
    line_count: 5,
    status: "por_validar",
  },
  {
    id: 2,
    client_name: "Beto Diaz",
    client_email: "beto@x.com",
    created_at: "2026-11-02T10:00:00Z",
    line_count: 3,
    status: "validada",
  },
];

function renderSidebar(overrides = {}) {
  const props = {
    fichas: items,
    activeFilter: "todas" as const,
    selectedId: null,
    onFilterChange: vi.fn(),
    onSelect: vi.fn(),
    onUpload: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  render(<FichaSidebar {...props} />);
  return props;
}

describe("FichaSidebar", () => {
  test("renders a row per ficha with name, product count and status badge", () => {
    renderSidebar();
    const row1 = screen.getByTestId("ficha-row-1");
    expect(within(row1).getByText("Ana Lopez")).toBeInTheDocument();
    expect(within(row1).getByText(/5 productos/)).toBeInTheDocument();
    expect(within(row1).getByText("Por validar")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("ficha-row-2")).getByText("Validada"),
    ).toBeInTheDocument();
  });

  test("clicking a ficha row selects it", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSidebar();
    await user.click(screen.getByTestId("ficha-row-1"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  test("clicking a filter tab emits the status (or 'todas')", async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Validadas" }));
    expect(onFilterChange).toHaveBeenCalledWith("validada");
  });

  test("the upload button triggers onUpload", async () => {
    const user = userEvent.setup();
    const { onUpload } = renderSidebar();
    await user.click(screen.getByRole("button", { name: /subir ficha/i }));
    expect(onUpload).toHaveBeenCalled();
  });

  test("clicking the delete button calls onDelete, not onSelect", async () => {
    const user = userEvent.setup();
    const { onDelete, onSelect } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Eliminar Ana Lopez" }));
    expect(onDelete).toHaveBeenCalledWith(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("the selected ficha row is marked current", () => {
    renderSidebar({ selectedId: 2 });
    expect(screen.getByTestId("ficha-row-2")).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

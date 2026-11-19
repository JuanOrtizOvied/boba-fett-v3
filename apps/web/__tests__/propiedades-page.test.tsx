import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PropertiesPage from "@/app/admin/propiedades/page";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/propiedades",
}));

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

const LIST_URL = "/api/admin/properties";
const BACKFILL_URL = "/api/admin/properties/backfill-slugs";

const LIST_ROW = {
  code: "PR-1",
  name: "Torre Uno",
  usage: "Oficinas",
  manager: "Gestora X",
  administrator: "Admin Alfa",
  estimated_value_usd: 1000000,
  ownership: 1,
  asset_class: [{ name: "Renta Fija", percentage: 1 }],
  geographic_focus: [{ name: "EEUU", percentage: 1 }],
  underlying: [{ name: "Inmueble", percentage: 1 }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as Response;
}

describe("PropertiesPage backfill slugs button", () => {
  beforeEach(() => {
    vi.mocked(fetchWithAuth).mockReset();
    toastMock.mockReset();
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (String(url) === LIST_URL) return jsonResponse([LIST_ROW]);
      return jsonResponse({}, 404);
    });
  });

  function mockBackfill(body: unknown, status = 200) {
    const base = vi.mocked(fetchWithAuth).getMockImplementation()!;
    vi.mocked(fetchWithAuth).mockImplementation(async (url, init) => {
      if (String(url) === BACKFILL_URL) return jsonResponse(body, status);
      return base(url, init);
    });
  }

  const listCalls = () =>
    vi.mocked(fetchWithAuth).mock.calls.filter(([u]) => String(u) === LIST_URL).length;

  test("POSTs the backfill, toasts the total and refetches the list", async () => {
    mockBackfill({
      updated: { asset_class: 2, geographic_focus: 0, underlying: 1 },
      total: 3,
    });
    const user = userEvent.setup();
    render(<PropertiesPage />);
    await screen.findByText("Torre Uno");
    const before = listCalls();

    await user.click(screen.getByRole("button", { name: /Generar slugs faltantes/ }));

    await waitFor(() => {
      expect(fetchWithAuth).toHaveBeenCalledWith(
        BACKFILL_URL,
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.stringContaining("Slugs generados: 3"),
        "success",
      );
    });
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
  });

  test("toasts that nothing was missing when total is 0", async () => {
    mockBackfill({
      updated: { asset_class: 0, geographic_focus: 0, underlying: 0 },
      total: 0,
    });
    const user = userEvent.setup();
    render(<PropertiesPage />);
    await screen.findByText("Torre Uno");

    await user.click(screen.getByRole("button", { name: /Generar slugs faltantes/ }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith("No faltaban slugs", "success");
    });
  });

  test("shows an error toast when the request fails", async () => {
    mockBackfill({ detail: "boom" }, 500);
    const user = userEvent.setup();
    render(<PropertiesPage />);
    await screen.findByText("Torre Uno");

    await user.click(screen.getByRole("button", { name: /Generar slugs faltantes/ }));

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls[0][0]).toContain("boom");
  });
});

import { act } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SnapshotModal } from "@/components/portfolio/SnapshotModal";
import { ToastProvider } from "@/components/ui/Toast";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import { usePortfolioVersioning, type Snapshot } from "@/lib/usePortfolioVersioning";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

const pushMock = vi.fn();
// `useRouter()` must return a *stable* object reference across renders (as
// the real Next.js router does) — otherwise `usePortfolioVersioning`'s
// `useCallback([router])` dependency changes every render and re-triggers
// the mount `useEffect` in an infinite loop.
const routerMock = { push: pushMock };
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

const SNAPSHOT: Snapshot = {
  id: "snap-1",
  name: "Pre-revisión Q3",
  description: "",
  product_count: 3,
  total_amount: 15000,
  created_at: "2026-07-14T00:00:00Z",
};

beforeEach(() => {
  vi.mocked(fetchWithAuth).mockReset();
  pushMock.mockReset();
});

describe("SnapshotModal — creation flow (SNAP-007)", () => {
  test("empty name is blocked client-side and sends no request", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();

    render(
      <ToastProvider>
        <SnapshotModal isOpen onClose={vi.fn()} onCreate={onCreate} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByText("Ingresa un nombre para la versión")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  test("valid submit calls onCreate with the entered name/description and closes with a toast", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreate = vi.fn().mockResolvedValue(SNAPSHOT);

    render(
      <ToastProvider>
        <SnapshotModal isOpen onClose={onClose} onCreate={onCreate} />
      </ToastProvider>,
    );

    await user.type(screen.getByPlaceholderText("Ej. Pre-revisión Q3"), "Pre-revisión Q3");
    await user.type(
      screen.getByLabelText("Descripción (opcional)"),
      "Antes de la reunión trimestral",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        "Pre-revisión Q3",
        "Antes de la reunión trimestral",
      );
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Versión "Pre-revisión Q3" guardada')).toBeInTheDocument();
  });

  test("a failed creation surfaces a visible inline error and keeps the modal open", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreate = vi.fn().mockRejectedValue(new Error("No se pudo guardar (status 500)"));

    render(
      <ToastProvider>
        <SnapshotModal isOpen onClose={onClose} onCreate={onCreate} />
      </ToastProvider>,
    );

    await user.type(screen.getByPlaceholderText("Ej. Pre-revisión Q3"), "Cierre 2026");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(screen.getAllByText("No se pudo guardar (status 500)").length).toBeGreaterThan(0);
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("usePortfolioVersioning — createSnapshot (SNAP-001)", () => {
  test("posts to the snapshots endpoint and refetches the list on success", async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async (input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => SNAPSHOT,
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ snapshots: [SNAPSHOT] }),
      } as Response;
    });

    const { result } = renderHook(() => usePortfolioVersioning());

    await waitFor(() => expect(result.current.isLoadingSnapshots).toBe(false));

    await act(async () => {
      await result.current.createSnapshot("Pre-revisión Q3", "");
    });

    const postCall = vi
      .mocked(fetchWithAuth)
      .mock.calls.find(([, init]) => init?.method === "POST");
    expect(postCall).toBeDefined();
    const [url, init] = postCall!;
    expect(url).toBe("/api/portfolio/me/snapshots");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "Pre-revisión Q3",
      description: "",
    });

    // Filtered to the snapshots endpoint specifically — PR7 (T-024) added a
    // second mount-time GET to `/api/portfolio/me/changes`, so a blanket
    // "any GET" count would no longer isolate the snapshots refetch.
    const snapshotsGetCallCount = vi
      .mocked(fetchWithAuth)
      .mock.calls.filter(
        ([url, init]) =>
          (init?.method ?? "GET") === "GET" && url === "/api/portfolio/me/snapshots",
      ).length;
    // Initial mount fetch + refetch after create.
    expect(snapshotsGetCallCount).toBe(2);

    await waitFor(() => expect(result.current.snapshots).toEqual([SNAPSHOT]));
  });

  test("a failed creation rejects without a silent failure", async () => {
    vi.mocked(fetchWithAuth).mockImplementation(async (_input, init) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        return { ok: false, status: 500, json: async () => ({}) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({ snapshots: [] }) } as Response;
    });

    const { result } = renderHook(() => usePortfolioVersioning());
    await waitFor(() => expect(result.current.isLoadingSnapshots).toBe(false));

    await expect(
      act(async () => {
        await result.current.createSnapshot("Cierre 2026");
      }),
    ).rejects.toThrow("No se pudo guardar la versión (status 500)");
  });
});

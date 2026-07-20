import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VersioningDrawer } from "@/components/portfolio/VersioningDrawer";
import { fetchWithAuth } from "@/lib/fetchWithAuth";
import type { ChangeLogEntry, Snapshot, SnapshotDetail } from "@/lib/usePortfolioVersioning";

vi.mock("@/lib/fetchWithAuth", () => ({
  fetchWithAuth: vi.fn(),
}));

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: "snap-1",
    name: "Q2 Review",
    description: "",
    product_count: 3,
    total_amount: 90000,
    category_summary: [],
    created_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

// Backend already returns snapshots newest-first (`ORDER BY created_at
// DESC`) — the drawer/list render in the given prop order without
// re-sorting.
const SNAPSHOTS: Snapshot[] = [
  makeSnapshot({ id: "snap-3", name: "Q3 Review", created_at: "2026-07-01T00:00:00Z" }),
  makeSnapshot({ id: "snap-2", name: "Mid-year", created_at: "2026-06-15T00:00:00Z" }),
  makeSnapshot({ id: "snap-1", name: "Q2 Review", created_at: "2026-06-01T00:00:00Z" }),
];

const DETAIL: SnapshotDetail = {
  ...SNAPSHOTS[0],
  products: [
    {
      id: "prod_1",
      user_id: "user-1",
      name: "BlackRock Fund",
      provider: "BlackRock",
      amount: 50000,
      category: "mercados_privados",
      underlying: [],
      asset_class: "",
      geographic_focus: "",
      commission: "",
      currency: "",
      administrator: "",
      manager: "",
      liquidity: "",
      return_rate: "",
      catalog_product_id: null,
    },
  ],
};

function baseProps() {
  return {
    isOpen: true,
    onClose: vi.fn(),
    snapshots: SNAPSHOTS,
    isLoadingSnapshots: false,
    changes: [] as ChangeLogEntry[],
    isLoadingChanges: false,
    changesTotal: 0,
    changesHasMore: false,
    onLoadMoreChanges: vi.fn(),
    comparison: null,
    isComparing: false,
    compareError: null,
    onCompare: vi.fn(),
    onClearComparison: vi.fn(),
  };
}

beforeEach(() => {
  vi.mocked(fetchWithAuth).mockReset();
});

describe("VersioningDrawer — snapshot timeline (SNAP-008)", () => {
  test("lists all snapshots in the given order (newest first)", () => {
    render(<VersioningDrawer {...baseProps()} />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Q3 Review");
    expect(items[1]).toHaveTextContent("Mid-year");
    expect(items[2]).toHaveTextContent("Q2 Review");
  });

  test("selecting a snapshot opens a read-only detail view with no edit/delete controls", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => DETAIL,
    } as Response);

    render(<VersioningDrawer {...baseProps()} />);

    await user.click(screen.getByText("Q3 Review"));

    await waitFor(() => {
      expect(screen.getByTestId("snapshot-detail-products")).toBeInTheDocument();
    });
    expect(screen.getByText("BlackRock Fund")).toBeInTheDocument();
    expect(fetchWithAuth).toHaveBeenCalledWith("/api/portfolio/me/snapshots/snap-3");

    expect(screen.queryByRole("button", { name: /eliminar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /editar/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/eliminar fila/i)).not.toBeInTheDocument();
  });

  test("a failed detail fetch surfaces a visible error, not a blank panel", async () => {
    const user = userEvent.setup();
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    render(<VersioningDrawer {...baseProps()} />);
    await user.click(screen.getByText("Q3 Review"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No se pudo cargar la versión (status 404)",
      );
    });
  });
});

describe("VersioningDrawer — change log (AL-008)", () => {
  test("the Changes tab renders entries in the given reverse-chronological order with operation and source", async () => {
    const user = userEvent.setup();
    const changes: ChangeLogEntry[] = [
      {
        id: "chg-2",
        user_id: "user-1",
        product_id: "prod_2",
        operation: "update",
        before_state: null,
        after_state: { ...DETAIL.products[0], id: "prod_2", name: "Updated Fund" },
        source: "agent",
        metadata: {},
        snapshot_id: null,
        created_at: "2026-07-14T10:00:00Z",
      },
      {
        id: "chg-1",
        user_id: "user-1",
        product_id: "prod_1",
        operation: "create",
        before_state: null,
        after_state: { ...DETAIL.products[0], name: "First Fund" },
        source: "api",
        metadata: {},
        snapshot_id: null,
        created_at: "2026-07-10T10:00:00Z",
      },
    ];

    render(<VersioningDrawer {...baseProps()} changes={changes} changesTotal={2} />);

    await user.click(screen.getByRole("tab", { name: "Cambios" }));

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Updated Fund");
    expect(items[0]).toHaveTextContent("Actualizado");
    expect(items[0]).toHaveTextContent("Agente");
    expect(items[1]).toHaveTextContent("First Fund");
    expect(items[1]).toHaveTextContent("Creado");
    expect(items[1]).toHaveTextContent("Manual");
  });
});

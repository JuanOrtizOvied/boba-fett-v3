import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ComparisonView } from "@/components/portfolio/ComparisonView";
import type { Product } from "@/lib/portfolio-types";
import type { Snapshot, SnapshotDiff } from "@/lib/usePortfolioVersioning";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "prod_1",
    user_id: "user-1",
    name: "BlackRock Fund",
    provider: "BlackRock",
    amount: 100000,
    category: "mercados_privados",
    subcategory: "",
    composition: [],
    asset_class: "",
    geographic_focus: "",
    underlying: "",
    commission: "",
    currency: "",
    administrator: "",
    manager: "",
    liquidity: "",
    return_rate: "",
    catalog_product_id: null,
    ...overrides,
  };
}

const SNAPSHOT_A: Snapshot = {
  id: "snap-a",
  name: "Q2 Review",
  description: "",
  product_count: 3,
  total_amount: 100000,
  category_summary: [],
  created_at: "2026-06-01T00:00:00Z",
};

const SNAPSHOT_B: Snapshot = {
  id: "snap-b",
  name: "Q3 Review",
  description: "",
  product_count: 4,
  total_amount: 130000,
  category_summary: [],
  created_at: "2026-07-01T00:00:00Z",
};

// Mirrors `VersioningRepository.compare_snapshots`'s actual return shape
// (`db/versioning.py`) — per-field deltas use `{before, after}` keys.
const DIFF: SnapshotDiff = {
  snapshot_a: SNAPSHOT_A.id,
  snapshot_b: SNAPSHOT_B.id,
  added: [makeProduct({ id: "prod_new", name: "New Fund" })],
  removed: [makeProduct({ id: "prod_old", name: "Old Fund" })],
  modified: [
    {
      product_id: "prod_1",
      name: "BlackRock Fund",
      before: makeProduct({ amount: 100000 }),
      after: makeProduct({ amount: 130000 }),
      changes: { amount: { before: 100000, after: 130000 } },
    },
  ],
  summary: {
    added_count: 1,
    removed_count: 1,
    modified_count: 1,
    total_amount_delta: 30000,
    product_count_delta: 0,
  },
};

const EMPTY_DIFF: SnapshotDiff = {
  snapshot_a: SNAPSHOT_A.id,
  snapshot_b: SNAPSHOT_A.id,
  added: [],
  removed: [],
  modified: [],
  summary: {
    added_count: 0,
    removed_count: 0,
    modified_count: 0,
    total_amount_delta: 0,
    product_count_delta: 0,
  },
};

describe("ComparisonView — diff classification and deltas (CMP-002, CMP-003, CMP-004)", () => {
  test("renders added/removed/modified sections with correct color coding and per-field deltas", () => {
    render(
      <ComparisonView
        isOpen
        onClose={vi.fn()}
        snapshotA={SNAPSHOT_A}
        snapshotB={SNAPSHOT_B}
        comparison={DIFF}
        isComparing={false}
        compareError={null}
      />,
    );

    const addedSection = screen.getByText("Agregados (1)").closest("section");
    expect(addedSection).toHaveClass("border-emerald-200");
    expect(addedSection).toHaveTextContent("New Fund");

    const removedSection = screen.getByText("Eliminados (1)").closest("section");
    expect(removedSection).toHaveClass("border-red-200");
    expect(removedSection).toHaveTextContent("Old Fund");

    const modifiedSection = screen.getByText("Modificados (1)").closest("section");
    expect(modifiedSection).toHaveClass("border-amber-200");
    // Field-level delta inline, not a generic "changed" label (CMP-004).
    expect(modifiedSection).toHaveTextContent("Monto:");
    expect(modifiedSection).toHaveTextContent("$100,000 → $130,000");
  });
});

describe("ComparisonView — self-comparison (CMP-006) and empty diffs (CMP-004)", () => {
  test("an all-empty diff shows an explicit no-changes state, not three empty sections", () => {
    render(
      <ComparisonView
        isOpen
        onClose={vi.fn()}
        snapshotA={SNAPSHOT_A}
        snapshotB={SNAPSHOT_A}
        comparison={EMPTY_DIFF}
        isComparing={false}
        compareError={null}
      />,
    );

    expect(screen.getByText("Sin cambios entre estas dos versiones.")).toBeInTheDocument();
    expect(screen.queryByText(/Agregados/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Eliminados/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Modificados/)).not.toBeInTheDocument();
  });
});

describe("ComparisonView — error handling (CMP-005)", () => {
  test("a compare error renders a visible message instead of a blank or partial diff", () => {
    render(
      <ComparisonView
        isOpen
        onClose={vi.fn()}
        snapshotA={SNAPSHOT_A}
        snapshotB={SNAPSHOT_B}
        comparison={null}
        isComparing={false}
        compareError="Snapshot snap-b not found"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Snapshot snap-b not found");
    expect(screen.queryByText(/Agregados/)).not.toBeInTheDocument();
  });

  test("a pending compare shows a loading state instead of a blank panel", () => {
    render(
      <ComparisonView
        isOpen
        onClose={vi.fn()}
        snapshotA={SNAPSHOT_A}
        snapshotB={SNAPSHOT_B}
        comparison={null}
        isComparing
        compareError={null}
      />,
    );

    expect(screen.getByText("Comparando versiones…")).toBeInTheDocument();
  });
});

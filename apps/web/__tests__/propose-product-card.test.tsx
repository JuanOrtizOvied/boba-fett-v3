import type { ComponentProps } from "react";
import { useContext, useEffect } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useThreadRuntime } from "@assistant-ui/react";
import {
  ProposalBatchContext,
  ProposalBatchProvider,
  ProposeProductCard,
  type ProposalEntry,
} from "@/components/assistant-ui/thread";

vi.mock("@assistant-ui/react", () => {
  const stub = () => new Proxy({}, { get: () => "div" });
  return {
    useThreadRuntime: vi.fn(() => ({ append: vi.fn() })),
    MessagePrimitive: stub(),
    ActionBarPrimitive: stub(),
    AttachmentPrimitive: stub(),
    ComposerPrimitive: stub(),
    ErrorPrimitive: stub(),
    ThreadPrimitive: stub(),
  };
});

type ProductInput = {
  name?: string;
  amount?: number;
  category?: string;
  subcategory?: string;
  provider?: string;
};

function cardProps(product: ProductInput) {
  return {
    result: { status: "proposed", product },
  } as unknown as ComponentProps<typeof ProposeProductCard>;
}

function errorCardProps() {
  return {
    result: { status: "error", message: "boom" },
  } as unknown as ComponentProps<typeof ProposeProductCard>;
}

/** Test-only consumer that reports every batch snapshot to the caller. */
function BatchSnapshot({
  onSnapshot,
}: {
  onSnapshot: (entries: Map<string, ProposalEntry> | undefined) => void;
}) {
  const batch = useContext(ProposalBatchContext);
  useEffect(() => {
    onSnapshot(batch?.entries);
  });
  return null;
}

function ConditionalCard({ show, product }: { show: boolean; product: ProductInput }) {
  return show ? <ProposeProductCard {...cardProps(product)} /> : null;
}

let appendMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  appendMock = vi.fn();
  vi.mocked(useThreadRuntime).mockReturnValue({ append: appendMock } as unknown as ReturnType<
    typeof useThreadRuntime
  >);
});

describe("ProposeProductCard rendering", () => {
  test("renders full product fields with no missing-fields warning", () => {
    render(
      <ProposeProductCard
        {...cardProps({
          name: "BlackRock Fund",
          amount: 1000,
          category: "publicos",
          subcategory: "US Treasuries",
        })}
      />,
    );

    expect(screen.getByLabelText("Nombre")).toHaveValue("BlackRock Fund");
    expect(screen.getByLabelText("Monto (USD)")).toHaveValue(1000);
    expect(screen.getByLabelText("Categoría")).toHaveValue("publicos");
    expect(screen.getByLabelText(/Subcategoría/)).toHaveValue("US Treasuries");
    expect(screen.getByText("Merc. públicos")).toBeInTheDocument();
    expect(screen.queryByText(/Completa:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, agregar" })).not.toBeDisabled();
  });

  test("shows a missing-fields warning and disables confirm when subcategory is missing", () => {
    render(
      <ProposeProductCard
        {...cardProps({
          name: "Fondo X",
          amount: 500,
          category: "cash",
          subcategory: undefined,
        })}
      />,
    );

    expect(screen.getByText("Completa: subcategoría")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, agregar" })).toBeDisabled();
  });

  test("renders nothing for a non-proposed tool result", () => {
    const { container } = render(<ProposeProductCard {...errorCardProps()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ProposeProductCard field editing", () => {
  test("editing amount to a valid positive number clears the warning", async () => {
    const user = userEvent.setup();
    render(
      <ProposeProductCard
        {...cardProps({
          name: "Fondo X",
          amount: 0,
          category: "cash",
          subcategory: "Depósitos a plazo",
        })}
      />,
    );

    expect(screen.getByText("Completa: monto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, agregar" })).toBeDisabled();

    const amountInput = screen.getByLabelText("Monto (USD)");
    await user.clear(amountInput);
    await user.type(amountInput, "500");

    expect(screen.queryByText(/Completa:/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sí, agregar" })).not.toBeDisabled();
  });
});

describe("ProposeProductCard confirm and reject actions", () => {
  test("confirm sends the exact composed text and switches to confirmed", async () => {
    const user = userEvent.setup();
    render(
      <ProposeProductCard
        {...cardProps({
          name: "BlackRock Fund",
          amount: 1000,
          category: "publicos",
          subcategory: "Renta Fija",
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sí, agregar" }));

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith({
      role: "user",
      content: [
        {
          type: "text",
          text: "Sí, agregar al portafolio con: nombre: BlackRock Fund, monto: 1000, categoría: publicos, subcategoría: Renta Fija.",
        },
      ],
    });
    expect(screen.getByText("✓ Confirmado")).toBeInTheDocument();
  });

  test("confirm is a no-op when the card is invalid", async () => {
    const user = userEvent.setup();
    render(
      <ProposeProductCard
        {...cardProps({
          name: "",
          amount: 1000,
          category: "cash",
          subcategory: "Depósitos a plazo",
        })}
      />,
    );

    const confirmButton = screen.getByRole("button", { name: "Sí, agregar" });
    expect(confirmButton).toBeDisabled();

    await user.click(confirmButton);

    expect(appendMock).not.toHaveBeenCalled();
    expect(screen.queryByText("✓ Confirmado")).not.toBeInTheDocument();
  });

  test("reject always sends the rejection text, even for an incomplete card", async () => {
    const user = userEvent.setup();
    render(
      <ProposeProductCard
        {...cardProps({
          name: "Fondo Y",
          amount: 500,
          category: "cash",
          subcategory: undefined,
        })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "No" }));

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith({
      role: "user",
      content: [{ type: "text", text: 'No, no agregar "Fondo Y".' }],
    });
    expect(screen.getByText("✗ Descartado")).toBeInTheDocument();
  });
});

describe("ProposeProductCard registration in ProposalBatchProvider", () => {
  test("registers an entry on mount", async () => {
    let latest: Map<string, ProposalEntry> | undefined;

    render(
      <ProposalBatchProvider>
        <ProposeProductCard
          {...cardProps({
            name: "BlackRock Fund",
            amount: 1000,
            category: "publicos",
            subcategory: "Renta Fija",
          })}
        />
        <BatchSnapshot onSnapshot={(entries) => (latest = entries)} />
      </ProposalBatchProvider>,
    );

    await waitFor(() => {
      expect(latest?.size).toBe(1);
      const [entry] = Array.from(latest!.values());
      expect(entry.isValid).toBe(true);
      expect(entry.responded).toBeNull();
    });
  });

  test("unregisters its entry on unmount", async () => {
    let latest: Map<string, ProposalEntry> | undefined;
    const product: ProductInput = {
      name: "BlackRock Fund",
      amount: 1000,
      category: "publicos",
      subcategory: "Renta Fija",
    };

    const { rerender } = render(
      <ProposalBatchProvider>
        <ConditionalCard show product={product} />
        <BatchSnapshot onSnapshot={(entries) => (latest = entries)} />
      </ProposalBatchProvider>,
    );

    await waitFor(() => expect(latest?.size).toBe(1));

    rerender(
      <ProposalBatchProvider>
        <ConditionalCard show={false} product={product} />
        <BatchSnapshot onSnapshot={(entries) => (latest = entries)} />
      </ProposalBatchProvider>,
    );

    await waitFor(() => expect(latest?.size).toBe(0));
  });
});

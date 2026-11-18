import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AdminLayout from "@/app/admin/layout";

const mockRouter = { replace: vi.fn() };

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => mockRouter,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    user: { role: "admin" },
    isLoading: false,
    isAuthenticated: true,
    logout: vi.fn(),
  }),
}));

describe("AdminLayout navigation", () => {
  test("includes a Ficha Patrimonial link to /admin/ficha-patrimonial", () => {
    render(
      <AdminLayout>
        <div>content</div>
      </AdminLayout>,
    );

    const link = screen.getByRole("link", { name: /Ficha Patrimonial/i });
    expect(link).toHaveAttribute("href", "/admin/ficha-patrimonial");
  });

  test("exposes the normalized catalog as a single 'Catálogo' link", () => {
    render(
      <AdminLayout>
        <div>content</div>
      </AdminLayout>,
    );

    const link = screen.getByRole("link", { name: "Catálogo" });
    expect(link).toHaveAttribute("href", "/admin/catalogo-normalizado");
  });

  test("drops the old flat catalog section and the 'normalizado' label", () => {
    render(
      <AdminLayout>
        <div>content</div>
      </AdminLayout>,
    );

    // The "normalizado" wording is gone...
    expect(screen.queryByText("Catálogo normalizado")).toBeNull();
    // ...and there is no longer a link to the old flat catalog route.
    const flatLink = screen
      .getAllByRole("link")
      .find((a) => a.getAttribute("href") === "/admin/catalog");
    expect(flatLink).toBeUndefined();
  });
});

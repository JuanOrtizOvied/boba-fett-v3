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
});

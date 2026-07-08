"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

const NAV_LINKS = [
  { href: "/admin", label: "Usuarios" },
  { href: "/admin/users/create", label: "Crear usuario" },
  { href: "/admin/portfolios", label: "Portafolios" },
  { href: "/admin/threads", label: "Chats" },
];

/**
 * Admin-only shell: left sidebar nav + role guard. `middleware.ts` already
 * blocks unauthenticated requests to `/admin/*` (cookie existence check),
 * but the `admin` role itself lives inside the JWT payload, which the
 * middleware never decodes — this layout adds the missing role check and
 * redirects non-admins to `/` (`access-control/spec.md` -> "Non-admin
 * redirected from admin routes").
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, isLoading, isAuthenticated, logout } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isAdmin = isAuthenticated && user?.role === "admin";

  useEffect(() => {
    if (isLoading) return;
    if (!isAdmin) {
      router.replace("/");
    }
  }, [isLoading, isAdmin, router]);

  if (isLoading || !isAdmin) {
    return (
      <div className="flex h-dvh items-center justify-center bg-sabbi-neutral-50">
        <div className="size-8 animate-spin rounded-full border-2 border-sabbi-neutral-200 border-t-sabbi-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex w-56 shrink-0 flex-col border-r border-sabbi-neutral-200 bg-background px-3 py-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <div
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: "linear-gradient(135deg, #7c3aed, #4338ca)" }}
          >
            S
          </div>
          <span className="text-sm font-semibold text-sabbi-neutral-900">Admin</span>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-sabbi-primary-soft text-sabbi-primary"
                    : "text-sabbi-neutral-600 hover:bg-sabbi-neutral-50"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-col gap-1 border-t border-sabbi-neutral-200 pt-3">
          <Link
            href="/"
            className="rounded-lg px-3 py-2 text-sm font-medium text-sabbi-neutral-600 hover:bg-sabbi-neutral-50"
          >
            Volver al portafolio
          </Link>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg px-3 py-2 text-left text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="min-h-0 flex-1 overflow-y-auto bg-sabbi-neutral-50 px-6 py-6">
        {children}
      </main>
    </div>
  );
}

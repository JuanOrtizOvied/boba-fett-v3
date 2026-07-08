"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface AdminUser {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
}

/**
 * User directory — the admin dashboard's landing page
 * (`user-management/spec.md` -> "Admin lists users").
 */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/users");
        if (!res.ok) {
          throw new Error(
            `No se pudo cargar la lista de usuarios (status ${res.status})`,
          );
        }
        const data: AdminUser[] = await res.json();
        setUsers(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-sabbi-neutral-900">Usuarios</h1>
        <Link
          href="/admin/users/create"
          className="rounded-lg bg-sabbi-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sabbi-primary-hover"
        >
          Crear usuario
        </Link>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {users === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : users && users.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">No hay usuarios.</p>
      ) : (
        users && (
          <div className="overflow-hidden rounded-xl border border-sabbi-neutral-200 bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-sabbi-neutral-50 text-xs font-medium tracking-wide text-sabbi-neutral-600 uppercase">
                <tr>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Rol</th>
                  <th className="px-4 py-2">Creado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sabbi-neutral-200">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="px-4 py-2 text-sabbi-neutral-900">{u.email}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.role === "admin"
                            ? "bg-sabbi-primary-soft text-sabbi-primary"
                            : "bg-sabbi-neutral-100 text-sabbi-neutral-700"
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sabbi-neutral-600">
                      {new Date(u.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

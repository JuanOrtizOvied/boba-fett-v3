"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

const inputClass =
  "rounded-lg border border-sabbi-neutral-200 px-3 py-2 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

const REDIRECT_DELAY_MS = 800;

/**
 * Admin-only user creation form — the only way to provision an account,
 * there is no public registration endpoint (`user-management/spec.md` ->
 * "Admin creates a user", "Duplicate email rejected").
 */
export default function CreateUserPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await fetchWithAuth("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, role }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          throw new Error("Ya existe un usuario con ese email");
        }
        throw new Error(`No se pudo crear el usuario (status ${res.status})`);
      }
      setSuccess(true);
      setTimeout(() => router.push("/admin"), REDIRECT_DELAY_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">Crear usuario</h1>

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4 rounded-xl border border-sabbi-neutral-200 bg-background p-5"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-sabbi-neutral-700">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-sabbi-neutral-700">Contraseña</span>
          <input
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-sabbi-neutral-700">Rol</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as "user" | "admin")}
            className={inputClass}
          >
            <option value="user">Usuario</option>
            <option value="admin">Admin</option>
          </select>
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && (
          <p className="text-sm text-green-600">Usuario creado. Redirigiendo…</p>
        )}

        <button
          type="submit"
          disabled={isSubmitting}
          className="mt-2 rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
        >
          {isSubmitting ? "Creando…" : "Crear usuario"}
        </button>
      </form>
    </div>
  );
}

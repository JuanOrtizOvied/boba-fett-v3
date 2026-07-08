"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

const inputClass =
  "rounded-lg border border-sabbi-neutral-200 px-3 py-2 text-sm text-sabbi-neutral-900 outline-none focus:border-sabbi-primary";

/**
 * Email/password login form — `POST /api/auth/login` via `AuthProvider.login`.
 * On success the auth context is refreshed from `/api/auth/me` and this
 * redirects to the portfolio builder (`user-auth/spec.md` — "Successful
 * login", "Invalid credentials").
 */
export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo iniciar sesión",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex h-dvh items-center justify-center bg-sabbi-neutral-50 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-background p-6 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-lg text-base font-bold text-white"
            style={{ background: "linear-gradient(135deg, #7c3aed, #4338ca)" }}
          >
            S
          </div>
          <h1 className="text-lg font-semibold text-sabbi-neutral-900">
            SABBI Portfolio Builder
          </h1>
          <p className="text-sm text-sabbi-neutral-600">
            Inicia sesión para continuar
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-sabbi-neutral-700">
              Email
            </span>
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
            <span className="text-xs font-medium text-sabbi-neutral-700">
              Contraseña
            </span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium text-white hover:bg-sabbi-primary-hover disabled:opacity-60"
          >
            {isSubmitting ? "Ingresando…" : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}

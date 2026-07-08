"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

const inputBase =
  "rounded-lg border px-3 py-2 text-sm text-sabbi-neutral-900 outline-none transition-colors duration-200";
const inputNormal = `${inputBase} border-sabbi-neutral-200 focus:border-sabbi-primary`;
const inputError = `${inputBase} border-red-400 bg-red-50/40 focus:border-red-500`;

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
      const user = await login(email, password);
      router.push(user.role === "admin" ? "/admin" : "/");
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
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError(null);
              }}
              className={error ? inputError : inputNormal}
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
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError(null);
              }}
              className={error ? inputError : inputNormal}
            />
          </label>

          {error && (
            <div className="animate-login-error flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <svg
                viewBox="0 0 20 20"
                fill="currentColor"
                className="size-4 shrink-0 text-red-500"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-sm font-medium text-red-700">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 flex items-center justify-center gap-2 rounded-lg bg-sabbi-primary px-4 py-2 text-sm font-medium text-white transition-opacity hover:bg-sabbi-primary-hover disabled:opacity-60"
          >
            {isSubmitting && (
              <svg
                className="size-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                  className="opacity-25"
                />
                <path
                  d="M4 12a8 8 0 018-8"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  className="opacity-75"
                />
              </svg>
            )}
            {isSubmitting ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </div>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";

const CATEGORIES = [
  { name: "Mercados Públicos", color: "#2563eb" },
  { name: "Mercados Privados", color: "#7c3aed" },
  { name: "Real Estate Perú", color: "#0d9488" },
  { name: "Club Deal", color: "#0d9488" },
  { name: "Cash", color: "#16a34a" },
] as const;

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
    <div className="flex h-dvh flex-col md:flex-row">
      {/* ── Hero / Branding Panel ── */}
      <section
        className="relative flex h-[30vh] w-full flex-col justify-between p-6 md:h-full md:w-1/2 md:p-10"
        style={{ backgroundColor: "#2B3C2B" }}
      >
        {/* Top branding */}
        <p
          className="text-xs font-medium uppercase tracking-[0.2em]"
          style={{ color: "#F2EDE4" }}
        >
          SABBI &middot; AGENTE PORTAFOLIO
        </p>

        {/* Bottom content — hidden on mobile to save space */}
        <div className="hidden md:block">
          {/* Headline */}
          <h2 className="text-4xl font-bold leading-tight text-white">
            Tu portafolio,
            <br />
            <span style={{ color: "#D4A843" }}>clasificado.</span>
          </h2>

          {/* Description */}
          <p
            className="mt-4 max-w-xs text-sm leading-relaxed"
            style={{ color: "rgba(242, 237, 228, 0.7)" }}
          >
            Subí tus documentos o cargá tus inversiones y obtené la composición
            de tu portafolio por clase de activo y foco geográfico.
          </p>

          {/* Category breakdown */}
          <div className="mt-8">
            <p
              className="text-xs font-medium uppercase tracking-[0.2em]"
              style={{ color: "rgba(242, 237, 228, 0.5)" }}
            >
              Composición por clase de activo
            </p>
            <ul className="mt-3 space-y-2">
              {CATEGORIES.map((cat) => (
                <li
                  key={cat.name}
                  className="flex items-center justify-between text-sm tracking-wide text-white"
                >
                  <span>{cat.name}</span>
                  <span
                    className="ml-4 inline-block h-1.5 w-10 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                </li>
              ))}
            </ul>
          </div>

          {/* Footer */}
          <p
            className="mt-10 text-xs"
            style={{ color: "rgba(242, 237, 228, 0.4)" }}
          >
            Asesoría de inversiones &middot; Lima, Perú
          </p>
        </div>
      </section>

      {/* ── Form Panel ── */}
      <main
        className="flex flex-1 items-center justify-center px-6 py-10 md:w-1/2"
        style={{ backgroundColor: "#F2EDE4" }}
      >
        <div className="w-full max-w-sm">
          <h1
            className="text-3xl font-bold"
            style={{ color: "#1a1a18" }}
          >
            Bienvenido
          </h1>
          <p
            className="mb-6 mt-2 text-sm"
            style={{ color: "#6b6a65" }}
          >
            Ingresá tu correo para continuar.
          </p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {/* Email */}
            <label className="flex flex-col gap-1.5">
              <span
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "#6b6a65" }}
              >
                Email
              </span>
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="tucorreo@sabbi.pe"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) setError(null);
                }}
                className={`rounded-lg border bg-white px-4 py-3 text-sm outline-none transition-colors duration-200 ${
                  error
                    ? "border-red-400 bg-red-50/40 focus:border-red-500"
                    : "border-[#d1d5db] focus:border-[#2B3C2B]"
                }`}
                style={{ color: "#1a1a18" }}
              />
            </label>

            {/* Password */}
            <label className="flex flex-col gap-1.5">
              <span
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "#6b6a65" }}
              >
                Contraseña
              </span>
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) setError(null);
                }}
                className={`rounded-lg border bg-white px-4 py-3 text-sm outline-none transition-colors duration-200 ${
                  error
                    ? "border-red-400 bg-red-50/40 focus:border-red-500"
                    : "border-[#d1d5db] focus:border-[#2B3C2B]"
                }`}
                style={{ color: "#1a1a18" }}
              />
            </label>

            {/* Error */}
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

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-medium text-white transition-colors duration-200 hover:brightness-110 disabled:opacity-60"
              style={{ backgroundColor: "#2B3C2B" }}
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
              {isSubmitting ? "Ingresando..." : "Continuar"}
            </button>
          </form>

          {/* Footer */}
          <p
            className="mt-6 text-center text-xs leading-relaxed"
            style={{ color: "#9c9b96" }}
          >
            Acceso para clientes y equipo SABBI.
            <br />
            ¿Problemas para entrar? Escribinos a{" "}
            <a
              href="mailto:informatica@sabbi.pe"
              className="underline hover:no-underline"
              style={{ color: "#6b6a65" }}
            >
              informatica@sabbi.pe
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

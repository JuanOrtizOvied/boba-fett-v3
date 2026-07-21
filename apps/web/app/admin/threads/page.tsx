"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/fetchWithAuth";

interface AdminThread {
  thread_id: string;
  user_id: string | null;
  email?: string;
  created_at: string | null;
  cost?: number | null;
  message_count?: number | null;
  last_message_at?: string | null;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-opus-4-20250514": { input: 15, output: 75 },
};

function calcThreadCost(
  messages: { type: string; response_metadata?: { model: string; usage: { input_tokens: number; output_tokens: number } } }[],
): number {
  let total = 0;
  for (const msg of messages) {
    if (msg.type !== "ai" || !msg.response_metadata?.model) continue;
    const p = MODEL_PRICING[msg.response_metadata.model];
    if (!p) continue;
    const { input_tokens, output_tokens } = msg.response_metadata.usage;
    total += (input_tokens * p.input + output_tokens * p.output) / 1_000_000;
  }
  return total;
}

/**
 * Read-only thread directory across all users (`admin-panel/spec.md` ->
 * "Admin browses a user's thread list"). The backend lists the current
 * FastAPI chat thread persisted on each user (`active_thread_id`).
 */
export default function AdminThreadsPage() {
  const [threads, setThreads] = useState<AdminThread[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/admin/threads");
        if (!res.ok) {
          throw new Error(
            `No se pudo cargar la lista de chats (status ${res.status})`,
          );
        }
        const data: AdminThread[] = await res.json();
        setThreads(data);

        const withCosts = await Promise.all(
          data.map(async (t) => {
            try {
              const r = await fetchWithAuth(`/api/admin/threads/${t.thread_id}`);
              if (!r.ok) return { ...t, cost: null, message_count: null, last_message_at: null };
              const data = await r.json();
              return {
                ...t,
                cost: calcThreadCost(data.messages),
                message_count: data.message_count ?? data.messages.length,
                last_message_at: data.last_message_at ?? null,
              };
            } catch {
              return { ...t, cost: null, message_count: null, last_message_at: null };
            }
          }),
        );
        setThreads(withCosts);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error desconocido");
      }
    })();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-sabbi-neutral-900">Chats</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {threads === null && !error ? (
        <p className="text-sm text-sabbi-neutral-600">Cargando…</p>
      ) : threads && threads.length === 0 ? (
        <p className="text-sm text-sabbi-neutral-600">No hay conversaciones.</p>
      ) : (
        threads && (
          <div className="overflow-hidden rounded-xl border border-sabbi-neutral-200 bg-background">
            <table className="w-full text-left text-sm">
              <thead className="bg-sabbi-neutral-50 text-xs font-medium tracking-wide text-sabbi-neutral-600 uppercase">
                <tr>
                  <th className="px-4 py-2">Usuario</th>
                  <th className="px-4 py-2 text-right">Mensajes</th>
                  <th className="px-4 py-2">Último mensaje</th>
                  <th className="px-4 py-2 text-right">Costo</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-sabbi-neutral-200">
                {threads.map((t) => (
                  <tr key={t.thread_id}>
                    <td className="px-4 py-2 text-sabbi-neutral-900">
                      {t.email ?? t.user_id ?? (
                        <span className="text-sabbi-neutral-400">Sin usuario</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-sabbi-neutral-700">
                      {t.message_count === undefined ? (
                        <span className="text-sabbi-neutral-400">…</span>
                      ) : t.message_count === null ? (
                        <span className="text-sabbi-neutral-400">—</span>
                      ) : (
                        t.message_count
                      )}
                    </td>
                    <td className="px-4 py-2 text-sabbi-neutral-600">
                      {t.last_message_at === undefined ? (
                        <span className="text-sabbi-neutral-400">…</span>
                      ) : t.last_message_at ? (
                        new Date(t.last_message_at).toLocaleString()
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-sabbi-neutral-700">
                      {t.cost === undefined ? (
                        <span className="text-sabbi-neutral-400">…</span>
                      ) : t.cost === null || t.cost === 0 ? (
                        <span className="text-sabbi-neutral-400">—</span>
                      ) : (
                        <span className="font-semibold">${t.cost.toFixed(4)}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/admin/threads/${t.thread_id}`}
                        className="text-sm font-medium text-sabbi-primary hover:underline"
                      >
                        Ver
                      </Link>
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

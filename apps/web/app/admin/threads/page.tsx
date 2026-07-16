"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface AdminThread {
  thread_id: string;
  user_id: string | null;
  email?: string;
  created_at: string | null;
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
        const res = await fetch("/api/admin/threads");
        if (!res.ok) {
          throw new Error(
            `No se pudo cargar la lista de chats (status ${res.status})`,
          );
        }
        const data: AdminThread[] = await res.json();
        setThreads(data);
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
                  <th className="px-4 py-2">Actualizado</th>
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
                    <td className="px-4 py-2 text-sabbi-neutral-600">
                      {t.created_at ? new Date(t.created_at).toLocaleString() : "—"}
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

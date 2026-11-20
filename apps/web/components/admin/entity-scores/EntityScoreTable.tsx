"use client";

import {
  KIND_TEXT,
  NO_SLUGS,
  isDeleted,
  scoreLabel,
  type EntityKind,
  type EntityScore,
} from "@/lib/entityScores";

interface EntityScoreTableProps {
  /** `null` while the first load is still going. */
  rows: EntityScore[] | null;
  error: string | null;
  kind: EntityKind;
  /** True when the rows were filtered by a search term. */
  searching: boolean;
}

const HEADER =
  "sticky top-0 z-10 border-b border-sabbi-neutral-200 bg-sabbi-neutral-100 px-4 py-2 text-left text-xs font-semibold text-sabbi-neutral-600";

/** The rows of one table: name, score and slugs. Read only; a deleted row shows struck
 * through with an "Eliminado" tag. */
export function EntityScoreTable({ rows, error, kind, searching }: EntityScoreTableProps) {
  const plural = KIND_TEXT[kind].plural;

  if (error) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error}
      </p>
    );
  }
  if (rows === null) {
    return <p className="text-sm text-sabbi-neutral-600">Cargando…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="text-sm text-sabbi-neutral-600">
        {searching ? `No se encontraron ${plural}.` : `No hay ${plural}.`}
      </p>
    );
  }

  return (
    // The wrapper takes the width that is available and no more (`w-full max-w-full min-w-0`)
    // and scrolls both ways, so a wide table never pushes the page or hides what is at the
    // end of a row. Its height keeps the whole table inside the screen.
    <div className="max-h-[calc(100dvh-16rem)] min-h-64 w-full max-w-full min-w-0 overflow-auto rounded-xl border border-sabbi-neutral-200 bg-white">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">{KIND_TEXT[kind].tab}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEADER}>
              Nombre
            </th>
            <th scope="col" className={HEADER}>
              Score
            </th>
            <th scope="col" className={HEADER}>
              Slugs
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-sabbi-neutral-200">
          {rows.map((row) => {
            const gone = isDeleted(row);
            return (
              <tr
                key={row.id}
                className={`transition-colors hover:bg-[#f0fcd4] ${
                  gone ? "text-sabbi-neutral-500" : "text-sabbi-neutral-900"
                }`}
              >
                <td className="px-4 py-2.5 align-top font-medium">
                  <span className={gone ? "line-through" : ""}>{row.name}</span>
                  {gone && (
                    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                      Eliminado
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 align-top">
                  {row.score === null ? (
                    <span className="text-sabbi-neutral-500 italic">{scoreLabel(row.score)}</span>
                  ) : (
                    <span className="inline-block min-w-[26px] rounded-full bg-sabbi-neutral-100 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-sabbi-neutral-900">
                      {scoreLabel(row.score)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 align-top">
                  {row.slugs.length === 0 ? (
                    <span className="text-sabbi-neutral-500 italic">{NO_SLUGS}</span>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {row.slugs.map((slug) => (
                        <li
                          key={slug}
                          className="max-w-full rounded-md bg-sabbi-primary-soft px-2 py-0.5 font-mono text-xs break-all text-sabbi-primary"
                        >
                          {slug}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import {
  formatValue,
  gapOf,
  nameById,
  type MarkowitzAsset,
  type ReviewPair,
} from "@/lib/markowitz";

interface MarkowitzReviewListProps {
  assets: MarkowitzAsset[];
  review: ReviewPair[];
  /** Opens the cell modal on a pair. The button shows only when this is given. */
  onOpen?: (pair: ReviewPair) => void;
}

const HEADER =
  "sticky top-0 z-10 border-b border-sabbi-neutral-200 bg-sabbi-neutral-100 px-4 py-2 text-left text-xs font-semibold text-sabbi-neutral-600";

/** The pairs whose two directions differ, the largest gap first (the server's order). Each
 * shows both values and the gap, so someone can decide which one is right. */
export function MarkowitzReviewList({ assets, review, onOpen }: MarkowitzReviewListProps) {
  if (review.length === 0) {
    return (
      <p className="rounded-xl border border-sabbi-neutral-200 bg-white px-4 py-6 text-sm text-sabbi-neutral-600">
        No hay pares por revisar: cada valor coincide con el de su pareja.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-sm text-sabbi-neutral-600">
        En estos pares el valor de ir de uno al otro no es el mismo que el de vuelta. Puede ser
        un error de transcripción o una diferencia real; hay que decidir cuál es el correcto.
      </p>
      <div className="w-full min-w-0 max-w-full overflow-auto rounded-xl border border-sabbi-neutral-200 bg-white">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <caption className="sr-only">Pares con valores distintos en cada dirección</caption>
          <thead>
            <tr>
              <th scope="col" className={HEADER}>
                Par
              </th>
              <th scope="col" className={`${HEADER} text-right`}>
                Ida
              </th>
              <th scope="col" className={`${HEADER} text-right`}>
                Vuelta
              </th>
              <th scope="col" className={`${HEADER} text-right`}>
                Diferencia
              </th>
              {onOpen && (
                <th scope="col" className={HEADER}>
                  <span className="sr-only">Acciones</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {review.map((pair) => {
              const a = nameById(assets, pair.a_id);
              const b = nameById(assets, pair.b_id);
              return (
                <tr
                  key={`${pair.a_id}-${pair.b_id}`}
                  className="border-b border-sabbi-neutral-200 last:border-b-0"
                >
                  <th scope="row" className="px-4 py-2 text-left font-medium text-sabbi-neutral-900">
                    {a} y {b}
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums" aria-label={`${a} frente a ${b}`}>
                    {formatValue(pair.a_to_b)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums" aria-label={`${b} frente a ${a}`}>
                    {formatValue(pair.b_to_a)}
                  </td>
                  <td className="px-4 py-2 text-right font-medium tabular-nums">
                    {formatValue(gapOf(pair))}
                  </td>
                  {onOpen && (
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onOpen(pair)}
                        className="rounded-lg border border-sabbi-neutral-200 px-3 py-1.5 text-sm font-medium text-sabbi-neutral-700 hover:bg-sabbi-neutral-50"
                      >
                        Revisar
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

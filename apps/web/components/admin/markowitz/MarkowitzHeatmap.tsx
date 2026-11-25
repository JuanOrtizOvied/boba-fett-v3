"use client";

import {
  memo,
  useCallback,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  LEGEND_GRADIENT,
  MISSING,
  formatValue,
  heatStyle,
  type MarkowitzMatrix,
} from "@/lib/markowitz";

interface MarkowitzHeatmapProps {
  matrix: MarkowitzMatrix;
  /** A click or Enter on a cell that is not on the diagonal. The cells are only
   * interactive when this is given. */
  onCellActivate?: (rowIndex: number, colIndex: number) => void;
  /** A click on a row or column header. The headers are only buttons when this is given. */
  onAssetActivate?: (index: number) => void;
}

type Pos = { r: number; c: number };
type Highlight = "self" | "line" | null;

const ROW_HEADER_WIDTH = 230;
const CELL_WIDTH = 44;

const BORDER = "border-r border-b border-sabbi-neutral-200";

interface CellProps {
  r: number;
  c: number;
  value: number | null;
  label: string;
  highlight: Highlight;
  tabIndex: 0 | -1;
  interactive: boolean;
}

// One cell. It takes only simple values, so moving the guides re-renders just the cells
// of the row and column that change, not the whole 31 x 31 grid.
const Cell = memo(function Cell({
  r,
  c,
  value,
  label,
  highlight,
  tabIndex,
  interactive,
}: CellProps) {
  const diagonal = r === c;
  const style = diagonal ? undefined : heatStyle(value);
  return (
    <td
      data-r={r}
      data-c={c}
      data-hl={highlight ?? undefined}
      data-diagonal={diagonal ? "true" : undefined}
      tabIndex={tabIndex}
      aria-label={label}
      className={`${BORDER} relative h-[30px] p-0 text-center text-[11.5px] tabular-nums outline-none focus-visible:z-[1] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sabbi-primary ${
        diagonal
          ? "cursor-default bg-sabbi-neutral-100 text-sabbi-neutral-500"
          : `text-sabbi-neutral-900 ${interactive ? "cursor-pointer" : ""}`
      }`}
      style={{
        width: CELL_WIDTH,
        minWidth: CELL_WIDTH,
        ...style,
        ...(highlight ? { boxShadow: "inset 0 0 0 100px rgba(197, 216, 45, 0.28)" } : {}),
      }}
    >
      {value === null ? MISSING : formatValue(value)}
    </td>
  );
});

/**
 * The whole matrix as a heat map: one row and one column per asset, sticky headers, and a
 * guide (row, column and both headers) that follows the cell under the pointer or the
 * keyboard focus. Arrow keys, Home and End move between cells; one cell is a tab stop.
 *
 * Nothing here writes: `onCellActivate` and `onAssetActivate` are how a parent opens its
 * own modals.
 */
export function MarkowitzHeatmap({
  matrix,
  onCellActivate,
  onAssetActivate,
}: MarkowitzHeatmapProps) {
  const { assets, values } = matrix;
  const size = assets.length;
  const tableRef = useRef<HTMLTableElement>(null);
  const [hover, setHover] = useState<Pos | null>(null);
  const [focused, setFocused] = useState<Pos | null>(null);
  // The one cell that is a tab stop: the last one the keyboard was on, or the first.
  const [stop, setStop] = useState<Pos>({ r: 0, c: 0 });
  const active = hover ?? focused;

  const posOf = (target: EventTarget | null): Pos | null => {
    const cell = (target as HTMLElement | null)?.closest?.("td[data-r]") as HTMLElement | null;
    if (!cell || !tableRef.current?.contains(cell)) return null;
    return { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
  };

  const handleMouseOver = (e: MouseEvent) => {
    const pos = posOf(e.target);
    if (pos) setHover((prev) => (prev?.r === pos.r && prev.c === pos.c ? prev : pos));
  };

  const handleFocus = (e: FocusEvent) => {
    const pos = posOf(e.target);
    if (!pos) return;
    setFocused(pos);
    setStop(pos);
  };

  const handleBlur = (e: FocusEvent) => {
    if (!tableRef.current?.contains(e.relatedTarget as Node | null)) setFocused(null);
  };

  const handleClick = (e: MouseEvent) => {
    const pos = posOf(e.target);
    if (pos && pos.r !== pos.c) onCellActivate?.(pos.r, pos.c);
  };

  const moveTo = useCallback((pos: Pos) => {
    const cell = tableRef.current?.querySelector<HTMLElement>(
      `td[data-r="${pos.r}"][data-c="${pos.c}"]`,
    );
    if (!cell) return;
    setStop(pos);
    cell.focus();
    cell.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, []);

  const handleKeyDown = (e: KeyboardEvent) => {
    const pos = posOf(e.target);
    if (!pos) return;
    const last = size - 1;
    const move: Record<string, Pos> = {
      ArrowUp: { r: Math.max(0, pos.r - 1), c: pos.c },
      ArrowDown: { r: Math.min(last, pos.r + 1), c: pos.c },
      ArrowLeft: { r: pos.r, c: Math.max(0, pos.c - 1) },
      ArrowRight: { r: pos.r, c: Math.min(last, pos.c + 1) },
      Home: { r: pos.r, c: 0 },
      End: { r: pos.r, c: last },
    };
    const next = move[e.key];
    if (next) {
      e.preventDefault();
      moveTo(next);
    } else if ((e.key === "Enter" || e.key === " ") && onCellActivate && pos.r !== pos.c) {
      e.preventDefault();
      onCellActivate(pos.r, pos.c);
    }
  };

  const highlightOf = (r: number, c: number): Highlight => {
    if (!active) return null;
    if (active.r === r && active.c === c) return "self";
    return active.r === r || active.c === c ? "line" : null;
  };

  const header = (index: number, children: ReactNode, className: string) => {
    const name = assets[index].name;
    return onAssetActivate ? (
      <button
        type="button"
        onClick={() => onAssetActivate(index)}
        aria-label={`Editar ${name}`}
        className={className}
      >
        {children}
      </button>
    ) : (
      <div className={className}>{children}</div>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div
        data-testid="matrix-box"
        className="max-h-[calc(100dvh-17rem)] min-h-72 w-full min-w-0 max-w-full overflow-auto rounded-xl border border-sabbi-neutral-200 bg-white"
      >
        <table
          ref={tableRef}
          aria-label="Matriz de correlaciones"
          onMouseOver={handleMouseOver}
          onMouseLeave={() => setHover(null)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          className="border-separate border-spacing-0 tabular-nums"
        >
          <thead>
            <tr>
              <th
                scope="col"
                className={`sticky left-0 top-0 z-[5] bg-sabbi-neutral-100 px-3 py-2 text-left align-bottom text-xs font-semibold text-sabbi-neutral-600 ${BORDER}`}
                style={{ width: ROW_HEADER_WIDTH, minWidth: ROW_HEADER_WIDTH, height: 196 }}
              >
                Fila frente a columna
              </th>
              {assets.map((asset, c) => (
                <th
                  key={asset.id}
                  scope="col"
                  data-hl={active && active.c === c ? "line" : undefined}
                  className={`sticky top-0 z-[3] bg-sabbi-neutral-100 p-0 align-bottom ${BORDER}`}
                  style={{
                    width: CELL_WIDTH,
                    minWidth: CELL_WIDTH,
                    height: 196,
                    ...(active && active.c === c
                      ? { boxShadow: "inset 0 0 0 100px rgba(197, 216, 45, 0.28)" }
                      : {}),
                  }}
                >
                  {header(
                    c,
                    <span
                      title={asset.name}
                      className="max-h-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium text-sabbi-neutral-700 [transform:rotate(180deg)] [writing-mode:vertical-rl]"
                    >
                      {asset.name}
                    </span>,
                    `flex h-full w-full items-start justify-center border-0 bg-transparent py-2 ${
                      onAssetActivate ? "cursor-pointer hover:underline" : ""
                    }`,
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {assets.map((asset, r) => (
              <tr key={asset.id}>
                <th
                  scope="row"
                  data-hl={active && active.r === r ? "line" : undefined}
                  className={`sticky left-0 z-[2] bg-sabbi-neutral-100 p-0 text-left ${BORDER}`}
                  style={{
                    width: ROW_HEADER_WIDTH,
                    minWidth: ROW_HEADER_WIDTH,
                    maxWidth: ROW_HEADER_WIDTH,
                    ...(active && active.r === r
                      ? { boxShadow: "inset 0 0 0 100px rgba(197, 216, 45, 0.28)" }
                      : {}),
                  }}
                >
                  {header(
                    r,
                    <span
                      title={asset.name}
                      className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-medium text-sabbi-neutral-700"
                    >
                      {asset.name}
                    </span>,
                    `flex h-[30px] w-full items-center border-0 bg-transparent px-3 text-left ${
                      onAssetActivate ? "cursor-pointer hover:underline" : ""
                    }`,
                  )}
                </th>
                {assets.map((col, c) => (
                  <Cell
                    key={col.id}
                    r={r}
                    c={c}
                    value={values[r][c]}
                    label={
                      r === c
                        ? `${asset.name}: diagonal, siempre 1`
                        : values[r][c] === null
                          ? `${asset.name} frente a ${col.name}: falta el valor`
                          : `${asset.name} frente a ${col.name}: ${formatValue(values[r][c])}`
                    }
                    highlight={highlightOf(r, c)}
                    tabIndex={stop.r === r && stop.c === c ? 0 : -1}
                    interactive={Boolean(onCellActivate)}
                  />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] text-sabbi-neutral-500">
        <span>-0.2</span>
        <span
          aria-hidden="true"
          className="h-2.5 w-[150px] rounded-full border border-sabbi-neutral-200"
          style={{ background: LEGEND_GRADIENT }}
        />
        <span>1.0</span>
        <span>
          Azul: negativo (se mueven al revés). Verde: positivo. El número de cada celda es el
          valor.
        </span>
      </div>
    </div>
  );
}

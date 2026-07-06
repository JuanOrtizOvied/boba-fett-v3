const PORTFOLIO_ID_KEY = "portfolio_id";

/**
 * Resolves this browser's portfolio identity (v1 — no auth). Generated once
 * and cached in `localStorage`; shared between the chat runtime
 * (`app/assistant.tsx` — passed as `configurable.portfolio_id`) and the
 * portfolio panel (`lib/usePortfolio.ts` — used as the `/api/portfolio/:id`
 * path parameter) so both read/write the same portfolio.
 */
export function getPortfolioId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(PORTFOLIO_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(PORTFOLIO_ID_KEY, id);
  }
  return id;
}

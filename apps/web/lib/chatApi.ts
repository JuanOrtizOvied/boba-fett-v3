import { Client } from "@langchain/langgraph-sdk";

/**
 * Creates a LangGraph SDK client.
 *
 * - In the browser, requests are sent to `NEXT_PUBLIC_LANGGRAPH_API_URL`
 *   directly (dev) or to the `/api` proxy route (prod), which injects the
 *   `LANGCHAIN_API_KEY` server-side so it is never exposed to the client.
 * - On the server (SSR), requests fall back to a relative `/api` URL.
 */
export const createClient = () => {
  const apiUrl =
    process.env["NEXT_PUBLIC_LANGGRAPH_API_URL"] ||
    (typeof window !== "undefined"
      ? new URL("/api", window.location.href).href
      : "/api");

  return new Client({ apiUrl });
};

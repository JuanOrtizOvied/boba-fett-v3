import { NextRequest, NextResponse } from "next/server";

const LANGGRAPH_API_URL =
  process.env["LANGGRAPH_API_URL"] || "http://localhost:2024";
const LANGCHAIN_API_KEY = process.env["LANGCHAIN_API_KEY"];
const PORTFOLIO_API_URL =
  process.env["PORTFOLIO_API_URL"] || "http://localhost:8001";

const isPortfolioApiPath = (path: string) =>
  path.startsWith("/portfolio/") || path.startsWith("/products/");

/**
 * Proxies browser requests to the right backend: LangGraph for assistant
 * traffic and the FastAPI portfolio service for direct portfolio CRUD/export.
 * LangGraph API keys are injected server-side so they are never exposed to the
 * client.
 */
async function handleRequest(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api/, "");
  const upstreamBaseUrl = isPortfolioApiPath(path)
    ? PORTFOLIO_API_URL
    : LANGGRAPH_API_URL;
  const url = new URL(path, upstreamBaseUrl);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  if (!isPortfolioApiPath(path) && LANGCHAIN_API_KEY) {
    headers.set("x-api-key", LANGCHAIN_API_KEY);
  }
  headers.delete("host");

  try {
    const response = await fetch(url, {
      method: req.method,
      headers,
      body: req.body,
      // @ts-expect-error — duplex is required for streaming request bodies
      duplex: "half",
    });

    return new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    // The upstream backend is unreachable. Surface a recoverable error to
    // the client instead of letting the request hang or fail silently.
    console.error("[api proxy] failed to reach upstream backend", {
      upstreamBaseUrl,
      error,
    });
    return NextResponse.json(
      {
        error: "backend_unavailable",
        message:
          "The backend is unreachable. Check that the API servers are running and proxy environment variables are configured correctly.",
      },
      { status: 502 },
    );
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const PATCH = handleRequest;
export const DELETE = handleRequest;

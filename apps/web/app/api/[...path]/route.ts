import { NextRequest, NextResponse } from "next/server";

const LANGGRAPH_API_URL =
  process.env["LANGGRAPH_API_URL"] || "http://localhost:2024";
const LANGCHAIN_API_KEY = process.env["LANGCHAIN_API_KEY"];
const PORTFOLIO_API_URL =
  process.env["PORTFOLIO_API_URL"] || "http://localhost:3003";

const isFastApiPath = (path: string) =>
  path.startsWith("/portfolio/") ||
  path.startsWith("/products/") ||
  path.startsWith("/auth/") ||
  path.startsWith("/admin/");

/**
 * Proxies browser requests to the right backend: LangGraph for assistant
 * traffic and the FastAPI service (portfolio CRUD/export, auth, admin) for
 * everything else. LangGraph API keys are injected server-side so they are
 * never exposed to the client.
 */
async function handleRequest(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api/, "");
  const upstreamBaseUrl = isFastApiPath(path)
    ? PORTFOLIO_API_URL
    : LANGGRAPH_API_URL;
  const url = new URL(path, upstreamBaseUrl);
  url.search = req.nextUrl.search;

  // Request cookies (`sabbi_access`/`sabbi_refresh`) flow to the backend
  // automatically as part of `req.headers` — no special handling needed here.
  const headers = new Headers(req.headers);
  if (!isFastApiPath(path) && LANGCHAIN_API_KEY) {
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

    // `Set-Cookie` headers must be forwarded individually. Reading a
    // standard `Headers` object via `.entries()`/`.get()` merges duplicate
    // entries with a comma, which corrupts multiple `Set-Cookie` headers —
    // `POST /auth/login` sets BOTH `sabbi_access` and `sabbi_refresh` in the
    // same response. `getSetCookie()` returns each cookie string separately
    // so both survive the proxy hop (CRITICAL for httpOnly cookie auth).
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("set-cookie");
    const proxyResponse = new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
    for (const cookie of response.headers.getSetCookie()) {
      proxyResponse.headers.append("set-cookie", cookie);
    }
    return proxyResponse;
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

import { NextRequest, NextResponse } from "next/server";

const LANGGRAPH_API_URL =
  process.env["LANGGRAPH_API_URL"] || "http://localhost:2024";
const LANGCHAIN_API_KEY = process.env["LANGCHAIN_API_KEY"];

/**
 * Proxies requests from the browser to the LangGraph backend, injecting the
 * `LANGCHAIN_API_KEY` server-side so it is never exposed to the client. Used
 * in production where the frontend cannot reach the backend directly.
 */
async function handleRequest(req: NextRequest) {
  const path = req.nextUrl.pathname.replace(/^\/api/, "");
  const url = new URL(path, LANGGRAPH_API_URL);
  url.search = req.nextUrl.search;

  const headers = new Headers(req.headers);
  if (LANGCHAIN_API_KEY) {
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
    // The LangGraph backend is unreachable. Surface a recoverable error to
    // the client instead of letting the request hang or fail silently.
    console.error("[api proxy] failed to reach LangGraph backend", error);
    return NextResponse.json(
      {
        error: "backend_unavailable",
        message:
          "The assistant backend is unreachable. Check that the LangGraph server is running and LANGGRAPH_API_URL is configured correctly.",
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

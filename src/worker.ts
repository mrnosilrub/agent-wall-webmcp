import { CHALLENGE_FIXTURE } from "./fixtures/challenge.js";
import { createRemoteMcpHttpHandler } from "./mcp/server.js";
import {
  MCP_MAX_REQUEST_BYTES,
  SECURITY_HEADERS,
  boundMcpRequestBody,
  createFixedWindowRateLimiter,
} from "./mcp/worker-boundary.js";
import { CHAIN_ID_DECIMAL } from "./tools/contracts.js";

interface AssetBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  readonly ASSETS: AssetBinding;
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException?(): void;
}

const mcpHandler = createRemoteMcpHttpHandler({
  fixture: CHALLENGE_FIXTURE,
  transientStage: { stage() {} },
});

const mcpRateLimiter = createFixedWindowRateLimiter({ limit: 60, windowMs: 60_000 });

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return withSecurityHeaders(
        Response.json({
          ok: true,
          mode: "fixture",
          chain: "base-sepolia",
          chainId: CHAIN_ID_DECIMAL,
          testnet: true,
          canonical: false,
          webmcpTools: 4,
          remoteMcp: "/mcp",
        }),
      );
    }

    if (url.pathname === "/mcp") {
      if (request.method !== "POST") {
        return withSecurityHeaders(
          Response.json(
            { error: { code: "method_not_allowed", message: "POST /mcp only" } },
            { status: 405, headers: { Allow: "POST" } },
          ),
        );
      }
      const rate = mcpRateLimiter.take(
        request.headers.get("CF-Connecting-IP") ?? "unknown-client",
      );
      if (!rate.allowed) {
        return withSecurityHeaders(
          Response.json(
            {
              error: {
                code: "rate_limited",
                message: "Public fixture MCP request budget exceeded",
              },
            },
            {
              status: 429,
              headers: { "Retry-After": String(rate.retryAfterSeconds) },
            },
          ),
        );
      }
      const boundedRequest = await boundMcpRequestBody(request);
      if (boundedRequest === null) {
        return withSecurityHeaders(
          Response.json(
            {
              error: {
                code: "request_too_large",
                message: `MCP requests are limited to ${String(MCP_MAX_REQUEST_BYTES)} bytes`,
              },
            },
            { status: 413 },
          ),
        );
      }
      const response = await mcpHandler(boundedRequest, env, ctx as never);
      return withSecurityHeaders(response);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
} satisfies { fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> };

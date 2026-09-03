import { describe, expect, it } from "vitest";

import {
  MCP_MAX_REQUEST_BYTES,
  SECURITY_HEADERS,
  boundMcpRequestBody,
  createFixedWindowRateLimiter,
} from "../src/mcp/worker-boundary.js";

describe("public Worker boundary", () => {
  it("enforces a bounded fixed-window request budget per client key", () => {
    let now = 0;
    const limiter = createFixedWindowRateLimiter({
      limit: 2,
      windowMs: 1_000,
      now: () => now,
    });

    expect(limiter.take("198.51.100.1")).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 0,
    });
    expect(limiter.take("198.51.100.1")).toEqual({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 0,
    });
    expect(limiter.take("198.51.100.1")).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    });
    expect(limiter.take("203.0.113.7").allowed).toBe(true);

    now = 1_000;
    expect(limiter.take("198.51.100.1").allowed).toBe(true);
  });

  it("prevents the challenge page from calling its own remote MCP route", () => {
    const policy = SECURITY_HEADERS["Content-Security-Policy"];
    expect(policy).toContain("connect-src 'none'");
    expect(policy).not.toContain("connect-src 'self'");
    expect(SECURITY_HEADERS["Permissions-Policy"]).toContain("payment=()");
  });

  it("bounds streamed MCP request bodies before the SDK parser", async () => {
    const small = new Request("https://fixture.invalid/mcp", {
      method: "POST",
      body: "{}",
    });
    const bounded = await boundMcpRequestBody(small);
    expect(bounded).not.toBeNull();
    await expect(bounded?.text()).resolves.toBe("{}");

    const oversized = new Request("https://fixture.invalid/mcp", {
      method: "POST",
      body: new Uint8Array(MCP_MAX_REQUEST_BYTES + 1),
    });
    await expect(boundMcpRequestBody(oversized)).resolves.toBeNull();
  });
});

export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

export const MCP_MAX_REQUEST_BYTES = 64 * 1024;

export async function boundMcpRequestBody(request: Request): Promise<Request | null> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > MCP_MAX_REQUEST_BYTES) return null;
  }
  if (request.body === null) return request;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MCP_MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request, { body });
}

export function createFixedWindowRateLimiter(options: {
  readonly limit: number;
  readonly windowMs: number;
  readonly now?: () => number;
}): { take(key: string): RateLimitResult } {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error("rate limit must be a positive integer");
  }
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1) {
    throw new Error("rate-limit window must be a positive integer");
  }
  const now = options.now ?? Date.now;
  const buckets = new Map<string, { windowStartMs: number; count: number }>();
  const maxBuckets = 4_096;

  return Object.freeze({
    take(rawKey: string): RateLimitResult {
      const timestamp = now();
      let key = rawKey.trim() || "unknown-client";
      let bucket = buckets.get(key);
      if (bucket !== undefined && timestamp - bucket.windowStartMs >= options.windowMs) {
        buckets.delete(key);
        bucket = undefined;
      }
      if (bucket === undefined && buckets.size >= maxBuckets) {
        for (const [candidateKey, candidate] of buckets) {
          if (timestamp - candidate.windowStartMs >= options.windowMs) {
            buckets.delete(candidateKey);
          }
        }
        if (buckets.size >= maxBuckets) key = "overflow-clients";
        bucket = buckets.get(key);
      }
      if (bucket === undefined) {
        bucket = { windowStartMs: timestamp, count: 0 };
        buckets.set(key, bucket);
      }

      if (bucket.count >= options.limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((bucket.windowStartMs + options.windowMs - timestamp) / 1_000),
          ),
        };
      }
      bucket.count += 1;
      return {
        allowed: true,
        remaining: options.limit - bucket.count,
        retryAfterSeconds: 0,
      };
    },
  });
}

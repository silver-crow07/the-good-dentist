/**
 * Minimal in-memory fixed-window rate limiter for public endpoints.
 *
 * Scope: this protects a single Node process. For multi-instance or
 * serverless deployments, replace with a shared store (e.g. Redis or the
 * database) keeping the same `check()` interface — the route handlers do not
 * need to change.
 *
 * No patient data is part of any key.
 */

type Bucket = {
  windowStart: number;
  count: number;
};

const buckets = new Map<string, Bucket>();

/** Drop expired buckets occasionally so the map cannot grow unbounded. */
function sweep(now: number, windowMs: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= windowMs) {
      buckets.delete(key);
    }
  }
}

export type RateLimitResult = {
  ok: boolean;
  /** Milliseconds until the caller may retry (0 when ok). */
  retryAfterMs: number;
  remaining: number;
};

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  // Sweep on roughly every 500th check — cheap amortized cleanup.
  if (now % 500 < 7) sweep(now, windowMs);

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return { ok: true, retryAfterMs: 0, remaining: limit - 1 };
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      retryAfterMs: Math.max(0, windowMs - (now - bucket.windowStart)),
      remaining: 0,
    };
  }

  bucket.count += 1;
  return { ok: true, retryAfterMs: 0, remaining: limit - bucket.count };
}

/** Test helper — clears all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
}

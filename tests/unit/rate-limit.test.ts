/**
 * In-memory rate-limiter tests — pure.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { checkRateLimit, resetRateLimits } from "@/lib/server/rate-limit";

beforeEach(() => resetRateLimits());

describe("checkRateLimit", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const now = 1_000_000;
    for (let i = 0; i < 5; i += 1) {
      expect(checkRateLimit("ip:a", 5, 60_000, now + i).ok).toBe(true);
    }
    const blocked = checkRateLimit("ip:a", 5, 60_000, now + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window has passed", () => {
    const now = 2_000_000;
    expect(checkRateLimit("ip:b", 2, 60_000, now).ok).toBe(true);
    expect(checkRateLimit("ip:b", 2, 60_000, now + 1_000).ok).toBe(true);
    expect(checkRateLimit("ip:b", 2, 60_000, now + 2_000).ok).toBe(false);
    // A minute later the window has expired:
    expect(checkRateLimit("ip:b", 2, 60_000, now + 61_000).ok).toBe(true);
  });

  it("isolates keys from each other", () => {
    const now = 3_000_000;
    expect(checkRateLimit("ip:c1", 1, 60_000, now).ok).toBe(true);
    expect(checkRateLimit("ip:c1", 1, 60_000, now).ok).toBe(false);
    expect(checkRateLimit("ip:c2", 1, 60_000, now).ok).toBe(true);
  });

  it("reports remaining budget", () => {
    const now = 4_000_000;
    expect(checkRateLimit("ip:d", 3, 60_000, now).remaining).toBe(2);
    expect(checkRateLimit("ip:d", 3, 60_000, now).remaining).toBe(1);
  });
});

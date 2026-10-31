/**
 * Auth-crypto tests — password hashing and session-token signing.
 * No database required (only node:crypto + env).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hashPassword,
  mintSessionValue,
  verifyPassword,
  verifySessionValue,
} from "@/lib/server/auth";

const ORIGINAL_SECRET = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "unit-test-secret-please-do-not-use-in-production-0123456789";
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = ORIGINAL_SECRET;
});

describe("password hashing (scrypt)", () => {
  it("verifies the correct password and rejects wrong ones", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("Correct horse battery staple", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("uses a fresh salt per hash (same password → different hashes)", async () => {
    const a = await hashPassword("same-password-12345");
    const b = await hashPassword("same-password-12345");
    expect(a).not.toBe(b);
  });

  it("fails closed on malformed stored hashes", async () => {
    for (const stored of ["", "plaintext", "scrypt$bad", "bcrypt$1,8,1$c2FsdA==$aGFzaA=="]) {
      expect(await verifyPassword("whatever", stored)).toBe(false);
    }
  });
});

describe("session tokens", () => {
  it("mints a signed value that verifies to a stable row id", () => {
    const minted = mintSessionValue();
    expect(minted).not.toBeNull();
    if (!minted) return;
    expect(minted.cookieValue).toMatch(/\.[A-Za-z0-9_-]+$/);
    expect(verifySessionValue(minted.cookieValue)).toBe(minted.sessionId);
  });

  it("rejects tampered tokens and unsigned values", () => {
    const minted = mintSessionValue();
    if (!minted) return;
    const [token, signature] = minted.cookieValue.split(".");
    expect(verifySessionValue(`${token}x.${signature}`)).toBeNull();
    expect(verifySessionValue(`${token}.forged-signature`)).toBeNull();
    expect(verifySessionValue(token ?? "")).toBeNull();
    expect(verifySessionValue("")).toBeNull();
  });

  it("fails closed when SESSION_SECRET is missing", () => {
    delete process.env.SESSION_SECRET;
    expect(mintSessionValue()).toBeNull();
    const token = "abc.def";
    expect(verifySessionValue(token)).toBeNull();
  });
});

/**
 * Unit tests for the integration-test database wipe guard.
 *
 * These tests pin the safety predicate that stops `npm run test:integration`
 * from wiping anything that is not clearly disposable.
 */

import { describe, expect, it } from "vitest";

import {
  assertDisposableDatabase,
  isDisposableDatabaseUrl,
} from "@/tests/integration/db-guard";

const LOCAL = "postgres://postgres:secret@localhost:55432/the_good_dentist?sslmode=disable";
const LOCAL_127 = "postgres://user:pass@127.0.0.1:5432/db";
const REMOTE_TEST = "postgres://user:pass@db.example.com:5432/the_good_dentist_test";
const REMOTE_PROD = "postgres://user:pass@db.example.com:5432/the_good_dentist";
const REMOTE_STAGING = "postgresql://user:pass@staging.internal:5432/clinic";

describe("isDisposableDatabaseUrl", () => {
  it("allows the local loopback dev database", () => {
    expect(isDisposableDatabaseUrl(LOCAL, "development")).toBe(true);
    expect(isDisposableDatabaseUrl(LOCAL_127, undefined)).toBe(true);
    expect(isDisposableDatabaseUrl("postgres://u:p@[::1]:5432/db", undefined)).toBe(true);
  });

  it("allows a remote database explicitly named *_test", () => {
    expect(isDisposableDatabaseUrl(REMOTE_TEST, undefined)).toBe(true);
  });

  it("refuses remote databases that are not named *_test (prod/staging)", () => {
    expect(isDisposableDatabaseUrl(REMOTE_PROD, undefined)).toBe(false);
    expect(isDisposableDatabaseUrl(REMOTE_STAGING, undefined)).toBe(false);
  });

  it("always refuses under NODE_ENV=production, even loopback", () => {
    expect(isDisposableDatabaseUrl(LOCAL, "production")).toBe(false);
    expect(isDisposableDatabaseUrl(REMOTE_TEST, "production")).toBe(false);
  });

  it("fails closed on unparseable, relative or non-postgres URLs", () => {
    expect(isDisposableDatabaseUrl("not a url", undefined)).toBe(false);
    expect(isDisposableDatabaseUrl("", undefined)).toBe(false);
    expect(isDisposableDatabaseUrl("file:///etc/passwd", undefined)).toBe(false);
    expect(isDisposableDatabaseUrl("postgres://host-only", undefined)).toBe(false); // no db name
  });
});

describe("assertDisposableDatabase", () => {
  it("is a no-op when no database is configured (suite will skip)", () => {
    expect(() => assertDisposableDatabase(undefined)).not.toThrow();
  });

  it("passes for disposable URLs", () => {
    expect(() => assertDisposableDatabase(LOCAL)).not.toThrow();
    expect(() => assertDisposableDatabase(REMOTE_TEST)).not.toThrow();
  });

  it("throws for a remote production URL — without echoing the password", () => {
    const withPassword = "postgres://appuser:SUPER-SECRET-PW@prod-db.internal:5432/clinic";
    expect(() => assertDisposableDatabase(withPassword)).toThrow();
    try {
      assertDisposableDatabase(withPassword);
      expect.unreachable("should have thrown");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("prod-db.internal:5432/clinic");
      expect(message).not.toContain("SUPER-SECRET-PW"); // never leak credentials
      expect(message).not.toContain("appuser");
    }
  });
});

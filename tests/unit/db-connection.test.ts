/**
 * Unit tests for the UTC session-timezone guard on DATABASE_URL.
 *
 * `@prisma/adapter-pg` writes naive UTC-component timestamp strings that
 * PostgreSQL parses in the SESSION timezone — see lib/server/db.ts for the
 * full explanation. These tests pin the URL transformation itself (no DB
 * needed); the end-to-end invariant is covered by the integration test
 * "stores the exact UTC instant PostgreSQL itself renders".
 */

import { describe, expect, it } from "vitest";

import { withUtcSession } from "@/lib/server/db";

const base = "postgres://user:pass@localhost:55432/the_good_dentist?sslmode=disable";

describe("withUtcSession", () => {
  it("appends the UTC startup option to a URL that already has a query string", () => {
    expect(withUtcSession(base)).toBe(`${base}&options=-c%20timezone%3DUTC`);
  });

  it("appends with ? when the URL has no query string", () => {
    expect(withUtcSession("postgres://localhost:5432/db")).toBe(
      "postgres://localhost:5432/db?options=-c%20timezone%3DUTC",
    );
  });

  it("never appends twice when the option is already present", () => {
    const once = withUtcSession(base)!;
    expect(withUtcSession(once)).toBe(once);
    expect(once.match(/options=/g)).toHaveLength(1);
  });

  it("respects an explicit options param instead of clobbering it", () => {
    const custom = `${base}&options=-c%20timezone%3DAsia%2FKolkata`;
    expect(withUtcSession(custom)).toBe(custom);
  });

  it("passes undefined through so getPrisma can answer 503 safely", () => {
    expect(withUtcSession(undefined)).toBeUndefined();
  });

  it("keeps the rest of the connection string byte-identical", () => {
    const url = withUtcSession(base)!;
    expect(url.startsWith(base)).toBe(true); // pure append — no re-encoding
  });
});

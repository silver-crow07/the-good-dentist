import { describe, expect, it } from "vitest";

import { isRoleAllowed } from "@/lib/server/guard";

/**
 * Role decisions are made server-side from the VERIFIED session role only.
 * These tests pin the allow-list semantics used by requireRole() (which is
 * additionally covered with a real session in tests/integration/admin.test.ts).
 */
describe("isRoleAllowed", () => {
  it("allows listed roles and rejects others", () => {
    expect(isRoleAllowed({ role: "ADMIN" }, ["ADMIN"])).toBe(true);
    expect(isRoleAllowed({ role: "STAFF" }, ["ADMIN"])).toBe(false);
    expect(isRoleAllowed({ role: "STAFF" }, ["ADMIN", "STAFF"])).toBe(true);
    expect(isRoleAllowed({ role: "ADMIN" }, ["ADMIN", "STAFF"])).toBe(true);
  });

  it("rejects every role when the allow-list is empty", () => {
    expect(isRoleAllowed({ role: "ADMIN" }, [])).toBe(false);
    expect(isRoleAllowed({ role: "STAFF" }, [])).toBe(false);
  });
});

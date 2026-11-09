import { describe, expect, it } from "vitest";

import { isAdminPath } from "@/lib/admin-path";

/**
 * Site chrome routing: the public Navbar/Footer/WhatsApp button must be
 * hidden on admin routes and shown everywhere else — including lookalike
 * paths such as `/adminfoo`.
 */
describe("isAdminPath", () => {
  it("matches the admin root and nested admin routes", () => {
    expect(isAdminPath("/admin")).toBe(true);
    expect(isAdminPath("/admin/login")).toBe(true);
    expect(isAdminPath("/admin/appointments")).toBe(true);
    expect(isAdminPath("/admin/patients/abc123")).toBe(true);
    expect(isAdminPath("/admin/")).toBe(true);
  });

  it("does not match public or lookalike paths", () => {
    expect(isAdminPath("/")).toBe(false);
    expect(isAdminPath("/appointment")).toBe(false);
    expect(isAdminPath("/adminfoo")).toBe(false);
    expect(isAdminPath("/services/admin")).toBe(false);
    expect(isAdminPath("")).toBe(false);
  });
});

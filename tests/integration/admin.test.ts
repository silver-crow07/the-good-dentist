/**
 * Admin panel integration tests — real PostgreSQL, no HTTP server needed.
 *
 * Covers Phase A: GET /api/admin/stats authorization, response shape,
 * cache policy, and the server-side role gate (requireRole) with REAL
 * sessions for both StaffRole values.
 *
 * Gating + disposable-DB assumption identical to routes.test.ts.
 */

import "dotenv/config";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Refuse — loudly, before any query runs — to touch anything that is not a
// disposable database (see tests/integration/db-guard.ts).
import { assertDisposableDatabase } from "./db-guard";
assertDisposableDatabase(process.env.DATABASE_URL);

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as statsGet, POST as statsPost } from "@/app/api/admin/stats/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { hashPassword } from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { requireRole } from "@/lib/server/guard";

const prisma = getPrisma();
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

const describeDb = prisma ? describe : describe.skip;

let ipSeq = 200;
function nextIp(): string {
  ipSeq += 1;
  return `10.78.0.${ipSeq % 250}`;
}

function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; ip?: string } = {},
): NextRequest {
  const headers = new Headers(init.headers);
  if (!headers.has("host")) headers.set("host", HOST);
  if (!headers.has("origin")) headers.set("origin", ORIGIN);
  headers.set("x-forwarded-for", init.ip ?? nextIp());
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`${ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function login(email: string, password: string): Promise<string> {
  const response = await loginPost(
    request("/api/auth/login", {
      method: "POST",
      body: { email, password },
      ip: nextIp(),
    }),
  );
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = /tgd_session=([^;]+)/.exec(setCookie);
  expect(match).toBeTruthy();
  return `tgd_session=${match?.[1] ?? ""}`;
}

describeDb("Admin API (real PostgreSQL)", () => {
  let adminCookie: string;
  let staffCookie: string;

  beforeAll(async () => {
    if (!prisma) return;
    const config = await prisma.clinicConfig.findUnique({
      where: { id: "singleton" },
      select: { id: true },
    });
    if (!config) {
      throw new Error("Database is not seeded — run: npx prisma migrate deploy && npm run db:seed");
    }
    await prisma.staffSession.deleteMany({});
    await prisma.staff.deleteMany({});

    const suffix = Date.now();
    const adminEmail = `admin-test-${suffix}@example.test`;
    const staffEmail = `staff-test-${suffix}@example.test`;
    const password = "admin-panel-test-pw-123";

    await prisma.staff.createMany({
      data: [
        {
          email: adminEmail,
          fullName: "Admin Test",
          passwordHash: await hashPassword(password),
          role: "ADMIN",
          active: true,
        },
        {
          email: staffEmail,
          fullName: "Staff Test",
          passwordHash: await hashPassword(password),
          role: "STAFF",
          active: true,
        },
      ],
    });

    adminCookie = await login(adminEmail, password);
    staffCookie = await login(staffEmail, password);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.staffSession.deleteMany({});
    await prisma.staff.deleteMany({});
  });

  /* ---------------- GET /api/admin/stats ---------------- */

  it("401s unauthenticated stats access", async () => {
    const response = await statsGet(request("/api/admin/stats"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(JSON.stringify(body)).not.toMatch(/patient|phone|stats/i);
  });

  it("403s cross-origin stats access (CSRF)", async () => {
    const response = await statsGet(
      request("/api/admin/stats", {
        headers: { cookie: adminCookie, origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  });

  it("refuses non-GET methods with 405", async () => {
    const response = await statsPost();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  it("returns dashboard stats for ADMIN with no-store caching", async () => {
    const response = await statsGet(
      request("/api/admin/stats", { headers: { cookie: adminCookie } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    const stats = body.stats;
    expect(stats).toBeTruthy();
    expect(typeof stats.timezone).toBe("string");
    expect(stats.timezone).toBe("Asia/Kolkata");
    expect(typeof stats.generatedAt).toBe("string");
    expect(Number.isInteger(stats.totals.appointments)).toBe(true);
    expect(Number.isInteger(stats.totals.patients)).toBe(true);
    expect(stats.today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isInteger(stats.today.total)).toBe(true);

    for (const key of ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"]) {
      expect(Number.isInteger(stats.byStatus[key])).toBe(true);
      expect(Number.isInteger(stats.today[key])).toBe(true);
    }

    expect(Array.isArray(stats.week)).toBe(true);
    expect(stats.week).toHaveLength(7);
    for (const day of stats.week) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isInteger(day.count)).toBe(true);
    }

    expect(Array.isArray(stats.upcoming)).toBe(true);
    expect(Array.isArray(stats.recentActivity)).toBe(true);

    // Nothing sensitive ever leaves the server:
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/password|scrypt\$|SESSION_SECRET|DATABASE_URL/i);
    // Staff emails are not part of the payload:
    expect(raw).not.toContain("@example.test");
  });

  it("allows STAFF to view the dashboard (both roles may)", async () => {
    const response = await statsGet(
      request("/api/admin/stats", { headers: { cookie: staffCookie } }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.stats.totals).toBeTruthy();
  });

  /* ---------------- Server-side role gate ---------------- */

  it("requireRole enforces ADMIN-only access for a STAFF session", async () => {
    const guard = await requireRole(
      request("/api/admin/stats", { headers: { cookie: staffCookie } }),
      ["ADMIN"],
    );
    expect(guard.staff).toBeUndefined();
    expect(guard.response?.status).toBe(403);
    const body = await guard.response?.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("requireRole admits an ADMIN session and preserves identity", async () => {
    const guard = await requireRole(
      request("/api/admin/stats", { headers: { cookie: adminCookie } }),
      ["ADMIN"],
    );
    expect(guard.response).toBeUndefined();
    expect(guard.staff?.role).toBe("ADMIN");
    expect(guard.staff?.fullName).toBe("Admin Test");
    // Only session-derived identity fields are exposed:
    expect(Object.keys(guard.staff ?? {}).sort()).toEqual([
      "email",
      "fullName",
      "id",
      "role",
    ]);
  });

  it("requireRole rejects unauthenticated requests before any role check", async () => {
    const guard = await requireRole(request("/api/admin/stats"), ["ADMIN"]);
    expect(guard.staff).toBeUndefined();
    expect(guard.response?.status).toBe(401);
  });
});

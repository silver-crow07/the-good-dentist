/**
 * Route-handler integration tests — real PostgreSQL, no HTTP server needed.
 *
 * Route handlers are invoked directly with constructed requests, which
 * exercises the full stack: validation → rate limiting → auth/CSRF → domain
 * service → Prisma → PostgreSQL (including the exclusion constraint).
 *
 * Gating + disposable-DB assumption identical to booking.test.ts.
 */

import "dotenv/config";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as availabilityGet } from "@/app/api/appointments/availability/route";
import { POST as bookingPost } from "@/app/api/appointments/route";
import { GET as appointmentGet, PATCH as appointmentPatch } from "@/app/api/appointments/[id]/route";
import { POST as cancelPost } from "@/app/api/appointments/[id]/cancel/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { POST as logoutPost } from "@/app/api/auth/logout/route";
import { GET as meGet } from "@/app/api/auth/me/route";
import { hashPassword } from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { clinicDateKey, weekdayOfDateKey, zonedTimeToUtc } from "@/lib/server/schedule";

const prisma = getPrisma();
const tz = "Asia/Kolkata";
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

const describeDb = prisma ? describe : describe.skip;

let ipSeq = 100;
function nextIp(): string {
  ipSeq += 1;
  return `10.77.0.${ipSeq % 250}`;
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

function dateKeyAhead(days: number): string {
  return clinicDateKey(new Date(Date.now() + days * 86_400_000), tz);
}

function nextWeekdayKey(target: number): string {
  for (let i = 1; i <= 14; i += 1) {
    const key = dateKeyAhead(i);
    if (weekdayOfDateKey(key) === target) return key;
  }
  throw new Error("no matching weekday");
}

function isoAt(dateKey: string, minutes: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, minutes, tz).toISOString();
}

type Session = { email: string; password: string; cookie: string };

describeDb("API route handlers (real PostgreSQL)", () => {
  let session: Session;
  const monday = nextWeekdayKey(1);

  beforeAll(async () => {
    if (!prisma) return;
    const config = await prisma.clinicConfig.findUnique({
      where: { id: "singleton" },
      include: { hours: true },
    });
    if (!config || config.hours.length === 0) {
      throw new Error("Database is not seeded — run: npx prisma migrate deploy && npm run db:seed");
    }
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.staffSession.deleteMany({});
    await prisma.staff.deleteMany({});

    // Staff account for protected-route tests (offline-style creation).
    const email = `route-test-${Date.now()}@example.test`;
    const password = "integration-test-pw-123";
    await prisma.staff.create({
      data: {
        email,
        fullName: "Route Test",
        passwordHash: await hashPassword(password),
        role: "ADMIN",
        active: true,
      },
    });
    session = { email, password, cookie: "" };
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.staffSession.deleteMany({});
    await prisma.staff.deleteMany({});
  });

  function authed(extra: Record<string, string> = {}, ip?: string) {
    return { headers: { cookie: session.cookie, ...extra }, ip };
  }

  /* ---------------- Public booking endpoints ---------------- */

  it("GET availability returns slots and leaks nothing sensitive", async () => {
    const response = await availabilityGet(
      request(`/api/appointments/availability?date=${monday}&serviceSlug=general-dentistry`),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.date).toBe(monday);
    expect(body.closed).toBe(false);
    expect(Array.isArray(body.slots)).toBe(true);
    expect(body.slots.length).toBe(18);
    expect(JSON.stringify(body)).not.toMatch(/password|secret|DATABASE_URL/i);
  });

  it("GET availability validates query parameters", async () => {
    const response = await availabilityGet(request("/api/appointments/availability?date=nope"));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST booking succeeds (201, PENDING) without echoing patient data", async () => {
    const response = await bookingPost(
      request("/api/appointments", {
        method: "POST",
        body: {
          patient: { fullName: "HTTP Patient", phone: "98111 11111", email: "" },
          serviceSlug: "general-dentistry",
          startsAt: isoAt(nextWeekdayKey(2), 9 * 60),
        },
      }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.appointment.status).toBe("PENDING");
    expect(body.appointment.publicId).toMatch(/^apt_[0-9a-f]{16}$/);
    expect(body.message).toMatch(/request has been received/i);
    // No patient PII in the public response:
    expect(JSON.stringify(body)).not.toContain("9811111111");
    expect(body.appointment.patient).toBeUndefined();
  });

  it("POST booking returns 409 for a taken slot", async () => {
    const startsAt = isoAt(nextWeekdayKey(2), 10 * 60);
    const payload = {
      patient: { fullName: "Conflict Patient", phone: "98222 22222", email: "" },
      serviceSlug: "general-dentistry",
      startsAt,
    };
    const first = await bookingPost(request("/api/appointments", { method: "POST", body: payload }));
    expect(first.status).toBe(201);
    const second = await bookingPost(request("/api/appointments", { method: "POST", body: payload }));
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("CONFLICT");
    expect(body.error.message).toMatch(/just taken|another booking/i);
  });

  it("POST booking returns field-level 400s for invalid input", async () => {
    const response = await bookingPost(
      request("/api/appointments", {
        method: "POST",
        body: {
          patient: { fullName: "X", phone: "not-a-phone", email: "bad" },
          serviceSlug: "general-dentistry",
          startsAt: isoAt(nextWeekdayKey(2), 11 * 60),
        },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.fields["patient.fullName"]).toBeTruthy();
    expect(body.error.fields["patient.phone"]).toBeTruthy();
  });

  it("POST booking rejects malformed JSON", async () => {
    const headers = new Headers({
      host: HOST,
      origin: ORIGIN,
      "x-forwarded-for": nextIp(),
      "content-type": "application/json",
    });
    const response = await bookingPost(
      new NextRequest(`${ORIGIN}/api/appointments`, { method: "POST", headers, body: "{oops" }),
    );
    expect(response.status).toBe(400);
  });

  it("POST booking rejects cross-origin requests (CSRF)", async () => {
    const response = await bookingPost(
      request("/api/appointments", {
        method: "POST",
        body: {
          patient: { fullName: "CSRF Test", phone: "98333 33333", email: "" },
          serviceSlug: "general-dentistry",
          startsAt: isoAt(nextWeekdayKey(2), 12 * 60),
        },
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rate-limits repeated booking attempts (429 + Retry-After)", async () => {
    const ip = nextIp();
    let sawTooMany = false;
    for (let i = 0; i < 8; i += 1) {
      const response = await bookingPost(
        request("/api/appointments", {
          method: "POST",
          body: {
            patient: { fullName: "Burst Patient", phone: "98444 44444", email: "" },
            serviceSlug: "general-dentistry",
            startsAt: isoAt(nextWeekdayKey(2), 14 * 60),
          },
          ip,
        }),
      );
      if (response.status === 429) {
        sawTooMany = true;
        expect(response.headers.get("retry-after")).toBeTruthy();
        break;
      }
    }
    expect(sawTooMany).toBe(true);
  });

  /* ---------------- Staff auth ---------------- */

  it("login rejects wrong passwords with a generic message", async () => {
    const response = await loginPost(
      request("/api/auth/login", {
        method: "POST",
        body: { email: session.email, password: "wrong-password-xyz" },
      }),
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.message).toBe("Invalid email or password.");
    // Must not reveal account existence:
    expect(JSON.stringify(body)).not.toContain("no such");
  });

  it("login rate-limits repeated failures", async () => {
    const ip = nextIp();
    let sawTooMany = false;
    for (let i = 0; i < 8; i += 1) {
      const response = await loginPost(
        request("/api/auth/login", {
          method: "POST",
          body: { email: session.email, password: `guess-${i}` },
          ip,
        }),
      );
      if (response.status === 429) {
        sawTooMany = true;
        break;
      }
    }
    expect(sawTooMany).toBe(true);
  });

  it("login sets an HttpOnly, SameSite=Lax session cookie", async () => {
    const response = await loginPost(
      request("/api/auth/login", {
        method: "POST",
        body: { email: session.email, password: session.password },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.staff.fullName).toBe("Route Test");
    // Password hash must never appear:
    expect(JSON.stringify(body)).not.toContain("scrypt$");

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/tgd_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);

    const match = /tgd_session=([^;]+)/.exec(setCookie);
    expect(match).toBeTruthy();
    session.cookie = `tgd_session=${match?.[1] ?? ""}`;
  });

  it("GET /me resolves the session and 401s without it", async () => {
    const withCookie = await meGet(request("/api/auth/me", authed()));
    expect(withCookie.status).toBe(200);
    expect((await withCookie.json()).staff.fullName).toBe("Route Test");

    const without = await meGet(request("/api/auth/me"));
    expect(without.status).toBe(401);
  });

  it("logout destroys the session and clears the cookie", async () => {
    const response = await logoutPost(request("/api/auth/logout", { method: "POST", ...authed() }));
    expect(response.status).toBe(200);
    const after = await meGet(request("/api/auth/me", authed()));
    expect(after.status).toBe(401);

    // Re-login for subsequent tests:
    const login = await loginPost(
      request("/api/auth/login", {
        method: "POST",
        body: { email: session.email, password: session.password },
      }),
    );
    const setCookie = login.headers.get("set-cookie") ?? "";
    const match = /tgd_session=([^;]+)/.exec(setCookie);
    session.cookie = `tgd_session=${match?.[1] ?? ""}`;
  });

  /* ---------------- Protected appointment endpoints ---------------- */

  it("401s unauthenticated staff access and never leaks patient data", async () => {
    const response = await appointmentGet(
      request("/api/appointments/apt_0000000000000000"),
      { params: Promise.resolve({ id: "apt_0000000000000000" }) },
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(JSON.stringify(body)).not.toMatch(/patient|phone/i);
  });

  it("staff can fetch the full appointment (incl. patient) after login", async () => {
    const booking = await bookingPost(
      request("/api/appointments", {
        method: "POST",
        body: {
          patient: { fullName: "Staff View Patient", phone: "98555 55555", email: "" },
          serviceSlug: "general-dentistry",
          startsAt: isoAt(nextWeekdayKey(3), 9 * 60),
        },
      }),
    );
    const { appointment } = await booking.json();

    const response = await appointmentGet(
      request(`/api/appointments/${appointment.publicId}`, authed()),
      { params: Promise.resolve({ id: appointment.publicId }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointment.patient.fullName).toBe("Staff View Patient");
    expect(body.appointment.patient.phone).toBe("9855555555");

    // And a 404 for unknown ids:
    const missing = await appointmentGet(
      request("/api/appointments/apt_ffffffffffffffff", authed()),
      { params: Promise.resolve({ id: "apt_ffffffffffffffff" }) },
    );
    expect(missing.status).toBe(404);
  });

  it("PATCH confirm → complete works; invalid transitions → 409; CSRF → 403", async () => {
    const booking = await bookingPost(
      request("/api/appointments", {
        method: "POST",
        body: {
          patient: { fullName: "Lifecycle Patient", phone: "98666 66666", email: "" },
          serviceSlug: "general-dentistry",
          startsAt: isoAt(nextWeekdayKey(3), 10 * 60),
        },
      }),
    );
    const { appointment } = await booking.json();
    const id = appointment.publicId;

    const confirm = await appointmentPatch(
      request(`/api/appointments/${id}`, { method: "PATCH", body: { status: "CONFIRMED" }, ...authed() }),
      { params: Promise.resolve({ id }) },
    );
    expect(confirm.status).toBe(200);
    expect((await confirm.json()).appointment.status).toBe("CONFIRMED");

    // CSRF: same cookie, foreign origin → 403.
    const csrf = await appointmentPatch(
      request(`/api/appointments/${id}`, {
        method: "PATCH",
        body: { status: "CANCELLED" },
        headers: { origin: "https://evil.example", cookie: session.cookie },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(csrf.status).toBe(403);

    const complete = await appointmentPatch(
      request(`/api/appointments/${id}`, { method: "PATCH", body: { status: "COMPLETED" }, ...authed() }),
      { params: Promise.resolve({ id }) },
    );
    expect(complete.status).toBe(200);

    // Terminal → invalid transition:
    const reopen = await appointmentPatch(
      request(`/api/appointments/${id}`, { method: "PATCH", body: { status: "CONFIRMED" }, ...authed() }),
      { params: Promise.resolve({ id }) },
    );
    expect(reopen.status).toBe(409);
  });

  it("staff can cancel; cancelling again → 409; slot frees up", async () => {
    const dateKey = nextWeekdayKey(4);
    const booking = await bookingPost(
      request("/api/appointments", {
        method: "POST",
        body: {
          patient: { fullName: "Cancel Patient", phone: "98777 77777", email: "" },
          serviceSlug: "general-dentistry",
          startsAt: isoAt(dateKey, 9 * 60),
        },
      }),
    );
    const { appointment } = await booking.json();

    const cancel = await cancelPost(
      request(`/api/appointments/${appointment.publicId}/cancel`, {
        method: "POST",
        body: { reason: "Clinic event" },
        ...authed(),
      }),
      { params: Promise.resolve({ id: appointment.publicId }) },
    );
    expect(cancel.status).toBe(200);
    expect((await cancel.json()).appointment.status).toBe("CANCELLED");

    const again = await cancelPost(
      request(`/api/appointments/${appointment.publicId}/cancel`, {
        method: "POST",
        body: {},
        ...authed(),
      }),
      { params: Promise.resolve({ id: appointment.publicId }) },
    );
    expect(again.status).toBe(409);

    // Slot freed:
    const availability = await availabilityGet(
      request(`/api/appointments/availability?date=${dateKey}&serviceSlug=general-dentistry`),
    );
    const body = await availability.json();
    expect(body.slots.find((slot: { label: string }) => slot.label === "9:00 AM")?.available).toBe(true);
  });
});

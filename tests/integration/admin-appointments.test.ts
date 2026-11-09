/**
 * Phase B integration tests — appointment management + settings APIs against
 * a REAL PostgreSQL database.
 *
 * Covers:
 *  - GET /api/admin/appointments (auth, CSRF, 405, list mode, pagination,
 *    name/phone/public-id search, status/date/doctor/service filters,
 *    range mode, invalid queries)
 *  - GET /api/admin/appointments/options (shape, timezone/today keys)
 *  - GET /api/admin/settings (own profile + clinic config, no secret leak)
 *  - Mutations reusing the EXISTING audited endpoints: confirm, complete,
 *    cancel-with-reason, reschedule (conflict 409 + success) with audit rows
 *  - Availability API doctorSlug support used by the reschedule dialog
 *
 * Gating + disposable-DB assumption identical to admin.test.ts: the suite
 * WIPES Appointment/Patient/AuditLog/Staff/StaffSession — never point it at
 * production.
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

import { GET as availabilityGet } from "@/app/api/appointments/availability/route";
import { GET as appointmentGet, PATCH as appointmentPatch } from "@/app/api/appointments/[id]/route";
import { POST as cancelPost } from "@/app/api/appointments/[id]/cancel/route";
import { POST as loginPost } from "@/app/api/auth/login/route";
import { GET as listGet, POST as listPost } from "@/app/api/admin/appointments/route";
import {
  GET as optionsGet,
  POST as optionsPost,
} from "@/app/api/admin/appointments/options/route";
import { GET as settingsGet, POST as settingsPost } from "@/app/api/admin/settings/route";
import { addDaysKey } from "@/lib/admin/calendar";
import { hashPassword } from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { clinicDateKey, weekdayOfDateKey, zonedTimeToUtc } from "@/lib/server/schedule";

const prisma = getPrisma();
const tz = "Asia/Kolkata";
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

const describeDb = prisma ? describe : describe.skip;

let ipSeq = 300;
function nextIp(): string {
  ipSeq += 1;
  return `10.79.0.${ipSeq % 250}`;
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

function authed(cookie: string, extra: Record<string, string> = {}) {
  return { headers: { cookie, ...extra } };
}

/* Fixed public ids — every one matches /^apt_[0-9a-f]{16}$/. */
const APT_A = "apt_a0a0a0a0a0a0a0a0"; // PENDING   Mon 09:00  general (30m)
const APT_B = "apt_b0b0b0b0b0b0b0b0"; // CONFIRMED Mon 12:00  root canal (60m)
const APT_C = "apt_c0c0c0c0c0c0c0c0"; // CONFIRMED Mon 16:30  general (30m)
const APT_D = "apt_d0d0d0d0d0d0d0d0"; // CANCELLED Tue 09:00  general (30m)
const APT_E = "apt_e0e0e0e0e0e0e0e0"; // PENDING   Mon 19:00  root canal (60m)

describeDb("Admin appointments + settings (real PostgreSQL)", () => {
  const monday = nextWeekdayKey(1);
  const tuesday = addDaysKey(monday, 1);

  let adminCookie = "";
  let staffCookie = "";
  let adminId = "";
  let staffId = "";
  let adminEmail = "";
  let staffEmail = "";
  let doctorSlug = "";

  beforeAll(async () => {
    if (!prisma) return;
    const config = await prisma.clinicConfig.findUnique({
      where: { id: "singleton" },
      include: { hours: true },
    });
    if (!config || config.hours.length === 0) {
      throw new Error("Database is not seeded — run: npx prisma migrate deploy && npm run db:seed");
    }

    const doctor = await prisma.doctor.findFirst({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    });
    const general = await prisma.service.findUnique({ where: { slug: "general-dentistry" } });
    const rootCanal = await prisma.service.findUnique({
      where: { slug: "root-canal-treatment" },
    });
    if (!doctor || !general || !rootCanal) {
      throw new Error("Database is not seeded — doctors/services are missing.");
    }
    doctorSlug = doctor.slug;

    // Disposable-test-DB assumption: wipe booking + auth data (keep config).
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.staffSession.deleteMany({});
    await prisma.staff.deleteMany({});

    const suffix = Date.now();
    adminEmail = `admin-apt-${suffix}@example.test`;
    staffEmail = `staff-apt-${suffix}@example.test`;
    const password = "admin-panel-test-pw-123";

    const admin = await prisma.staff.create({
      data: {
        email: adminEmail,
        fullName: "Admin Test",
        passwordHash: await hashPassword(password),
        role: "ADMIN",
        active: true,
      },
    });
    const staff = await prisma.staff.create({
      data: {
        email: staffEmail,
        fullName: "Staff Test",
        passwordHash: await hashPassword(password),
        role: "STAFF",
        active: true,
      },
    });
    adminId = admin.id;
    staffId = staff.id;
    adminCookie = await login(adminEmail, password);
    staffCookie = await login(staffEmail, password);

    /* Seed patients + appointments (direct rows — no booking flow involved). */
    const asha = await prisma.patient.create({
      data: { fullName: "Asha Verma", phone: "9876543210" },
    });
    const rahul = await prisma.patient.create({
      data: { fullName: "Rahul Sen", phone: "9812345678" },
    });
    const meera = await prisma.patient.create({
      data: { fullName: "Meera Iyer", phone: "9711111111" },
    });

    await prisma.appointment.createMany({
      data: [
        {
          publicId: APT_A,
          patientId: asha.id,
          doctorId: doctor.id,
          serviceId: general.id,
          startsAt: isoAt(monday, 9 * 60),
          endsAt: isoAt(monday, 9 * 60 + 30),
          status: "PENDING",
          patientNotes: "Prefers morning slots",
        },
        {
          publicId: APT_B,
          patientId: rahul.id,
          doctorId: doctor.id,
          serviceId: rootCanal.id,
          startsAt: isoAt(monday, 12 * 60),
          endsAt: isoAt(monday, 13 * 60),
          status: "CONFIRMED",
        },
        {
          publicId: APT_C,
          patientId: asha.id,
          doctorId: doctor.id,
          serviceId: general.id,
          startsAt: isoAt(monday, 16 * 60 + 30),
          endsAt: isoAt(monday, 17 * 60),
          status: "CONFIRMED",
        },
        {
          publicId: APT_D,
          patientId: meera.id,
          doctorId: doctor.id,
          serviceId: general.id,
          startsAt: isoAt(tuesday, 9 * 60),
          endsAt: isoAt(tuesday, 9 * 60 + 30),
          status: "CANCELLED",
        },
        {
          publicId: APT_E,
          patientId: rahul.id,
          doctorId: doctor.id,
          serviceId: rootCanal.id,
          startsAt: isoAt(monday, 19 * 60),
          endsAt: isoAt(monday, 20 * 60),
          status: "PENDING",
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.staffSession.deleteMany({});
    await prisma.staff.deleteMany({});
  });

  /* ---------------- GET /api/admin/appointments — gating ---------------- */

  it("401s unauthenticated list access without leaking data", async () => {
    const response = await listGet(request("/api/admin/appointments"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    // The safe message may mention appointments, but never any patient data:
    expect(JSON.stringify(body)).not.toMatch(/patient|phone|password|scrypt|DATABASE_URL/i);
  });

  it("403s cross-origin list access (CSRF)", async () => {
    const response = await listGet(
      request("/api/admin/appointments", {
        headers: { cookie: adminCookie, origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  });

  it("refuses non-GET methods with 405", async () => {
    const response = await listPost();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });

  /* ---------------- List mode, shape, pagination ---------------- */

  it("returns the seeded list sorted by start time with a full staff shape", async () => {
    const response = await listGet(
      request("/api/admin/appointments", authed(adminCookie)),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.range).toBeNull();
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 5,
      totalPages: 1,
    });
    expect(body.appointments.map((a: { publicId: string }) => a.publicId)).toEqual([
      APT_A,
      APT_B,
      APT_C,
      APT_E,
      APT_D,
    ]);

    const first = body.appointments[0];
    expect(first.status).toBe("PENDING");
    expect(first.startsAt).toBe(isoAt(monday, 9 * 60));
    expect(first.endsAt).toBe(isoAt(monday, 9 * 60 + 30));
    expect(first.source).toBe("WEBSITE");
    expect(first.patientNotes).toBe("Prefers morning slots");
    expect(first.service).toEqual({ slug: "general-dentistry", name: expect.any(String) });
    expect(first.doctor.slug).toBe(doctorSlug);
    expect(first.patient.fullName).toBe("Asha Verma");
    expect(first.patient.phone).toBe("9876543210");

    // No secrets of any kind in a PII response:
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/password|scrypt\$|DATABASE_URL|SESSION_SECRET/i);
  });

  it("paginates with page/pageSize", async () => {
    const page1 = await listGet(
      request("/api/admin/appointments?page=1&pageSize=2", authed(adminCookie)),
    );
    expect(page1.status).toBe(200);
    const body1 = await page1.json();
    expect(body1.appointments.map((a: { publicId: string }) => a.publicId)).toEqual([
      APT_A,
      APT_B,
    ]);
    expect(body1.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    const page2 = await listGet(
      request("/api/admin/appointments?page=2&pageSize=2", authed(adminCookie)),
    );
    const body2 = await page2.json();
    expect(body2.appointments.map((a: { publicId: string }) => a.publicId)).toEqual([
      APT_C,
      APT_E,
    ]);
    expect(body2.pagination.page).toBe(2);

    // Page beyond the end → empty page, total unchanged (not an error).
    const page4 = await listGet(
      request("/api/admin/appointments?page=4&pageSize=2", authed(adminCookie)),
    );
    const body4 = await page4.json();
    expect(body4.appointments).toEqual([]);
    expect(body4.pagination.total).toBe(5);
  });

  /* ---------------- Search ---------------- */

  it("searches by patient name (case-insensitive), phone and public id", async () => {
    const byName = await listGet(
      request("/api/admin/appointments?q=Asha", authed(adminCookie)),
    );
    expect(byName.status).toBe(200);
    const nameBody = await byName.json();
    expect(nameBody.appointments.map((a: { publicId: string }) => a.publicId)).toEqual([
      APT_A,
      APT_C,
    ]);

    const byLowerName = await listGet(
      request("/api/admin/appointments?q=asha", authed(adminCookie)),
    );
    expect((await byLowerName.json()).pagination.total).toBe(2);

    const byPhone = await listGet(
      request("/api/admin/appointments?q=9812345678", authed(adminCookie)),
    );
    const phoneBody = await byPhone.json();
    expect(phoneBody.appointments.map((a: { publicId: string }) => a.publicId)).toEqual([
      APT_B,
      APT_E,
    ]);

    // Partial digits still match the phone clause (≥3 digits).
    const byPartialPhone = await listGet(
      request("/api/admin/appointments?q=98765", authed(adminCookie)),
    );
    expect((await byPartialPhone.json()).pagination.total).toBe(2);

    const byId = await listGet(
      request(`/api/admin/appointments?q=${APT_C}`, authed(adminCookie)),
    );
    const idBody = await byId.json();
    expect(idBody.appointments.map((a: { publicId: string }) => a.publicId)).toEqual([APT_C]);

    const noMatch = await listGet(
      request("/api/admin/appointments?q=zzz-no-match", authed(adminCookie)),
    );
    const noMatchBody = await noMatch.json();
    expect(noMatchBody.appointments).toEqual([]);
    expect(noMatchBody.pagination.total).toBe(0);
  });

  /* ---------------- Filters ---------------- */

  it("filters by status, date, service and doctor", async () => {
    const pending = await listGet(
      request("/api/admin/appointments?status=PENDING", authed(adminCookie)),
    );
    expect((await pending.json()).appointments.map((a: { publicId: string }) => a.publicId)).toEqual([
      APT_A,
      APT_E,
    ]);

    const confirmed = await listGet(
      request("/api/admin/appointments?status=CONFIRMED", authed(adminCookie)),
    );
    expect((await confirmed.json()).appointments.map((a: { publicId: string }) => a.publicId)).toEqual(
      [APT_B, APT_C],
    );

    const cancelled = await listGet(
      request("/api/admin/appointments?status=CANCELLED", authed(adminCookie)),
    );
    expect((await cancelled.json()).appointments.map((a: { publicId: string }) => a.publicId)).toEqual(
      [APT_D],
    );

    // `date` is a single-day filter INSIDE the paginated list mode.
    const mondayOnly = await listGet(
      request(`/api/admin/appointments?date=${monday}`, authed(adminCookie)),
    );
    const mondayBody = await mondayOnly.json();
    expect(mondayBody.range).toBeNull();
    expect(mondayBody.pagination.total).toBe(4);
    expect(mondayBody.appointments.map((a: { publicId: string }) => a.publicId)).toEqual([
      APT_A,
      APT_B,
      APT_C,
      APT_E,
    ]);

    const tuesdayOnly = await listGet(
      request(`/api/admin/appointments?date=${tuesday}`, authed(adminCookie)),
    );
    expect((await tuesdayOnly.json()).pagination.total).toBe(1);

    const byService = await listGet(
      request(
        "/api/admin/appointments?serviceSlug=root-canal-treatment",
        authed(adminCookie),
      ),
    );
    expect((await byService.json()).appointments.map((a: { publicId: string }) => a.publicId)).toEqual(
      [APT_B, APT_E],
    );

    const byDoctor = await listGet(
      request(`/api/admin/appointments?doctorSlug=${doctorSlug}`, authed(adminCookie)),
    );
    expect((await byDoctor.json()).pagination.total).toBe(5);

    // Unknown slugs simply match nothing (no 500s).
    const unknownDoctor = await listGet(
      request("/api/admin/appointments?doctorSlug=nobody-here", authed(adminCookie)),
    );
    expect(unknownDoctor.status).toBe(200);
    expect((await unknownDoctor.json()).appointments).toEqual([]);

    const unknownService = await listGet(
      request("/api/admin/appointments?serviceSlug=no-such-service", authed(adminCookie)),
    );
    expect(unknownService.status).toBe(200);
    expect((await unknownService.json()).appointments).toEqual([]);
  });

  /* ---------------- Range mode + invalid queries ---------------- */

  it("range mode returns the calendar window without pagination", async () => {
    const single = await listGet(
      request(`/api/admin/appointments?from=${monday}&to=${monday}`, authed(adminCookie)),
    );
    expect(single.status).toBe(200);
    const singleBody = await single.json();
    expect(singleBody.pagination).toBeNull();
    expect(singleBody.range).toEqual({ from: monday, to: monday, truncated: false });
    expect(singleBody.appointments).toHaveLength(4);

    const twoDays = await listGet(
      request(`/api/admin/appointments?from=${monday}&to=${tuesday}`, authed(adminCookie)),
    );
    const twoDaysBody = await twoDays.json();
    expect(twoDaysBody.pagination).toBeNull();
    expect(twoDaysBody.range.truncated).toBe(false);
    expect(twoDaysBody.appointments).toHaveLength(5);
  });

  it("rejects invalid queries with 400 VALIDATION_ERROR", async () => {
    const cases = [
      `/api/admin/appointments?from=${tuesday}&to=${monday}`, // inverted range
      `/api/admin/appointments?date=${monday}&from=${monday}`, // date + range
      "/api/admin/appointments?status=BOGUS", // unknown status
      "/api/admin/appointments?page=0", // page below 1
      "/api/admin/appointments?pageSize=501", // page size above cap
      "/api/admin/appointments?from=not-a-date", // malformed key
    ];
    for (const path of cases) {
      const response = await listGet(request(path, authed(adminCookie)));
      expect(response.status, path).toBe(400);
      expect((await response.json()).error.code, path).toBe("VALIDATION_ERROR");
    }
  });

  /* ---------------- Options ---------------- */

  it("options endpoint returns filters plus clinic timezone/today", async () => {
    const unauth = await optionsGet(request("/api/admin/appointments/options"));
    expect(unauth.status).toBe(401);

    const response = await optionsGet(
      request("/api/admin/appointments/options", authed(staffCookie)),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.doctors.length).toBeGreaterThanOrEqual(1);
    expect(body.doctors.map((d: { slug: string }) => d.slug)).toContain(doctorSlug);
    expect(body.services.length).toBeGreaterThanOrEqual(1);
    for (const service of body.services) {
      expect(typeof service.durationMinutes).toBe("number");
    }
    expect(body.timezone).toBe("Asia/Kolkata");
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const method = await optionsPost();
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
  });

  /* ---------------- Settings (read-only) ---------------- */

  it("settings returns the own profile + clinic schedule without any secrets", async () => {
    const unauth = await settingsGet(request("/api/admin/settings"));
    expect(unauth.status).toBe(401);

    const response = await settingsGet(request("/api/admin/settings", authed(adminCookie)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    const settings = body.settings;
    expect(settings.staff).toEqual({
      fullName: "Admin Test",
      email: adminEmail,
      role: "ADMIN",
      joinedAt: expect.any(String),
    });
    expect(settings.clinic.timezone).toBe("Asia/Kolkata");
    expect(settings.slotIntervalMinutes).toBe(30);
    expect(settings.bookingPolicy).toBe("MANUAL_APPROVAL");
    expect(settings.hours).toHaveLength(7);
    expect(settings.hours.map((h: { weekday: number }) => h.weekday)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    // Sunday (0) is closed; Monday (1) is 9:00–13:00 with a 13:00–16:00 break.
    expect(settings.hours[0].closed).toBe(true);
    expect(settings.hours[1]).toMatchObject({
      closed: false,
      opensAtMinutes: 9 * 60,
      closesAtMinutes: 21 * 60,
      breakStartMinutes: 13 * 60,
      breakEndMinutes: 16 * 60,
    });

    // Never any credential material:
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/password|scrypt\$|DATABASE_URL|SESSION_SECRET/i);

    // STAFF sees their OWN profile (both roles may view settings).
    const staffView = await settingsGet(request("/api/admin/settings", authed(staffCookie)));
    expect(staffView.status).toBe(200);
    const staffBody = await staffView.json();
    expect(staffBody.settings.staff.role).toBe("STAFF");
    expect(staffBody.settings.staff.email).toBe(staffEmail);

    const method = await settingsPost();
    expect(method.status).toBe(405);
    expect(method.headers.get("allow")).toBe("GET");
  });

  /* ---------------- Role access ---------------- */

  it("allows STAFF to read the appointment list (both roles may)", async () => {
    const response = await listGet(
      request("/api/admin/appointments", authed(staffCookie)),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pagination.total).toBe(5);
  });

  it("returns the full staff detail view for the details dialog", async () => {
    const unauth = await appointmentGet(request(`/api/appointments/${APT_C}`), {
      params: Promise.resolve({ id: APT_C }),
    });
    expect(unauth.status).toBe(401);

    const response = await appointmentGet(
      request(`/api/appointments/${APT_C}`, authed(staffCookie)),
      { params: Promise.resolve({ id: APT_C }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointment.publicId).toBe(APT_C);
    expect(body.appointment.patient.fullName).toBe("Asha Verma");
    expect(body.appointment.patient.phone).toBe("9876543210");
  });

  /* ---------------- Mutations (existing audited endpoints) ---------------- */

  it("confirms a PENDING appointment and writes an audit row", async () => {
    const response = await appointmentPatch(
      request(`/api/appointments/${APT_A}`, {
        method: "PATCH",
        body: { status: "CONFIRMED" },
        ...authed(adminCookie),
      }),
      { params: Promise.resolve({ id: APT_A }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).appointment.status).toBe("CONFIRMED");

    const audit = await prisma?.auditLog.findFirst({
      where: { action: "appointment.confirmed", entityId: APT_A },
    });
    expect(audit).toBeTruthy();
    expect(audit?.staffId).toBe(adminId);
    expect(audit?.entityType).toBe("appointment");
  });

  it("rejects invalid status transitions with 409", async () => {
    // CONFIRMED → PENDING is not a legal transition.
    const reopen = await appointmentPatch(
      request(`/api/appointments/${APT_C}`, {
        method: "PATCH",
        body: { status: "PENDING" },
        ...authed(adminCookie),
      }),
      { params: Promise.resolve({ id: APT_C }) },
    );
    expect(reopen.status).toBe(409);
    expect((await reopen.json()).error.code).toBe("CONFLICT");

    // CANCELLED is terminal.
    const revive = await appointmentPatch(
      request(`/api/appointments/${APT_D}`, {
        method: "PATCH",
        body: { status: "CONFIRMED" },
        ...authed(adminCookie),
      }),
      { params: Promise.resolve({ id: APT_D }) },
    );
    expect(revive.status).toBe(409);
  });

  it("marks an appointment COMPLETED with an audit row", async () => {
    const response = await appointmentPatch(
      request(`/api/appointments/${APT_A}`, {
        method: "PATCH",
        body: { status: "COMPLETED" },
        ...authed(adminCookie),
      }),
      { params: Promise.resolve({ id: APT_A }) },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).appointment.status).toBe("COMPLETED");

    const audit = await prisma?.auditLog.findFirst({
      where: { action: "appointment.completed", entityId: APT_A },
    });
    expect(audit).toBeTruthy();
    expect(audit?.staffId).toBe(adminId);
  });

  it("lets STAFF cancel with a reason; cancelling twice → 409", async () => {
    const response = await cancelPost(
      request(`/api/appointments/${APT_E}/cancel`, {
        method: "POST",
        body: { reason: "Patient asked to postpone" },
        ...authed(staffCookie),
      }),
      { params: Promise.resolve({ id: APT_E }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.appointment.status).toBe("CANCELLED");
    expect(body.appointment.cancellationReason).toBe("Patient asked to postpone");

    const audit = await prisma?.auditLog.findFirst({
      where: { action: "appointment.cancelled", entityId: APT_E },
    });
    expect(audit).toBeTruthy();
    expect(audit?.staffId).toBe(staffId);

    const again = await cancelPost(
      request(`/api/appointments/${APT_E}/cancel`, {
        method: "POST",
        body: {},
        ...authed(staffCookie),
      }),
      { params: Promise.resolve({ id: APT_E }) },
    );
    expect(again.status).toBe(409);
  });

  /* ---------------- Availability (doctorSlug) + reschedule ---------------- */

  it("availability supports doctorSlug for per-clinician reschedule slots", async () => {
    const withDoctor = await availabilityGet(
      request(
        `/api/appointments/availability?date=${monday}&serviceSlug=general-dentistry&doctorSlug=${doctorSlug}`,
      ),
    );
    expect(withDoctor.status).toBe(200);
    const body = await withDoctor.json();
    expect(body.date).toBe(monday);
    expect(body.closed).toBe(false);
    expect(body.doctor.slug).toBe(doctorSlug);
    expect(body.slots.length).toBeGreaterThan(0);

    // Public booking shape unchanged: doctorSlug omitted → default doctor.
    const withoutDoctor = await availabilityGet(
      request(
        `/api/appointments/availability?date=${monday}&serviceSlug=general-dentistry`,
      ),
    );
    expect(withoutDoctor.status).toBe(200);
    expect((await withoutDoctor.json()).doctor.slug).toBe(doctorSlug);

    // Unknown clinician → clean 400, not a 500.
    const unknown = await availabilityGet(
      request(
        `/api/appointments/availability?date=${monday}&serviceSlug=general-dentistry&doctorSlug=nobody-here`,
      ),
    );
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("reschedule onto a taken slot → 409 (double booking prevented)", async () => {
    // APT_C holds Monday 16:30–17:00 (CONFIRMED, slot-reserving).
    const response = await appointmentPatch(
      request(`/api/appointments/${APT_B}`, {
        method: "PATCH",
        body: { startsAt: isoAt(monday, 16 * 60 + 30) },
        ...authed(adminCookie),
      }),
      { params: Promise.resolve({ id: APT_B }) },
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("CONFLICT");

    // Untouched:
    const row = await prisma?.appointment.findUnique({ where: { publicId: APT_B } });
    expect(row?.startsAt.toISOString()).toBe(isoAt(monday, 12 * 60));
  });

  it("reschedules onto a free slot via the conflict-safe service (audited)", async () => {
    const target = isoAt(monday, 17 * 60 + 30); // 5:30 PM — free, on the 30-min grid
    const response = await appointmentPatch(
      request(`/api/appointments/${APT_B}`, {
        method: "PATCH",
        body: { startsAt: target },
        ...authed(staffCookie),
      }),
      { params: Promise.resolve({ id: APT_B }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Date.parse(body.appointment.startsAt)).toBe(Date.parse(target));
    // Duration preserved from the service (root canal = 60 min):
    expect(Date.parse(body.appointment.endsAt) - Date.parse(body.appointment.startsAt)).toBe(
      60 * 60_000,
    );

    const audit = await prisma?.auditLog.findFirst({
      where: { action: "appointment.reschedule", entityId: APT_B },
    });
    expect(audit).toBeTruthy();
    expect(audit?.staffId).toBe(staffId);
    expect(audit?.metadata).toMatchObject({ startsAt: target });

    // The vacated 12:00 slot is free again; the new slot is gone from availability.
    const availability = await availabilityGet(
      request(
        `/api/appointments/availability?date=${monday}&serviceSlug=root-canal-treatment&doctorSlug=${doctorSlug}`,
      ),
    );
    expect(availability.status).toBe(200);
    const slots = (await availability.json()).slots as Array<{
      label: string;
      available: boolean;
    }>;
    expect(slots.find((slot) => slot.label === "12:00 PM")?.available).toBe(true);
    expect(slots.find((slot) => slot.label === "5:30 PM")?.available).toBe(false);
  });
});

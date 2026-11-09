/**
 * Phase C integration tests — patient management + clinical notes against a
 * REAL PostgreSQL database.
 *
 * Covers:
 *  - GET/POST /api/admin/patients (auth, CSRF, 405, list shape, alphabetical
 *    order, name/phone/email search, pagination, invalid queries, create 201
 *    + audit, STAFF 403 on create, validation 400)
 *  - GET/PATCH /api/admin/patients/[id] (ADMIN vs STAFF payloads — note
 *    content stripped for STAFF, permissions flags, 404, edit 201/200 +
 *    audit, STAFF 403, empty-patch 400, email clearing, DELETE 405)
 *  - POST /api/admin/patients/[id]/notes (201 + audit, STAFF 403, empty body
 *    400, unknown patient 404, GET 405)
 *  - Cache-Control: no-store on every patient response; no passwordHash /
 *    session material ever serialized
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

import { POST as loginPost } from "@/app/api/auth/login/route";
import { GET as listGet, POST as listPost, DELETE as listDelete } from "@/app/api/admin/patients/route";
import {
  GET as profileGet,
  PATCH as profilePatch,
  DELETE as profileDelete,
} from "@/app/api/admin/patients/[id]/route";
import { GET as notesGet, POST as notesPost } from "@/app/api/admin/patients/[id]/notes/route";
import { hashPassword } from "@/lib/server/auth";
import { getPrisma } from "@/lib/server/db";
import { clinicDateKey, weekdayOfDateKey, zonedTimeToUtc } from "@/lib/server/schedule";

const prisma = getPrisma();
const tz = "Asia/Kolkata";
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

const describeDb = prisma ? describe : describe.skip;

let ipSeq = 500;
function nextIp(): string {
  ipSeq += 1;
  return `10.80.0.${ipSeq % 250}`;
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

function authed(cookie: string, extra: Record<string, string> = {}) {
  return { headers: { cookie, ...extra } };
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

describeDb("Admin patients + clinical notes (real PostgreSQL)", () => {
  const monday = nextWeekdayKey(1);

  let adminCookie = "";
  let staffCookie = "";
  let adminFullName = "";
  let ashaId = "";
  let rahulId = "";
  let meeraId = "";

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

    // Disposable-test-DB assumption: wipe booking + auth data (keep config).
    await prisma.clinicalNote.deleteMany({});
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.staffSession.deleteMany({});
    await prisma.staff.deleteMany({});

    const suffix = Date.now();
    const adminEmail = `admin-pat-${suffix}@example.test`;
    const staffEmail = `staff-pat-${suffix}@example.test`;
    const password = "admin-panel-test-pw-123";

    const admin = await prisma.staff.create({
      data: {
        email: adminEmail,
        fullName: "Admin PatientTest",
        passwordHash: await hashPassword(password),
        role: "ADMIN",
        active: true,
      },
    });
    await prisma.staff.create({
      data: {
        email: staffEmail,
        fullName: "Staff PatientTest",
        passwordHash: await hashPassword(password),
        role: "STAFF",
        active: true,
      },
    });
    adminFullName = admin.fullName;
    adminCookie = await login(adminEmail, password);
    staffCookie = await login(staffEmail, password);

    /* Seed patients directly (no booking flow involved). */
    const asha = await prisma.patient.create({
      data: { fullName: "Asha Verma", phone: "9876543210" },
    });
    const rahul = await prisma.patient.create({
      data: { fullName: "Rahul Sen", phone: "9812345678", email: "rahul.sen@example.test" },
    });
    const meera = await prisma.patient.create({
      data: { fullName: "Meera Iyer", phone: "9711111111", email: "meera.iyer@example.test" },
    });
    ashaId = asha.id;
    rahulId = rahul.id;
    meeraId = meera.id;

    /* Asha: 2 COMPLETED general sessions + 1 CONFIRMED root canal.
     * Rahul: 1 PENDING root canal. Meera: none (her row was CANCELLED). */
    await prisma.appointment.createMany({
      data: [
        {
          publicId: "apt_a1a1a1a1a1a1a1a1",
          patientId: asha.id,
          doctorId: doctor.id,
          serviceId: general.id,
          startsAt: isoAt(monday, 9 * 60),
          endsAt: isoAt(monday, 9 * 60 + 30),
          status: "COMPLETED",
        },
        {
          publicId: "apt_a2a2a2a2a2a2a2a2",
          patientId: asha.id,
          doctorId: doctor.id,
          serviceId: general.id,
          startsAt: isoAt(monday, 10 * 60),
          endsAt: isoAt(monday, 10 * 60 + 30),
          status: "COMPLETED",
        },
        {
          publicId: "apt_a3a3a3a3a3a3a3a3",
          patientId: asha.id,
          doctorId: doctor.id,
          serviceId: rootCanal.id,
          startsAt: isoAt(monday, 16 * 60 + 30),
          endsAt: isoAt(monday, 17 * 60 + 30),
          status: "CONFIRMED",
        },
        {
          publicId: "apt_r1r1r1r1r1r1r1r1",
          patientId: rahul.id,
          doctorId: doctor.id,
          serviceId: rootCanal.id,
          startsAt: isoAt(monday, 12 * 60),
          endsAt: isoAt(monday, 13 * 60),
          status: "PENDING",
        },
        {
          publicId: "apt_m1m1m1m1m1m1m1m1",
          patientId: meera.id,
          doctorId: doctor.id,
          serviceId: general.id,
          startsAt: isoAt(monday, 18 * 60),
          endsAt: isoAt(monday, 18 * 60 + 30),
          status: "CANCELLED",
        },
      ],
    });

    /* One existing clinical note on Asha (author = ADMIN). */
    await prisma.clinicalNote.create({
      data: {
        patientId: asha.id,
        staffId: admin.id,
        body: "Allergic to penicillin — confirm before prescribing.",
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.clinicalNote.deleteMany({});
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.staffSession.deleteMany({});
    await prisma.staff.deleteMany({});
  });

  /* ---------------- GET /api/admin/patients — gating ---------------- */

  it("401s unauthenticated directory access without leaking data", async () => {
    const response = await listGet(request("/api/admin/patients"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(JSON.stringify(body)).not.toMatch(/patient|phone|password|scrypt|DATABASE_URL/i);
  });

  it("403s cross-origin directory access (CSRF)", async () => {
    const response = await listGet(
      request("/api/admin/patients", {
        headers: { cookie: adminCookie, origin: "https://evil.example" },
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
  });

  it("refuses DELETE on the collection with 405", async () => {
    const response = await listDelete();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
  });

  /* ---------------- List shape, search, pagination ---------------- */

  it("returns the directory alphabetically with a full shape and no-store", async () => {
    const response = await listGet(request("/api/admin/patients", authed(adminCookie)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.timezone).toBe(tz);
    expect(body.pagination).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    expect(body.patients.map((p: { fullName: string }) => p.fullName)).toEqual([
      "Asha Verma",
      "Meera Iyer",
      "Rahul Sen",
    ]);

    const asha = body.patients[0];
    expect(asha).toEqual({
      id: ashaId,
      fullName: "Asha Verma",
      phone: "9876543210",
      email: null,
      createdAt: expect.any(String),
      appointmentCount: 3,
    });

    // No secrets of any kind in a PII response:
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/password|scrypt\$|DATABASE_URL|SESSION_SECRET/i);
  });

  it("searches by name, phone digits and email", async () => {
    const byName = await listGet(
      request("/api/admin/patients?q=verma", authed(adminCookie)),
    );
    expect(byName.status).toBe(200);
    let body = await byName.json();
    expect(body.patients.map((p: { fullName: string }) => p.fullName)).toEqual(["Asha Verma"]);

    const byPhone = await listGet(
      request("/api/admin/patients?q=9812", authed(adminCookie)),
    );
    body = await byPhone.json();
    expect(body.patients.map((p: { fullName: string }) => p.fullName)).toEqual(["Rahul Sen"]);

    const byEmail = await listGet(
      request("/api/admin/patients?q=meera.iyer", authed(adminCookie)),
    );
    body = await byEmail.json();
    expect(body.patients.map((p: { fullName: string }) => p.fullName)).toEqual(["Meera Iyer"]);

    const noMatch = await listGet(
      request("/api/admin/patients?q=nobody-here", authed(adminCookie)),
    );
    body = await noMatch.json();
    expect(body.patients).toEqual([]);
    expect(body.pagination.total).toBe(0);
  });

  it("paginates with pageSize=2 across two pages", async () => {
    const first = await listGet(
      request("/api/admin/patients?page=1&pageSize=2", authed(adminCookie)),
    );
    const firstBody = await first.json();
    expect(firstBody.pagination).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(firstBody.patients.map((p: { fullName: string }) => p.fullName)).toEqual([
      "Asha Verma",
      "Meera Iyer",
    ]);

    const second = await listGet(
      request("/api/admin/patients?page=2&pageSize=2", authed(adminCookie)),
    );
    const secondBody = await second.json();
    expect(secondBody.pagination.page).toBe(2);
    expect(secondBody.patients.map((p: { fullName: string }) => p.fullName)).toEqual([
      "Rahul Sen",
    ]);
  });

  it("400s an out-of-bounds query", async () => {
    const response = await listGet(
      request("/api/admin/patients?page=0", authed(adminCookie)),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  /* ---------------- POST /api/admin/patients — register ---------------- */

  it("registers a patient as ADMIN (201 + audit + no-store)", async () => {
    const response = await listPost(
      request("/api/admin/patients", {
        method: "POST",
        body: { fullName: "  Kavya   Nair ", phone: "98222 33445", email: "kavya@example.test" },
        headers: { cookie: adminCookie },
      }),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.patient.fullName).toBe("Kavya Nair"); // name normalised
    expect(body.patient.phone).toBe("9822233445"); // digits only
    expect(body.patient.email).toBe("kavya@example.test");
    expect(body.patient.appointmentCount).toBe(0);

    const audit = await prisma?.auditLog.findFirst({
      where: { action: "patient.create", entityId: body.patient.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe("patient");

    // Clean up so pagination expectations elsewhere stay stable.
    await prisma?.patient.delete({ where: { id: body.patient.id } });
    await prisma?.auditLog.deleteMany({ where: { action: "patient.create", entityId: body.patient.id } });
  });

  it("403s STAFF registration attempts (requireRole)", async () => {
    const before = await prisma?.patient.count();
    const response = await listPost(
      request("/api/admin/patients", {
        method: "POST",
        body: { fullName: "Nope Person", phone: "9800000001" },
        headers: { cookie: staffCookie },
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(await prisma?.patient.count()).toBe(before);
  });

  it("400s an invalid registration", async () => {
    const response = await listPost(
      request("/api/admin/patients", {
        method: "POST",
        body: { fullName: "", phone: "abc" },
        headers: { cookie: adminCookie },
      }),
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.fullName).toBeTruthy();
    expect(body.error.fields.phone).toBeTruthy();
  });

  /* ---------------- GET /api/admin/patients/[id] — profile ---------------- */

  it("404s an unknown patient id", async () => {
    const response = await profileGet(
      request("/api/admin/patients/patient_that_does_not_exist", authed(adminCookie)),
      { params: Promise.resolve({ id: "patient_that_does_not_exist" }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("returns the ADMIN profile with history, treatments and notes", async () => {
    const response = await profileGet(
      request(`/api/admin/patients/${ashaId}`, authed(adminCookie)),
      { params: Promise.resolve({ id: ashaId }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.timezone).toBe(tz);
    expect(body.patient).toEqual({
      id: ashaId,
      fullName: "Asha Verma",
      phone: "9876543210",
      email: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      appointmentCount: 3,
    });

    // Appointment history: all statuses, newest first, full shape.
    expect(body.appointments).toHaveLength(3);
    expect(body.appointments[0].status).toBe("CONFIRMED");
    expect(body.appointments[0].publicId).toBe("apt_a3a3a3a3a3a3a3a3");
    expect(body.appointments[0].service.slug).toBe("root-canal-treatment");
    expect(body.appointments[0].doctor.slug).toBeTruthy();
    expect(body.appointments[2].status).toBe("COMPLETED");

    // Treatment history: only COMPLETED, grouped by service.
    expect(body.treatments).toHaveLength(1);
    expect(body.treatments[0].service.slug).toBe("general-dentistry");
    expect(body.treatments[0].sessions).toBe(2);
    expect(body.treatments[0].lastAt).toBe(isoAt(monday, 10 * 60));

    // Clinical notes visible to ADMIN with the author's name.
    expect(body.clinicalNotes).toHaveLength(1);
    expect(body.clinicalNotes[0].body).toContain("penicillin");
    expect(body.clinicalNotes[0].author).toBe(adminFullName);
    expect(body.clinicalNotesTotal).toBe(1);
    expect(body.permissions).toEqual({ canEdit: true, canAddNotes: true });

    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/password|scrypt\$|DATABASE_URL|SESSION_SECRET/i);
  });

  it("strips clinical notes from the STAFF profile (content never sent)", async () => {
    const response = await profileGet(
      request(`/api/admin/patients/${ashaId}`, authed(staffCookie)),
      { params: Promise.resolve({ id: ashaId }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.clinicalNotes).toBeNull();
    expect(body.clinicalNotesTotal).toBeNull();
    expect(body.permissions).toEqual({ canEdit: false, canAddNotes: false });
    // Limited view still carries what appointment management needs:
    expect(body.patient.fullName).toBe("Asha Verma");
    expect(body.appointments).toHaveLength(3);

    const raw = JSON.stringify(body);
    // Note CONTENT (and any note object) must never appear — only the
    // explicit nulls the STAFF payload uses:
    expect(raw).not.toMatch(/penicillin/i);
    expect(raw).not.toMatch(/"body"/);
    expect(raw).not.toMatch(/password|scrypt\$/i);
  });

  /* ---------------- PATCH /api/admin/patients/[id] — edit ---------------- */

  it("405s DELETE on the profile route", async () => {
    const response = await profileDelete();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, PATCH");
  });

  it("400s an empty PATCH", async () => {
    const response = await profilePatch(
      request(`/api/admin/patients/${meeraId}`, {
        method: "PATCH",
        body: {},
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ id: meeraId }) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  it("403s an STAFF edit attempt", async () => {
    const response = await profilePatch(
      request(`/api/admin/patients/${meeraId}`, {
        method: "PATCH",
        body: { fullName: "Hacked Name" },
        headers: { cookie: staffCookie },
      }),
      { params: Promise.resolve({ id: meeraId }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    const row = await prisma?.patient.findUnique({ where: { id: meeraId } });
    expect(row?.fullName).toBe("Meera Iyer");
  });

  it("edits patient details as ADMIN (200 + audit of field names)", async () => {
    const response = await profilePatch(
      request(`/api/admin/patients/${meeraId}`, {
        method: "PATCH",
        body: { fullName: "Meera Iyer-Nair", phone: "97111 22334" },
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ id: meeraId }) },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.patient.fullName).toBe("Meera Iyer-Nair");
    expect(body.patient.phone).toBe("9711122334");

    const audit = await prisma?.auditLog.findFirst({
      where: { action: "patient.update", entityId: meeraId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe("patient");
    // Audit metadata carries FIELD NAMES only — never the values (PII):
    const metadata = audit?.metadata as unknown as { fields?: string[] } | null;
    expect(metadata?.fields).toEqual(expect.arrayContaining(["fullName", "phone"]));
    expect(JSON.stringify(metadata)).not.toMatch(/Meera|9711122334/);
  });

  it("clears the email when PATCH sends an empty string", async () => {
    const set = await profilePatch(
      request(`/api/admin/patients/${rahulId}`, {
        method: "PATCH",
        body: { email: "new.address@example.test" },
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ id: rahulId }) },
    );
    expect(set.status).toBe(200);
    expect((await set.json()).patient.email).toBe("new.address@example.test");

    const clear = await profilePatch(
      request(`/api/admin/patients/${rahulId}`, {
        method: "PATCH",
        body: { email: "" },
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ id: rahulId }) },
    );
    expect(clear.status).toBe(200);
    expect((await clear.json()).patient.email).toBeNull();

    const row = await prisma?.patient.findUnique({ where: { id: rahulId } });
    expect(row?.email).toBeNull();
  });

  it("404s PATCH on an unknown id", async () => {
    const response = await profilePatch(
      request("/api/admin/patients/patient_that_does_not_exist", {
        method: "PATCH",
        body: { fullName: "Ghost" },
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ id: "patient_that_does_not_exist" }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  /* ---------------- POST /api/admin/patients/[id]/notes ---------------- */

  it("refuses GET on the notes collection with 405", async () => {
    const response = await notesGet();
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("adds a clinical note as ADMIN (201 + audit + no-store)", async () => {
    const response = await notesPost(
      request(`/api/admin/patients/${rahulId}/notes`, {
        method: "POST",
        body: { body: "  Prefers afternoon appointments.  " },
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ id: rahulId }) },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const body = await response.json();
    expect(body.note.body).toBe("Prefers afternoon appointments.");
    expect(body.note.author).toBe(adminFullName);
    expect(body.note.createdAt).toMatch(/^\d{4}-/);

    const audit = await prisma?.auditLog.findFirst({
      where: { action: "note.create", entityId: body.note.id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.entityType).toBe("clinicalNote");

    // It shows up in the ADMIN profile:
    const profile = await profileGet(
      request(`/api/admin/patients/${rahulId}`, authed(adminCookie)),
      { params: Promise.resolve({ id: rahulId }) },
    );
    const profileBody = await profile.json();
    expect(profileBody.clinicalNotesTotal).toBe(1);
    expect(profileBody.clinicalNotes[0].body).toBe("Prefers afternoon appointments.");
  });

  it("403s STAFF note creation", async () => {
    const before = await prisma?.clinicalNote.count({ where: { patientId: rahulId } });
    const response = await notesPost(
      request(`/api/admin/patients/${rahulId}/notes`, {
        method: "POST",
        body: { body: "Should not be saved." },
        headers: { cookie: staffCookie },
      }),
      { params: Promise.resolve({ id: rahulId }) },
    );
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("FORBIDDEN");
    expect(await prisma?.clinicalNote.count({ where: { patientId: rahulId } })).toBe(before);
  });

  it("400s an empty note body", async () => {
    const response = await notesPost(
      request(`/api/admin/patients/${rahulId}/notes`, {
        method: "POST",
        body: { body: "   " },
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ id: rahulId }) },
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.fields.body).toBeTruthy();
  });

  it("404s a note on an unknown patient", async () => {
    const response = await notesPost(
      request("/api/admin/patients/patient_that_does_not_exist/notes", {
        method: "POST",
        body: { body: "Orphan note." },
        headers: { cookie: adminCookie },
      }),
      { params: Promise.resolve({ id: "patient_that_does_not_exist" }) },
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("401s unauthenticated profile and note access", async () => {
    const profile = await profileGet(
      request(`/api/admin/patients/${ashaId}`),
      { params: Promise.resolve({ id: ashaId }) },
    );
    expect(profile.status).toBe(401);

    const note = await notesPost(
      request(`/api/admin/patients/${ashaId}/notes`, {
        method: "POST",
        body: { body: "Anonymous." },
      }),
      { params: Promise.resolve({ id: ashaId }) },
    );
    expect(note.status).toBe(401);
  });
});

/**
 * Integration tests against a REAL PostgreSQL database.
 *
 * Gating: skipped entirely when no DATABASE_URL is available. Uses the
 * project `.env` (dotenv) or TEST_DATABASE_URL when provided.
 *
 * IMPORTANT: these tests WIPE the Appointment, Patient and AuditLog tables
 * (config/services/doctors/staff are kept). Point them at a disposable
 * database — never at production.
 *
 * Requires: `npx prisma migrate deploy && npm run db:seed` first.
 */

import "dotenv/config";

if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  AppointmentError,
  cancelAppointment,
  createBooking,
  getAppointmentByPublicId,
  getAvailability,
  updateAppointment,
} from "@/lib/server/appointments";
import { getPrisma } from "@/lib/server/db";
import { hashPassword } from "@/lib/server/auth";
import { clinicDateKey, weekdayOfDateKey, zonedTimeToUtc } from "@/lib/server/schedule";

const prisma = getPrisma();
const tz = "Asia/Kolkata";

/** Real staff id — audit-log writes require an existing Staff row. */
let staffId = "integration-test-staff";

/** Skips the whole suite when no database is configured. */
const describeDb = prisma ? describe : describe.skip;

function dateKeyAhead(days: number): string {
  return clinicDateKey(new Date(Date.now() + days * 86_400_000), tz);
}

function nextWeekdayKey(target: number): string {
  for (let i = 1; i <= 14; i += 1) {
    const key = dateKeyAhead(i);
    if (weekdayOfDateKey(key) === target) return key;
  }
  throw new Error("could not find a matching weekday in the next two weeks");
}

function isoAt(dateKey: string, minutes: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, minutes, tz).toISOString();
}

let bookingSeq = 0;
function bookingAt(dateKey: string, minutes: number, overrides: Record<string, unknown> = {}) {
  bookingSeq += 1;
  return {
    patient: {
      fullName: `Integration Patient ${bookingSeq}`,
      phone: `980000${String(10000 + bookingSeq).slice(-5)}`,
      email: "",
    },
    serviceSlug: "general-dentistry", // 30 min (provisional)
    startsAt: isoAt(dateKey, minutes),
    ...overrides,
  };
}

async function expectError(promise: Promise<unknown>, code: string): Promise<AppointmentError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppointmentError);
    const appointmentError = error as AppointmentError;
    expect(appointmentError.code).toBe(code);
    return appointmentError;
  }
  throw new Error(`expected ${code} but the call succeeded`);
}

describeDb("appointment booking (real PostgreSQL)", () => {
  const monday = nextWeekdayKey(1);
  const saturday = nextWeekdayKey(6);
  const sunday = nextWeekdayKey(0);

  beforeAll(async () => {
    if (!prisma) return;
    const config = await prisma.clinicConfig.findUnique({
      where: { id: "singleton" },
      include: { hours: true },
    });
    if (!config || config.hours.length === 0) {
      throw new Error("Database is not seeded — run: npx prisma migrate deploy && npm run db:seed");
    }
    // Disposable-test-DB assumption: wipe booking data (keep config).
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.staff.deleteMany({});

    // Real staff row so audit-log FKs succeed (offline-style creation).
    const staff = await prisma.staff.create({
      data: {
        email: `booking-test-${Date.now()}@example.test`,
        fullName: "Booking Test",
        passwordHash: await hashPassword("integration-test-pw-123"),
        role: "ADMIN",
        active: true,
      },
    });
    staffId = staff.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.appointment.deleteMany({});
    await prisma.patient.deleteMany({});
    await prisma.auditLog.deleteMany({});
    await prisma.staff.deleteMany({});
  });

  /* ---------------- Availability rules ---------------- */

  it("returns 18 bookable slots on an empty Monday (30-min service)", async () => {
    const payload = await getAvailability({ date: monday, serviceSlug: "general-dentistry" });
    expect(payload.closed).toBe(false);
    expect(payload.slots).toHaveLength(18);
    expect(payload.slots.every((slot) => slot.available)).toBe(true);
    expect(payload.slots[0]?.label).toBe("9:00 AM");
    // No slot starts during the 1:00–4:00 PM lunch break:
    const labels = payload.slots.map((slot) => slot.label);
    expect(labels).not.toContain("1:00 PM");
    expect(labels).not.toContain("1:30 PM");
    expect(labels).not.toContain("3:30 PM");
    expect(labels).toContain("4:00 PM");
  });

  it("is available on Saturday", async () => {
    const payload = await getAvailability({ date: saturday, serviceSlug: "general-dentistry" });
    expect(payload.closed).toBe(false);
    expect(payload.slots.filter((slot) => slot.available).length).toBeGreaterThanOrEqual(16);
  });

  it("Sunday is closed with zero slots", async () => {
    const payload = await getAvailability({ date: sunday, serviceSlug: "general-dentistry" });
    expect(payload.closed).toBe(true);
    expect(payload.slots).toEqual([]);
  });

  it("rejects an unknown or inactive treatment", async () => {
    await expectError(
      getAvailability({ date: monday, serviceSlug: "does-not-exist" }),
      "VALIDATION_ERROR",
    );
    await expectError(
      getAvailability({ date: monday, serviceSlug: "DROP TABLE" }),
      "VALIDATION_ERROR",
    );
  });

  it("rejects malformed dates", async () => {
    await expectError(getAvailability({ date: "2026-99-99", serviceSlug: "general-dentistry" }), "VALIDATION_ERROR");
    await expectError(getAvailability({ date: "someday", serviceSlug: "general-dentistry" }), "VALIDATION_ERROR");
  });

  /* ---------------- Booking ---------------- */

  it("creates a PENDING booking (manual-approval policy) with a public-safe id", async () => {
    const appointment = await createBooking(bookingAt(monday, 9 * 60));
    expect(appointment.status).toBe("PENDING"); // never auto-confirmed
    expect(appointment.publicId).toMatch(/^apt_[0-9a-f]{16}$/);
    expect(appointment.startsAt).toBe(isoAt(monday, 9 * 60));
    expect(appointment.endsAt).toBe(isoAt(monday, 9 * 60 + 30));
    expect(appointment.patient).toBeUndefined(); // public response has no PII

    // The slot is now taken in availability:
    const payload = await getAvailability({ date: monday, serviceSlug: "general-dentistry" });
    const nineAm = payload.slots.find((slot) => slot.label === "9:00 AM");
    expect(nineAm?.available).toBe(false);
  });

  it("rejects a duplicate booking of the same slot (409 semantics)", async () => {
    await createBooking(bookingAt(monday, 10 * 60));
    await expectError(createBooking(bookingAt(monday, 10 * 60)), "CONFLICT");
  });

  it("allows back-to-back bookings (end == next start)", async () => {
    const a = await createBooking(bookingAt(monday, 11 * 60)); // 11:00–11:30
    expect(a.status).toBe("PENDING");
    const b = await createBooking(bookingAt(monday, 11 * 60 + 30)); // 11:30–12:00
    expect(b.status).toBe("PENDING");
  });

  it("rejects partially overlapping bookings (misaligned start)", async () => {
    await createBooking(bookingAt(monday, 12 * 60)); // 12:00–12:30
    await expectError(createBooking(bookingAt(monday, 12 * 60 + 15)), "CONFLICT");
  });

  it("rejects Sunday bookings", async () => {
    const error = await expectError(createBooking(bookingAt(sunday, 10 * 60)), "VALIDATION_ERROR");
    expect(error.message).toMatch(/closed/i);
  });

  it("rejects past appointment times", async () => {
    // Find a Monday that already passed this week… simplest: 30 days ago.
    const past = dateKeyAhead(-30);
    if (weekdayOfDateKey(past) === 0) return; // Sunday — covered elsewhere
    await expectError(createBooking(bookingAt(past, 10 * 60)), "VALIDATION_ERROR");
  });

  it("rejects a start that would overlap the lunch break", async () => {
    // 45-min service (dental-cleaning): 12:30 start runs into 1:00 PM.
    const error = await expectError(
      createBooking(bookingAt(monday, 12 * 60 + 30, { serviceSlug: "dental-cleaning" })),
      "VALIDATION_ERROR",
    );
    expect(error.message).toMatch(/lunch/i);
  });

  it("rejects a start that would run past closing time", async () => {
    // 60-min service (root-canal-treatment): 8:30 PM start ends 9:30 PM.
    const error = await expectError(
      createBooking(bookingAt(monday, 20 * 60 + 30, { serviceSlug: "root-canal-treatment" })),
      "VALIDATION_ERROR",
    );
    expect(error.message).toMatch(/closing/i);
  });

  it("accepts an appointment ending exactly at closing time", async () => {
    // 30-min service at 8:30 PM ends exactly at 9:00 PM — allowed.
    const appointment = await createBooking(bookingAt(monday, 20 * 60 + 30));
    expect(appointment.endsAt).toBe(isoAt(monday, 21 * 60));
  });

  it("frees the slot when an appointment is cancelled", async () => {
    const appointment = await createBooking(bookingAt(saturday, 9 * 60));
    const cancelled = await cancelAppointment(appointment.publicId, "Patient rescheduled", staffId);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.cancellationReason).toBe("Patient rescheduled");

    // Slot is bookable again:
    const payload = await getAvailability({ date: saturday, serviceSlug: "general-dentistry" });
    const nineAm = payload.slots.find((slot) => slot.label === "9:00 AM");
    expect(nineAm?.available).toBe(true);

    // And a different patient can book it:
    const rebooked = await createBooking(bookingAt(saturday, 9 * 60));
    expect(rebooked.status).toBe("PENDING");
  });

  it("treats pending and confirmed bookings as slot-reserving", async () => {
    // 8:00 PM (16:00+ are the only valid evening starts after lunch).
    const first = await createBooking(bookingAt(saturday, 20 * 60));
    await updateAppointment(first.publicId, { status: "CONFIRMED", staffId: staffId });
    // Confirmed still blocks:
    await expectError(createBooking(bookingAt(saturday, 20 * 60)), "CONFLICT");
    // Pending blocks too — cancel → free:
    const pending = await createBooking(bookingAt(saturday, 20 * 60 + 30));
    expect(pending.status).toBe("PENDING");
    await expectError(createBooking(bookingAt(saturday, 20 * 60 + 30)), "CONFLICT");
  });

  /* ---------------- Concurrency ---------------- */

  it("allows exactly one of two simultaneous bookings for the same slot", async () => {
    const startsAt = isoAt(nextWeekdayKey(2), 9 * 60); // a Tuesday, untouched so far
    const make = (label: string) => ({
      patient: { fullName: `Race ${label}`, phone: `970000${label}`, email: "" },
      serviceSlug: "general-dentistry",
      startsAt,
    });

    const results = await Promise.allSettled([createBooking(make("A")), createBooking(make("B"))]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = (rejected[0] as PromiseRejectedResult).reason as AppointmentError;
    expect(error).toBeInstanceOf(AppointmentError);
    expect(error.code).toBe("CONFLICT");
  });

  it("holds up under five simultaneous requests (exactly one wins)", async () => {
    const startsAt = isoAt(nextWeekdayKey(3), 10 * 60);
    const make = (i: number) => ({
      patient: { fullName: `Burst ${i}`, phone: `97111111${i}`, email: "" },
      serviceSlug: "general-dentistry",
      startsAt,
    });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => createBooking(make(i))),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const rejection of rejected) {
      expect((rejection.reason as AppointmentError).code).toBe("CONFLICT");
    }
  });

  /* ---------------- Status lifecycle ---------------- */

  it("enforces the status transition table", async () => {
    const appointment = await createBooking(bookingAt(saturday, 16 * 60));

    // PENDING → CONFIRMED → COMPLETED is allowed:
    const confirmed = await updateAppointment(appointment.publicId, {
      status: "CONFIRMED",
      staffId: staffId,
    });
    expect(confirmed.status).toBe("CONFIRMED");
    const completed = await updateAppointment(appointment.publicId, {
      status: "COMPLETED",
      staffId: staffId,
    });
    expect(completed.status).toBe("COMPLETED");

    // Terminal states cannot move:
    await expectError(
      updateAppointment(appointment.publicId, { status: "CONFIRMED", staffId: staffId }),
      "CONFLICT",
    );
    await expectError(
      updateAppointment(appointment.publicId, { status: "CANCELLED", staffId: staffId }),
      "CONFLICT",
    );
  });

  it("rejects skipping PENDING → COMPLETED and double-cancel", async () => {
    const appointment = await createBooking(bookingAt(saturday, 17 * 60));
    await expectError(
      updateAppointment(appointment.publicId, { status: "COMPLETED", staffId: staffId }),
      "CONFLICT",
    );
    const cancelled = await cancelAppointment(appointment.publicId, undefined, staffId);
    expect(cancelled.status).toBe("CANCELLED");
    await expectError(cancelAppointment(appointment.publicId, undefined, staffId), "CONFLICT");
  });

  /* ---------------- Reschedule ---------------- */

  it("reschedules into a free slot and rejects overlapping targets", async () => {
    const target = nextWeekdayKey(4); // Thursday
    const a = await createBooking(bookingAt(target, 9 * 60));
    const b = await createBooking(bookingAt(target, 10 * 60));

    // Move A onto B's slot → conflict:
    await expectError(
      updateAppointment(a.publicId, { startsAt: isoAt(target, 10 * 60), staffId: staffId }),
      "CONFLICT",
    );

    // Move A into free space → ok:
    const moved = await updateAppointment(a.publicId, {
      startsAt: isoAt(target, 11 * 60),
      staffId: staffId,
    });
    expect(moved.startsAt).toBe(isoAt(target, 11 * 60));
    expect(moved.endsAt).toBe(isoAt(target, 11 * 60 + 30));
    expect(b.status).toBe("PENDING");
  });

  it("refuses to reschedule terminal appointments", async () => {
    const appointment = await createBooking(bookingAt(saturday, 18 * 60));
    await cancelAppointment(appointment.publicId, "n/a", staffId);
    await expectError(
      updateAppointment(appointment.publicId, { startsAt: isoAt(saturday, 19 * 60), staffId: staffId }),
      "CONFLICT",
    );
  });

  /* ---------------- Lookups ---------------- */

  it("returns full staff view including patient contact", async () => {
    const created = await createBooking(bookingAt(saturday, 19 * 60));
    const found = await getAppointmentByPublicId(created.publicId);
    expect(found.patient).toBeDefined();
    expect(found.patient?.phone).toMatch(/^\d{7,15}$/);
    expect(found.service.slug).toBe("general-dentistry");
    expect(found.doctor.slug).toBe("dr-nidhi-paliwal");
  });

  it("404s on malformed and unknown public ids", async () => {
    await expectError(getAppointmentByPublicId("1"), "NOT_FOUND");
    await expectError(getAppointmentByPublicId("apt_notarealidatall0"), "NOT_FOUND");
    await expectError(getAppointmentByPublicId("'; DROP TABLE Appointment;--"), "NOT_FOUND");
  });

  /* ---------------- Patient identity ---------------- */

  it("reuses a patient only on exact name + phone match", async () => {
    const friday = nextWeekdayKey(5);

    const first = await createBooking(bookingAt(friday, 9 * 60, {
      patient: { fullName: "Shared Number", phone: "9812345678", email: "" },
    }));
    const second = await createBooking(bookingAt(friday, 10 * 60, {
      patient: { fullName: "Shared Number", phone: "9812345678", email: "" },
    }));
    const third = await createBooking(bookingAt(friday, 11 * 60, {
      patient: { fullName: "Different Person", phone: "9812345678", email: "" },
    }));

    const patientA = (await getAppointmentByPublicId(first.publicId)).patient;
    const patientB = (await getAppointmentByPublicId(second.publicId)).patient;
    const patientC = (await getAppointmentByPublicId(third.publicId)).patient;

    expect(patientA?.fullName).toBe(patientB?.fullName); // same person → same row
    // Same phone but different name must NOT merge:
    expect(patientC?.fullName).toBe("Different Person");
    const rows = await prisma!.patient.count({ where: { phone: "9812345678" } });
    expect(rows).toBe(2);
  });

  it("writes audit entries for creates and status changes", async () => {
    const creates = await prisma!.auditLog.count({ where: { action: "appointment.create" } });
    const confirms = await prisma!.auditLog.count({ where: { action: "appointment.confirmed" } });
    expect(creates).toBeGreaterThan(0);
    expect(confirms).toBeGreaterThan(0);
  });

  /* ---------------- Timestamp storage integrity ---------------- */

  it("stores the exact UTC instant PostgreSQL itself renders (regression: session-timezone shift)", async () => {
    // `@prisma/adapter-pg` serializes DateTime as a NAIVE UTC string, which
    // PostgreSQL parses in the session timezone. If a connection ever runs
    // outside UTC (our dev database defaults to Asia/Calcutta), the instant is
    // silently stored 5.5 h early — invisible to Prisma-only assertions,
    // because the shifted value round-trips. This test asks PostgreSQL to
    // render the stored instant in UTC (text — no client-side Date parsing),
    // so it fails on any session-timezone or serialization drift.
    const target = nextWeekdayKey(3);
    const startIso = isoAt(target, 9 * 60); // 09:00 Asia/Kolkata as a UTC instant

    const pad = (n: number) => String(n).padStart(2, "0");
    const utcText = (d: Date) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;

    const appointment = await createBooking(bookingAt(target, 9 * 60));
    try {
      const rows = await prisma!.$queryRaw<
        Array<{ starts_at: string; ends_at: string }>
      >`SELECT to_char("startsAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS starts_at,
                to_char("endsAt"   AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS ends_at
         FROM "Appointment" WHERE "publicId" = ${appointment.publicId}`;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.starts_at).toBe(utcText(new Date(startIso)));
      // 30-min provisional service ends exactly half an hour later.
      expect(rows[0]!.ends_at).toBe(utcText(new Date(new Date(startIso).getTime() + 30 * 60_000)));

      // Prisma's own read must agree with what PostgreSQL stored.
      const viaPrisma = await prisma!.appointment.findUniqueOrThrow({
        where: { publicId: appointment.publicId },
      });
      expect(viaPrisma.startsAt.getTime()).toBe(new Date(startIso).getTime());
    } finally {
      const row = await prisma!.appointment.findUnique({
        where: { publicId: appointment.publicId },
        select: { id: true, patientId: true },
      });
      if (row) {
        await prisma!.appointment.delete({ where: { id: row.id } });
        await prisma!.patient.deleteMany({ where: { id: row.patientId } });
      }
    }
  });
});

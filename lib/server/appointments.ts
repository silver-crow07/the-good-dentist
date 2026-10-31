/**
 * Appointment domain service — availability, booking, staff operations.
 *
 * All schedule rules come from the database (ClinicConfig/ClinicHour) and are
 * evaluated by the pure engine in `lib/server/schedule.ts`. This module owns
 * persistence and concurrency safety:
 *
 *  Double-booking prevention (in depth):
 *   1. Inside the booking transaction, a per-doctor Postgres advisory lock
 *      (`pg_advisory_xact_lock`) serialises concurrent bookings for the same
 *      doctor, then the overlap is re-checked against the database before
 *      inserting — the authoritative check.
 *   2. The `Appointment_noDoctorOverlap` exclusion constraint (migration
 *      SQL) is the database-level backstop for races across app instances;
 *      its violation maps to HTTP 409.
 *
 * Status lifecycle (see VALID_TRANSITIONS):
 *   PENDING    → CONFIRMED | CANCELLED
 *   CONFIRMED  → CANCELLED | COMPLETED | NO_SHOW
 *   CANCELLED / COMPLETED / NO_SHOW → terminal
 *
 * Slot-reserving statuses: PENDING and CONFIRMED. Cancellation always frees
 * the slot. New website bookings are PENDING unless the clinic turns on the
 * AUTO_CONFIRM booking policy (client has not approved auto-confirm yet).
 */

import { randomBytes } from "node:crypto";

import type { ApiErrorCode } from "./api";
import { getPrisma, type PrismaTx } from "./db";
import {
  buildDaySlots,
  clinicDateKey,
  isValidStart,
  parseDateKey,
  weekdayOfDateKey,
  wallClockParts,
  type ScheduleConfig,
  type WeekdayHours,
} from "./schedule";
import type { CreateAppointmentInput } from "./validation";

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/** Domain error carrying a safe, user-facing message + API error code. */
export class AppointmentError extends Error {
  readonly code: ApiErrorCode;
  readonly fields?: Record<string, string>;

  constructor(code: ApiErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "AppointmentError";
    this.code = code;
    this.fields = fields;
  }
}

const DB_UNAVAILABLE_MESSAGE =
  "Online booking is temporarily unavailable. Please try again shortly or book via WhatsApp.";

/** Max horizon for a new booking — keeps garbage dates out of the database. */
export const MAX_BOOKING_DAYS_AHEAD = 60;

/* ------------------------------------------------------------------ *
 * Types returned by this module
 * ------------------------------------------------------------------ */

export type PublicSlot = {
  /** ISO instant the appointment would start (unambiguous, has offset). */
  start: string;
  /** Display label, e.g. "9:00 AM". */
  label: string;
  available: boolean;
};

export type AvailabilityPayload = {
  date: string;
  timezone: string;
  /** True when the clinic does not open on this date at all. */
  closed: boolean;
  service: {
    slug: string;
    name: string;
    durationMinutes: number;
    durationIsProvisional: boolean;
  };
  doctor: { slug: string; name: string };
  slots: PublicSlot[];
};

export type PublicAppointment = {
  publicId: string;
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  startsAt: string;
  endsAt: string;
  source: "WEBSITE" | "WHATSAPP" | "STAFF";
  patientNotes: string | null;
  cancellationReason: string | null;
  createdAt: string;
  service: { slug: string; name: string };
  doctor: { slug: string; name: string };
  /** Staff-only field — never included in public API responses. */
  patient?: {
    fullName: string;
    phone: string;
    email: string | null;
  };
};

/* ------------------------------------------------------------------ *
 * Status lifecycle
 * ------------------------------------------------------------------ */

export const VALID_TRANSITIONS: Record<PublicAppointment["status"], PublicAppointment["status"][]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "COMPLETED", "NO_SHOW"],
  CANCELLED: [],
  COMPLETED: [],
  NO_SHOW: [],
};

/** Statuses that reserve a slot (mirrors the SQL exclusion constraint). */
export const SLOT_RESERVING_STATUSES = ["PENDING", "CONFIRMED"] as const;

/* ------------------------------------------------------------------ *
 * Internal helpers
 * ------------------------------------------------------------------ */

function requirePrisma() {
  const prisma = getPrisma();
  if (!prisma) throw new AppointmentError("SERVICE_UNAVAILABLE", DB_UNAVAILABLE_MESSAGE);
  return prisma;
}

async function loadScheduleConfig(tx: PrismaTx): Promise<ScheduleConfig> {
  const config = await tx.clinicConfig.findUnique({
    where: { id: "singleton" },
    include: { hours: true },
  });
  if (!config) {
    throw new AppointmentError(
      "SERVICE_UNAVAILABLE",
      "The clinic schedule is not configured yet. Please book via WhatsApp.",
    );
  }
  return {
    timezone: config.timezone,
    slotIntervalMinutes: config.slotIntervalMinutes,
    hours: config.hours.map((hour) => ({
      weekday: hour.weekday,
      closed: hour.closed,
      opensAtMinutes: hour.opensAtMinutes,
      closesAtMinutes: hour.closesAtMinutes,
      breakStartMinutes: hour.breakStartMinutes,
      breakEndMinutes: hour.breakEndMinutes,
    })),
  };
}

type BookingPolicy = "MANUAL_APPROVAL" | "AUTO_CONFIRM";

async function loadBookingPolicy(tx: PrismaTx): Promise<BookingPolicy> {
  const config = await tx.clinicConfig.findUnique({
    where: { id: "singleton" },
    select: { bookingPolicy: true },
  });
  return (config?.bookingPolicy ?? "MANUAL_APPROVAL") as BookingPolicy;
}

async function resolveActiveDoctor(tx: PrismaTx, slug?: string) {
  const doctor = slug
    ? await tx.doctor.findFirst({ where: { slug, active: true } })
    : await tx.doctor.findFirst({ where: { active: true }, orderBy: { sortOrder: "asc" } });

  if (!doctor) {
    throw new AppointmentError(
      "VALIDATION_ERROR",
      slug
        ? "That clinician is not available for booking."
        : "No clinician is currently configured for online booking. Please book via WhatsApp.",
      slug ? { doctorSlug: "Unknown or inactive clinician." } : undefined,
    );
  }
  return doctor;
}

async function resolveActiveService(tx: PrismaTx, slug: string) {
  const service = await tx.service.findUnique({ where: { slug } });
  if (!service || !service.active) {
    throw new AppointmentError("VALIDATION_ERROR", "Please choose a valid treatment.", {
      serviceSlug: "Unknown or inactive treatment.",
    });
  }
  return service;
}

/** Busy (slot-reserving) intervals of one doctor overlapping a clinic day. */
async function loadBusyIntervals(
  tx: PrismaTx,
  doctorId: string,
  dayStartUtc: Date,
  dayEndUtc: Date,
) {
  const rows = await tx.appointment.findMany({
    where: {
      doctorId,
      status: { in: [...SLOT_RESERVING_STATUSES] },
      startsAt: { lt: dayEndUtc },
      endsAt: { gt: dayStartUtc },
    },
    select: { startsAt: true, endsAt: true },
  });
  return rows;
}

/**
 * Validates wall-clock rules for a requested start instant. Throws
 * AppointmentError with user-friendly messages when the request is invalid.
 */
function validateStartInstant(
  schedule: ScheduleConfig,
  startsAt: Date,
  durationMinutes: number,
  now: Date,
): void {
  const { year, month, day, weekday, minutesOfDay } = wallClockParts(
    startsAt,
    schedule.timezone,
  );

  const hours: WeekdayHours | undefined = schedule.hours.find(
    (entry) => entry.weekday === weekday,
  );
  if (!hours || hours.closed) {
    throw new AppointmentError(
      "VALIDATION_ERROR",
      "The clinic is closed on this date — please choose another day.",
      { startsAt: "The clinic is closed on this date." },
    );
  }

  if (minutesOfDay < hours.opensAtMinutes) {
    throw new AppointmentError(
      "VALIDATION_ERROR",
      "That time is before the clinic opens.",
      { startsAt: "Choose a time during clinic hours." },
    );
  }

  if (!isValidStart(schedule, weekday, minutesOfDay, durationMinutes)) {
    // Distinguish the two common causes for clearer messages.
    const endMinutes = minutesOfDay + durationMinutes;
    const overlapsLunch =
      hours.breakStartMinutes !== null &&
      hours.breakEndMinutes !== null &&
      minutesOfDay < hours.breakEndMinutes &&
      hours.breakStartMinutes < endMinutes;
    throw new AppointmentError(
      "VALIDATION_ERROR",
      overlapsLunch
        ? "That treatment would run into the 1:00 PM–4:00 PM lunch break — please choose another time."
        : "That treatment would run past the clinic's closing time — please choose another time.",
      { startsAt: "Treatment does not fit within clinic hours." },
    );
  }

  if (startsAt.getTime() <= now.getTime()) {
    throw new AppointmentError("VALIDATION_ERROR", "That time has already passed. Please choose a future slot.", {
      startsAt: "Choose a future time.",
    });
  }

  // Horizon guard (uses the calendar date, not instants).
  const todayKey = clinicDateKey(now, schedule.timezone);
  const today = parseDateKey(todayKey);
  if (today) {
    const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
    const requestedUtc = Date.UTC(year, month - 1, day);
    const daysAhead = Math.round((requestedUtc - todayUtc) / 86_400_000);
    if (daysAhead > MAX_BOOKING_DAYS_AHEAD) {
      throw new AppointmentError(
        "VALIDATION_ERROR",
        `Appointments can be requested up to ${MAX_BOOKING_DAYS_AHEAD} days ahead.`,
        { startsAt: "Date too far in the future." },
      );
    }
  }
}

/** Public-safe appointment id: `apt_` + 16 hex chars (72+ bits of entropy). */
function newPublicId(): string {
  return `apt_${randomBytes(8).toString("hex")}`;
}

export const PUBLIC_ID_PATTERN = /^apt_[0-9a-f]{16}$/;

/** Advisory-lock key — serialises bookings per doctor. */
function doctorLockKey(doctorId: string): string {
  return `appointment:doctor:${doctorId}`;
}

/**
 * Detects the `Appointment_noDoctorOverlap` exclusion violation (and Prisma's
 * wrapping of it) so it can map to HTTP 409.
 */
function isOverlapConstraintError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string; meta?: { constraint?: string } };
  if (!candidate) return false;
  if (candidate.code === "23P01") return true; // exclusion_violation
  if (candidate.meta?.constraint === "Appointment_noDoctorOverlap") return true;
  return typeof candidate.message === "string" && candidate.message.includes("Appointment_noDoctorOverlap");
}

const CONFLICT_MESSAGE =
  "That time was just taken by another booking. Please choose a different slot.";

async function writeAuditLog(
  tx: PrismaTx,
  entry: {
    staffId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, string | number | boolean>;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      staffId: entry.staffId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      // Never put patient PII in audit metadata.
      metadata: entry.metadata,
    },
  });
}

/* ------------------------------------------------------------------ *
 * Public API — availability
 * ------------------------------------------------------------------ */

export async function getAvailability(input: {
  date: string;
  serviceSlug: string;
  now?: Date;
}): Promise<AvailabilityPayload> {
  const prisma = requirePrisma();
  const now = input.now ?? new Date();

  if (!parseDateKey(input.date)) {
    throw new AppointmentError("VALIDATION_ERROR", "Please choose a valid date.", {
      date: "Invalid date.",
    });
  }

  const service = await resolveActiveService(prisma, input.serviceSlug);
  const doctor = await resolveActiveDoctor(prisma);
  const schedule = await loadScheduleConfig(prisma);

  const parsed = parseDateKey(input.date)!;
  const dayStartUtc = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  // The day's busy window in UTC covers any instant of the clinic day
  // (timezone shift is at most ±14h; widen the window accordingly).
  const dayEndUtc = new Date(dayStartUtc.getTime() + 48 * 60 * 60 * 1000);
  const earlyStart = new Date(dayStartUtc.getTime() - 24 * 60 * 60 * 1000);

  const busy = await loadBusyIntervals(prisma, doctor.id, earlyStart, dayEndUtc);
  const computed = buildDaySlots(schedule, input.date, service.durationMinutes, busy, now);
  const weekday = weekdayOfDateKey(input.date);
  const hours = schedule.hours.find((entry) => entry.weekday === weekday);
  const closed = !hours || hours.closed;

  return {
    date: input.date,
    timezone: schedule.timezone,
    closed,
    service: {
      slug: service.slug,
      name: service.name,
      durationMinutes: service.durationMinutes,
      durationIsProvisional: service.durationIsProvisional,
    },
    doctor: { slug: doctor.slug, name: doctor.name },
    slots: computed.map((slot) => ({
      start: slot.startsAt.toISOString(),
      label: slot.label,
      available: slot.available,
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Public API — booking
 * ------------------------------------------------------------------ */

export async function createBooking(
  input: CreateAppointmentInput,
  options: { now?: Date; source?: "WEBSITE" | "WHATSAPP" | "STAFF" } = {},
): Promise<PublicAppointment> {
  const prisma = requirePrisma();
  const now = options.now ?? new Date();
  const startsAt = new Date(input.startsAt);

  // Pre-transaction validation (rules independent of concurrent writes).
  const service = await resolveActiveService(prisma, input.serviceSlug);
  const doctor = await resolveActiveDoctor(prisma, input.doctorSlug);
  const schedule = await loadScheduleConfig(prisma);
  validateStartInstant(schedule, startsAt, service.durationMinutes, now);

  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // 1) Serialise concurrent bookings for this doctor. ($executeRaw —
      //    pg_advisory_xact_lock returns void, which $queryRaw cannot
      //    deserialize through the driver adapter.)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${doctorLockKey(doctor.id)}, 0))`;

      // 2) Authoritative overlap re-check inside the lock.
      const clash = await tx.appointment.findFirst({
        where: {
          doctorId: doctor.id,
          status: { in: [...SLOT_RESERVING_STATUSES] },
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { publicId: true },
      });
      if (clash) throw new AppointmentError("CONFLICT", CONFLICT_MESSAGE);

      // 3) Patient: reuse ONLY on exact name+phone match — never phone alone
      //    (two different people may share a number). No public search path.
      const normalizedName = input.patient.fullName.trim().replace(/\s+/g, " ");
      const existingPatient = await tx.patient.findFirst({
        where: {
          phone: input.patient.phone,
          fullName: { equals: normalizedName, mode: "insensitive" },
        },
      });
      const patient =
        existingPatient ??
        (await tx.patient.create({
          data: {
            fullName: normalizedName,
            phone: input.patient.phone,
            email: input.patient.email,
          },
        }));

      // 4) Status per booking policy — default PENDING (manual approval).
      const policy = await loadBookingPolicy(tx);
      const status = policy === "AUTO_CONFIRM" ? "CONFIRMED" : "PENDING";

      const appointment = await tx.appointment.create({
        data: {
          publicId: newPublicId(),
          patientId: patient.id,
          doctorId: doctor.id,
          serviceId: service.id,
          startsAt,
          endsAt,
          status,
          source: options.source ?? "WEBSITE",
          patientNotes: input.patientNotes,
        },
      });

      await writeAuditLog(tx, {
        action: "appointment.create",
        entityType: "appointment",
        entityId: appointment.publicId,
        metadata: { source: appointment.source, status: appointment.status },
      });

      return appointment;
    });

    return toPublicAppointment(prisma, created.id, { includePatient: false });
  } catch (error) {
    if (error instanceof AppointmentError) throw error;
    // Database-level backstop (races across app instances).
    if (isOverlapConstraintError(error)) {
      throw new AppointmentError("CONFLICT", CONFLICT_MESSAGE);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ *
 * Staff API
 * ------------------------------------------------------------------ */

async function toPublicAppointment(
  tx: PrismaTx,
  appointmentId: string,
  options: { includePatient: boolean },
): Promise<PublicAppointment> {
  const row = await tx.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: {
      service: { select: { slug: true, name: true } },
      doctor: { select: { slug: true, name: true } },
      ...(options.includePatient
        ? { patient: { select: { fullName: true, phone: true, email: true } } }
        : {}),
    },
  });

  return {
    publicId: row.publicId,
    status: row.status as PublicAppointment["status"],
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    source: row.source as PublicAppointment["source"],
    patientNotes: row.patientNotes,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    service: row.service,
    doctor: row.doctor,
    ...(options.includePatient && "patient" in row ? { patient: row.patient } : {}),
  };
}

/** Staff lookup by public id — validates format to avoid junk lookups. */
export async function getAppointmentByPublicId(
  publicId: string,
): Promise<PublicAppointment> {
  const prisma = requirePrisma();
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    throw new AppointmentError("NOT_FOUND", "Appointment not found.");
  }
  const row = await prisma.appointment.findUnique({
    where: { publicId },
    select: { id: true },
  });
  if (!row) throw new AppointmentError("NOT_FOUND", "Appointment not found.");
  return toPublicAppointment(prisma, row.id, { includePatient: true });
}

export type StaffUpdate = {
  status?: PublicAppointment["status"];
  cancellationReason?: string;
  startsAt?: string;
  staffId: string;
};

export async function updateAppointment(
  publicId: string,
  update: StaffUpdate,
  options: { now?: Date } = {},
): Promise<PublicAppointment> {
  const prisma = requirePrisma();
  const now = options.now ?? new Date();

  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    throw new AppointmentError("NOT_FOUND", "Appointment not found.");
  }
  const existing = await prisma.appointment.findUnique({
    where: { publicId },
    include: { service: { select: { durationMinutes: true } } },
  });
  if (!existing) throw new AppointmentError("NOT_FOUND", "Appointment not found.");

  const currentStatus = existing.status as PublicAppointment["status"];

  // --- Status transition validation --------------------------------
  if (update.status) {
    if (update.status === currentStatus) {
      throw new AppointmentError(
        "CONFLICT",
        `The appointment is already ${currentStatus.toLowerCase()}.`,
      );
    }
    const allowed = VALID_TRANSITIONS[currentStatus];
    if (!allowed.includes(update.status)) {
      throw new AppointmentError(
        "CONFLICT",
        `An appointment that is ${currentStatus.toLowerCase()} cannot become ${update.status.toLowerCase()}.`,
        { status: "Invalid status change." },
      );
    }
  }

  // --- Reschedule validation ---------------------------------------
  let newStart: Date | null = null;
  let newEnd: Date | null = null;
  if (update.startsAt) {
    if (currentStatus === "CANCELLED" || currentStatus === "COMPLETED" || currentStatus === "NO_SHOW") {
      throw new AppointmentError(
        "CONFLICT",
        "A cancelled or finished appointment cannot be rescheduled — create a new booking instead.",
      );
    }
    newStart = new Date(update.startsAt);
    const schedule = await loadScheduleConfig(prisma);
    validateStartInstant(schedule, newStart, existing.service.durationMinutes, now);
    newEnd = new Date(newStart.getTime() + existing.service.durationMinutes * 60_000);
  }

  const targetStatus = update.status ?? currentStatus;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${doctorLockKey(existing.doctorId)}, 0))`;

      // Reschedule must not overlap other ACTIVE appointments (exclude self).
      if (newStart && newEnd) {
        const clash = await tx.appointment.findFirst({
          where: {
            doctorId: existing.doctorId,
            id: { not: existing.id },
            status: { in: [...SLOT_RESERVING_STATUSES] },
            startsAt: { lt: newEnd },
            endsAt: { gt: newStart },
          },
          select: { publicId: true },
        });
        if (clash) {
          throw new AppointmentError("CONFLICT", "That time overlaps another booking — choose a different slot.");
        }
      }

      await tx.appointment.update({
        where: { id: existing.id },
        data: {
          ...(update.status ? { status: update.status } : {}),
          ...(update.status === "CANCELLED" && update.cancellationReason !== undefined
            ? { cancellationReason: update.cancellationReason }
            : {}),
          ...(newStart && newEnd ? { startsAt: newStart, endsAt: newEnd } : {}),
        },
      });

      await writeAuditLog(tx, {
        staffId: update.staffId,
        action: newStart && newEnd ? "appointment.reschedule" : `appointment.${targetStatus.toLowerCase()}`,
        entityType: "appointment",
        entityId: publicId,
        metadata: {
          from: currentStatus,
          to: targetStatus,
          ...(newStart ? { startsAt: newStart.toISOString() } : {}),
        },
      });
    });
  } catch (error) {
    if (error instanceof AppointmentError) throw error;
    if (isOverlapConstraintError(error)) {
      throw new AppointmentError("CONFLICT", "That time overlaps another booking — choose a different slot.");
    }
    throw error;
  }

  return toPublicAppointment(prisma, existing.id, { includePatient: true });
}

/** Staff convenience wrapper: cancel with an optional reason + audit. */
export async function cancelAppointment(
  publicId: string,
  reason: string | undefined,
  staffId: string,
): Promise<PublicAppointment> {
  return updateAppointment(
    publicId,
    { status: "CANCELLED", cancellationReason: reason, staffId },
  );
}

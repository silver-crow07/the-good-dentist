/**
 * Admin dashboard aggregates — read-only queries for GET /api/admin/stats.
 *
 * Design rules:
 *  - Read-only: this module never writes (mutations go through the audited
 *    domain services, e.g. updateAppointment in lib/server/appointments.ts).
 *  - "Today" and the 7-day window are computed in the CLINIC timezone from
 *    ClinicConfig — never the server's local clock.
 *  - Only the minimum patient fields needed to manage appointments leave the
 *    server (name + phone for the upcoming list; no email, no notes).
 *  - Returns `null` when no database is configured (route maps that to 503),
 *    mirroring the booking API's behaviour instead of faking data.
 */

import type { ApiErrorCode } from "../api";
import { getPrisma } from "../db";
import { SLOT_RESERVING_STATUSES } from "../appointments";
import { clinicDateKey, parseDateKey, zonedTimeToUtc } from "../schedule";

/** Safe, user-facing error carrying the API error code (like AppointmentError). */
export class AdminError extends Error {
  readonly code: ApiErrorCode;
  readonly fields?: Record<string, string>;

  constructor(code: ApiErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "AdminError";
    this.code = code;
    this.fields = fields;
  }
}

export type AppointmentStatusKey =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "COMPLETED"
  | "NO_SHOW";

export type StatusCounts = Record<AppointmentStatusKey, number>;

export type UpcomingAppointment = {
  publicId: string;
  startsAt: string;
  status: AppointmentStatusKey;
  service: string;
  doctor: string;
  patient: { fullName: string; phone: string };
};

export type ActivityEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  staffName: string | null;
  createdAt: string;
};

export type AdminStats = {
  /** Clinic IANA timezone — all client-side date formatting uses this. */
  timezone: string;
  generatedAt: string;
  totals: { appointments: number; patients: number };
  /** Appointments starting today (clinic-local), by status. */
  today: { date: string; total: number } & StatusCounts;
  /** All-time counts by status. */
  byStatus: StatusCounts;
  /** Slot-reserving appointments starting per clinic day, today + 6 days. */
  week: Array<{ date: string; count: number }>;
  upcoming: UpcomingAppointment[];
  recentActivity: ActivityEntry[];
};

const EMPTY_STATUS: StatusCounts = {
  PENDING: 0,
  CONFIRMED: 0,
  CANCELLED: 0,
  COMPLETED: 0,
  NO_SHOW: 0,
};

const UPCOMING_TAKE = 8;
const ACTIVITY_TAKE = 8;
const WEEK_DAYS = 7;

/** Builds the zeroed status map from a Prisma groupBy result. */
function countsFromGroup(
  rows: Array<{ status: AppointmentStatusKey; _count: { _all: number } }>,
): StatusCounts {
  const counts: StatusCounts = { ...EMPTY_STATUS };
  for (const row of rows) counts[row.status] = row._count._all;
  return counts;
}

/**
 * Dashboard aggregates for the signed-in staff member.
 *
 * @returns `null` when the database is not configured; throws AdminError when
 *          the database exists but the clinic schedule has not been seeded.
 */
export async function getAdminStats(): Promise<AdminStats | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const config = await prisma.clinicConfig.findUnique({
    where: { id: "singleton" },
    select: { timezone: true },
  });
  if (!config) {
    throw new AdminError(
      "SERVICE_UNAVAILABLE",
      "The clinic schedule is not configured yet.",
    );
  }
  const tz = config.timezone;

  const now = new Date();
  const todayKey = clinicDateKey(now, tz);
  const parsed = parseDateKey(todayKey);
  if (!parsed) {
    // clinicDateKey always emits a valid key — this is a defensive guard.
    throw new AdminError("INTERNAL", "Could not compute the clinic date.");
  }

  const { year, month, day } = parsed;
  const todayStart = zonedTimeToUtc(year, month, day, 0, tz);
  const tomorrowStart = zonedTimeToUtc(year, month, day + 1, 0, tz);
  const dayBounds = Array.from({ length: WEEK_DAYS }, (_, i) => ({
    start: zonedTimeToUtc(year, month, day + i, 0, tz),
    end: zonedTimeToUtc(year, month, day + i + 1, 0, tz),
  }));

  const [
    totalAppointments,
    totalPatients,
    todayGroup,
    statusGroup,
    upcoming,
    recentActivity,
    weekCounts,
  ] = await Promise.all([
    prisma.appointment.count(),
    prisma.patient.count(),
    prisma.appointment.groupBy({
      by: ["status"],
      where: { startsAt: { gte: todayStart, lt: tomorrowStart } },
      _count: { _all: true },
    }),
    prisma.appointment.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    prisma.appointment.findMany({
      where: {
        startsAt: { gte: now },
        status: { in: [...SLOT_RESERVING_STATUSES] },
      },
      orderBy: { startsAt: "asc" },
      take: UPCOMING_TAKE,
      select: {
        publicId: true,
        startsAt: true,
        status: true,
        service: { select: { name: true } },
        doctor: { select: { name: true } },
        patient: { select: { fullName: true, phone: true } },
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: ACTIVITY_TAKE,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
        staff: { select: { fullName: true } },
      },
    }),
    Promise.all(
      dayBounds.map((bound) =>
        prisma.appointment.count({
          where: {
            startsAt: { gte: bound.start, lt: bound.end },
            status: { in: [...SLOT_RESERVING_STATUSES] },
          },
        }),
      ),
    ),
  ]);

  const todayCounts = countsFromGroup(todayGroup);
  const todayTotal = Object.values(todayCounts).reduce((sum, n) => sum + n, 0);

  return {
    timezone: tz,
    generatedAt: now.toISOString(),
    totals: { appointments: totalAppointments, patients: totalPatients },
    today: { date: todayKey, total: todayTotal, ...todayCounts },
    byStatus: countsFromGroup(statusGroup),
    week: dayBounds.map((bound, i) => ({
      date: clinicDateKey(bound.start, tz),
      count: weekCounts[i],
    })),
    upcoming: upcoming.map((row) => ({
      publicId: row.publicId,
      startsAt: row.startsAt.toISOString(),
      status: row.status as AppointmentStatusKey,
      service: row.service.name,
      doctor: row.doctor.name,
      patient: { fullName: row.patient.fullName, phone: row.patient.phone },
    })),
    recentActivity: recentActivity.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      staffName: row.staff?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

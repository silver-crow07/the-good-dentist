/**
 * Admin appointment list — read-only queries for GET /api/admin/appointments.
 *
 * Design rules (mirrors dashboard.ts):
 *  - Read-only: mutations go through updateAppointment / cancelAppointment in
 *    lib/server/appointments.ts (per-doctor advisory lock + exclusion
 *    constraint, audit-logged). This module never writes.
 *  - Date bounds are CLINIC-local (ClinicConfig.timezone) converted to UTC
 *    instants by lib/server/schedule.ts — never the server clock.
 *  - `q` only ever matches patient name / phone digits / public id; no other
 *    patient fields are searchable and nothing is logged.
 *  - Returns `null` when no database is configured (route maps that to 503),
 *    mirroring the rest of the admin API instead of faking data.
 */

import type { Prisma } from "@/generated/prisma/client";

import { PUBLIC_ID_PATTERN } from "../appointments";
import { getPrisma } from "../db";
import { clinicDateKey, parseDateKey, zonedTimeToUtc } from "../schedule";
import type { AdminAppointmentsQuery } from "../validation";
import { AdminError, type AppointmentStatusKey } from "./dashboard";

// Re-exported so route handlers can narrow with `instanceof AdminError`
// while importing everything list-related from this module.
export { AdminError };

export type AdminAppointmentListItem = {
  publicId: string;
  status: AppointmentStatusKey;
  startsAt: string;
  endsAt: string;
  source: "WEBSITE" | "WHATSAPP" | "STAFF";
  patientNotes: string | null;
  cancellationReason: string | null;
  createdAt: string;
  service: { slug: string; name: string };
  doctor: { slug: string; name: string };
  patient: { fullName: string; phone: string; email: string | null };
};

export type AdminAppointmentsPage = {
  appointments: AdminAppointmentListItem[];
  /** List mode only — null when a date range was requested. */
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  } | null;
  /** Range mode only — null when paginating. */
  range: { from: string; to: string; truncated: boolean } | null;
};

const DEFAULT_PAGE_SIZE = 20;
/** Safety net for calendar ranges (a month never comes close). */
const RANGE_LIMIT = 400;

const ITEM_SELECT = {
  publicId: true,
  status: true,
  startsAt: true,
  endsAt: true,
  source: true,
  patientNotes: true,
  cancellationReason: true,
  createdAt: true,
  service: { select: { slug: true, name: true } },
  doctor: { select: { slug: true, name: true } },
  patient: { select: { fullName: true, phone: true, email: true } },
} satisfies Prisma.AppointmentSelect;

type ItemRow = {
  publicId: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  source: string;
  patientNotes: string | null;
  cancellationReason: string | null;
  createdAt: Date;
  service: { slug: string; name: string };
  doctor: { slug: string; name: string };
  patient: { fullName: string; phone: string; email: string | null };
};

function toItem(row: ItemRow): AdminAppointmentListItem {
  return {
    publicId: row.publicId,
    status: row.status as AppointmentStatusKey,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    source: row.source as AdminAppointmentListItem["source"],
    patientNotes: row.patientNotes,
    cancellationReason: row.cancellationReason,
    createdAt: row.createdAt.toISOString(),
    service: row.service,
    doctor: row.doctor,
    patient: row.patient,
  };
}

/** Clinic-local `YYYY-MM-DD` → UTC instant of its 00:00. */
function dayStartUtc(dateKey: string, timezone: string): Date {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    throw new AdminError("VALIDATION_ERROR", "Please choose a valid date.", {
      date: "Invalid date.",
    });
  }
  return zonedTimeToUtc(parsed.year, parsed.month, parsed.day, 0, timezone);
}

/** Search predicate: patient name (insensitive), phone digits, public id. */
function searchWhere(term: string): Prisma.AppointmentWhereInput[] {
  const clauses: Prisma.AppointmentWhereInput[] = [
    { patient: { fullName: { contains: term, mode: "insensitive" } } },
  ];
  const digits = term.replace(/\D/g, "");
  if (digits.length >= 3) clauses.push({ patient: { phone: { contains: digits } } });
  if (PUBLIC_ID_PATTERN.test(term)) clauses.push({ publicId: term });
  return clauses;
}

/**
 * Paginated list (no date bound) or a bounded range for the calendar views.
 *
 * @returns `null` when the database is not configured; throws AdminError for
 *          invalid dates / unseeded schedule (route maps to 503/400).
 */
export async function listAdminAppointments(
  query: AdminAppointmentsQuery,
): Promise<AdminAppointmentsPage | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const config = await prisma.clinicConfig.findUnique({
    where: { id: "singleton" },
    select: { timezone: true },
  });
  if (!config) {
    throw new AdminError("SERVICE_UNAVAILABLE", "The clinic schedule is not configured yet.");
  }
  const timezone = config.timezone;

  // Mode selection:
  //  - `from`/`to` → calendar RANGE mode: every row in the window, no
  //    pagination (a lone bound is a single-day range).
  //  - `date` → single-day FILTER inside the paginated LIST mode.
  //  - neither → unbounded paginated list.
  const rangeMode = Boolean(query.from || query.to);
  let fromKey = rangeMode ? (query.from ?? query.to) : query.date;
  let toKey = rangeMode ? (query.to ?? query.from) : query.date;
  if (fromKey && !toKey) toKey = fromKey;
  if (toKey && !fromKey) fromKey = toKey;

  const search = query.q?.trim() || undefined;

  const where: Prisma.AppointmentWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.doctorSlug ? { doctor: { slug: query.doctorSlug } } : {}),
    ...(query.serviceSlug ? { service: { slug: query.serviceSlug } } : {}),
    ...(search ? { OR: searchWhere(search) } : {}),
  };

  if (fromKey && toKey) {
    const gte = dayStartUtc(fromKey, timezone);
    const toParsed = parseDateKey(toKey);
    if (!toParsed) {
      throw new AdminError("VALIDATION_ERROR", "Please choose a valid date.", {
        to: "Invalid date.",
      });
    }
    // Exclusive end = clinic-local midnight after `to` (day+1 overflow is
    // normalised by zonedTimeToUtc, e.g. Nov 32 → Dec 1).
    const lt = zonedTimeToUtc(toParsed.year, toParsed.month, toParsed.day + 1, 0, timezone);
    where.startsAt = { gte, lt };

    if (rangeMode) {
      const rows = await prisma.appointment.findMany({
        where,
        orderBy: [{ startsAt: "asc" }, { publicId: "asc" }],
        take: RANGE_LIMIT + 1,
        select: ITEM_SELECT,
      });
      const truncated = rows.length > RANGE_LIMIT;
      return {
        appointments: rows.slice(0, RANGE_LIMIT).map(toItem),
        pagination: null,
        range: { from: fromKey, to: toKey, truncated },
      };
    }
  }

  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  const [rows, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      orderBy: [{ startsAt: "asc" }, { publicId: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: ITEM_SELECT,
    }),
    prisma.appointment.count({ where }),
  ]);

  return {
    appointments: rows.map(toItem),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    range: null,
  };
}

export type AdminAppointmentOptions = {
  doctors: Array<{ slug: string; name: string }>;
  services: Array<{ slug: string; name: string; durationMinutes: number }>;
  /** IANA clinic timezone — all client-side date/time rendering uses this. */
  timezone: string;
  /** Clinic-local `YYYY-MM-DD` of "now" — calendar views default to it. */
  today: string;
};

/**
 * Active clinicians + treatments for the filter and reschedule pickers,
 * plus the clinic timezone/today key so views never read the browser clock
 * for clinic-local decisions.
 */
export async function getAdminAppointmentOptions(): Promise<AdminAppointmentOptions | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const config = await prisma.clinicConfig.findUnique({
    where: { id: "singleton" },
    select: { timezone: true },
  });
  if (!config) {
    throw new AdminError("SERVICE_UNAVAILABLE", "The clinic schedule is not configured yet.");
  }

  const [doctors, services] = await Promise.all([
    prisma.doctor.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { slug: true, name: true },
    }),
    prisma.service.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
      select: { slug: true, name: true, durationMinutes: true },
    }),
  ]);
  return {
    doctors,
    services,
    timezone: config.timezone,
    today: clinicDateKey(new Date(), config.timezone),
  };
}

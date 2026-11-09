/**
 * Admin settings — read-only clinic configuration for GET /api/admin/settings.
 *
 * The Settings screen is deliberately READ-ONLY in Phase B: it surfaces the
 * signed-in staff profile plus the database-owned schedule rules (clinic
 * hours, slot interval, booking policy) so staff can see exactly what the
 * booking engine enforces. Nothing here writes — changing these values is a
 * future, separately-approved feature (and the seed owns them today).
 *
 * Returns `null` when no database is configured (route maps to 503).
 */

import { getPrisma } from "../db";
import type { SessionStaff } from "../auth";
import { AdminError } from "./dashboard";

export type AdminSettingsHours = {
  /** 0 = Sunday … 6 = Saturday (clinic-local). */
  weekday: number;
  closed: boolean;
  opensAtMinutes: number;
  closesAtMinutes: number;
  breakStartMinutes: number | null;
  breakEndMinutes: number | null;
};

export type AdminSettings = {
  /** The signed-in staff member's own account (never anyone else's). */
  staff: {
    fullName: string;
    email: string;
    role: SessionStaff["role"];
    joinedAt: string;
  };
  clinic: { name: string; timezone: string };
  /** Grid step every bookable slot must land on. */
  slotIntervalMinutes: number;
  bookingPolicy: "MANUAL_APPROVAL" | "AUTO_CONFIRM";
  /** All 7 weekdays, Sunday-first, straight from ClinicHour. */
  hours: AdminSettingsHours[];
};

export async function getAdminSettings(
  session: Pick<SessionStaff, "id">,
): Promise<AdminSettings | null> {
  const prisma = getPrisma();
  if (!prisma) return null;

  const [staff, config] = await Promise.all([
    prisma.staff.findUnique({
      where: { id: session.id },
      select: {
        fullName: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.clinicConfig.findUnique({
      where: { id: "singleton" },
      include: { hours: { orderBy: { weekday: "asc" } } },
    }),
  ]);

  // The session already proved the account is active; a missing row here
  // means the account was deleted mid-session — treat as re-auth required.
  if (!staff || !staff.active) {
    throw new AdminError("UNAUTHORIZED", "Your staff account is no longer active.");
  }
  if (!config) {
    throw new AdminError("SERVICE_UNAVAILABLE", "The clinic schedule is not configured yet.");
  }

  return {
    staff: {
      fullName: staff.fullName,
      email: staff.email,
      role: staff.role as SessionStaff["role"],
      joinedAt: staff.createdAt.toISOString(),
    },
    clinic: { name: config.clinicName, timezone: config.timezone },
    slotIntervalMinutes: config.slotIntervalMinutes,
    bookingPolicy: config.bookingPolicy as AdminSettings["bookingPolicy"],
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

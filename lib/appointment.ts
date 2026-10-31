/**
 * Date/time display utilities for the appointment UI.
 *
 * Real availability now comes from the backend
 * (`GET /api/appointments/availability` via `lib/client/appointments.ts`);
 * this module only provides the presentation helpers the booking UI shares:
 *
 *   - the display-only clinic schedule (confirmed hours) used to mark closed
 *     days in the date picker — the server re-validates every rule,
 *   - date-key and label formatting shared across form components.
 *
 * Two values remain PROVISIONAL frontend data pending clinic approval:
 *   - `SLOT_INTERVAL_MINUTES` — the 30-minute interval, and
 *   - `durationMinutes` on each service (`data/services.ts`), shown as
 *     "provisional" in the UI. The database stores the same flags
 *     (`Service.durationIsProvisional`).
 */

export type AppointmentSlot = {
  time: string;
  available: boolean;
};

export type SlotStatus = "available" | "selected" | "unavailable";

/** PROVISIONAL — 30-minute interval not yet approved by the clinic. */
export const SLOT_INTERVAL_MINUTES = 30;

export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  available: "Available",
  selected: "Selected",
  unavailable: "Unavailable",
};

export type ClinicSchedule = {
  /** Opening time in 24h hours (9 = 9:00 AM). */
  startHour: number;
  /** Closing time in 24h hours (21 = 9:00 PM). */
  endHour: number;
  /** Lunch break start in 24h hours (13 = 1:00 PM) — no slots are offered. */
  breakStartHour: number;
  /** Lunch break end in 24h hours (16 = 4:00 PM) — slots resume afterwards. */
  breakEndHour: number;
  /** 0 = Sunday … 6 = Saturday */
  closedWeekdays: number[];
};

/**
 * Confirmed clinic schedule (display only — the backend reads its schedule
 * from the ClinicConfig/ClinicHour tables): Monday–Saturday 9:00 AM–9:00 PM
 * with a lunch break 1:00 PM–4:00 PM; Sunday closed.
 */
export const CLINIC_SCHEDULE: ClinicSchedule = {
  startHour: 9,
  endHour: 21,
  breakStartHour: 13,
  breakEndHour: 16,
  closedWeekdays: [0], // Sunday
};

export type BookingDate = {
  /** `YYYY-MM-DD` */
  iso: string;
  weekdayShort: string;
  weekdayLong: string;
  day: string;
  monthShort: string;
  monthLong: string;
  closed: boolean;
};

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The next `count` calendar days (starting tomorrow) with a `closed` flag so
 * the UI can show — and disable — days the clinic does not open (Sundays).
 * The server independently re-validates closed days on every request.
 */
export function getBookableDates(count = 14, from = new Date()): BookingDate[] {
  const dates: BookingDate[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  for (let offset = 1; dates.length < count && offset <= count * 2; offset += 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + offset);
    dates.push({
      iso: toDateKey(date),
      weekdayShort: date.toLocaleDateString("en-GB", { weekday: "short" }),
      weekdayLong: date.toLocaleDateString("en-GB", { weekday: "long" }),
      day: String(date.getDate()).padStart(2, "0"),
      monthShort: date.toLocaleDateString("en-GB", { month: "short" }),
      monthLong: date.toLocaleDateString("en-GB", { month: "long" }),
      closed: CLINIC_SCHEDULE.closedWeekdays.includes(date.getDay()),
    });
  }

  return dates;
}

export function formatSlotDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, (month ?? 1) - 1, day ?? 1);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatMinutesAsTime(totalMinutes: number): string {
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = ((hours24 + 11) % 12) + 1;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

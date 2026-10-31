/**
 * Server-side appointment schedule engine (pure — no database, no I/O).
 *
 * This is the single place where booking time rules live on the backend.
 * Schedule values (working days, hours, lunch break, slot interval) are
 * INPUTS — they come from the `ClinicConfig` / `ClinicHour` rows in the
 * database and are never hardcoded here. The confirmed defaults used to seed
 * the database are in `prisma/seed.ts` (Monday–Saturday 9:00–13:00 and
 * 16:00–21:00, lunch 13:00–16:00, Sunday closed, Asia/Kolkata).
 *
 * All wall-clock reasoning happens in the clinic's timezone; instants are
 * stored/transferred as UTC. Asia/Kolkata currently has no DST, but the
 * conversion helpers are offset-aware anyway so a future timezone change
 * cannot silently break booking.
 */

import { formatMinutesAsTime } from "@/lib/appointment";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

export type WeekdayHours = {
  /** 0 = Sunday … 6 = Saturday, in the clinic's timezone. */
  weekday: number;
  closed: boolean;
  /** Minutes from midnight when the clinic opens (540 = 9:00 AM). */
  opensAtMinutes: number;
  /** Minutes from midnight when the clinic closes (1260 = 9:00 PM). */
  closesAtMinutes: number;
  /** Lunch break start in minutes (780 = 1:00 PM), or null when none. */
  breakStartMinutes: number | null;
  /** Lunch break end in minutes (960 = 4:00 PM), or null when none. */
  breakEndMinutes: number | null;
};

export type ScheduleConfig = {
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone: string;
  /** PROVISIONAL — 30-minute interval not yet approved by the clinic. */
  slotIntervalMinutes: number;
  hours: WeekdayHours[];
};

/** A busy (already booked) interval as UTC instants. */
export type BusyInterval = {
  startsAt: Date;
  endsAt: Date;
};

export type ComputedSlot = {
  /** Minutes from midnight in the clinic's timezone. */
  startMinutes: number;
  /** Exact UTC instant the appointment would start. */
  startsAt: Date;
  /** Exact UTC instant the appointment would end. */
  endsAt: Date;
  /** Display label, e.g. "9:00 AM" — identical to the frontend format. */
  label: string;
  available: boolean;
};

/* ------------------------------------------------------------------ *
 * Timezone helpers
 * ------------------------------------------------------------------ */

type WallClockParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  /** Minutes since midnight in the target timezone. */
  minutesOfDay: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getPartsFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = partsFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    partsFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of an instant, as seen in `timezone`. */
export function wallClockParts(instant: Date, timezone: string): WallClockParts {
  const parts = getPartsFormatter(timezone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const hour = Number(read("hour"));
  const minute = Number(read("minute"));

  return {
    year: Number(read("year")),
    month: Number(read("month")),
    day: Number(read("day")),
    weekday: WEEKDAY_INDEX[read("weekday")] ?? 0,
    // `hour12: false` can render midnight as "24" in some engines.
    minutesOfDay: (hour % 24) * 60 + minute,
  };
}

/** Offset (ms) of `timezone` from UTC at the given instant. */
function timezoneOffsetMs(instantMs: number, timezone: string): number {
  const parts = getPartsFormatter(timezone).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
  );
  return asUtc - instantMs;
}

/**
 * The UTC instant of a wall-clock time (`YYYY-MM-DD` + minutes since
 * midnight) in `timezone`. Two-pass offset resolution so DST transitions
 * (if the timezone ever observes them) resolve correctly.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
  timezone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesOfDay * 60_000;
  const firstGuess = naiveUtc - timezoneOffsetMs(naiveUtc, timezone);
  return new Date(naiveUtc - timezoneOffsetMs(firstGuess, timezone));
}

/** `YYYY-MM-DD` key of an instant in `timezone`. */
export function clinicDateKey(instant: Date, timezone: string): string {
  const parts = wallClockParts(instant, timezone);
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${parts.year}-${month}-${day}`;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Validates `YYYY-MM-DD` and returns its numeric parts, or null. */
export function parseDateKey(dateKey: string): {
  year: number;
  month: number;
  day: number;
} | null {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible calendar dates (e.g. 2026-02-30).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/**
 * Weekday (0 = Sunday) of a `YYYY-MM-DD` calendar date — computed on the
 * calendar date itself, not via a timezone (a date key IS clinic-local).
 */
export function weekdayOfDateKey(dateKey: string): number | null {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  return new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day),
  ).getUTCDay();
}

/* ------------------------------------------------------------------ *
 * Schedule rules
 * ------------------------------------------------------------------ */

export function getHoursForWeekday(
  schedule: ScheduleConfig,
  weekday: number,
): WeekdayHours | undefined {
  return schedule.hours.find((entry) => entry.weekday === weekday);
}

/**
 * Candidate start times (minutes from midnight) for a weekday, stepping by
 * the configured interval across the morning and evening sessions. Starts
 * inside the lunch break are never generated.
 */
export function candidateStartMinutes(
  schedule: ScheduleConfig,
  weekday: number,
): number[] {
  const hours = getHoursForWeekday(schedule, weekday);
  if (!hours || hours.closed) return [];

  const interval = schedule.slotIntervalMinutes;
  const starts: number[] = [];

  const morningEnd = hours.breakStartMinutes ?? hours.closesAtMinutes;
  for (let minutes = hours.opensAtMinutes; minutes < morningEnd; minutes += interval) {
    starts.push(minutes);
  }

  if (hours.breakStartMinutes !== null && hours.breakEndMinutes !== null) {
    for (
      let minutes = hours.breakEndMinutes;
      minutes < hours.closesAtMinutes;
      minutes += interval
    ) {
      starts.push(minutes);
    }
  }

  return starts;
}

/**
 * True when a treatment of `durationMinutes` starting at `startMinutes` fits
 * the working day: it starts within opening hours, does not overlap the
 * lunch break, and does not extend past closing time.
 */
export function isValidStart(
  schedule: ScheduleConfig,
  weekday: number,
  startMinutes: number,
  durationMinutes: number,
): boolean {
  const hours = getHoursForWeekday(schedule, weekday);
  if (!hours || hours.closed) return false;
  if (startMinutes < hours.opensAtMinutes) return false;

  const endMinutes = startMinutes + durationMinutes;
  if (endMinutes > hours.closesAtMinutes) return false;

  if (
    hours.breakStartMinutes !== null &&
    hours.breakEndMinutes !== null &&
    startMinutes < hours.breakEndMinutes &&
    hours.breakStartMinutes < endMinutes
  ) {
    return false; // overlaps the lunch break
  }

  return true;
}

/** True when [aStart, aEnd) and [bStart, bEnd) share any time. */
function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * The day's slots for a treatment duration, each marked available or not.
 *
 * A slot is unavailable when the treatment would not fit the day, when it
 * overlaps an existing (busy) appointment, or when it has already passed
 * (`now`).
 */
export function buildDaySlots(
  schedule: ScheduleConfig,
  dateKey: string,
  durationMinutes: number,
  busy: BusyInterval[],
  now: Date,
): ComputedSlot[] {
  const timezone = schedule.timezone;
  const weekday = weekdayOfDateKey(dateKey);
  if (weekday === null) return [];

  const parsed = parseDateKey(dateKey);
  if (!parsed) return [];

  // Busy intervals as [startMinutes, endMinutes) relative to this clinic day.
  const busyRanges = busy
    .map((interval) => ({
      start: minutesRelativeToDay(interval.startsAt, parsed, timezone),
      end: minutesRelativeToDay(interval.endsAt, parsed, timezone),
    }))
    .filter((range) => range.end > 0 && range.start < 24 * 60);

  return candidateStartMinutes(schedule, weekday).map((startMinutes) => {
    const startsAt = zonedTimeToUtc(
      parsed.year,
      parsed.month,
      parsed.day,
      startMinutes,
      timezone,
    );
    const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);

    const fitsDay = isValidStart(schedule, weekday, startMinutes, durationMinutes);
    const clash = busyRanges.some((range) =>
      overlaps(startMinutes, startMinutes + durationMinutes, range.start, range.end),
    );
    const past = startsAt.getTime() <= now.getTime();

    return {
      startMinutes,
      startsAt,
      endsAt,
      label: formatMinutesAsTime(startMinutes),
      available: fitsDay && !clash && !past,
    };
  });
}

/** An instant expressed as minutes since midnight of the given clinic day. */
function minutesRelativeToDay(
  instant: Date,
  day: { year: number; month: number; day: number },
  timezone: string,
): number {
  const dayStartUtc = zonedTimeToUtc(day.year, day.month, day.day, 0, timezone);
  return Math.round((instant.getTime() - dayStartUtc.getTime()) / 60_000);
}

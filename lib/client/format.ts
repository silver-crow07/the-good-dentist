/**
 * Browser-side formatting helpers shared by admin views.
 *
 * All clinic-time formatting goes through `timezone` (IANA name from the
 * server's ClinicConfig) so the panel always shows the clinic's clock, not
 * the browser's. Pure functions — safe for unit tests.
 */

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${timezone}|${JSON.stringify(options)}`;
  let formatter = cache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-IN", { timeZone: timezone, ...options });
    cache.set(key, formatter);
  }
  return formatter;
}

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const timeCache = new Map<string, Intl.DateTimeFormat>();

/** "Tue, 3 Nov · 9:00 AM" in the clinic timezone. */
export function formatClinicDateTime(iso: string, timezone: string): string {
  const date = cachedFormatter(dateTimeCache, timezone, {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
  const time = formatClinicTime(iso, timezone);
  return `${date} · ${time}`;
}

/** "9:00 AM" in the clinic timezone. */
export function formatClinicTime(iso: string, timezone: string): string {
  return cachedFormatter(timeCache, timezone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

/** "just now" / "12m ago" / "3h ago" / "2d ago" / localized date. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  const diffMs = Math.max(0, now - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Weekday short label ("Sun"…"Sat") for a `YYYY-MM-DD` clinic-local key. */
export function weekdayShortOfDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return "";
  return WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** 0 → "Sunday" … 6 → "Saturday" (ClinicHour.weekday convention). */
export function weekdayLongName(weekday: number): string {
  return WEEKDAYS_LONG[weekday] ?? "";
}

/** Minutes-from-midnight → "9:00 AM" (clinic-local, 24h clock input). */
export function formatMinutesOfDay(minutes: number): string {
  const normalized = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${hour24 < 12 ? "AM" : "PM"}`;
}

function partsOfKey(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

/** "Tuesday, 3 November 2026" for a clinic-local `YYYY-MM-DD` key. */
export function formatDateKeyLong(dateKey: string): string {
  const { year, month, day } = partsOfKey(dateKey);
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * "2 – 8 Nov 2026" (same month) or "30 Nov – 6 Dec 2026" (crossing months)
 * for a week header built from two clinic-local keys.
 */
export function formatWeekRangeLabel(fromKey: string, toKey: string): string {
  const from = partsOfKey(fromKey);
  const to = partsOfKey(toKey);
  if (!from.year || !from.month || !from.day || !to.year || !to.month || !to.day) {
    return `${fromKey} – ${toKey}`;
  }
  const yearLabel = new Intl.DateTimeFormat("en-IN", {
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(to.year, to.month - 1, to.day)));
  const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });
  const fromMonth = monthFmt.format(new Date(Date.UTC(from.year, from.month - 1, from.day)));
  const toMonth = monthFmt.format(new Date(Date.UTC(to.year, to.month - 1, to.day)));

  if (from.month === to.month && from.year === to.year) {
    return `${from.day} – ${to.day} ${toMonth} ${yearLabel}`;
  }
  return `${from.day} ${fromMonth} – ${to.day} ${toMonth} ${yearLabel}`;
}

/** "2026-11-03" → "Tue, 3 Nov" (clinic-local date key, no timezone needed). */
export function formatClinicDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** ISO instant → "3 Nov 2026" rendered in the CLINIC timezone. */
export function formatClinicDate(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(iso));
}

/**
 * Audit action → human sentence. Unknown actions degrade to a readable
 * fallback rather than leaking raw identifiers to the UI.
 */
export function formatActivityAction(action: string): string {
  const known: Record<string, string> = {
    "staff.login": "Staff member signed in",
    "staff.logout": "Staff member signed out",
    "appointment.create": "New appointment request received",
    "appointment.confirm": "Appointment confirmed",
    "appointment.confirmed": "Appointment confirmed",
    "appointment.cancel": "Appointment cancelled",
    "appointment.cancelled": "Appointment cancelled",
    "appointment.completed": "Appointment marked completed",
    "appointment.no_show": "Appointment marked as no-show",
    "appointment.reschedule": "Appointment rescheduled",
    "patient.create": "Patient registered",
    "patient.update": "Patient details updated",
    "note.create": "Clinical note added",
    "dentalrecord.create": "Dental record created",
    "dentalrecord.update": "Dental record updated",
    "dentalrecord.delete": "Dental record deleted",
    "dentalfile.upload": "Dental image uploaded",
    "dentalfile.download": "Dental image downloaded",
    "dentalfile.delete": "Dental image deleted",
    "dentalfile.rejected": "Dental image rejected (failed verification)",
    "dentalfile.orphan_already_absent": "Orphan scan: object already gone",
    "dentalfile.orphan_row_backed": "Orphan scan: object protected by its record",
    "inventory.create": "Inventory item added",
    "inventory.update": "Inventory item updated",
    "inventory.delete": "Inventory item removed",
    "inventory.stock_in": "Stock added",
    "inventory.stock_out": "Stock removed",
  };
  const mapped = known[action];
  if (mapped) return mapped;
  // Fallback: "some.action_name" → "Some action name"
  return action
    .split(".")
    .join(" ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Initials for the avatar chip ("Dr. Nidhi Paliwal" → "NP"). */
export function initialsOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

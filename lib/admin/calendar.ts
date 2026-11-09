/**
 * Pure clinic-local date-key (YYYY-MM-DD) arithmetic for the admin calendar.
 *
 * All math happens on the UTC midnight of the key — no timezone rules and
 * no clock reads: these helpers only decide WHICH days a view displays.
 * The server decides what falls inside them (it converts keys to UTC
 * instants using ClinicConfig.timezone).
 *
 * Weeks are Monday-first — the clinic works Mon–Sat, so Sunday sits at the
 * end of the row where staff expect it.
 */

function toUtcMs(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `2026-11-03` + 5 days → `2026-11-08` (rolls across months/years). */
export function addDaysKey(dateKey: string, days: number): string {
  return fromUtcMs(toUtcMs(dateKey) + days * 86_400_000);
}

/** Monday of the week containing `dateKey`. */
export function startOfWeekKey(dateKey: string): string {
  const ms = toUtcMs(dateKey);
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return fromUtcMs(ms - sinceMonday * 86_400_000);
}

/** The 7 keys of the week starting at `weekStartKey` (Monday → Sunday). */
export function weekDayKeys(weekStartKey: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysKey(weekStartKey, index));
}

/**
 * 42 keys (6 full weeks, Monday-first) covering the grid that contains
 * `year`/`month` — leading/trailing days bleed into the neighbouring month
 * exactly like a printed calendar.
 */
export function monthGridKeys(year: number, month: number): string[] {
  const firstOfMonth = Date.UTC(year, month - 1, 1);
  const sinceMonday = (new Date(firstOfMonth).getUTCDay() + 6) % 7;
  const gridStart = firstOfMonth - sinceMonday * 86_400_000;
  return Array.from({ length: 42 }, (_, index) => fromUtcMs(gridStart + index * 86_400_000));
}

/** "November 2026" for the calendar header (UTC — keys are already local). */
export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** "Nov 2026" — compact variant for narrow layouts. */
export function monthLabelShort(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/** Split `2026-11-03` → `{ year: 2026, month: 11, day: 3 }`. */
export function partsOfDateKey(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

/** First day of the month containing `dateKey`. */
export function firstOfMonthKey(dateKey: string): string {
  const { year, month } = partsOfDateKey(dateKey);
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

/** Move `dateKey` by whole months, clamping the day into the target month. */
export function shiftMonthKey(dateKey: string, delta: number): string {
  const { year, month, day } = partsOfDateKey(dateKey);
  const target = new Date(Date.UTC(year, month - 1 + delta, 1));
  const daysInTarget = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const clamped = Math.min(day, daysInTarget);
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

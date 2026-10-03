/**
 * Appointment availability — FRONTEND MOCK ONLY.
 *
 * The structure mirrors what a future backend will return so the UI can be
 * swapped to real data without redesign:
 *
 *   - One slot = one appointment (booking a time blocks it for everyone else).
 *   - Treatment duration consumes the slots it overlaps (e.g. a 60-minute
 *     treatment occupies two 30-minute slots).
 *
 * Replace `getSlotsForDate()` with an API call in a later phase.
 */

export type AppointmentSlot = {
  time: string;
  available: boolean;
};

export type SlotStatus = "available" | "selected" | "unavailable";

export const SLOT_INTERVAL_MINUTES = 30;

export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  available: "Available",
  selected: "Selected",
  unavailable: "Unavailable",
};

export type ClinicSchedule = {
  startHour: number;
  endHour: number;
  /** 0 = Sunday … 6 = Saturday */
  closedWeekdays: number[];
};

/** Mock schedule driving the placeholder availability below. */
export const MOCK_SCHEDULE: ClinicSchedule = {
  startHour: 9,
  endHour: 18,
  closedWeekdays: [0],
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
 * the UI can show — and disable — days the clinic does not open.
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
      closed: MOCK_SCHEDULE.closedWeekdays.includes(date.getDay()),
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

/** Deterministic 32-bit hash so the same date always renders the same mock day. */
function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic mock availability for a given date + treatment duration.
 *
 * - Generates the day's slots from the mock schedule.
 * - Marks pseudo-random slots as already booked (one slot = one appointment).
 * - Reserves the remaining slots a longer treatment would occupy.
 * - Leaves at least two bookable slots so the flow can always be completed.
 */
export function getSlotsForDate(
  isoDate: string,
  durationMinutes: number,
  schedule: ClinicSchedule = MOCK_SCHEDULE,
): AppointmentSlot[] {
  const interval = SLOT_INTERVAL_MINUTES;
  const startMinutes = schedule.startHour * 60;
  const endMinutes = schedule.endHour * 60;
  const stepCount = Math.max(1, Math.ceil(durationMinutes / interval));
  const lastStart = endMinutes - durationMinutes;

  const times: number[] = [];
  for (let minutes = startMinutes; minutes < endMinutes; minutes += interval) {
    times.push(minutes);
  }

  const random = createRandom(hashSeed(isoDate));
  const blocked = new Set<number>();

  times.forEach((minutes, index) => {
    const booked = random() < 0.26;
    const tooLate = minutes > lastStart;
    if (booked || tooLate) {
      for (let offset = 0; offset < stepCount; offset += 1) {
        blocked.add(index + offset);
      }
    }
  });

  // Guarantee a usable day so the mock flow can always be completed.
  const fallbackStarts = [1, 3, 6, 8];
  let availableCount = times.filter((_, index) => !blocked.has(index)).length;
  for (const index of fallbackStarts) {
    if (availableCount >= 2) break;
    if (index < times.length && times[index] <= lastStart) {
      blocked.delete(index);
      availableCount += 1;
    }
  }

  return times.map((minutes, index) => ({
    time: formatMinutesAsTime(minutes),
    available: !blocked.has(index),
  }));
}

/** Convenience lookup used by form/summary components. */
export function isSlotAvailable(
  slots: AppointmentSlot[],
  time: string,
): boolean {
  return slots.some((slot) => slot.time === time && slot.available);
}

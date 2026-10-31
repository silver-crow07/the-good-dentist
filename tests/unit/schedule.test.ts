/**
 * Pure schedule-engine tests — no database required.
 *
 * These encode the confirmed clinic rules:
 *   Mon–Sat 9:00–13:00 and 16:00–21:00, lunch 13:00–16:00, Sunday closed,
 *   Asia/Kolkata, provisional 30-minute interval.
 */

import { describe, expect, it } from "vitest";

import {
  buildDaySlots,
  candidateStartMinutes,
  clinicDateKey,
  isValidStart,
  parseDateKey,
  weekdayOfDateKey,
  zonedTimeToUtc,
  type ScheduleConfig,
} from "@/lib/server/schedule";

/** Mirrors the seeded ClinicConfig (prisma/seed.ts) for pure tests. */
const schedule: ScheduleConfig = {
  timezone: "Asia/Kolkata",
  slotIntervalMinutes: 30,
  hours: [
    { weekday: 0, closed: true, opensAtMinutes: 0, closesAtMinutes: 0, breakStartMinutes: null, breakEndMinutes: null },
    ...[1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      closed: false,
      opensAtMinutes: 9 * 60,
      closesAtMinutes: 21 * 60,
      breakStartMinutes: 13 * 60,
      breakEndMinutes: 16 * 60,
    })),
  ],
};

const NOW = new Date("2026-11-01T00:00:00Z"); // 5:30 AM IST, Sunday

// Upcoming week (IST): Mon 2026-11-02 … Sun 2026-11-08.
const MONDAY = "2026-11-02";
const SATURDAY = "2026-11-07";
const SUNDAY = "2026-11-08";

describe("candidateStartMinutes", () => {
  it("returns 18 starts on a working day (8 morning + 10 evening)", () => {
    const starts = candidateStartMinutes(schedule, 1);
    expect(starts).toHaveLength(18);
    expect(starts[0]).toBe(9 * 60); // 9:00 AM
    expect(starts).toContain(12 * 60 + 30); // last morning start 12:30 PM
    expect(starts).not.toContain(13 * 60); // nothing during lunch
    expect(starts).not.toContain(14 * 60 + 30);
    expect(starts).toContain(16 * 60); // evening resumes 4:00 PM
    expect(starts.at(-1)).toBe(20 * 60 + 30); // last start 8:30 PM
  });

  it("returns no starts on Sunday", () => {
    expect(candidateStartMinutes(schedule, 0)).toEqual([]);
  });

  it("covers Saturday the same as Monday", () => {
    expect(candidateStartMinutes(schedule, 6)).toEqual(candidateStartMinutes(schedule, 1));
  });
});

describe("isValidStart", () => {
  it("accepts an appointment ending exactly at closing time", () => {
    expect(isValidStart(schedule, 1, 20 * 60 + 30, 30)).toBe(true); // 8:30–9:00 PM
  });

  it("rejects an appointment extending past closing time", () => {
    expect(isValidStart(schedule, 1, 20 * 60 + 45, 30)).toBe(false);
    expect(isValidStart(schedule, 1, 20 * 60 + 30, 45)).toBe(false);
  });

  it("rejects an appointment overlapping the lunch break", () => {
    expect(isValidStart(schedule, 1, 12 * 60 + 30, 60)).toBe(false); // 12:30–1:30
    expect(isValidStart(schedule, 1, 12 * 60 + 45, 30)).toBe(false); // 12:45–1:15
  });

  it("accepts an appointment ending exactly at lunch start", () => {
    expect(isValidStart(schedule, 1, 12 * 60 + 30, 30)).toBe(true); // ends 1:00 PM sharp
  });

  it("rejects starts inside the lunch break", () => {
    expect(isValidStart(schedule, 1, 13 * 60, 30)).toBe(false);
    expect(isValidStart(schedule, 1, 14 * 60 + 30, 30)).toBe(false);
  });

  it("rejects starts before opening and on Sunday", () => {
    expect(isValidStart(schedule, 1, 8 * 60 + 30, 30)).toBe(false);
    expect(isValidStart(schedule, 0, 10 * 60, 30)).toBe(false);
  });
});

describe("buildDaySlots", () => {
  it("marks all 18 slots available on an empty Monday", () => {
    const slots = buildDaySlots(schedule, MONDAY, 30, [], NOW);
    expect(slots).toHaveLength(18);
    expect(slots.every((slot) => slot.available)).toBe(true);
  });

  it("returns no slots for Sunday", () => {
    expect(buildDaySlots(schedule, SUNDAY, 30, [], NOW)).toEqual([]);
  });

  it("still lists morning starts for a 60-minute treatment but marks lunch-crossing ones unavailable", () => {
    const slots = buildDaySlots(schedule, MONDAY, 60, [], NOW);
    const byStart = new Map(slots.map((slot) => [slot.startMinutes, slot]));
    expect(byStart.get(12 * 60 + 30)?.available).toBe(false); // 12:30–1:30 crosses lunch
    expect(byStart.get(12 * 60)?.available).toBe(true); // 12:00–1:00 fits
    expect(byStart.get(20 * 60 + 30)?.available).toBe(false); // 8:30–9:30 past close
    expect(byStart.get(20 * 60)?.available).toBe(true); // 8:00–9:00 fits
  });

  it("marks slots overlapping busy intervals unavailable", () => {
    // 9:00–9:30 AM IST on Mon 2026-11-02 = 03:30–04:00 UTC.
    const busy = [
      {
        startsAt: new Date("2026-11-02T03:30:00Z"),
        endsAt: new Date("2026-11-02T04:00:00Z"),
      },
    ];
    const slots = buildDaySlots(schedule, MONDAY, 30, busy, NOW);
    const nineAm = slots.find((slot) => slot.startMinutes === 9 * 60);
    expect(nineAm?.available).toBe(false);
    expect(slots.filter((slot) => slot.available)).toHaveLength(17);
  });

  it("marks past slots unavailable and keeps later slots bookable", () => {
    // NOW = 5:30 AM IST — nothing is past yet. Use 1:00 PM IST as "now".
    const afternoonNow = new Date("2026-11-02T07:30:00Z"); // 1:00 PM IST Monday
    const slots = buildDaySlots(schedule, MONDAY, 30, [], afternoonNow);
    const morning = slots.filter((slot) => slot.startMinutes < 13 * 60);
    expect(morning.every((slot) => !slot.available)).toBe(true);
    expect(slots.filter((slot) => slot.startMinutes >= 16 * 60 && slot.available).length).toBeGreaterThan(0);
  });

  it("labels slots exactly like the website (9:00 AM, 1:00 PM, 8:30 PM)", () => {
    const slots = buildDaySlots(schedule, SATURDAY, 30, [], NOW);
    expect(slots[0]?.label).toBe("9:00 AM");
    expect(slots.at(-1)?.label).toBe("8:30 PM");
  });
});

describe("timezone helpers (Asia/Kolkata, +05:30, no DST)", () => {
  it("converts a clinic wall-clock time to the right UTC instant", () => {
    const instant = zonedTimeToUtc(2026, 11, 2, 9 * 60, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-11-02T03:30:00.000Z"); // 9:00 AM IST
  });

  it("derives the clinic-local date key from a UTC instant", () => {
    // 2026-11-01T18:30Z is exactly midnight IST on 2026-11-02.
    expect(clinicDateKey(new Date("2026-11-01T18:30:00Z"), "Asia/Kolkata")).toBe("2026-11-02");
    expect(clinicDateKey(new Date("2026-11-02T03:30:00Z"), "Asia/Kolkata")).toBe("2026-11-02");
    expect(clinicDateKey(new Date("2026-11-01T18:29:00Z"), "Asia/Kolkata")).toBe("2026-11-01");
  });

  it("computes the weekday of a date key on the calendar date", () => {
    expect(weekdayOfDateKey("2026-11-02")).toBe(1); // Monday
    expect(weekdayOfDateKey("2026-11-07")).toBe(6); // Saturday
    expect(weekdayOfDateKey("2026-11-08")).toBe(0); // Sunday
  });
});

describe("parseDateKey", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(parseDateKey("2026-11-02")).toEqual({ year: 2026, month: 11, day: 2 });
    expect(parseDateKey("2026-02-30")).toBeNull();
    expect(parseDateKey("2026-13-01")).toBeNull();
    expect(parseDateKey("02-11-2026")).toBeNull();
    expect(parseDateKey("not-a-date")).toBeNull();
  });
});

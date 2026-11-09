import { describe, expect, it } from "vitest";

import {
  addDaysKey,
  firstOfMonthKey,
  monthGridKeys,
  monthLabel,
  monthLabelShort,
  partsOfDateKey,
  shiftMonthKey,
  startOfWeekKey,
  weekDayKeys,
} from "@/lib/admin/calendar";

/**
 * Clinic-local date-key arithmetic for the calendar views. 2026-11-02 is a
 * Monday (the week these fixtures orbit).
 */

describe("addDaysKey", () => {
  it("adds days within a month and across boundaries", () => {
    expect(addDaysKey("2026-11-03", 5)).toBe("2026-11-08");
    expect(addDaysKey("2026-11-30", 3)).toBe("2026-12-03");
    expect(addDaysKey("2026-12-01", -1)).toBe("2026-11-30");
  });

  it("rolls over years and handles negative offsets", () => {
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysKey("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDaysKey("2026-11-02", 0)).toBe("2026-11-02");
  });
});

describe("startOfWeekKey / weekDayKeys", () => {
  it("returns Monday for every day of the week", () => {
    expect(startOfWeekKey("2026-11-02")).toBe("2026-11-02"); // Monday itself
    expect(startOfWeekKey("2026-11-04")).toBe("2026-11-02"); // Wednesday
    expect(startOfWeekKey("2026-11-08")).toBe("2026-11-02"); // Sunday
    expect(startOfWeekKey("2026-11-09")).toBe("2026-11-09"); // next Monday
  });

  it("produces the 7 keys Monday → Sunday", () => {
    const days = weekDayKeys("2026-11-02");
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-11-02");
    expect(days[6]).toBe("2026-11-08");
  });
});

describe("monthGridKeys", () => {
  it("always covers 42 unique days starting on a Monday", () => {
    const grid = monthGridKeys(2026, 11);
    expect(grid).toHaveLength(42);
    expect(new Set(grid).size).toBe(42);
    // 1 Nov 2026 is a Sunday → the grid starts Monday 26 Oct.
    expect(grid[0]).toBe("2026-10-26");
    expect(grid[41]).toBe("2026-12-06");
  });

  it("contains every day of the target month", () => {
    const grid = monthGridKeys(2026, 11);
    expect(grid).toContain("2026-11-01");
    expect(grid).toContain("2026-11-30");
    expect(grid.filter((key) => key.startsWith("2026-11"))).toHaveLength(30);
  });
});

describe("shiftMonthKey", () => {
  it("moves whole months while clamping the day", () => {
    expect(shiftMonthKey("2026-11-15", -1)).toBe("2026-10-15");
    expect(shiftMonthKey("2026-11-15", 1)).toBe("2026-12-15");
    expect(shiftMonthKey("2026-03-31", -1)).toBe("2026-02-28"); // 2026 not a leap year
    expect(shiftMonthKey("2026-01-31", 1)).toBe("2026-02-28");
    expect(shiftMonthKey("2026-12-01", 1)).toBe("2027-01-01");
  });
});

describe("labels and parts", () => {
  it("splits a key into numeric parts", () => {
    expect(partsOfDateKey("2026-11-03")).toEqual({ year: 2026, month: 11, day: 3 });
  });

  it("returns the first day of the key's month", () => {
    expect(firstOfMonthKey("2026-11-15")).toBe("2026-11-01");
    expect(firstOfMonthKey("2026-12-31")).toBe("2026-12-01");
  });

  it("formats month labels", () => {
    expect(monthLabel(2026, 11)).toBe("November 2026");
    expect(monthLabelShort(2026, 11)).toBe("Nov 2026");
  });
});

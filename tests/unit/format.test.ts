import { describe, expect, it } from "vitest";

import {
  formatClinicDateKey,
  formatMinutesOfDay,
  formatRelativeTime,
  formatDateKeyLong,
  formatWeekRangeLabel,
  initialsOf,
  weekdayLongName,
  weekdayShortOfDateKey,
} from "@/lib/client/format";

/**
 * Admin formatting helpers. 2026-11-02 is a Monday; 2026-11-03 a Tuesday.
 */

describe("formatMinutesOfDay", () => {
  it("renders clinic-local minutes as a 12-hour clock", () => {
    expect(formatMinutesOfDay(0)).toBe("12:00 AM");
    expect(formatMinutesOfDay(540)).toBe("9:00 AM"); // 9:00 AM open
    expect(formatMinutesOfDay(780)).toBe("1:00 PM"); // lunch start
    expect(formatMinutesOfDay(960)).toBe("4:00 PM"); // lunch end
    expect(formatMinutesOfDay(1260)).toBe("9:00 PM"); // close
    expect(formatMinutesOfDay(1439)).toBe("11:59 PM");
  });
});

describe("weekday helpers", () => {
  it("maps ClinicHour weekday numbers to names", () => {
    expect(weekdayLongName(0)).toBe("Sunday");
    expect(weekdayLongName(1)).toBe("Monday");
    expect(weekdayLongName(6)).toBe("Saturday");
    expect(weekdayLongName(7)).toBe("");
  });

  it("renders short labels from date keys", () => {
    expect(weekdayShortOfDateKey("2026-11-02")).toBe("Mon");
    expect(weekdayShortOfDateKey("2026-11-08")).toBe("Sun");
    expect(weekdayShortOfDateKey("nonsense")).toBe("");
  });
});

describe("date-key labels", () => {
  it("formats a full day label", () => {
    expect(formatDateKeyLong("2026-11-03")).toBe("Tuesday, 3 November 2026");
  });

  it("formats same-month and cross-month week ranges", () => {
    expect(formatWeekRangeLabel("2026-11-02", "2026-11-08")).toBe("2 – 8 Nov 2026");
    expect(formatWeekRangeLabel("2026-11-30", "2026-12-06")).toBe("30 Nov – 6 Dec 2026");
  });

  it("formats a clinic date key", () => {
    expect(formatClinicDateKey("2026-11-03")).toBe("Tue, 3 Nov");
    expect(formatClinicDateKey("bad")).toBe("bad");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-11-02T12:00:00Z");

  it("describes recency in plain language", () => {
    expect(formatRelativeTime("2026-11-02T11:59:30Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-02T11:58:00Z", now)).toBe("2m ago");
    expect(formatRelativeTime("2026-11-02T09:00:00Z", now)).toBe("3h ago");
    expect(formatRelativeTime("2026-10-31T12:00:00Z", now)).toBe("2d ago");
    // Older than a week falls back to an absolute date.
    expect(formatRelativeTime("2026-10-20T12:00:00Z", now)).toContain("Oct");
  });
});

describe("initialsOf", () => {
  it("builds avatar initials from a full name", () => {
    expect(initialsOf("Asha Verma")).toBe("AV");
    expect(initialsOf("Dr. Nidhi Paliwal")).toBe("DP");
    expect(initialsOf("Madonna")).toBe("MA");
    expect(initialsOf("")).toBe("?");
  });
});

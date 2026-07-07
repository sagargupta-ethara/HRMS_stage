import { describe, expect, it } from "vitest";

import {
  attendanceCurrentYear,
  attendanceRangeForShortcut,
  attendanceTodayDateInput,
  formatAttendanceDateColumn,
  formatAttendanceTime,
} from "./attendance-dates";

describe("attendance date helpers", () => {
  it("derives today from the application timezone", () => {
    const istNextDay = new Date("2026-06-06T20:00:00.000Z");

    expect(attendanceTodayDateInput(istNextDay)).toBe("2026-06-07");
  });

  it("keeps shortcut ranges aligned to the application business day", () => {
    const tuesdayInIst = new Date("2026-06-16T01:00:00.000Z");

    expect(attendanceRangeForShortcut("today", tuesdayInIst)).toEqual({
      from: "2026-06-16",
      to: "2026-06-16",
    });
    expect(attendanceRangeForShortcut("week", tuesdayInIst)).toEqual({
      from: "2026-06-15",
      to: "2026-06-16",
    });
    expect(attendanceRangeForShortcut("month", tuesdayInIst)).toEqual({
      from: "2026-06-01",
      to: "2026-06-16",
    });
  });

  it("handles month and year rollover in IST", () => {
    const newYearInIst = new Date("2026-12-31T20:00:00.000Z");

    expect(attendanceCurrentYear(newYearInIst)).toBe(2027);
    expect(attendanceRangeForShortcut("month", newYearInIst)).toEqual({
      from: "2027-01-01",
      to: "2027-01-01",
    });
  });

  it("formats date-only attendance columns without timezone shifts", () => {
    expect(formatAttendanceDateColumn("2026-06-16")).toEqual({
      day: "16",
      label: "Jun Tue",
    });
  });

  it("formats attendance times in the application timezone", () => {
    expect(formatAttendanceTime("2026-06-16T10:29:48.000Z")).toBe("15:59");
    expect(formatAttendanceTime("2026-06-16T10:29:48+05:30")).toBe("10:29");
    expect(formatAttendanceTime("2026-06-16 10:29:48")).toBe("10:29");
    expect(formatAttendanceTime(null)).toBe("-");
  });
});

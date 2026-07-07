import { APP_TIME_ZONE } from "@/lib/utils";

export type AttendanceRangeShortcut = "today" | "week" | "month";

export type AttendanceDateRange = {
  from: string;
  to: string;
};

type CalendarDateParts = {
  year: number;
  month: number;
  day: number;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateInputValue(parts: CalendarDateParts): string {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function attendanceDateParts(now: Date = new Date()): CalendarDateParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

export function attendanceTodayDateInput(now: Date = new Date()): string {
  return dateInputValue(attendanceDateParts(now));
}

export function attendanceCurrentYear(now: Date = new Date()): number {
  return attendanceDateParts(now).year;
}

export function parseAttendanceDateInput(value: string | null | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function inputValueFromDate(value: Date): string {
  return dateInputValue({
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
  });
}

export function attendanceRangeForShortcut(
  shortcut: AttendanceRangeShortcut,
  now: Date = new Date(),
): AttendanceDateRange {
  const todayParts = attendanceDateParts(now);
  const today = new Date(todayParts.year, todayParts.month - 1, todayParts.day);
  const to = inputValueFromDate(today);

  if (shortcut === "today") {
    return { from: to, to };
  }

  if (shortcut === "week") {
    const start = new Date(today);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return { from: inputValueFromDate(start), to };
  }

  return {
    from: inputValueFromDate(new Date(today.getFullYear(), today.getMonth(), 1)),
    to,
  };
}

export function formatAttendanceDateColumn(value: string): { day: string; label: string } {
  const parsed = parseAttendanceDateInput(value);
  if (!parsed) {
    return { day: value.slice(-2), label: "" };
  }
  return {
    day: pad(parsed.getDate()),
    label: parsed.toLocaleDateString("en-US", { weekday: "short", month: "short" }),
  };
}

export function formatAttendanceTime(value: string | null | undefined): string {
  if (!value) return "-";
  if (!/(?:z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
    return /T?\s*(\d{2}:\d{2})/.exec(value)?.[1] ?? "-";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return /T?(\d{2}:\d{2})/.exec(value)?.[1] ?? "-";
  }
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
    timeZone: APP_TIME_ZONE,
  }).format(parsed);
}

"use client";

import { cn } from "@/lib/utils";
import {
  attendanceRangeForShortcut,
  type AttendanceRangeShortcut,
} from "@/lib/attendance-dates";

export type RangeShortcut = AttendanceRangeShortcut;

export function rangeForShortcut(shortcut: RangeShortcut): { from: string; to: string } {
  return attendanceRangeForShortcut(shortcut);
}

export function DateRangeShortcuts({ from, to, onSelect, className }: {
  from: string;
  to: string;
  onSelect: (range: { from: string; to: string }) => void;
  className?: string;
}) {
  const options: Array<{ key: RangeShortcut; label: string }> = [
    { key: "today", label: "Today" },
    { key: "week", label: "This Week" },
    { key: "month", label: "This Month" },
  ];
  const now = new Date();
  return (
    <div
      role="group"
      aria-label="Attendance date range"
      className={cn(
        "grid h-10 w-full min-w-[15.5rem] grid-cols-3 rounded-xl border border-border bg-background/35 p-1",
        className,
      )}
    >
      {options.map((option) => {
        const range = attendanceRangeForShortcut(option.key, now);
        const active = from === range.from && to === range.to;
        return (
          <button
            key={option.key}
            type="button"
            onClick={() => onSelect(range)}
            className={cn(
              "inline-flex h-8 min-w-0 items-center justify-center rounded-lg px-2 text-xs font-medium leading-none whitespace-nowrap transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

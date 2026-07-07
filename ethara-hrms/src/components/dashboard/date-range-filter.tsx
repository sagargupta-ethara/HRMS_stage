"use client";

import { useState } from "react";
import { Calendar, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn, formatCurrentDateLabel } from "@/lib/utils";

export type DashboardDateRange = {
  from: string;
  to: string;
};

function formatRangeDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function dashboardDateRangeLabel(range: DashboardDateRange): string {
  if (!range.from && !range.to) {
    return formatCurrentDateLabel({ day: "2-digit", month: "long", year: "numeric" });
  }
  if (range.from && range.to) return `${formatRangeDate(range.from)} - ${formatRangeDate(range.to)}`;
  if (range.from) return `From ${formatRangeDate(range.from)}`;
  return `To ${formatRangeDate(range.to)}`;
}

export function dashboardDateRangeParams(range: DashboardDateRange) {
  return {
    createdFrom: range.from || undefined,
    createdTo: range.to || undefined,
  };
}

export function isWithinDashboardDateRange(
  value: string | null | undefined,
  range: DashboardDateRange,
): boolean {
  if (!value || (!range.from && !range.to)) return true;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return true;
  if (range.from && time < new Date(`${range.from}T00:00:00.000Z`).getTime()) return false;
  if (range.to && time > new Date(`${range.to}T23:59:59.999Z`).getTime()) return false;
  return true;
}

export function DashboardDateRangeFilter({
  value,
  onChange,
  className,
}: {
  value: DashboardDateRange;
  onChange: (value: DashboardDateRange) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardDateRange>(value);
  const invalidRange = Boolean(draft.from && draft.to && draft.to < draft.from);

  const openPicker = () => {
    setDraft(value);
    setOpen(true);
  };

  const applyRange = () => {
    if (invalidRange) return;
    onChange(draft);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className={cn(
          "inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          className,
        )}
        style={{
          background: "rgba(144,141,206,0.10)",
          border: "1px solid rgba(144,141,206,0.18)",
          color: "rgba(197,203,232,0.70)",
        }}
      >
        <Calendar className="h-3.5 w-3.5 text-primary" />
        <span className="truncate">{dashboardDateRangeLabel(value)}</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dashboard date range</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>From</Label>
              <DatePicker value={draft.from} onChange={(from) => setDraft((prev) => ({ ...prev, from }))} />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <DatePicker value={draft.to} onChange={(to) => setDraft((prev) => ({ ...prev, to }))} />
            </div>
          </div>
          {invalidRange && (
            <p className="text-xs text-destructive">To date must be on or after From date.</p>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="gap-1.5 rounded-xl text-xs"
              onClick={() => setDraft({ from: "", to: "" })}
            >
              <X className="h-3.5 w-3.5" />
              Clear
            </Button>
            <Button type="button" className="rounded-xl text-xs" onClick={applyRange} disabled={invalidRange}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

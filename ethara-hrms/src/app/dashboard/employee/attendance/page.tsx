"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarDays, CheckCircle2, Clock3, FileDown, Loader2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeShortcuts } from "@/components/shared/date-range-shortcuts";
import { attendanceApi, type AttendanceMatrixRow, type AttendanceStatus, type AttendanceSummary } from "@/lib/api";
import {
  attendanceTodayDateInput,
  formatAttendanceDateColumn,
  formatAttendanceTime,
} from "@/lib/attendance-dates";
import { cn, formatLabel } from "@/lib/utils";

const STATUS_VARIANT: Record<AttendanceStatus, "default" | "secondary" | "outline" | "destructive"> = {
  present: "default",
  absent: "destructive",
  half_day: "secondary",
  holiday: "outline",
  weekoff: "outline",
};

function errorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

export default function EmployeeAttendancePage() {
  const [rows, setRows] = useState<AttendanceMatrixRow[]>([]);
  const [dateColumns, setDateColumns] = useState<string[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState(() => attendanceTodayDateInput());
  const [toDate, setToDate] = useState(() => attendanceTodayDateInput());
  const [exporting, setExporting] = useState(false);
  const attendanceToday = attendanceTodayDateInput();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { from: fromDate, to: toDate };
      const [matrix, stats] = await Promise.all([
        attendanceApi.myMatrix(params),
        attendanceApi.mySummary({ from: fromDate, to: toDate }),
      ]);
      setRows(matrix.data);
      setDateColumns(matrix.dates);
      setSummary(stats);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load attendance."));
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  const exportAttendance = async () => {
    setExporting(true);
    try {
      await attendanceApi.downloadMineExport(
        { from: fromDate, to: toDate },
        `my_attendance_${fromDate}_${toDate}.csv`,
      );
      toast.success("Attendance export is ready.");
    } catch (error) {
      toast.error(errorMessage(error, "Attendance export failed."));
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const cards = [
    {
      label: "Present",
      value: summary?.present ?? 0,
      icon: CheckCircle2,
      iconClass: "text-emerald-500",
      bgClass: "bg-emerald-500/10",
    },
    {
      label: "Absent",
      value: summary?.absent ?? 0,
      icon: XCircle,
      iconClass: "text-red-500",
      bgClass: "bg-red-500/10",
    },
    {
      label: "Half Day",
      value: summary?.halfDay ?? 0,
      icon: Clock3,
      iconClass: "text-amber-500",
      bgClass: "bg-amber-500/10",
    },
    {
      label: "Total",
      value: summary?.total ?? 0,
      icon: CalendarDays,
      iconClass: "text-sky-500",
      bgClass: "bg-sky-500/10",
    },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card/70 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <Clock3 className="h-6 w-6 text-primary" />
            My Attendance
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">Attendance mapped to your employee code</p>
        </div>
        <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
          <DateRangeShortcuts
            from={fromDate}
            to={toDate}
            onSelect={({ from, to }) => {
              setFromDate(from);
              setToDate(to);
            }}
            className="lg:w-[15.5rem]"
          />
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-[minmax(0,9.5rem)_minmax(0,9.5rem)_auto] lg:w-auto">
            <DatePicker value={fromDate} onChange={setFromDate} className="h-9 rounded-lg text-xs" />
            <DatePicker value={toDate} onChange={setToDate} max={attendanceToday} className="h-9 rounded-lg text-xs" />
            <Button
              variant="outline"
              size="sm"
              className="h-9 gap-1.5 rounded-lg px-3 text-xs"
              onClick={exportAttendance}
              disabled={exporting}
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
              Export
            </Button>
          </div>
        </div>
      </div>

      <div className="grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="flex min-h-16 items-center gap-2.5 rounded-xl border border-border/70 bg-card/70 px-3 py-2.5 shadow-sm"
          >
            <span className={cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg", card.bgClass)}>
              <card.icon className={cn("h-3.5 w-3.5", card.iconClass)} />
            </span>
            <div className="min-w-0">
              <p className="text-lg font-semibold leading-none">{card.value}</p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">{card.label}</p>
            </div>
          </div>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-sm">Attendance History</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No attendance rows found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="min-w-max">
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-20 min-w-[180px] bg-card shadow-[1px_0_0_var(--border)]">
                      Employee
                    </TableHead>
                    {dateColumns.map((date) => {
                      const heading = formatAttendanceDateColumn(date);
                      return (
                        <TableHead key={date} className="min-w-[118px] text-center">
                          <span className="block text-sm font-semibold">{heading.day}</span>
                          <span className="block text-[11px] font-normal text-muted-foreground">
                            {heading.label}
                          </span>
                        </TableHead>
                      );
                    })}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={`${row.employeeProfileId || row.employeeCode}`}>
                      <TableCell className="sticky left-0 z-10 min-w-[180px] max-w-[220px] bg-card shadow-[1px_0_0_var(--border)]">
                        <p className="truncate text-sm font-medium">{row.employeeName || "My Attendance"}</p>
                        <p className="truncate text-xs text-muted-foreground">{row.employeeCode}</p>
                      </TableCell>
                      {dateColumns.map((date) => {
                        const cell = row.dates[date];
                        return (
                          <TableCell key={date} className="min-w-[118px] align-top">
                            {cell ? (
                              <div className="flex min-h-12 flex-col items-center justify-center gap-1 text-center">
                                <span className="font-mono text-sm">{formatAttendanceTime(cell.inTime)}</span>
                                <Badge
                                  variant={STATUS_VARIANT[cell.status] ?? "outline"}
                                  className="max-w-[104px] justify-center truncate text-[10px]"
                                >
                                  {formatLabel(cell.status)}
                                </Badge>
                              </div>
                            ) : (
                              <div className="flex min-h-12 items-center justify-center text-sm text-muted-foreground">
                                -
                              </div>
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Separator />
          <div className="px-4 py-3 text-sm text-muted-foreground">
            Date columns scroll horizontally for the selected range.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

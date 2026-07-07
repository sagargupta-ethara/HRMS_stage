"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileDown,
  Loader2,
  RefreshCw,
  Search,
  UploadCloud,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangeShortcuts } from "@/components/shared/date-range-shortcuts";
import { attendanceApi, type AttendanceMatrixRow, type AttendanceStatus, type AttendanceSummary } from "@/lib/api";
import {
  attendanceCurrentYear,
  attendanceTodayDateInput,
  formatAttendanceDateColumn,
  formatAttendanceTime,
} from "@/lib/attendance-dates";
import { cn, formatLabel } from "@/lib/utils";

const NONE = "__none__";
const PAGE_SIZE = 25;

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

export default function AttendanceManagementPage() {
  const [rows, setRows] = useState<AttendanceMatrixRow[]>([]);
  const [dateColumns, setDateColumns] = useState<string[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [fromDate, setFromDate] = useState(() => attendanceTodayDateInput());
  const [toDate, setToDate] = useState(() => attendanceTodayDateInput());
  const [statusFilter, setStatusFilter] = useState(NONE);
  const [department, setDepartment] = useState("");
  const [search, setSearch] = useState("");
  const [includeUnmapped, setIncludeUnmapped] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [syncDate, setSyncDate] = useState(() => attendanceTodayDateInput());
  const [syncing, setSyncing] = useState(false);
  const [syncYear, setSyncYear] = useState(() => String(attendanceCurrentYear()));
  const [syncingYear, setSyncingYear] = useState(false);
  const [exporting, setExporting] = useState(false);
  const attendanceToday = attendanceTodayDateInput();
  const attendanceYear = attendanceCurrentYear();
  const params = {
    from: fromDate,
    to: toDate,
    status: statusFilter !== NONE ? statusFilter : undefined,
    department: department.trim() || undefined,
    search: search.trim() || undefined,
    // Biometric devices send many codes that belong to no registered employee;
    // by default only show rows mapped to an employee profile.
    mapped: includeUnmapped ? undefined : true,
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [matrix, stats] = await Promise.all([
        attendanceApi.matrix({ ...params, page, limit: PAGE_SIZE }),
        attendanceApi.summary(params),
      ]);
      setRows(matrix.data);
      setDateColumns(matrix.dates);
      setTotal(matrix.total);
      setTotalPages(Math.max(1, matrix.totalPages));
      setSummary(stats);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load attendance."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, statusFilter, department, search, includeUnmapped, page]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const runSync = async () => {
    if (!syncDate) {
      toast.error("Select a sync date.");
      return;
    }
    setSyncing(true);
    try {
      const log = await attendanceApi.sync(syncDate);
      toast.success(`Synced ${log.rowsSynced} attendance rows.`);
      if (log.unmappedCount > 0) {
        toast.warning(`${log.unmappedCount} employee codes were not mapped.`);
      }
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Attendance sync failed."));
    } finally {
      setSyncing(false);
    }
  };

  const runYearSync = async () => {
    const selectedYear = Number(syncYear);
    if (!Number.isInteger(selectedYear) || selectedYear < 2000) {
      toast.error("Enter a valid attendance year.");
      return;
    }
    setSyncingYear(true);
    try {
      const result = await attendanceApi.syncYear(selectedYear);
      toast.success(`Synced ${result.days} days and ${result.rowsSynced} attendance rows.`);
      if (result.unmappedCount > 0) {
        toast.warning(`${result.unmappedCount} employee codes were not mapped.`);
      }
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Year attendance sync failed."));
    } finally {
      setSyncingYear(false);
    }
  };

  const exportAttendance = async () => {
    setExporting(true);
    try {
      await attendanceApi.downloadExport(params, `attendance_${fromDate}_${toDate}.csv`);
      toast.success("Attendance export is ready.");
    } catch (error) {
      toast.error(errorMessage(error, "Attendance export failed."));
    } finally {
      setExporting(false);
    }
  };

  const cards = [
    { label: "Present", value: summary?.present ?? 0, icon: CheckCircle2, color: "text-success" },
    { label: "Absent", value: summary?.absent ?? 0, icon: XCircle, color: "text-destructive" },
    { label: "Half Day", value: summary?.halfDay ?? 0, icon: Clock3, color: "text-warning" },
    { label: "Total Rows", value: summary?.total ?? 0, icon: CalendarDays, color: "text-info" },
  ];

  return (
    <div className="space-y-5 overflow-x-hidden">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Clock3 className="h-5 w-5 text-muted-foreground" />
            Attendance Management
          </h1>
          <p className="text-sm text-muted-foreground">
            Biometric attendance mapped by employee code
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[170px_auto_110px_auto_auto_auto]">
          <DatePicker value={syncDate} onChange={setSyncDate} max={attendanceToday} />
          <Button variant="outline" className="gap-2" onClick={runSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Sync Date
          </Button>
          <Input
            type="number"
            min={2000}
            max={attendanceYear}
            value={syncYear}
            onChange={(event) => setSyncYear(event.target.value)}
            aria-label="Attendance year"
          />
          <Button variant="outline" className="gap-2" onClick={runYearSync} disabled={syncingYear}>
            {syncingYear ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Sync Year
          </Button>
          <Button variant="outline" className="gap-2" onClick={exportAttendance} disabled={exporting}>
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
            Export
          </Button>
          <Button variant="ghost" className="gap-2" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} className="border-0 shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
              <card.icon className={cn("h-5 w-5 shrink-0", card.color)} />
              <div className="min-w-0">
                <p className="text-2xl font-semibold">{card.value}</p>
                <p className="text-xs text-muted-foreground">{card.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-sm">Employees ({total})</CardTitle>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-[150px_150px_150px_minmax(140px,180px)_minmax(190px,1fr)]">
              <DatePicker value={fromDate} onChange={(v) => { setFromDate(v); setPage(1); }} />
              <DatePicker value={toDate} onChange={(v) => { setToDate(v); setPage(1); }} />
              <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v ?? NONE); setPage(1); }}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="All statuses">
                    {(value) => value === NONE ? "All statuses" : formatLabel(String(value ?? ""))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>All statuses</SelectItem>
                  <SelectItem value="present">Present</SelectItem>
                  <SelectItem value="absent">Absent</SelectItem>
                  <SelectItem value="half_day">Half Day</SelectItem>
                  <SelectItem value="holiday">Holiday</SelectItem>
                  <SelectItem value="weekoff">Week Off</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={department}
                onChange={(e) => { setDepartment(e.target.value); setPage(1); }}
                placeholder="Department"
              />
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                  placeholder="Search name or code"
                  className="pl-9"
                />
              </div>
              <DateRangeShortcuts
                from={fromDate}
                to={toDate}
                onSelect={({ from, to }) => { setFromDate(from); setToDate(to); setPage(1); }}
                className="md:col-span-2 xl:col-span-5 xl:w-72 xl:justify-self-end"
              />
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded"
                checked={includeUnmapped}
                onChange={(e) => { setIncludeUnmapped(e.target.checked); setPage(1); }}
              />
              Include unmapped biometric codes (rows not linked to any registered employee)
            </label>
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
                    <TableHead className="sticky left-0 z-20 min-w-[220px] bg-card shadow-[1px_0_0_var(--border)]">
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
                      <TableCell className="sticky left-0 z-10 min-w-[220px] max-w-[260px] bg-card shadow-[1px_0_0_var(--border)]">
                        <p className="truncate text-sm font-medium">{row.employeeName || "-"}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.employeeCode}
                          {row.department ? ` · ${row.department}` : ""}
                        </p>
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
          <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}

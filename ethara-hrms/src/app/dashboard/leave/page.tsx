"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { formatDate, formatLabel } from "@/lib/utils";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { leaveApi, type LeaveRequest } from "@/lib/api";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  approved: "default",
  manager_approved: "secondary",
  pending: "outline",
  rejected: "destructive",
};

const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: "Casual",
  sick: "Sick",
  earned: "Earned",
  maternity: "Maternity",
  paternity: "Paternity",
  unpaid: "Unpaid",
  compensatory: "Comp Off",
};

const NONE = "__none__";
const PAGE_SIZE = 20;
const ADMIN_ACTIONABLE_STATUSES = new Set(["pending", "manager_approved"]);
const STATUS_FILTER_LABELS: Record<string, string> = {
  [NONE]: "All statuses",
  pending: "Pending Requests",
  manager_approved: "Manager Reviewed",
  approved: "Fully Approved",
  rejected: "Rejected",
};

export default function LeaveManagementPage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(NONE);
  const [page, setPage] = useState(1);
  const [actingId, setActingId] = useState<string | null>(null);

  const displayed = requests.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await leaveApi.list({ status: statusFilter !== NONE ? statusFilter : undefined });
      setRequests(data);
    } catch {
      toast.error("Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPage(1);
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const hrAction = async (leaveId: string, action: string) => {
    setActingId(leaveId);
    try {
      await leaveApi.hrAction(leaveId, action);
      toast.success(`Leave ${action}`);
      load();
    } catch {
      toast.error("Action failed");
    } finally {
      setActingId(null);
    }
  };

  const counts = {
    pending: requests.filter((r) => r.status === "pending").length,
    manager_approved: requests.filter((r) => r.status === "manager_approved").length,
    approved: requests.filter((r) => r.status === "approved").length,
  };

  return (
    <div className="space-y-5 overflow-x-hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <CalendarDays className="h-6 w-6 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Leave Management</h1>
            <p className="text-sm text-muted-foreground">
              Admin and HR can approve or reject any leave request. Tagged managers review their own team requests from the manager queue.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={load} className="w-fit gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Pending Requests", count: counts.pending, color: "text-warning" },
          { label: "Manager Reviewed", count: counts.manager_approved, color: "text-info" },
          { label: "Fully Approved", count: counts.approved, color: "text-success" },
        ].map((c) => (
          <Card key={c.label} className="border-0 shadow-sm">
            <CardContent className="pt-4">
              <p className={`text-2xl font-bold ${c.color}`}>{c.count}</p>
              <p className="text-xs text-muted-foreground mt-1">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <CardTitle className="text-sm">
              Leave Requests ({requests.length})
            </CardTitle>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? NONE)}>
              <SelectTrigger className="h-9 w-full text-xs sm:h-8 sm:w-44">
                <SelectValue placeholder="All statuses">
                  {(value) => STATUS_FILTER_LABELS[value ?? NONE] ?? "All statuses"}
                </SelectValue>
              </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE} label={STATUS_FILTER_LABELS[NONE]}>{STATUS_FILTER_LABELS[NONE]}</SelectItem>
                  <SelectItem value="pending" label={STATUS_FILTER_LABELS.pending}>{STATUS_FILTER_LABELS.pending}</SelectItem>
                  <SelectItem value="manager_approved" label={STATUS_FILTER_LABELS.manager_approved}>{STATUS_FILTER_LABELS.manager_approved}</SelectItem>
                  <SelectItem value="approved" label={STATUS_FILTER_LABELS.approved}>{STATUS_FILTER_LABELS.approved}</SelectItem>
                  <SelectItem value="rejected" label={STATUS_FILTER_LABELS.rejected}>{STATUS_FILTER_LABELS.rejected}</SelectItem>
                </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3 text-center">
              <CalendarDays className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No leave requests found</p>
            </div>
          ) : (
            <>
            <div className="space-y-3 px-4 pb-4 sm:hidden">
              {displayed.map((r) => (
                <div key={r.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium">{r.employeeName}</p>
                      <p className="break-all text-xs text-muted-foreground">{r.employeeCode}</p>
                    </div>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="shrink-0 text-xs">
                      {formatLabel(r.status)}
                    </Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Type</p>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {LEAVE_TYPE_LABELS[r.leaveType] || r.leaveType}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Days</p>
                      <p className="mt-1 text-sm font-medium">{r.days}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Dates</p>
                      <p className="mt-1">{formatDate(r.startDate)} – {formatDate(r.endDate)}</p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Manager</p>
                      <p className="mt-1 break-words">{r.managerName || "—"}</p>
                      {r.managerAction && (
                        <p className="mt-1 text-muted-foreground">{r.managerAction}</p>
                      )}
                    </div>
                  </div>

                  {ADMIN_ACTIONABLE_STATUSES.has(r.status) && (
                    <div className="mt-4 grid grid-cols-1 gap-2">
                      <Button
                        size="sm"
                        className="h-9 gap-1 text-xs"
                        disabled={actingId === r.id}
                        onClick={() => hrAction(r.id, "approved")}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-9 gap-1 text-xs"
                        disabled={actingId === r.id}
                        onClick={() => hrAction(r.id, "rejected")}
                      >
                        <XCircle className="h-3 w-3" />
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="hidden w-full overflow-x-auto sm:block">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Manager</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{r.employeeName}</p>
                      <p className="text-xs text-muted-foreground">{r.employeeCode}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">
                        {LEAVE_TYPE_LABELS[r.leaveType] || r.leaveType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {formatDate(r.startDate)} – {formatDate(r.endDate)}
                    </TableCell>
                    <TableCell className="text-sm">{r.days}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs">
                        {formatLabel(r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.managerName || "—"}
                      {r.managerAction && (
                        <p className="text-xs">{r.managerAction}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      {ADMIN_ACTIONABLE_STATUSES.has(r.status) && (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="h-7 px-2 text-xs gap-1"
                            disabled={actingId === r.id}
                            onClick={() => hrAction(r.id, "approved")}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs gap-1"
                            disabled={actingId === r.id}
                            onClick={() => hrAction(r.id, "rejected")}
                          >
                            <XCircle className="h-3 w-3" />
                            Reject
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            </>
          )}
          {totalPages > 1 && (
            <>
              <Separator />
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">Page {page} of {totalPages}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatLabel } from "@/lib/utils";
import { CalendarDays, Loader2, CheckCircle2, Clock, XCircle, AlertTriangle, Info, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { leaveApi, roleModulesApi, type GreytHRLeaveBalance, type LeaveRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useQuery } from "@tanstack/react-query";

const LEAVE_TYPE_LABELS: Record<string, string> = {
  casual: "Casual Leave",
  sick: "Sick Leave",
  earned: "Earned Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  unpaid: "Unpaid Leave",
  compensatory: "Compensatory Leave",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  approved: "default",
  manager_approved: "secondary",
  pending: "outline",
  rejected: "destructive",
  cancelled: "destructive",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending Manager",
  manager_approved: "Approved by Manager",
  approved: "Fully Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export default function EmployeeLeavePage() {
  const { user } = useAuth();
  const [balances, setBalances] = useState<GreytHRLeaveBalance[]>([]);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [leaveLoading, setLeaveLoading] = useState(true);

  const modulesQuery = useQuery({
    queryKey: ["employee-leave", "my-modules", user?.id],
    queryFn: () => roleModulesApi.myModules(),
    enabled: Boolean(user),
    staleTime: 60_000,
  });
  const moduleAccessLoaded = !user || modulesQuery.isSuccess || modulesQuery.isError;
  const enabledModules = modulesQuery.data?.enabled ?? [];
  const canReadLeave = Boolean(
    moduleAccessLoaded && user?.permissions?.includes("leave:read") && enabledModules.includes("leave"),
  );
  const leaveAccessDenied = moduleAccessLoaded && !canReadLeave;
  const loading = !moduleAccessLoaded || (canReadLeave && leaveLoading);

  const load = useCallback(async () => {
    setLeaveLoading(true);
    try {
      const [b, r] = await Promise.all([leaveApi.getGreytHRBalances(), leaveApi.myRequests()]);
      setBalances(b.balances);
      setSyncedAt(b.syncedAt);
      setRequests(r);
    } catch {
      toast.error("Failed to load leave data");
    } finally {
      setLeaveLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!moduleAccessLoaded) return undefined;
    if (!canReadLeave) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [canReadLeave, load, moduleAccessLoaded]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <CalendarDays className="h-6 w-6 text-primary" /> Leave Management
          </h1>
          <p className="text-sm text-muted-foreground">Your leave balance, synced from greytHR</p>
        </div>
        {!leaveAccessDenied && (
          <Button variant="outline" disabled className="w-full gap-2 sm:w-auto" title="Coming soon for everyone">
            <RefreshCw className="h-4 w-4" />
            Apply for Leave
            <Badge variant="secondary" className="ml-1 text-[10px]">Soon</Badge>
          </Button>
        )}
      </div>

      {leaveAccessDenied && (
        <Card className="border-dashed border-border/70 bg-muted/20 shadow-sm">
          <CardContent className="flex items-start gap-3 p-5 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p>
              Leave access is not enabled for this account. Once HR enables leave permissions, balances will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {!leaveAccessDenied && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">
            Applying for leave from here is <span className="font-medium text-foreground">coming soon</span> — it will be available
            for everyone shortly. The balances below are your live greytHR balances.
          </p>
        </div>
      )}

      {!leaveAccessDenied && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Leave Balance</h2>
            {syncedAt && (
              <span className="text-xs text-muted-foreground">Last updated {formatDate(syncedAt)}</span>
            )}
          </div>
          {balances.length === 0 ? (
            <Card className="border-dashed border-border/70 bg-muted/20 shadow-sm">
              <CardContent className="p-5 text-sm text-muted-foreground">
                Your leave balance hasn&apos;t been synced yet. It will appear here once the next greytHR sync runs.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {balances.map((b) => (
                <Card key={b.code} className="border-0 shadow-sm">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 break-words text-xs text-muted-foreground">{b.type}</p>
                      <Badge variant="outline" className="shrink-0 text-[10px]">{b.code}</Badge>
                    </div>
                    <p className="mt-1 text-2xl font-bold">{b.balance}</p>
                    <p className="text-xs text-muted-foreground">day{b.balance === 1 ? "" : "s"} available</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {!leaveAccessDenied && <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">My Leave History</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No leave requests yet</p>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <div key={r.id} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                      <p className="break-words text-sm font-medium">{LEAVE_TYPE_LABELS[r.leaveType] || formatLabel(r.leaveType)}</p>
                      <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs">
                        {STATUS_LABELS[r.status] ?? formatLabel(r.status)}
                      </Badge>
                    </div>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">
                      {formatDate(r.startDate)} – {formatDate(r.endDate)} · {r.days} day{r.days !== 1 ? "s" : ""}
                      {r.reason && ` · ${r.reason}`}
                    </p>
                  </div>
                  {r.status === "approved" && <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />}
                  {r.status === "pending" && <Clock className="h-4 w-4 text-amber-500 shrink-0" />}
                  {r.status === "rejected" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>}
    </div>
  );
}

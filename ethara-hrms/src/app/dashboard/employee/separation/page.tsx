"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Clock, Loader2, LogOut, RotateCcw, User } from "lucide-react";
import { toast } from "sonner";
import { employeesApi, separationApi, type SeparationRecord } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDate, formatLabel } from "@/lib/utils";

const statusColor: Record<string, string> = {
  pending: "border-amber-500/30 text-amber-500",
  manager_approved: "border-blue-500/30 text-blue-500",
  approved: "border-emerald-500/30 text-emerald-500",
  rejected: "border-destructive/30 text-destructive",
  on_hold: "border-muted-foreground/30 text-muted-foreground",
  cancelled: "border-muted-foreground/30 text-muted-foreground",
};

const statusLabel: Record<string, string> = {
  pending: "Pending Manager Review",
  manager_approved: "Manager Approved — Awaiting HR",
  approved: "Approved",
  rejected: "Rejected",
  on_hold: "On Hold",
  cancelled: "Revoked",
};

const REVOCABLE_RESIGNATION_STATUSES = new Set(["pending", "on_hold", "manager_approved"]);

export default function EmployeeSeparationPage() {
  const [separations, setSeparations] = useState<SeparationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [managerId, setManagerId] = useState<string | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);
  const [managerEmail, setManagerEmail] = useState<string | null>(null);

  const [remarks, setRemarks] = useState("");
  const [earlyRelieving, setEarlyRelieving] = useState(false);
  const [requestedNoticeDays, setRequestedNoticeDays] = useState("30");
  const [submitting, setSubmitting] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<SeparationRecord | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [data, dashboard] = await Promise.all([
          separationApi.mine(),
          employeesApi.getDashboard().catch(() => null),
        ]);
        setSeparations(data);
        setManagerId(dashboard?.employee.managerId ?? null);
        setManagerName(dashboard?.employee.managerName ?? null);
        setManagerEmail(dashboard?.employee.managerEmail ?? null);
      } catch {
        toast.error("Failed to load separation data.");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remarks.trim()) { toast.error("Please add your resignation remarks."); return; }
    if (!managerId) {
      toast.error("No reporting manager assigned. Please contact HR before submitting resignation.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await separationApi.resign({
        earlyRelievingRequested: earlyRelieving,
        requestedNoticeDays: earlyRelieving ? Number(requestedNoticeDays) : undefined,
        remarks: remarks.trim(),
      });
      setSeparations((prev) => [result, ...prev]);
      setShowForm(false);
      setRemarks(""); setEarlyRelieving(false); setRequestedNoticeDays("30");
      toast.success("Resignation submitted. Your reporting manager and HR have been notified.");
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to submit resignation.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (separation: SeparationRecord) => {
    setRevoking(true);
    try {
      const updated = await separationApi.revoke(separation.id, "Revoked by employee");
      setSeparations((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      toast.success("Resignation request revoked.");
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to revoke resignation.");
    } finally {
      setRevoking(false);
      setRevokeTarget(null);
    }
  };

  const activeResignation = separations.find((s) => s.separationType === "resignation" && !["rejected", "cancelled"].includes(s.status));
  const terminations = separations.filter((s) => ["termination", "no_show", "absconding"].includes(s.separationType));
  const hasManager = Boolean(managerId);

  return (
    <div className="mx-auto max-w-2xl space-y-6 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <LogOut className="h-6 w-6 text-primary" />
          Separation
        </h1>
        <p className="text-muted-foreground">Manage your employment separation process</p>
      </div>

      {!isLoading && hasManager && (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-2">
          <User className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">Reporting Manager:</span>
          <span className="break-words font-medium">{managerName}</span>
          {managerEmail && <span className="break-all text-muted-foreground">({managerEmail})</span>}
        </div>
      )}

      {!isLoading && !hasManager && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm dark:bg-amber-950/20">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-amber-700 dark:text-amber-400">
            No reporting manager assigned. Please contact HR before submitting resignation.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {terminations.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5 border-0 shadow-sm">
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="font-semibold text-destructive">Employment {terminations[0].separationTypeLabel ?? "Terminated"}</p>
                    {terminations[0].reason && (
                      <p className="mt-1 break-words text-sm text-muted-foreground">
                        Reason: {terminations[0].reason}
                      </p>
                    )}
                    {terminations[0].effectiveDate && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Effective: {formatDate(terminations[0].effectiveDate)}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeResignation ? (
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="text-base">Resignation Status</CardTitle>
                  <Badge variant="outline" className={cn("w-fit text-xs", statusColor[activeResignation.status] ?? "")}>
                    {statusLabel[activeResignation.status] ?? formatLabel(activeResignation.status)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Applied</p>
                    <p className="font-medium mt-0.5">
                      {activeResignation.appliedAt ? formatDate(activeResignation.appliedAt) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Last Working Day</p>
                    <p className="font-medium mt-0.5">
                      {activeResignation.lastWorkingDay ? formatDate(activeResignation.lastWorkingDay) : "—"}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">HR Classified Reason</p>
                    <p className="mt-0.5">{activeResignation.reason || "Pending HR classification"}</p>
                  </div>
                  {activeResignation.remarks && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Your Remarks</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm">{activeResignation.remarks}</p>
                    </div>
                  )}
                  {activeResignation.managerRemarks && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Manager Remarks</p>
                      <p className="mt-0.5 text-sm">{activeResignation.managerRemarks}</p>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {["pending", "manager_approved", "approved"].map((s, i) => {
                    const reached = ["pending", "manager_approved", "approved"].indexOf(activeResignation.status) >= i;
                    return (
                      <div key={s} className="flex items-center gap-1.5">
                        <div className={cn("h-2 w-2 rounded-full", reached ? "bg-primary" : "bg-muted")} />
                        <span className={cn("text-[10px]", reached ? "text-foreground" : "text-muted-foreground")}>
                          {s === "pending" ? "Submitted" : s === "manager_approved" ? "Manager" : "HR"}
                        </span>
                        {i < 2 && <div className={cn("h-px w-4 sm:w-6", reached ? "bg-primary/50" : "bg-muted")} />}
                      </div>
                    );
                  })}
                </div>
                {REVOCABLE_RESIGNATION_STATUSES.has(activeResignation.status) && (
                  <div className="pt-2">
                    <Button
                      type="button"
                      variant="destructive"
                      className="w-full gap-2 rounded-full sm:w-auto"
                      disabled={revoking}
                      onClick={() => setRevokeTarget(activeResignation)}
                    >
                      {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Revoke Resignation
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : !showForm && terminations.length === 0 ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-6 text-center space-y-4">
                <Clock className="h-10 w-10 mx-auto text-muted-foreground opacity-30" />
                <div>
                  <p className="font-semibold">No active resignation</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    If you intend to resign, you can apply for resignation here.
                    Your notice period will be calculated automatically.
                  </p>
                </div>
                <Button variant="outline" className="w-full rounded-full sm:w-auto" onClick={() => setShowForm(true)} disabled={!hasManager}>
                  Apply for Resignation
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {showForm && (
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-base">Apply for Resignation</CardTitle>
                <CardDescription>
                  Your Last Working Day will be calculated based on your notice period (90 days standard).
                  Early relieving requests will be subject to your reporting manager and HR approval.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm">
                    <p className="text-muted-foreground">This request will be routed to:</p>
                    <p className="mt-1 font-medium">{managerName ?? "Reporting manager not assigned"}</p>
                    {managerEmail && <p className="text-xs text-muted-foreground mt-0.5">{managerEmail}</p>}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Additional Remarks *</Label>
                    <Textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="Write your reason for resignation and any context HR or your manager should know..."
                      className="min-h-[120px] resize-none rounded-xl"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      HR will classify the official resignation reason after reviewing your remarks.
                    </p>
                  </div>

                  <div className="space-y-3 rounded-xl border border-border bg-muted/20 px-3 py-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        id="early"
                        checked={earlyRelieving}
                        onChange={(e) => setEarlyRelieving(e.target.checked)}
                        className="mt-1 rounded"
                      />
                      <label htmlFor="early" className="min-w-0 flex-1 cursor-pointer text-sm leading-6">
                        Request early relieving (30 or 60 days instead of standard 90 days)
                      </label>
                    </div>
                    {earlyRelieving && (
                      <div className="space-y-1.5 pl-7">
                        <Label className="text-xs">Requested notice period</Label>
                        <Select value={requestedNoticeDays} onValueChange={(value) => setRequestedNoticeDays(value ?? "30")}>
                          <SelectTrigger className="h-9 w-full rounded-xl sm:w-48">
                            <SelectValue placeholder="Select days" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="30">30 days</SelectItem>
                            <SelectItem value="60">60 days</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                    <Button type="button" variant="outline" className="rounded-full flex-1" onClick={() => setShowForm(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={submitting} className="rounded-full flex-1">
                      {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Submitting…</> : "Apply for Resignation"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke resignation request?"
        description="This will cancel your active resignation request and stop the current review workflow."
        confirmLabel="Revoke"
        destructive
        loading={revoking}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        onConfirm={() => {
          if (revokeTarget) void handleRevoke(revokeTarget);
        }}
      />
    </div>
  );
}

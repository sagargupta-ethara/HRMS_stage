"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardInsightStrip } from "@/components/dashboard/insight-strip";
import { PageHeader } from "@/components/shared/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { getInitials, formatDate, formatLabel, timeAgo } from "@/lib/utils";
import {
  CalendarDays, CheckCircle2, ChevronRight, Clock,
  Loader2, UserX, XCircle, Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  managerApi, leaveApi, separationApi,
  type TeamMember, type LeaveRequest, type SeparationRecord,
} from "@/lib/api";

const SEP_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  manager_approved: "secondary",
  approved: "default",
  rejected: "destructive",
};

export default function ManagerDashboard() {
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [pendingLeaves, setPendingLeaves] = useState<LeaveRequest[]>([]);
  const [resignations, setResignations] = useState<SeparationRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [leaveAction, setLeaveAction] = useState<{ record: LeaveRequest; type: "approved" | "rejected" } | null>(null);
  const [leaveRemarks, setLeaveRemarks] = useState("");
  const [actingLeave, setActingLeave] = useState(false);

  const [sepAction, setSepAction] = useState<{ record: SeparationRecord; type: "approve" | "reject" } | null>(null);
  const [sepRemarks, setSepRemarks] = useState("");
  const [suggestedLwd, setSuggestedLwd] = useState("");
  const [actingSep, setActingSep] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [t, l, s] = await Promise.all([
        managerApi.getTeam(),
        managerApi.getTeamLeaveRequests("pending"),
        separationApi.managerInbox(),
      ]);
      setTeam(t ?? []);
      setPendingLeaves(l ?? []);
      setResignations(s ?? []);
    } catch {
      toast.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

  const handleLeaveAction = async () => {
    if (!leaveAction) return;
    setActingLeave(true);
    try {
      await leaveApi.managerAction(leaveAction.record.id, leaveAction.type, leaveRemarks || undefined);
      toast.success(`Leave ${leaveAction.type}`);
      setLeaveAction(null);
      setLeaveRemarks("");
      setPendingLeaves((p) => p.filter((x) => x.id !== leaveAction.record.id));
    } catch {
      toast.error("Action failed");
    } finally {
      setActingLeave(false);
    }
  };

  const handleSepAction = async () => {
    if (!sepAction) return;
    setActingSep(true);
    try {
      await separationApi.managerAction(sepAction.record.id, {
        action: sepAction.type,
        remarks: sepRemarks || undefined,
        suggested_lwd: suggestedLwd || undefined,
      });
      toast.success(`Resignation ${sepAction.type === "approve" ? "approved" : "rejected"}`);
      setSepAction(null); setSepRemarks(""); setSuggestedLwd("");
      load();
    } catch {
      toast.error("Action failed");
    } finally {
      setActingSep(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const managerInsights = [
    {
      label: "Team Coverage",
      value: team.length,
      detail: `${team.filter((member) => member.department || member.designation).length} profiles have role or department metadata.`,
      icon: Users,
      tone: "info" as const,
      progress: team.length ? Math.round((team.filter((member) => member.department || member.designation).length / team.length) * 100) : 0,
      href: "/dashboard/manager/team",
    },
    {
      label: "Leave Decisions",
      value: pendingLeaves.length,
      detail: "Requests awaiting manager approval or rejection.",
      icon: Clock,
      tone: pendingLeaves.length ? "warning" as const : "success" as const,
      href: "/dashboard/manager/leaves",
    },
    {
      label: "Exit Reviews",
      value: resignations.length,
      detail: "Resignation records in the manager inbox.",
      icon: UserX,
      tone: resignations.length ? "danger" as const : "success" as const,
      href: "/dashboard/separation",
    },
    {
      label: "Action State",
      value: pendingLeaves.length + resignations.length,
      detail: pendingLeaves.length + resignations.length ? "Approvals need attention." : "No manager approvals are pending.",
      icon: CheckCircle2,
      tone: pendingLeaves.length + resignations.length ? "warning" as const : "success" as const,
      href: pendingLeaves.length ? "/dashboard/manager/leaves" : "/dashboard/manager/team",
    },
  ];

  return (
    <div className="space-y-5 overflow-x-hidden sm:space-y-6">
      <PageHeader
        title="Manager Dashboard"
        icon={Users}
        description="Manage your team, leaves, and approvals"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-4 p-4 sm:pt-6">
            <div className="rounded-xl bg-info/10 p-3"><Users className="h-5 w-5 text-info" /></div>
            <div><p className="text-2xl font-bold">{team.length}</p><p className="text-sm text-muted-foreground">Team Members</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-4 p-4 sm:pt-6">
            <div className="rounded-xl bg-warning/10 p-3"><Clock className="h-5 w-5 text-warning" /></div>
            <div><p className="text-2xl font-bold">{pendingLeaves.length}</p><p className="text-sm text-muted-foreground">Pending Leave Requests</p></div>
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardContent className="flex items-center gap-4 p-4 sm:pt-6">
            <div className="rounded-xl bg-destructive/10 p-3"><UserX className="h-5 w-5 text-destructive" /></div>
            <div><p className="text-2xl font-bold">{resignations.length}</p><p className="text-sm text-muted-foreground">Pending Resignations</p></div>
          </CardContent>
        </Card>
      </div>

      <DashboardInsightStrip
        title="Manager Operating Summary"
        subtitle="Team coverage, leave approvals, exit reviews, and current action load."
        insights={managerInsights}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">My Team</CardTitle>
            <Link href="/dashboard/manager/team">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">View All <ChevronRight className="h-3 w-3" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {team.length === 0
              ? <p className="text-sm text-muted-foreground py-4 text-center">No team members assigned yet</p>
              : team.slice(0, 5).map((m) => (
                <div key={m.id} className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/30">
                  <Avatar className="h-8 w-8"><AvatarFallback className="text-xs">{getInitials(m.fullName)}</AvatarFallback></Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.fullName}</p>
                    <p className="text-xs text-muted-foreground truncate">{m.designation || m.department || m.etharaEmail}</p>
                  </div>
                  <Badge variant="secondary" className="text-xs shrink-0">{m.employeeCode}</Badge>
                </div>
              ))}
          </CardContent>
        </Card>

        <Card className="border-0 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Pending Leave Requests</CardTitle>
            <Link href="/dashboard/manager/leaves">
              <Button variant="ghost" size="sm" className="gap-1 text-xs">View All <ChevronRight className="h-3 w-3" /></Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingLeaves.length === 0
              ? <div className="flex flex-col items-center py-4 gap-2"><CheckCircle2 className="h-6 w-6 text-success" /><p className="text-sm text-muted-foreground">No pending leave requests</p></div>
              : pendingLeaves.slice(0, 4).map((lr) => (
                <div key={lr.id} className="flex items-center justify-between rounded-lg border border-border p-2.5 gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{lr.employeeName}</p>
                    <p className="text-xs text-muted-foreground">{lr.leaveType} · {lr.days}d · {formatDate(lr.startDate)} – {formatDate(lr.endDate)}</p>
                    {lr.reason && <p className="text-xs text-muted-foreground truncate">{lr.reason}</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <Button size="sm" className="h-7 px-2 text-xs" onClick={() => { setLeaveAction({ record: lr, type: "approved" }); setLeaveRemarks(""); }}>
                      <CheckCircle2 className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="destructive" className="h-7 px-2 text-xs" onClick={() => { setLeaveAction({ record: lr, type: "rejected" }); setLeaveRemarks(""); }}>
                      <XCircle className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
          </CardContent>
        </Card>
      </div>

      {resignations.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <UserX className="h-4 w-4 text-destructive" />
              Pending Resignations ({resignations.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {resignations.map((r) => (
              <div key={r.id} className="rounded-xl border border-border p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-9 w-9 shrink-0"><AvatarFallback className="text-xs">{getInitials(r.employeeName ?? "")}</AvatarFallback></Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{r.employeeName}</p>
                      <p className="break-words text-xs text-muted-foreground">{r.employeeCode} · {r.department} · {r.designation}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Applied {r.appliedAt ? timeAgo(r.appliedAt) : "—"}
                        {r.lastWorkingDay && ` · LWD: ${formatDate(r.lastWorkingDay)}`}
                        {r.earlyRelievingRequested && " · Early relieving requested"}
                      </p>
                    </div>
                  </div>
                  <Badge variant={SEP_STATUS_VARIANT[r.status] ?? "outline"} className="text-xs shrink-0">
                    {formatLabel(r.status)}
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg bg-muted/30 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">HR Classified Reason</p>
                    <p className="mt-1 text-xs text-muted-foreground">{r.reason || "Pending HR classification"}</p>
                  </div>
                  {r.remarks && (
                    <div className="rounded-lg bg-muted/30 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Employee Remarks</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{r.remarks}</p>
                    </div>
                  )}
                </div>
                {r.status === "pending" && (
                  <div className="flex flex-col gap-2 pt-1 sm:flex-row">
                    <Button size="sm" className="gap-1.5 text-xs"
                      disabled={!r.reason}
                      onClick={() => { setSepAction({ record: r, type: "approve" }); setSuggestedLwd(""); setSepRemarks(""); }}>
                      <CheckCircle2 className="h-3 w-3" /> Approve
                    </Button>
                    <Button size="sm" variant="destructive" className="gap-1.5 text-xs"
                      disabled={!r.reason}
                      onClick={() => { setSepAction({ record: r, type: "reject" }); setSuggestedLwd(""); setSepRemarks(""); }}>
                      <XCircle className="h-3 w-3" /> Reject
                    </Button>
                    {!r.reason && (
                      <p className="self-center text-xs text-muted-foreground">
                        Waiting for HR to select the resignation reason.
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!leaveAction} onOpenChange={(o) => { if (!o) { setLeaveAction(null); setLeaveRemarks(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{leaveAction?.type === "approved" ? "Approve" : "Reject"} Leave</DialogTitle></DialogHeader>
          {leaveAction && (
            <div className="space-y-3 py-2">
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <p className="font-medium">{leaveAction.record.employeeName}</p>
                <p className="text-muted-foreground text-xs">{leaveAction.record.leaveType} · {leaveAction.record.days} days · {formatDate(leaveAction.record.startDate)} – {formatDate(leaveAction.record.endDate)}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Remarks (optional)</Label>
                <Textarea placeholder="Add remarks…" value={leaveRemarks} onChange={(e) => setLeaveRemarks(e.target.value)} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLeaveAction(null); setLeaveRemarks(""); }} disabled={actingLeave}>Cancel</Button>
            <Button onClick={handleLeaveAction} disabled={actingLeave} variant={leaveAction?.type === "rejected" ? "destructive" : "default"} className="gap-2">
              {actingLeave && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm {leaveAction?.type === "approved" ? "Approval" : "Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sepAction} onOpenChange={(o) => { if (!o) { setSepAction(null); setSepRemarks(""); setSuggestedLwd(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{sepAction?.type === "approve" ? "Approve" : "Reject"} Resignation</DialogTitle></DialogHeader>
          {sepAction && (
            <div className="space-y-3 py-2">
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <p className="font-medium">{sepAction.record.employeeName}</p>
                <p className="text-xs text-muted-foreground">{sepAction.record.department} · {sepAction.record.designation}</p>
                {sepAction.record.reason && <p className="text-xs mt-1">{sepAction.record.reason}</p>}
              </div>
              {sepAction.type === "approve" && (
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Suggested Last Working Day</Label>
                  <DatePicker value={suggestedLwd} onChange={(v) => setSuggestedLwd(v)} />
                  <p className="text-[10px] text-muted-foreground">Current LWD: {sepAction.record.lastWorkingDay ? formatDate(sepAction.record.lastWorkingDay) : "Not set"}</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Remarks (optional)</Label>
                <Textarea placeholder="Add remarks…" value={sepRemarks} onChange={(e) => setSepRemarks(e.target.value)} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSepAction(null)} disabled={actingSep}>Cancel</Button>
            <Button onClick={handleSepAction} disabled={actingSep} variant={sepAction?.type === "reject" ? "destructive" : "default"} className="gap-2">
              {actingSep && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm {sepAction?.type === "approve" ? "Approval" : "Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/empty-state";
import { cn, formatLabel, timeAgo } from "@/lib/utils";
import { AlertTriangle, Clock, CheckCircle2, Mail, Eye, Loader2 } from "lucide-react";
import { useEscalations, useResolveEscalation, useAcknowledgeEscalation } from "@/lib/queries";
import { useState } from "react";

const MOCK_ESCALATIONS = [
  { id: "1", candidate: { fullName: "Amit Singh", personalEmail: "amit.s@gmail.com" }, stage: "IT Email Creation", responsibleUser: { name: "Arun Verma", role: "it_team" }, slaDeadline: "2026-05-01T12:00:00Z", delayedBy: "3 days", escalationLevel: 3, status: "open", emailSentAt: "2026-05-02T10:00:00Z" },
  { id: "2", candidate: { fullName: "Neha Kapoor", personalEmail: "neha.k@gmail.com" }, stage: "Evaluation Submission", responsibleUser: { name: "Dr. Sanjay Patel", role: "evaluator" }, slaDeadline: "2026-05-03T18:00:00Z", delayedBy: "1 day", escalationLevel: 1, status: "open", emailSentAt: "2026-05-04T09:00:00Z" },
  { id: "3", candidate: { fullName: "Rohan Jain", personalEmail: "rohan.j@yahoo.com" }, stage: "Contract Signing", responsibleUser: { name: "Anita Gupta", role: "hr" }, slaDeadline: "2026-04-29T12:00:00Z", delayedBy: "5 days", escalationLevel: 3, status: "acknowledged", emailSentAt: "2026-04-30T08:00:00Z" },
  { id: "4", candidate: { fullName: "Sanya Mehra", personalEmail: "sanya.m@gmail.com" }, stage: "Document Verification", responsibleUser: { name: "Anita Gupta", role: "hr" }, slaDeadline: "2026-05-02T18:00:00Z", delayedBy: "2 days", escalationLevel: 2, status: "open", emailSentAt: "2026-05-03T10:00:00Z" },
  { id: "5", candidate: { fullName: "Vivek Kumar", personalEmail: "vivek.k@outlook.com" }, stage: "Statutory Form Submission", responsibleUser: { name: "Vivek Kumar", role: "candidate" }, slaDeadline: "2026-05-01T12:00:00Z", delayedBy: "3 days", escalationLevel: 2, status: "open", emailSentAt: "2026-05-02T14:00:00Z" },
  { id: "6", candidate: { fullName: "Pooja Reddy", personalEmail: "pooja.r@gmail.com" }, stage: "Resume Screening", responsibleUser: { name: "Anita Gupta", role: "hr" }, slaDeadline: "2026-05-03T12:00:00Z", delayedBy: "1 day", escalationLevel: 1, status: "resolved", emailSentAt: "2026-05-03T16:00:00Z" },
];

type EscalationRow = {
  id: string;
  candidate?: { fullName?: string; personalEmail?: string };
  candidateName?: string;
  stage: string;
  responsibleUser?: { name?: string; role?: string };
  responsibleName?: string;
  slaDeadline?: string;
  delayedBy?: string;
  escalationLevel?: number;
  level?: number;
  status: string;
  emailSentAt?: string;
};

const levelColors: Record<number, string> = {
  1: "bg-warning text-warning-foreground",
  2: "bg-orange-500 text-white",
  3: "bg-destructive text-destructive-foreground",
};

const statusBadge: Record<string, { label: string; variant: "default" | "outline" | "destructive" | "secondary" }> = {
  open: { label: "Open", variant: "destructive" },
  acknowledged: { label: "Acknowledged", variant: "outline" },
  resolved: { label: "Resolved", variant: "default" },
};

export default function EscalationsPage() {
  const [tab, setTab] = useState("all");
  const { data: apiData, isLoading, isError } = useEscalations();
  const resolve = useResolveEscalation();
  const acknowledge = useAcknowledgeEscalation();

  const allEscalations: EscalationRow[] = isError || !apiData
    ? MOCK_ESCALATIONS
    : (Array.isArray(apiData) ? apiData : apiData?.data ?? MOCK_ESCALATIONS);
  const escalations = tab === "all"
    ? allEscalations
    : tab === "open"
      ? allEscalations.filter((e) => e.status === "open")
      : allEscalations.filter((e) => (e.escalationLevel ?? e.level ?? 1) >= 3 && e.status !== "resolved");

  const openCount = allEscalations.filter((e) => e.status === "open").length;
  const criticalCount = allEscalations.filter((e) => (e.escalationLevel ?? e.level ?? 1) >= 3 && e.status !== "resolved").length;

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            Escalation Center
          </h1>
          <p className="text-muted-foreground">SLA breaches and overdue actions requiring attention</p>
        </div>
        <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-semibold text-destructive">{openCount} Open</span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2">
            <span className="text-sm font-semibold text-warning">{criticalCount} Critical</span>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Escalations", value: escalations.length, color: "text-foreground" },
          { label: "Open", value: escalations.filter((e) => e.status === "open").length, color: "text-destructive" },
          { label: "Acknowledged", value: escalations.filter((e) => e.status === "acknowledged").length, color: "text-warning" },
          { label: "Resolved", value: escalations.filter((e) => e.status === "resolved").length, color: "text-success" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border p-3 bg-card text-center">
            <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Escalation List */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Active Escalations</CardTitle>
            <Tabs defaultValue="all" className="hidden sm:block">
              <TabsList className="h-8">
                <TabsTrigger value="all" className="text-xs h-6 px-2.5">All</TabsTrigger>
                <TabsTrigger value="open" className="text-xs h-6 px-2.5">Open</TabsTrigger>
                <TabsTrigger value="critical" className="text-xs h-6 px-2.5">Critical</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="mb-3 grid h-auto w-full grid-cols-3 sm:inline-grid sm:w-auto">
              <TabsTrigger value="all" className="text-xs h-6 px-2.5">All ({allEscalations.length})</TabsTrigger>
              <TabsTrigger value="open" className="text-xs h-6 px-2.5">Open ({openCount})</TabsTrigger>
              <TabsTrigger value="critical" className="text-xs h-6 px-2.5">Critical ({criticalCount})</TabsTrigger>
            </TabsList>
          </Tabs>
          {isLoading ? (
            <div className="py-12 text-center"><Loader2 className="h-7 w-7 animate-spin text-primary mx-auto" /></div>
          ) : escalations.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="All clear — no escalations" description="There are no SLA breaches or overdue actions in this view right now." />
          ) : escalations.map((esc) => {
            const badge = statusBadge[esc.status];
            const level = esc.level ?? esc.escalationLevel ?? 1;
            return (
              <div
                key={esc.id}
                className={cn(
                  "rounded-xl border p-4 transition-all hover:shadow-sm",
                  esc.status === "resolved"
                    ? "border-border bg-card opacity-60"
                    : level >= 3
                    ? "border-destructive/30 bg-destructive/5"
                    : level >= 2
                    ? "border-warning/30 bg-warning/5"
                    : "border-border bg-card"
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
                  {/* Level Badge */}
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold shrink-0",
                    levelColors[level] || levelColors[1]
                  )}>
                    L{level}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="break-words text-sm font-semibold">{esc.candidate?.fullName ?? esc.candidateName}</h3>
                        <Badge variant={badge?.variant ?? "outline"} className="text-[10px]">{badge?.label ?? formatLabel(esc.status)}</Badge>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 w-fit rounded-lg text-xs">
                        <Eye className="h-3 w-3 mr-1" /> View
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground mt-0.5">
                      Stage: <span className="font-medium text-foreground">{formatLabel(esc.stage)}</span>
                    </p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-destructive" />
                        <span className="text-destructive font-medium">Delayed by {esc.delayedBy}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>Assigned to: <span className="font-medium text-foreground">{esc.responsibleUser?.name ?? esc.responsibleName}</span></span>
                      </div>
                      {esc.emailSentAt && (
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          <span>Escalation email sent {timeAgo(esc.emailSentAt)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action buttons for open escalations */}
                {esc.status !== "resolved" && (
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:ml-14 sm:flex sm:items-center">
                    {esc.status !== "acknowledged" && (
                      <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs sm:h-7"
                        disabled={acknowledge.isPending}
                        onClick={() => !isError && acknowledge.mutate(esc.id)}>
                        Acknowledge
                      </Button>
                    )}
                    <Button size="sm" className="h-8 rounded-lg text-xs sm:h-7"
                      disabled={resolve.isPending}
                      onClick={() => !isError && resolve.mutate({ id: esc.id })}>
                      <CheckCircle2 className="h-3 w-3 mr-1" /> Resolve
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

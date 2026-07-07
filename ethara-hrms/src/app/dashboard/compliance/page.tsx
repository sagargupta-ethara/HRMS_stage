"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardInsightStrip } from "@/components/dashboard/insight-strip";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, formatLabel, getInitials, timeAgo } from "@/lib/utils";
import type { CandidateStage } from "@/types";
import {
  Scale, FileCheck, Clock, CheckCircle2, AlertTriangle, XCircle,
  Eye, Loader2, Users, RefreshCw, ChevronDown, ChevronRight, Search,
  Send, Bell, Repeat, Ban,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { candidatesApi, complianceApi, employeesApi } from "@/lib/api";

type ComplianceForm = {
  id: string;
  queueType: "candidate" | "employee";
  candidateId: string;
  employeeId?: string;
  formType: string;
  formTitle?: string;
  form_title?: string;
  status: string;
  submittedAt?: string;
  submitted_at?: string;
  verifiedAt?: string;
  candidateName?: string;
  employeeName?: string;
  documensoId?: string | null;
  signedUrl?: string | null;
  pdfUrl?: string | null;
};

type PersonGroup = {
  key: string;
  name: string;
  queueType: "candidate" | "employee";
  entityId: string;
  currentStage?: CandidateStage;
  forms: ComplianceForm[];
};

type CandidateQueueItem = {
  id: string;
  fullName: string;
  currentStage?: CandidateStage;
};

type CandidateQueueResponse = {
  data?: CandidateQueueItem[];
  totalPages?: number;
};

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "outline" | "secondary" | "destructive"; color: string }> = {
  verified:         { label: "Verified",      variant: "default",     color: "text-success" },
  signed:           { label: "Signed",        variant: "default",     color: "text-success" },
  submitted:        { label: "Submitted",     variant: "outline",     color: "text-info" },
  sent:             { label: "Sent to sign",  variant: "outline",     color: "text-info" },
  pending:          { label: "Pending",       variant: "secondary",   color: "text-warning" },
  needs_correction: { label: "Needs Fix",     variant: "destructive", color: "text-destructive" },
  rejected:         { label: "Rejected",      variant: "destructive", color: "text-destructive" },
};

const READY_TO_SEND_STAGES: CandidateStage[] = [
  "contract_signed",
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
];

const COMPLIANCE_STAGES: CandidateStage[] = [
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
];

const CANDIDATE_COMPLIANCE_QUEUE_STAGES: CandidateStage[] = [
  ...READY_TO_SEND_STAGES,
  ...COMPLIANCE_STAGES,
];

const CANDIDATE_QUEUE_PAGE_SIZE = 200;

type FilterKey = "All" | "Pending" | "Submitted" | "Verified" | "Rejected";

const FILTER_STATUS_MAP: Record<Exclude<FilterKey, "All">, string> = {
  Pending: "pending",
  Submitted: "submitted",
  Verified: "verified",
  Rejected: "rejected",
};

function completionLabel(forms: ComplianceForm[]): string {
  if (forms.length === 0) return "Ready to send";
  const verified = forms.filter((f) => f.status === "verified").length;
  return `${verified}/${forms.length} verified`;
}

function completionPct(forms: ComplianceForm[]): number {
  if (forms.length === 0) return 0;
  return Math.round((forms.filter((f) => f.status === "verified").length / forms.length) * 100);
}

function pendingCount(forms: ComplianceForm[]): number {
  return forms.filter((f) => f.status === "pending" || f.status === "needs_correction").length;
}

function groupPersonStatus(forms: ComplianceForm[]): { label: string; variant: "default" | "outline" | "secondary" | "destructive" } {
  if (forms.length === 0) return { label: "Ready to send", variant: "outline" };
  if (forms.every((f) => f.status === "verified")) return { label: "Complete", variant: "default" };
  if (forms.some((f) => f.status === "needs_correction")) return { label: "Needs Fix", variant: "destructive" };
  if (forms.some((f) => f.status === "submitted")) return { label: "Submitted", variant: "outline" };
  return { label: "Pending", variant: "secondary" };
}

// "Issued" = the person has at least one form that isn't cancelled. Drives the
// Not Sent / Sent tab split (forms not yet issued vs forms out for signing/verification).
function hasIssuedForms(forms: ComplianceForm[]): boolean {
  return forms.some((f) => f.status !== "cancelled");
}

// A candidate form that is out for signature and can still be reminded/resent/cancelled.
function isOutstandingCandidateForm(f: ComplianceForm): boolean {
  return f.queueType === "candidate" && !["signed", "verified", "cancelled"].includes(f.status);
}

async function fetchCandidatesForComplianceStage(stage: CandidateStage): Promise<CandidateQueueItem[]> {
  const firstPage = await candidatesApi.list({
    stage,
    page: 1,
    limit: CANDIDATE_QUEUE_PAGE_SIZE,
  }) as CandidateQueueResponse;
  const totalPages = Math.max(1, Number(firstPage.totalPages ?? 1) || 1);
  if (totalPages <= 1) return firstPage.data ?? [];

  const remainingPages = await Promise.all(
    Array.from({ length: totalPages - 1 }, (_, index) =>
      candidatesApi.list({
        stage,
        page: index + 2,
        limit: CANDIDATE_QUEUE_PAGE_SIZE,
      }) as Promise<CandidateQueueResponse>
    )
  );
  return [
    ...(firstPage.data ?? []),
    ...remainingPages.flatMap((page) => page.data ?? []),
  ];
}

export async function fetchComplianceGroups(): Promise<PersonGroup[]> {
  const candidateResults = await Promise.all(
    CANDIDATE_COMPLIANCE_QUEUE_STAGES.map((stage) => fetchCandidatesForComplianceStage(stage))
  );
  const allCandidates: CandidateQueueItem[] =
    candidateResults.flatMap((items) => items)
      .filter((c, i, arr) => arr.findIndex((x: { id: string }) => x.id === c.id) === i);

  const candidateGroups = await Promise.all(
    allCandidates.map(async (candidate) => {
      const forms = await complianceApi.list(candidate.id)
        .then((fs: ComplianceForm[]) =>
          fs.map((f) => ({
            ...f,
            queueType: "candidate" as const,
            candidateName: candidate.fullName,
          }))
        )
        .catch(() => []);
      return {
        key: `candidate::${candidate.id}`,
        name: candidate.fullName,
        queueType: "candidate" as const,
        entityId: candidate.id,
        currentStage: candidate.currentStage,
        forms,
      } satisfies PersonGroup;
    })
  );
  const employeeForms = await employeesApi.listComplianceQueue()
    .then((records) => records.map((record) => ({
      id: record.id,
      queueType: "employee" as const,
      candidateId: "",
      employeeId: record.employeeId,
      formType: record.formType,
      formTitle: record.formTitle,
      status: record.status,
      submittedAt: record.submittedAt ?? undefined,
      verifiedAt: record.verifiedAt ?? undefined,
      employeeName: record.employeeName,
    } satisfies ComplianceForm)))
    .catch(() => []);

  const employeeMap = new Map<string, PersonGroup>();
  for (const form of employeeForms) {
    const entityId = form.employeeId ?? form.id;
    const key = `employee::${entityId}`;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, {
        key,
        name: form.employeeName ?? "Unknown",
        queueType: "employee",
        entityId,
        forms: [],
      });
    }
    employeeMap.get(key)!.forms.push(form);
  }

  return [...candidateGroups, ...employeeMap.values()];
}

export default function ComplianceDashboard() {
  const qc = useQueryClient();
  const [acting, setActing] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("All");
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"not_sent" | "sent">("sent");
  const [cancelTarget, setCancelTarget] = useState<ComplianceForm | null>(null);
  const [bulkActing, setBulkActing] = useState<"send" | "remind" | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { data: groups = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["compliance-dashboard"],
    queryFn: fetchComplianceGroups,
  });

  const handleVerify = async (item: ComplianceForm, formTitle: string) => {
    setActing(item.id);
    try {
      if (item.queueType === "employee" && item.employeeId) {
        await employeesApi.reviewCompliance(item.employeeId, item.id, { status: "verified" });
      } else {
        await complianceApi.verify(item.id);
      }
      toast.success(`${formTitle} verified successfully`);
      await refetch();
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to verify form");
    } finally {
      setActing(null);
    }
  };

  const handleSyncCandidate = async (candidateId: string, name: string) => {
    setActing(`sync:${candidateId}`);
    try {
      await complianceApi.syncCandidate(candidateId);
      toast.success(`Synced ${name}'s compliance status`);
      await refetch();
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to sync compliance");
    } finally {
      setActing(null);
    }
  };

  const handleSendCandidateForms = async (candidateId: string, name: string) => {
    setActing(`send:${candidateId}`);
    try {
      await complianceApi.sendCandidateEsign(candidateId);
      toast.success(`Sent statutory forms to ${name}`);
      await refetch();
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to send statutory forms");
    } finally {
      setActing(null);
    }
  };

  const handleRemindForm = async (item: ComplianceForm, formTitle: string) => {
    setActing(item.id);
    try {
      await complianceApi.remindForm(item.id);
      toast.success(`Reminder sent for ${formTitle}`);
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to send reminder");
    } finally {
      setActing(null);
    }
  };

  const handleResendForm = async (item: ComplianceForm, formTitle: string) => {
    setActing(item.id);
    try {
      await complianceApi.resendCandidateForm(item.id);
      toast.success(`Re-issued ${formTitle}`);
      await refetch();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to resend form");
    } finally {
      setActing(null);
    }
  };

  const handleCancelForm = async () => {
    if (!cancelTarget) return;
    setActing(cancelTarget.id);
    try {
      await complianceApi.cancelForm(cancelTarget.id);
      toast.success("Form cancelled");
      setCancelTarget(null);
      await refetch();
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Failed to cancel form");
    } finally {
      setActing(null);
    }
  };

  const forms = useMemo(() => groups.flatMap((group) => group.forms), [groups]);

  const metrics = useMemo(() => ({
    total: forms.length,
    ready: groups.filter((group) => group.queueType === "candidate" && group.forms.length === 0).length,
    pending: forms.filter((f) => f.status === "pending").length,
    submitted: forms.filter((f) => f.status === "submitted").length,
    verified: forms.filter((f) => f.status === "verified").length,
    needsCorrection: forms.filter((f) => f.status === "needs_correction").length,
    rejected: forms.filter((f) => f.status === "rejected").length,
  }), [forms, groups]);

  const filteredGroups = useMemo<PersonGroup[]>(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map((g) => {
        let filtered = g.forms;
        if (filter !== "All") {
          if (g.forms.length === 0) {
            filtered = filter === "Pending" ? [] : filtered;
          } else {
            filtered = filtered.filter((f) => f.status === FILTER_STATUS_MAP[filter]);
          }
        }
        if (q) {
          if (!g.name.toLowerCase().includes(q)) {
            filtered = filtered.filter((f) =>
              (f.formTitle ?? f.form_title ?? f.formType).toLowerCase().includes(q)
            );
          }
        }
        return { ...g, forms: filtered };
      })
      .filter((g) => {
        if (g.forms.length === 0) {
          return (
            g.queueType === "candidate" &&
            (filter === "All" || filter === "Pending") &&
            (!q || g.name.toLowerCase().includes(q))
          );
        }
        return true;
      });
  }, [groups, filter, search]);

  // Not Sent / Sent split: a person is "Sent" once they have any non-cancelled form.
  const notSentGroups = useMemo(() => filteredGroups.filter((g) => !hasIssuedForms(g.forms)), [filteredGroups]);
  const sentGroups = useMemo(() => filteredGroups.filter((g) => hasIssuedForms(g.forms)), [filteredGroups]);
  const displayGroups = tab === "not_sent" ? notSentGroups : sentGroups;

  const handleSendAll = async () => {
    const ready = notSentGroups.filter(
      (g) => g.queueType === "candidate" && g.currentStage && READY_TO_SEND_STAGES.includes(g.currentStage),
    );
    if (ready.length === 0) { toast.error("No candidates are ready to send."); return; }
    setBulkActing("send");
    try {
      const results = await Promise.allSettled(ready.map((g) => complianceApi.sendCandidateEsign(g.entityId)));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      toast.success(`Sent forms to ${ok}/${ready.length} candidate${ready.length === 1 ? "" : "s"}`);
      await refetch();
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch {
      toast.error("Bulk send failed");
    } finally {
      setBulkActing(null);
    }
  };

  const handleRemindAll = async () => {
    const remindable = sentGroups.flatMap((g) =>
      g.forms.filter((f) => isOutstandingCandidateForm(f) && Boolean(f.documensoId)),
    );
    if (remindable.length === 0) { toast.error("No outstanding forms to remind."); return; }
    setBulkActing("remind");
    try {
      const results = await Promise.allSettled(remindable.map((f) => complianceApi.remindForm(f.id)));
      const ok = results.filter((r) => r.status === "fulfilled").length;
      toast.success(`Reminders sent for ${ok}/${remindable.length} form${remindable.length === 1 ? "" : "s"}`);
    } catch {
      toast.error("Bulk remind failed");
    } finally {
      setBulkActing(null);
    }
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(displayGroups.map((g) => g.key)));
  const collapseAll = () => setExpanded(new Set());
  const complianceProgress = metrics.total ? Math.round((metrics.verified / metrics.total) * 100) : 0;
  const complianceInsights = [
    {
      label: "Verification Progress",
      value: metrics.total ? `${complianceProgress}%` : "—",
      detail: `${metrics.verified} verified out of ${metrics.total} compliance forms.`,
      icon: CheckCircle2,
      tone: metrics.pending || metrics.submitted ? "warning" as const : "success" as const,
      progress: complianceProgress,
    },
    {
      label: "Ready To Send",
      value: metrics.ready,
      detail: "Candidates ready for statutory forms to be issued.",
      icon: Send,
      tone: metrics.ready ? "warning" as const : "success" as const,
    },
    {
      label: "Review Queue",
      value: metrics.submitted,
      detail: "Submitted forms waiting for compliance verification.",
      icon: FileCheck,
      tone: metrics.submitted ? "warning" as const : "success" as const,
    },
    {
      label: "Correction Risk",
      value: metrics.needsCorrection + metrics.rejected,
      detail: "Forms needing correction or rejected follow-up.",
      icon: AlertTriangle,
      tone: metrics.needsCorrection + metrics.rejected ? "danger" as const : "success" as const,
    },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Compliance Dashboard</h1>
        <p className="text-muted-foreground">Track statutory forms, POSH declarations, and compliance status</p>
      </div>

      {isError && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">Unable to load compliance data.</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {[
          { label: "Total",      value: metrics.total,           icon: Scale },
          { label: "Ready",      value: metrics.ready,           icon: Send },
          { label: "Pending",    value: metrics.pending,         icon: Clock },
          { label: "Submitted",  value: metrics.submitted,       icon: FileCheck },
          { label: "Verified",   value: metrics.verified,        icon: CheckCircle2 },
          { label: "Needs Fix",  value: metrics.needsCorrection, icon: AlertTriangle },
          { label: "Rejected",   value: metrics.rejected,        icon: XCircle },
        ].map((m) => (
          <div key={m.label} className="flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-card p-3 sm:items-start sm:rounded-xl">
            <m.icon className="h-8 w-8 shrink-0 rounded-xl bg-primary/10 p-2 text-primary sm:h-4 sm:w-4 sm:bg-transparent sm:p-0" />
            <div className="min-w-0">
              <p className="text-lg font-bold leading-tight">{isLoading ? "—" : m.value}</p>
              <p className="truncate text-[10px] text-muted-foreground">{m.label}</p>
            </div>
          </div>
        ))}
      </div>

      <DashboardInsightStrip
        title="Compliance Operating Summary"
        subtitle="Verification progress, forms ready to send, review queue, and correction risk."
        insights={complianceInsights}
      />

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">Compliance Forms Queue</CardTitle>
              <CardDescription>
                {isLoading ? "Loading…" : `${displayGroups.length} ${displayGroups.length === 1 ? "person" : "people"} · ${displayGroups.reduce((s, g) => s + g.forms.length, 0)} forms`}
              </CardDescription>
            </div>
            <div className="-mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
              {(["All", "Pending", "Submitted", "Verified", "Rejected"] as const).map((f) => (
                <Badge
                  key={f}
                  variant={filter === f ? "default" : "outline"}
                  className="shrink-0 cursor-pointer select-none whitespace-nowrap text-[10px]"
                  onClick={() => setFilter(f)}
                >
                  {f}
                </Badge>
              ))}
            </div>
          </div>

          {/* Sent / Not-Sent tabs + bulk action */}
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex w-fit rounded-lg border border-border p-0.5">
              {([["sent", "Sent", sentGroups.length], ["not_sent", "Not Sent", notSentGroups.length]] as const).map(([k, label, count]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={cn(
                    "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    tab === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label} ({count})
                </button>
              ))}
            </div>
            {tab === "not_sent" ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full gap-1.5 text-xs sm:w-auto"
                disabled={bulkActing !== null || notSentGroups.length === 0}
                onClick={() => void handleSendAll()}
              >
                {bulkActing === "send" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Send all
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 w-full gap-1.5 text-xs sm:w-auto"
                disabled={bulkActing !== null || sentGroups.length === 0}
                onClick={() => void handleRemindAll()}
              >
                {bulkActing === "remind" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bell className="h-3.5 w-3.5" />}
                Remind all
              </Button>
            )}
          </div>

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-xs sm:flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name or form type…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs rounded-lg"
              />
            </div>
            {displayGroups.length > 0 && (
              <div className="flex items-center gap-1 sm:ml-auto">
                <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={expandAll}>Expand all</Button>
                <span className="text-muted-foreground/40 text-xs">·</span>
                <Button variant="ghost" size="sm" className="h-7 text-xs px-2" onClick={collapseAll}>Collapse all</Button>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : displayGroups.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-muted-foreground">
              <Users className="h-8 w-8 opacity-30 mb-2" />
              <p className="text-sm">
                {tab === "not_sent" ? "No one is waiting for forms to be sent" : "No forms have been sent yet"}
              </p>
              {search && <p className="text-xs mt-1 opacity-60">Try clearing your search</p>}
            </div>
          ) : (
            <div className="space-y-2">
              {displayGroups.map((group) => {
                const isOpen = expanded.has(group.key);
                const pct = completionPct(group.forms);
                const pending = pendingCount(group.forms);
                const groupStatus = groupPersonStatus(group.forms);
                const profileHref = group.queueType === "employee"
                  ? `/dashboard/employees/${group.entityId}`
                  : `/dashboard/candidates/${group.entityId}`;
                const canSendForms =
                  group.queueType === "candidate" &&
                  group.forms.length === 0 &&
                  Boolean(group.currentStage && READY_TO_SEND_STAGES.includes(group.currentStage));

                return (
                  <div
                    key={group.key}
                    className="rounded-xl border border-border overflow-hidden transition-all"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      className="flex w-full cursor-pointer items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:items-center sm:px-4"
                      onClick={() => toggleExpand(group.key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleExpand(group.key);
                        }
                      }}
                    >
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                          {getInitials(group.name)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="min-w-0">
                          <span className="block truncate text-sm font-semibold">{group.name}</span>
                          <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-x-auto whitespace-nowrap pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
                            <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[9px]">
                              {group.queueType === "employee" ? "Employee" : "Candidate"}
                            </Badge>
                            <Badge variant={groupStatus.variant} className="shrink-0 px-1.5 py-0 text-[9px]">
                              {groupStatus.label}
                            </Badge>
                            {pending > 0 && (
                              <span className="shrink-0 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                                {pending} pending
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-2 grid gap-1 sm:flex sm:items-center sm:gap-3 sm:mt-1.5">
                          <Progress value={pct} className="h-1.5 w-full sm:max-w-[140px] sm:flex-1" />
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {completionLabel(group.forms)}
                          </span>
                          <span className="text-[10px] text-muted-foreground/50 shrink-0">
                            {group.forms.length} {group.forms.length === 1 ? "form" : "forms"}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {canSendForms && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 rounded-lg text-xs"
                            disabled={acting === `send:${group.entityId}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSendCandidateForms(group.entityId, group.name);
                            }}
                          >
                            {acting === `send:${group.entityId}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3" />
                            )}
                            Send Forms
                          </Button>
                        )}
                        {group.queueType === "candidate" && group.forms.some((f) => f.documensoId) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 rounded-lg text-xs"
                            disabled={acting === `sync:${group.entityId}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleSyncCandidate(group.entityId, group.name);
                            }}
                          >
                            <RefreshCw className={`h-3 w-3 ${acting === `sync:${group.entityId}` ? "animate-spin" : ""}`} />
                            Sync
                          </Button>
                        )}
                        <Link
                          href={profileHref}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        {isOpen
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        }
                      </div>
                    </div>

                    {isOpen && (
                      <div className="border-t border-border bg-muted/10">
                        {group.forms.length === 0 ? (
                          <div className="px-4 py-4 text-sm text-muted-foreground sm:pl-16">
                            Statutory forms are ready to send after contract signing.
                          </div>
                        ) : group.forms.map((item, idx) => {
                          const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
                          const title = item.formTitle ?? item.form_title ?? item.formType;
                          const submittedAt = item.submittedAt ?? item.submitted_at;
                          const isActing = acting === item.id;
                          const isLast = idx === group.forms.length - 1;

                          return (
                            <div
                              key={item.id}
                              className={`flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-muted/20 sm:flex-row sm:items-center sm:justify-between ${!isLast ? "border-b border-border/50" : ""}`}
                            >
                              <div className="flex min-w-0 items-start gap-3 sm:items-center sm:pl-12">
                                <div className="h-1.5 w-1.5 rounded-full shrink-0 mt-0.5" style={{ background: cfg.color.replace("text-", "") === cfg.color ? "currentColor" : undefined }} aria-hidden="true">
                                  <span className={`block h-1.5 w-1.5 rounded-full ${
                                    item.status === "verified" ? "bg-success" :
                                    item.status === "submitted" ? "bg-info" :
                                    item.status === "needs_correction" ? "bg-destructive" :
                                    item.status === "rejected" ? "bg-destructive/80" :
                                    "bg-warning"
                                  }`} />
                                </div>
                                <div className="min-w-0">
                                  <p className="break-words text-sm font-medium sm:truncate">{title}</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] text-muted-foreground capitalize">
                                      {formatLabel(item.formType)}
                                    </span>
                                    {submittedAt && (
                                      <span className="text-[10px] text-muted-foreground/60">
                                        · Submitted {timeAgo(submittedAt)}
                                      </span>
                                    )}
                                    {item.verifiedAt && (
                                      <span className="text-[10px] text-success/80">
                                        · Verified {timeAgo(item.verifiedAt)}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
                                <Badge variant={cfg.variant} className="text-[10px] min-w-[72px] justify-center">
                                  {cfg.label}
                                </Badge>
                                {item.documensoId && (item.pdfUrl || item.signedUrl) && (
                                  <a
                                    href={(item.pdfUrl || item.signedUrl) as string}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-border px-2.5 text-xs hover:bg-muted sm:h-7"
                                  >
                                    {item.pdfUrl ? "View signed document" : "View form"}
                                  </a>
                                )}
                                {item.status === "submitted" && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg border-success/30 text-xs text-success hover:bg-success/10 sm:h-7"
                                    disabled={isActing}
                                    onClick={() => handleVerify(item, title)}
                                  >
                                    {isActing
                                      ? <><RefreshCw className="h-3 w-3 animate-spin mr-1" />Verifying…</>
                                      : <><CheckCircle2 className="h-3 w-3 mr-1" />Verify</>
                                    }
                                  </Button>
                                )}
                                {isOutstandingCandidateForm(item) && item.documensoId && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg text-xs sm:h-7"
                                    disabled={isActing}
                                    onClick={() => void handleRemindForm(item, title)}
                                    title="Email the candidate the existing signing link"
                                  >
                                    <Bell className="h-3 w-3 mr-1" />Remind
                                  </Button>
                                )}
                                {item.queueType === "candidate" && !["signed", "verified"].includes(item.status) && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg text-xs sm:h-7"
                                    disabled={isActing}
                                    onClick={() => void handleResendForm(item, title)}
                                    title="Re-issue a fresh signing document"
                                  >
                                    <Repeat className="h-3 w-3 mr-1" />Resend
                                  </Button>
                                )}
                                {isOutstandingCandidateForm(item) && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg border-destructive/30 text-xs text-destructive hover:bg-destructive/10 sm:h-7"
                                    disabled={isActing}
                                    onClick={() => setCancelTarget(item)}
                                    title="Cancel this form (removes it if it's a duplicate)"
                                  >
                                    <Ban className="h-3 w-3 mr-1" />Cancel
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Cancel this form?"
        description={
          cancelTarget ? (
            <span>
              This cancels{" "}
              <span className="font-medium text-foreground">
                {cancelTarget.formTitle ?? cancelTarget.form_title ?? cancelTarget.formType}
              </span>{" "}
              and voids its Documenso document. If it&apos;s a duplicate it will be removed; otherwise it&apos;s
              marked cancelled and can be re-sent.
            </span>
          ) : undefined
        }
        confirmLabel="Cancel form"
        loading={Boolean(cancelTarget && acting === cancelTarget.id)}
        onConfirm={handleCancelForm}
      />
    </div>
  );
}

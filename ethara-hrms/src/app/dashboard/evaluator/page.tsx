"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Calendar, CalendarPlus, CheckCircle2, ChevronDown, ChevronUp,
  ClipboardCheck, Eye, Filter, Loader2, RefreshCw, Users, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { assessmentsApi, evaluationsApi, positionsApi, usersApi } from "@/lib/api";
import type { EvaluatorCandidateRecord } from "@/lib/api";
import { STAGE_LABELS, cn, formatDateTime, formatLabel, getInitials, getTodayDateInputMin, hasAssignedRole, timeAgo } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardInsightStrip } from "@/components/dashboard/insight-strip";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";

const MODE_OPTIONS = [
  { value: "google_meet", label: "Google Meet" },
  { value: "offline", label: "Offline / In-person" },
  { value: "phone", label: "Phone Call" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "zoom", label: "Zoom" },
];

const STAGE_FILTER_OPTIONS = [
  { value: "", label: "All Stages" },
  { value: "resume_shortlisted", label: "Shortlisted" },
  { value: "evaluation_assigned", label: "Eval Assigned" },
  { value: "evaluation_in_progress", label: "Eval In Progress" },
  { value: "evaluation_passed", label: "Eval Passed" },
  { value: "evaluation_failed", label: "Eval Failed" },
];

const PASS_FAIL_OPTIONS = [
  { value: "", label: "All" },
  { value: "pass", label: "Passed" },
  { value: "fail", label: "Failed" },
  { value: "pending", label: "Pending" },
];

const PI_FILTER_OPTIONS = [
  { value: "", label: "All" },
  { value: "yes", label: "PI Scheduled" },
  { value: "no", label: "PI Not Scheduled" },
];

const ACTIVE_PI_STATUSES = new Set(["scheduled", "rescheduled"]);

type OutcomeDecision = "proceed_to_next_round" | "selected" | "rejected";

function toLocalDateTimeFields(value: string | null | undefined) {
  if (!value) return { date: "", time: "" };
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { date: "", time: "" };
  const pad = (part: number) => String(part).padStart(2, "0");
  return {
    date: `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`,
    time: `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`,
  };
}

function getSortedPiRounds(record: EvaluatorCandidateRecord) {
  return [...(record.piRounds ?? [])].sort((left, right) => left.roundNumber - right.roundNumber);
}

function getLatestPiRound(record: EvaluatorCandidateRecord) {
  const rounds = getSortedPiRounds(record);
  return rounds[rounds.length - 1] ?? record.piInterview ?? null;
}

function getActivePiRound(record: EvaluatorCandidateRecord) {
  const rounds = getSortedPiRounds(record);
  return [...rounds].reverse().find((round) => ACTIVE_PI_STATUSES.has(round.status ?? "")) ?? null;
}

function getNextPiRoundNumber(record: EvaluatorCandidateRecord) {
  const rounds = getSortedPiRounds(record);
  return Math.min(5, (rounds[rounds.length - 1]?.roundNumber ?? 0) + 1);
}

function hasFinalPiVerdict(record: EvaluatorCandidateRecord) {
  return getSortedPiRounds(record).some((round) => !!round.finalVerdict);
}

function DecisionBadge({ decision }: { decision: string | null | undefined }) {
  if (!decision) return <span className="text-[10px] text-muted-foreground">—</span>;
  return (
    <span className={cn(
      "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
      decision === "pass" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
    )}>
      {decision === "pass" ? "Pass" : "Fail"}
    </span>
  );
}

function PIStatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const map: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    rescheduled: "bg-amber-100 text-amber-700",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    no_further_pi_required: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
    cancelled: "bg-red-100 text-red-700",
  };
  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", map[status] ?? "bg-muted text-muted-foreground")}>
      {formatLabel(status)}
    </span>
  );
}

function PIOutcomeBadge({
  roundDecision,
  finalVerdict,
}: {
  roundDecision?: string | null;
  finalVerdict?: string | null;
}) {
  const value = finalVerdict ?? roundDecision;
  if (!value) return null;
  const labelMap: Record<string, string> = {
    proceed_to_next_round: "Next Round",
    selected: "Selected",
    rejected: "Rejected",
  };
  const colorMap: Record<string, string> = {
    proceed_to_next_round: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    selected: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    rejected: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  return (
    <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full", colorMap[value] ?? "bg-muted text-muted-foreground")}>
      {labelMap[value] ?? formatLabel(value)}
    </span>
  );
}

function KpiCard({ label, value, icon: Icon, color = "primary", loading }: {
  label: string;
  value: number;
  icon: React.ElementType;
  color?: "primary" | "success" | "warning" | "destructive" | "info";
  loading?: boolean;
}) {
  const iconStyle = {
    primary: "bg-primary/15 text-primary",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
    destructive: "bg-destructive/15 text-destructive",
    info: "bg-info/15 text-info",
  }[color];
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl p-3.5 transition-all sm:p-5 sm:hover:-translate-y-0.5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
      <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(ellipse at top right, rgba(237,0,237,0.08) 0%, transparent 60%)" }} />
      <div className="relative flex min-w-0 items-center justify-between gap-2 sm:items-start sm:gap-3">
        <div className="min-w-0">
          <p className="break-words text-[10px] font-medium uppercase tracking-wider sm:text-xs" style={{ color: "rgba(197,203,232,0.50)" }}>{label}</p>
          <p className="mt-2 break-words text-2xl font-bold sm:text-3xl" style={{ color: "#C5CBE8" }}>{loading ? "—" : value}</p>
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11", iconStyle)}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
      </div>
    </div>
  );
}

function getPiRemark(round: EvaluatorCandidateRecord["piInterview"]) {
  return round?.remarks ?? round?.notes ?? null;
}

function getModeLabel(mode: string | null | undefined) {
  if (!mode) return "—";
  return MODE_OPTIONS.find((option) => option.value === mode)?.label ?? formatLabel(mode);
}

type SortKey = "fullName" | "currentStage" | "finalDecision" | "updatedAt";

export default function EvaluatorDashboardPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const minScheduleDate = getTodayDateInputMin();

  const [filterStage, setFilterStage] = useState("");
  const [filterPassFail, setFilterPassFail] = useState("");
  const [filterPI, setFilterPI] = useState("");
  const [filterPosition, setFilterPosition] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<{
    evalId?: string;
    candidateId?: string;
    roundId?: string | null;
  } | null>(null);
  const [scheduleForm, setScheduleForm] = useState({
    roundNumber: 1,
    subject: "PI Interview",
    date: "",
    time: "",
    durationMinutes: "60",
    mode: "google_meet",
    evaluatorId: "",
    panelLabel: "",
    panelMembers: "",
    notes: "",
  });
  const [scheduling, setScheduling] = useState(false);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [outcomeTarget, setOutcomeTarget] = useState<{
    evalId: string;
    candidateId: string;
    roundId?: string | null;
    roundNumber: number;
  } | null>(null);
  const [outcomeForm, setOutcomeForm] = useState({
    decision: "proceed_to_next_round" as OutcomeDecision,
    piScore: "",
    remarks: "",
  });
  const [savingOutcome, setSavingOutcome] = useState(false);

  const { data: positions = [] } = useQuery({
    queryKey: ["positions"],
    queryFn: positionsApi.list,
    staleTime: 300_000,
  });
  const positionList = Array.isArray(positions) ? positions : (positions as { data?: { id: string; title: string }[] }).data ?? [];
  const { data: usersData = [] } = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.list,
    staleTime: 300_000,
  });
  const evaluators = useMemo(
    () => (Array.isArray(usersData) ? usersData : []).filter((user) => hasAssignedRole(user, ["evaluator"])) as Array<{ id: string; name: string; role: string; roles?: string[] }>,
    [usersData]
  );

  const { data: records = [], isLoading, refetch } = useQuery({
    queryKey: ["evaluator-view", filterStage, filterPassFail, filterPI, filterPosition],
    queryFn: () => assessmentsApi.evaluatorView({
      stage: filterStage || undefined,
      passFail: filterPassFail || undefined,
      piScheduled: filterPI || undefined,
      positionId: filterPosition || undefined,
    }),
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    let list = [...records];
    if (searchQuery.trim()) {
      const term = searchQuery.toLowerCase();
      list = list.filter((r) =>
        r.fullName.toLowerCase().includes(term) ||
        r.candidateCode.toLowerCase().includes(term) ||
        (r.positionTitle ?? "").toLowerCase().includes(term)
      );
    }
    list.sort((a, b) => {
      let av: string | number = 0;
      let bv: string | number = 0;
      if (sortKey === "fullName") { av = a.fullName; bv = b.fullName; }
      else if (sortKey === "currentStage") { av = a.currentStage; bv = b.currentStage; }
      else if (sortKey === "finalDecision") { av = a.finalDecision ?? "z"; bv = b.finalDecision ?? "z"; }
      else if (sortKey === "updatedAt") { av = a.updatedAt ?? ""; bv = b.updatedAt ?? ""; }
      if (av < bv) return sortAsc ? -1 : 1;
      if (av > bv) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [records, searchQuery, sortKey, sortAsc]);

  const metrics = useMemo(() => {
    const total = records.length;
    const passed = records.filter((r) => r.finalDecision === "pass").length;
    const failed = records.filter((r) => r.finalDecision === "fail").length;
    const piScheduled = records.filter((r) => getSortedPiRounds(r).some((round) => ACTIVE_PI_STATUSES.has(round.status ?? ""))).length;
    const pending = records.filter((r) => !hasFinalPiVerdict(r)).length;
    return [
      { label: "Total Candidates", value: total, color: "primary" as const, icon: ClipboardCheck },
      { label: "Passed", value: passed, color: "success" as const, icon: CheckCircle2 },
      { label: "Failed", value: failed, color: "destructive" as const, icon: XCircle },
      { label: "PI Scheduled", value: piScheduled, color: "info" as const, icon: Calendar },
      { label: "Pending Decision", value: pending, color: "warning" as const, icon: Loader2 },
    ];
  }, [records]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  };

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return null;
    return sortAsc ? <ChevronUp className="h-3 w-3 inline ml-0.5" /> : <ChevronDown className="h-3 w-3 inline ml-0.5" />;
  };

  const openSchedule = useCallback((record: EvaluatorCandidateRecord, roundId?: string | null, roundNumber?: number) => {
    const evalId = record.piInterview?.evaluationId ?? record.evaluation?.id;
    const rounds = getSortedPiRounds(record);
    const activeRound = roundId
      ? rounds.find((round) => round.id === roundId)
      : getActivePiRound(record);
    const prefillRound = activeRound ?? (roundNumber != null ? rounds.find((round) => round.roundNumber === roundNumber) : null);
    const targetRoundNumber = prefillRound?.roundNumber ?? roundNumber ?? getNextPiRoundNumber(record);
    const { date, time } = toLocalDateTimeFields(prefillRound?.scheduledAt);
    setScheduleTarget({ evalId, candidateId: record.candidateId, roundId: prefillRound?.id ?? null });
    setScheduleForm({
      roundNumber: targetRoundNumber,
      subject: prefillRound?.subject ?? `PI Interview - Round ${targetRoundNumber}`,
      date,
      time,
      durationMinutes: String(prefillRound?.durationMinutes ?? 60),
      mode: prefillRound?.mode ?? "google_meet",
      evaluatorId: prefillRound?.evaluatorId ?? "",
      panelLabel: prefillRound?.panelLabel ?? "",
      panelMembers: (prefillRound?.panelMembers ?? []).join(", "),
      notes: prefillRound?.remarks ?? prefillRound?.notes ?? "",
    });
    setScheduleOpen(true);
  }, []);

  const openOutcome = useCallback((record: EvaluatorCandidateRecord, roundId?: string | null) => {
    const evalId = record.piInterview?.evaluationId ?? record.evaluation?.id;
    if (!evalId) {
      toast.error("No PI evaluation record is available for this candidate.");
      return;
    }
    const rounds = getSortedPiRounds(record);
    const targetRound = roundId
      ? rounds.find((round) => round.id === roundId)
      : getActivePiRound(record) ?? getLatestPiRound(record);
    if (!targetRound) {
      toast.error("Schedule a PI round before recording an outcome.");
      return;
    }
    const existingDecision = targetRound.finalVerdict === "selected"
      ? "selected"
      : targetRound.finalVerdict === "rejected"
      ? "rejected"
      : "proceed_to_next_round";
    setOutcomeTarget({
      evalId,
      candidateId: record.candidateId,
      roundId: targetRound.id,
      roundNumber: targetRound.roundNumber,
    });
    setOutcomeForm({
      decision: existingDecision,
      piScore: targetRound.score != null ? String(targetRound.score) : "",
      remarks: targetRound.remarks ?? targetRound.notes ?? "",
    });
    setOutcomeOpen(true);
  }, []);

  const handleSchedule = async () => {
    if (!scheduleTarget?.evalId || !scheduleForm.subject.trim() || !scheduleForm.date || !scheduleForm.time) {
      toast.error("Meeting title, date, and time are required.");
      return;
    }
    const scheduledAt = new Date(`${scheduleForm.date}T${scheduleForm.time}:00`).toISOString();
    const panelMembers = scheduleForm.panelMembers
      .split(",")
      .map((member) => member.trim())
      .filter(Boolean);
    setScheduling(true);
    try {
      await evaluationsApi.schedule(scheduleTarget.evalId, {
        subject: scheduleForm.subject.trim(),
        scheduledAt,
        notes: scheduleForm.notes.trim() || undefined,
        mode: scheduleForm.mode,
        durationMinutes: parseInt(scheduleForm.durationMinutes, 10) || 60,
        roundNumber: scheduleForm.roundNumber,
        evaluatorId: scheduleForm.evaluatorId || undefined,
        panelLabel: scheduleForm.panelLabel.trim() || undefined,
        panelMembers: panelMembers.length > 0 ? panelMembers : undefined,
      });
      toast.success(`PI Round ${scheduleForm.roundNumber} scheduled.`);
      setScheduleOpen(false);
      setScheduleTarget(null);
      qc.invalidateQueries({ queryKey: ["evaluator-view"] });
      qc.invalidateQueries({ queryKey: ["evaluations"] });
      void refetch();
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to schedule interview.");
    } finally {
      setScheduling(false);
    }
  };

  const handleOutcomeSave = async () => {
    if (!outcomeTarget) return;
    const numericScore = outcomeForm.piScore.trim() ? parseFloat(outcomeForm.piScore) : undefined;
    if (numericScore != null && (Number.isNaN(numericScore) || numericScore < 0 || numericScore > 100)) {
      toast.error("PI score must be between 0 and 100.");
      return;
    }
    const isFinalDecision = outcomeForm.decision === "selected" || outcomeForm.decision === "rejected";
    if (outcomeTarget.roundNumber >= 5 && !isFinalDecision) {
      toast.error("PI Round 5 must be closed as Selected or Rejected.");
      return;
    }
    setSavingOutcome(true);
    try {
      await evaluationsApi.complete(outcomeTarget.evalId, {
        decision: outcomeForm.decision,
        notes: outcomeForm.remarks.trim() || undefined,
        piScore: numericScore,
        roundId: outcomeTarget.roundId ?? undefined,
        roundNumber: outcomeTarget.roundNumber,
        noFurtherPiRequired: isFinalDecision,
        finalVerdict: isFinalDecision ? (outcomeForm.decision as "selected" | "rejected") : null,
      });
      toast.success(
        isFinalDecision
          ? `Candidate marked as ${outcomeForm.decision === "selected" ? "Selected" : "Rejected"}.`
          : `PI Round ${outcomeTarget.roundNumber} marked complete.`
      );
      setOutcomeOpen(false);
      setOutcomeTarget(null);
      qc.invalidateQueries({ queryKey: ["evaluator-view"] });
      qc.invalidateQueries({ queryKey: ["evaluations"] });
      void refetch();
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to save PI round outcome.");
    } finally {
      setSavingOutcome(false);
    }
  };

  const clearFilters = () => {
    setFilterStage("");
    setFilterPassFail("");
    setFilterPI("");
    setFilterPosition("");
    setSearchQuery("");
  };
  const hasFilters = filterStage || filterPassFail || filterPI || filterPosition || searchQuery;
  const scheduleCandidate = scheduleTarget
    ? records.find((record) => record.candidateId === scheduleTarget.candidateId) ?? null
    : null;
  const outcomeCandidate = outcomeTarget
    ? records.find((record) => record.candidateId === outcomeTarget.candidateId) ?? null
    : null;
  const finalDecisions = records.filter((record) => hasFinalPiVerdict(record)).length;
  const unscheduledPi = records.filter((record) => !getLatestPiRound(record) && !hasFinalPiVerdict(record)).length;
  const activePi = records.filter((record) => getSortedPiRounds(record).some((round) => ACTIVE_PI_STATUSES.has(round.status ?? ""))).length;
  const evaluatorInsights = [
    {
      label: "PI Closure",
      value: records.length ? `${Math.round((finalDecisions / records.length) * 100)}%` : "—",
      detail: `${finalDecisions} of ${records.length} candidates have a final PI verdict.`,
      icon: CheckCircle2,
      tone: finalDecisions ? "success" as const : "default" as const,
      progress: records.length ? Math.round((finalDecisions / records.length) * 100) : 0,
      href: "/dashboard/evaluations",
    },
    {
      label: "Needs Scheduling",
      value: unscheduledPi,
      detail: "Candidates without an active or completed PI round.",
      icon: CalendarPlus,
      tone: unscheduledPi ? "warning" as const : "success" as const,
      href: "/dashboard/evaluations",
    },
    {
      label: "Active Interviews",
      value: activePi,
      detail: "Scheduled or rescheduled PI rounds still in motion.",
      icon: Calendar,
      tone: activePi ? "info" as const : "success" as const,
      href: "/dashboard/evaluations",
    },
    {
      label: "Filtered View",
      value: filtered.length,
      detail: hasFilters ? "Candidates matching the active filters." : "All candidates currently visible to this evaluator.",
      icon: ClipboardCheck,
      tone: hasFilters ? "info" as const : "default" as const,
    },
  ];

  return (
    <div className="space-y-5 overflow-x-hidden animate-fade-in">
      <PageHeader
        title="Evaluator Dashboard"
        icon={ClipboardCheck}
        description={`${filtered.length} candidates · live data`}
        actions={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
            <Link href="/dashboard/assessment-platform/grading">
              <Button variant="outline" size="sm" className="w-full rounded-xl text-xs gap-1.5">
                <ClipboardCheck className="h-3.5 w-3.5" /> Assessment Grading
              </Button>
            </Link>
            <Link href="/dashboard/evaluations">
              <Button variant="outline" size="sm" className="w-full rounded-xl text-xs gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> PI Interviews
              </Button>
            </Link>
            <Button variant="ghost" size="icon" className="col-span-2 h-9 w-full rounded-xl sm:w-9" onClick={() => void refetch()}>
              <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map((metric) => (
          <KpiCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            icon={metric.icon}
            color={metric.color}
            loading={isLoading}
          />
        ))}
      </div>

      <DashboardInsightStrip
        title="Evaluator Operating Summary"
        subtitle="PI closure, scheduling needs, active interviews, and visible workload."
        insights={evaluatorInsights}
      />

      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <div className="relative col-span-2 min-w-0 sm:flex-1 sm:min-w-[180px]">
              <input
                type="text"
                placeholder="Search candidate, code, role…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <Select value={filterPosition} onValueChange={(v) => setFilterPosition(v ?? "")}>
              <SelectTrigger className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring sm:w-fit">
                <SelectValue placeholder="All Roles" />
              </SelectTrigger>
              <SelectContent>
                {positionList.map((p: { id: string; title: string }) => (
                  <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterStage} onValueChange={(v) => setFilterStage(v ?? "")}>
              <SelectTrigger className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring sm:w-fit">
                <SelectValue placeholder={STAGE_FILTER_OPTIONS.find((o) => o.value === "")?.label} />
              </SelectTrigger>
              <SelectContent>
                {STAGE_FILTER_OPTIONS.filter((o) => o.value !== "").map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterPassFail} onValueChange={(v) => setFilterPassFail(v ?? "")}>
              <SelectTrigger className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring sm:w-fit">
                <SelectValue placeholder={PASS_FAIL_OPTIONS.find((o) => o.value === "")?.label} />
              </SelectTrigger>
              <SelectContent>
                {PASS_FAIL_OPTIONS.filter((o) => o.value !== "").map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={filterPI} onValueChange={(v) => setFilterPI(v ?? "")}>
              <SelectTrigger className="h-9 w-full rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring sm:w-fit">
                <SelectValue placeholder={PI_FILTER_OPTIONS.find((o) => o.value === "")?.label} />
              </SelectTrigger>
              <SelectContent>
                {PI_FILTER_OPTIONS.filter((o) => o.value !== "").map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>

            {hasFilters && (
              <button
                onClick={clearFilters}
                className="col-span-2 flex h-9 items-center justify-center gap-1 rounded-full border border-destructive/30 bg-destructive/5 px-2.5 py-1 text-xs text-destructive sm:col-span-1 sm:h-auto"
              >
                <Filter className="h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3 sm:hidden">
        {isLoading ? (
          <Card className="border-0 shadow-sm">
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-20" />
            <p className="text-sm font-medium">No candidates match your filters</p>
            <p className="text-xs mt-1">Candidates in evaluation stages will appear here.</p>
          </div>
        ) : (
          filtered.map((r) => {
            const isExpanded = expandedRow === r.candidateId;
            const piRounds = getSortedPiRounds(r);
            const latestPiRound = getLatestPiRound(r);
            const activePiRound = getActivePiRound(r);
            const piClosed = hasFinalPiVerdict(r);
            const nextRoundNumber = getNextPiRoundNumber(r);
            const canSchedule = Boolean(r.evaluation?.id || r.piInterview?.evaluationId) && !piClosed;
            const scheduleTitle = activePiRound ? "Reschedule" : latestPiRound ? `Round ${nextRoundNumber}` : "Schedule PI";
            const canRecordOutcome = Boolean(latestPiRound) && !piClosed;

            return (
              <Card key={r.candidateId} className="overflow-hidden border-0 shadow-sm">
                <CardContent className="space-y-4 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-11 w-11 shrink-0">
                      <AvatarFallback className="text-xs bg-primary/10 text-primary">
                        {getInitials(r.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold leading-5">{r.fullName}</p>
                          <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{r.candidateCode}</p>
                        </div>
                        <Badge variant="outline" className="shrink-0 rounded-full px-2 text-[10px]">
                          {STAGE_LABELS[r.currentStage as keyof typeof STAGE_LABELS] ?? formatLabel(r.currentStage)}
                        </Badge>
                      </div>
                      <p className="mt-1 break-words text-xs text-muted-foreground">{r.positionTitle ?? "Role not set"}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-muted/20 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">PI Status</p>
                        {latestPiRound ? (
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">R{latestPiRound.roundNumber}</Badge>
                            <PIStatusBadge status={latestPiRound.status} />
                            <PIOutcomeBadge roundDecision={latestPiRound.roundDecision} finalVerdict={latestPiRound.finalVerdict} />
                          </div>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">Not scheduled</p>
                        )}
                      </div>
                      <DecisionBadge decision={r.finalDecision} />
                    </div>
                    {latestPiRound?.scheduledAt && (
                      <p className="mt-2 text-[10px] text-muted-foreground">{formatDateTime(latestPiRound.scheduledAt)}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl text-xs"
                      onClick={() => router.push(`/dashboard/candidates/${r.candidateId}`)}
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" /> View
                    </Button>
                    <Button
                      size="sm"
                      className="h-9 rounded-xl text-xs"
                      disabled={!canSchedule}
                      onClick={() => openSchedule(r)}
                    >
                      <CalendarPlus className="mr-1.5 h-3.5 w-3.5" /> {scheduleTitle}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl text-xs"
                      disabled={!canRecordOutcome}
                      onClick={() => openOutcome(r)}
                    >
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Outcome
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 rounded-xl text-xs"
                      onClick={() => setExpandedRow(isExpanded ? null : r.candidateId)}
                    >
                      {isExpanded ? <ChevronUp className="mr-1.5 h-3.5 w-3.5" /> : <ChevronDown className="mr-1.5 h-3.5 w-3.5" />}
                      Details
                    </Button>
                  </div>

                  {isExpanded && (
                    <div className="space-y-3 border-t border-border pt-3">
                      <div className="rounded-xl border border-border p-3">
                        <p className="font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">PI Summary</p>
                        {latestPiRound ? (
                          <div className="mt-2 space-y-2 text-xs">
                            <Row label="Latest Round" value={`Round ${latestPiRound.roundNumber}`} />
                            <Row label="Status" value={<PIStatusBadge status={latestPiRound.status} />} />
                            <Row label="Outcome" value={<PIOutcomeBadge roundDecision={latestPiRound.roundDecision} finalVerdict={latestPiRound.finalVerdict} />} />
                            <Row label="Assigned To" value={latestPiRound.evaluatorName ?? "Evaluation owner"} />
                            <Row label="Scheduled" value={latestPiRound.scheduledAt ? formatDateTime(latestPiRound.scheduledAt) : "—"} />
                            <Row label="Rounds" value={`${piRounds.length}/5`} />
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-muted-foreground">Not scheduled</p>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      <Card className="hidden border-0 shadow-sm sm:block">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
              <CheckCircle2 className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">No candidates match your filters</p>
              <p className="text-xs mt-1">Candidates in evaluation stages will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    {[
                      { key: "fullName" as SortKey, label: "Candidate" },
                      { key: null, label: "Role" },
                      { key: "currentStage" as SortKey, label: "Stage" },
                      { key: null, label: "PI" },
                      { key: "finalDecision" as SortKey, label: "Final" },
                      { key: null, label: "" },
                    ].map(({ key, label }) => (
                      <th
                        key={label}
                        onClick={() => key && toggleSort(key)}
                        className={cn(
                          "py-2.5 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground",
                          key && "cursor-pointer select-none hover:text-foreground"
                        )}
                      >
                        {label}{key && <SortIcon k={key} />}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const isExpanded = expandedRow === r.candidateId;
                    const piRounds = getSortedPiRounds(r);
                    const latestPiRound = getLatestPiRound(r);
                    const activePiRound = getActivePiRound(r);
                    const piClosed = hasFinalPiVerdict(r);
                    const nextRoundNumber = getNextPiRoundNumber(r);
                    const canSchedule = Boolean(r.evaluation?.id || r.piInterview?.evaluationId) && !piClosed;
                    const scheduleTitle = piClosed
                      ? "PI closed"
                      : activePiRound
                      ? `Reschedule PI Round ${activePiRound.roundNumber}`
                      : latestPiRound
                      ? `Schedule PI Round ${nextRoundNumber}`
                      : "Schedule PI Round 1";
                    const canRecordOutcome = Boolean(latestPiRound) && !piClosed;
                    return (
                      <Fragment key={r.candidateId}>
                        <tr
                          className="border-b border-border/40 hover:bg-muted/20 transition-colors group"
                        >
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2.5">
                              <Avatar className="h-8 w-8 shrink-0">
                                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                  {getInitials(r.fullName)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-sm font-medium leading-none">{r.fullName}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{r.candidateCode}</p>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-3">
                            <p className="text-xs text-muted-foreground">{r.positionTitle ?? "—"}</p>
                          </td>

                          <td className="py-3 px-3">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {STAGE_LABELS[r.currentStage as keyof typeof STAGE_LABELS] ?? formatLabel(r.currentStage)}
                            </span>
                          </td>

                          <td className="py-3 px-3">
                            {latestPiRound ? (
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <Badge variant="outline" className="h-5 rounded-full px-2 text-[10px]">
                                    R{latestPiRound.roundNumber}
                                  </Badge>
                                  <PIStatusBadge status={latestPiRound.status} />
                                  <PIOutcomeBadge roundDecision={latestPiRound.roundDecision} finalVerdict={latestPiRound.finalVerdict} />
                                </div>
                                <p className="text-[10px] text-muted-foreground">
                                  {piRounds.length}/5 rounds
                                  {latestPiRound.evaluatorName ? ` · ${latestPiRound.evaluatorName}` : ""}
                                </p>
                                {latestPiRound.scheduledAt && (
                                  <p className="text-[9px] text-muted-foreground">{formatDateTime(latestPiRound.scheduledAt)}</p>
                                )}
                              </div>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">Not scheduled</span>
                            )}
                          </td>

                          <td className="py-3 px-3 text-center">
                            <DecisionBadge decision={r.finalDecision} />
                          </td>

                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => router.push(`/dashboard/candidates/${r.candidateId}`)}
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title={scheduleTitle}
                                disabled={!canSchedule}
                                onClick={() => openSchedule(r)}
                              >
                                <CalendarPlus className="h-3.5 w-3.5 text-primary" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title={piClosed ? "PI outcome is already final" : latestPiRound ? `Record PI Round ${latestPiRound.roundNumber} outcome` : "Schedule PI first"}
                                disabled={!canRecordOutcome}
                                onClick={() => openOutcome(r)}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => setExpandedRow(isExpanded ? null : r.candidateId)}
                              >
                                {isExpanded
                                  ? <ChevronUp className="h-3.5 w-3.5" />
                                  : <ChevronDown className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-muted/10 border-b border-border/40">
                            <td colSpan={6} className="px-4 py-4">
                              <div className="grid grid-cols-1 gap-4 text-xs">
                                <div className="space-y-2 rounded-xl border border-border p-3">
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">PI Summary</p>
                                    {latestPiRound && (
                                      <Badge variant="outline" className="text-[10px]">
                                        {piRounds.length}/5 rounds
                                      </Badge>
                                    )}
                                  </div>
                                  {latestPiRound ? (
                                    <>
                                      <Row label="Latest Round" value={`Round ${latestPiRound.roundNumber}`} />
                                      <Row label="Status" value={<PIStatusBadge status={latestPiRound.status} />} />
                                      <Row
                                        label="Outcome"
                                        value={<PIOutcomeBadge roundDecision={latestPiRound.roundDecision} finalVerdict={latestPiRound.finalVerdict} />}
                                      />
                                      <Row label="Assigned To" value={latestPiRound.evaluatorName ?? "Evaluation owner"} />
                                      <Row label="Scheduled" value={latestPiRound.scheduledAt ? formatDateTime(latestPiRound.scheduledAt) : "—"} />
                                      <Row label="Mode" value={getModeLabel(latestPiRound.mode)} />
                                      {latestPiRound.score != null && <Row label="Score" value={`${latestPiRound.score}`} />}
                                      {latestPiRound.noFurtherPiRequired && (
                                        <p className="rounded-lg bg-violet-50 px-2.5 py-2 text-[11px] text-violet-700 dark:bg-violet-950/30 dark:text-violet-300">
                                          No further PI required. Final verdict recorded in this round.
                                        </p>
                                      )}
                                      <div className="flex flex-wrap gap-2 pt-1">
                                        {!piClosed && (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="rounded-full text-xs h-7 gap-1"
                                            onClick={() => openOutcome(r)}
                                          >
                                            <CheckCircle2 className="h-3 w-3" /> Record Outcome
                                          </Button>
                                        )}
                                        {canSchedule && (
                                          <Button
                                            size="sm"
                                            className="rounded-full text-xs h-7 gap-1"
                                            onClick={() => openSchedule(r)}
                                          >
                                            <CalendarPlus className="h-3 w-3" />
                                            {activePiRound ? "Reschedule Active Round" : `Schedule Round ${nextRoundNumber}`}
                                          </Button>
                                        )}
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <p className="text-muted-foreground text-xs">Not scheduled</p>
                                      {r.evaluation?.id && (
                                        <Button
                                          size="sm"
                                          className="rounded-full text-xs h-7 mt-1 w-full gap-1"
                                          onClick={() => openSchedule(r)}
                                        >
                                          <CalendarPlus className="h-3 w-3" /> Schedule PI
                                        </Button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>

                              {piRounds.length > 0 && (
                                <div className="mt-4 rounded-xl border border-border p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <p className="font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">PI Journey</p>
                                      <p className="text-xs text-muted-foreground mt-1">
                                        All scheduled and completed PI rounds, including evaluators, marks, remarks, and final outcome.
                                      </p>
                                    </div>
                                    <Badge variant="outline" className="text-[10px]">
                                      {piRounds.length} round{piRounds.length !== 1 ? "s" : ""}
                                    </Badge>
                                  </div>

                                  <div className="mt-3 grid gap-3 xl:grid-cols-2">
                                    {piRounds.map((round) => {
                                      const roundRemark = getPiRemark(round);
                                      const roundIsActionable = !round.finalVerdict && round.roundNumber === (latestPiRound?.roundNumber ?? round.roundNumber);
                                      return (
                                        <div key={round.id} className="rounded-xl border border-border/60 bg-background/70 p-3">
                                          <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div>
                                              <p className="text-sm font-semibold">Round {round.roundNumber}</p>
                                              <p className="text-[11px] text-muted-foreground">
                                                {round.subject ?? "PI Interview"}
                                              </p>
                                            </div>
                                            <div className="flex flex-wrap gap-1.5">
                                              <PIStatusBadge status={round.status} />
                                              <PIOutcomeBadge roundDecision={round.roundDecision} finalVerdict={round.finalVerdict} />
                                            </div>
                                          </div>

                                          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                                            <Row label="Evaluator" value={round.evaluatorName ?? "Evaluation owner"} />
                                            <Row label="Mode" value={getModeLabel(round.mode)} />
                                            <Row label="Scheduled" value={round.scheduledAt ? formatDateTime(round.scheduledAt) : "—"} />
                                            <Row label="Completed" value={round.completedAt ? formatDateTime(round.completedAt) : "—"} />
                                            <Row label="Score" value={round.score != null ? `${round.score}` : "—"} />
                                            <Row label="Panel" value={round.panelLabel ?? "—"} />
                                          </div>

                                          {round.panelMembers && round.panelMembers.length > 0 && (
                                            <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                                                <Users className="h-3 w-3" /> Panel Members
                                              </p>
                                              <p className="mt-1 text-xs text-muted-foreground">
                                                {round.panelMembers.join(", ")}
                                              </p>
                                            </div>
                                          )}

                                          <div className="mt-3 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                                            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Remarks</p>
                                            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                                              {roundRemark ?? "No remarks added yet."}
                                            </p>
                                          </div>

                                          {roundIsActionable && (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                              {ACTIVE_PI_STATUSES.has(round.status ?? "") && (
                                                <Button
                                                  size="sm"
                                                  variant="outline"
                                                  className="rounded-full text-xs h-7 gap-1"
                                                  onClick={() => openSchedule(r, round.id, round.roundNumber)}
                                                >
                                                  <CalendarPlus className="h-3 w-3" /> Reschedule
                                                </Button>
                                              )}
                                              {!piClosed && (
                                                <Button
                                                  size="sm"
                                                  className="rounded-full text-xs h-7 gap-1"
                                                  onClick={() => openOutcome(r, round.id)}
                                                >
                                                  <CheckCircle2 className="h-3 w-3" /> Save Outcome
                                                </Button>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {r.evaluation && (
                                <div className="mt-3 rounded-xl border border-border p-3 text-xs space-y-1.5">
                                  <p className="font-semibold text-[11px] uppercase tracking-wider text-muted-foreground">PI Evaluation Result</p>
                                  <div className="flex flex-wrap gap-4">
                                    {r.evaluation.totalScore != null && (
                                      <Row label="Score" value={`${r.evaluation.totalScore}/10`} />
                                    )}
                                    <Row label="Recommendation" value={r.evaluation.recommendation ? formatLabel(r.evaluation.recommendation) : "—"} />
                                    {r.evaluation.evaluatorName && <Row label="Evaluator" value={r.evaluation.evaluatorName} />}
                                    {r.evaluation.completedAt && <Row label="Completed" value={timeAgo(r.evaluation.completedAt)} />}
                                  </div>
                                  {r.evaluation.notes && (
                                    <p className="text-muted-foreground leading-relaxed mt-1">{r.evaluation.notes}</p>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={scheduleOpen} onOpenChange={(open) => { if (!open) setScheduleTarget(null); setScheduleOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-primary" />
              {scheduleTarget?.roundId ? `Reschedule PI Round ${scheduleForm.roundNumber}` : `Schedule PI Round ${scheduleForm.roundNumber}`}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {scheduleCandidate && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <p className="text-sm font-semibold">{scheduleCandidate.fullName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {scheduleCandidate.candidateCode} · {scheduleCandidate.positionTitle ?? "Role not set"}
                </p>
              </div>
            )}
            {process.env.NODE_ENV !== "production" && (
              <div
                className="rounded-xl px-3 py-2 flex items-center justify-between"
                style={{ background: "rgba(237,0,237,0.06)", border: "1px dashed rgba(237,0,237,0.30)" }}
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(237,0,237,0.70)" }}>
                  Dev Demo
                </span>
                <button
                  type="button"
                  className="text-xs font-medium rounded-lg px-2.5 py-1 transition-colors"
                  style={{ background: "rgba(237,0,237,0.12)", color: "#ED00ED" }}
                  onClick={() => {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    setScheduleForm((current) => ({
                      ...current,
                      subject: `PI Interview - Round ${current.roundNumber}`,
                      date: tomorrow.toISOString().slice(0, 10),
                      time: "14:00",
                      durationMinutes: "60",
                      mode: "google_meet",
                      evaluatorId: current.evaluatorId,
                      panelLabel: "Final Panel",
                      panelMembers: "HR Lead, Delivery Manager",
                      notes: "Google Meet link: https://meet.google.com/demo-link\nPlease prepare a brief introduction and be ready to discuss your project experience.",
                    }));
                  }}
                >
                  Fill demo data
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Round</Label>
                <Input
                  value={`Round ${scheduleForm.roundNumber}`}
                  readOnly
                  className="rounded-xl bg-muted/40"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Assign Evaluator</Label>
                <Select value={scheduleForm.evaluatorId} onValueChange={(v) => setScheduleForm((f) => ({ ...f, evaluatorId: v ?? "" }))}>
                  <SelectTrigger className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    <SelectValue placeholder="Keep evaluation owner" />
                  </SelectTrigger>
                  <SelectContent>
                    {evaluators.map((evaluator) => (
                      <SelectItem key={evaluator.id} value={evaluator.id}>{evaluator.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Meeting Title *</Label>
              <Input
                value={scheduleForm.subject}
                onChange={(e) => setScheduleForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="e.g. PI Interview Round 1 - Technical Discussion"
                className="rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date *</Label>
                <DatePicker
                  min={minScheduleDate}
                  value={scheduleForm.date}
                  onChange={(v) => setScheduleForm((f) => ({ ...f, date: v }))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Time *</Label>
                <Input
                  type="time"
                  value={scheduleForm.time}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, time: e.target.value }))}
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Panel Label</Label>
                <Input
                  value={scheduleForm.panelLabel}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, panelLabel: e.target.value }))}
                  placeholder="e.g. HR + Business Panel"
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select value={scheduleForm.durationMinutes} onValueChange={(v) => setScheduleForm((f) => ({ ...f, durationMinutes: v ?? "" }))}>
                  <SelectTrigger className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["30", "45", "60", "90", "120"].map((d) => (
                      <SelectItem key={d} value={d}>{d} min</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select value={scheduleForm.mode} onValueChange={(v) => setScheduleForm((f) => ({ ...f, mode: v ?? "" }))}>
                  <SelectTrigger className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MODE_OPTIONS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Panel Members</Label>
                <Input
                  value={scheduleForm.panelMembers}
                  onChange={(e) => setScheduleForm((f) => ({ ...f, panelMembers: e.target.value }))}
                  placeholder="Name 1, Name 2"
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Instructions / Notes</Label>
              <Textarea
                value={scheduleForm.notes}
                onChange={(e) => setScheduleForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Meeting link, location, preparation notes…"
                className="rounded-xl resize-none min-h-[70px]"
              />
              <p className="text-[11px] text-muted-foreground">
                These notes will be stored with the round and shown in the candidate&apos;s PI history.
              </p>
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" size="sm" className="rounded-xl text-xs" />}>
              Cancel
            </DialogClose>
            <Button
              size="sm"
              className="rounded-xl text-xs"
              disabled={scheduling || !scheduleForm.subject.trim() || !scheduleForm.date || !scheduleForm.time}
              onClick={handleSchedule}
            >
              {scheduling
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Scheduling…</>
                : <><CalendarPlus className="h-3.5 w-3.5 mr-1.5" />Confirm Schedule</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={outcomeOpen} onOpenChange={(open) => { if (!open) setOutcomeTarget(null); setOutcomeOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              Save PI Round Outcome
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {outcomeCandidate && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <p className="text-sm font-semibold">{outcomeCandidate.fullName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Round {outcomeTarget?.roundNumber} · {outcomeCandidate.positionTitle ?? "Role not set"}
                </p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Outcome</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { value: "proceed_to_next_round" as OutcomeDecision, label: "Next Round", tone: "border-amber-300 text-amber-700 bg-amber-50" },
                  { value: "selected" as OutcomeDecision, label: "Selected", tone: "border-emerald-300 text-emerald-700 bg-emerald-50" },
                  { value: "rejected" as OutcomeDecision, label: "Rejected", tone: "border-red-300 text-red-700 bg-red-50" },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setOutcomeForm((form) => ({ ...form, decision: option.value }))}
                    className={cn(
                      "rounded-xl border px-3 py-2 text-xs font-medium transition-colors",
                      outcomeForm.decision === option.value
                        ? option.tone
                        : "border-border bg-background text-muted-foreground hover:border-primary/30 hover:text-foreground"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Round Score</Label>
              <Input
                type="number"
                min="0"
                max="100"
                value={outcomeForm.piScore}
                onChange={(e) => setOutcomeForm((form) => ({ ...form, piScore: e.target.value }))}
                placeholder="0 - 100"
                className="rounded-xl"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Remarks</Label>
              <Textarea
                value={outcomeForm.remarks}
                onChange={(e) => setOutcomeForm((form) => ({ ...form, remarks: e.target.value }))}
                placeholder="Round summary, strengths, risks, panel feedback..."
                className="rounded-xl resize-none min-h-[110px]"
              />
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/20 p-3 text-[11px] text-muted-foreground">
              {outcomeForm.decision === "proceed_to_next_round"
                ? outcomeTarget?.roundNumber === 5
                  ? "Round 5 cannot proceed further. Choose Selected or Rejected to close this PI journey."
                  : "This keeps the PI journey open so the next round can be scheduled."
                : "This will mark the candidate with No Further PI Required and store the final verdict on this round."}
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" size="sm" className="rounded-xl text-xs" />}>
              Cancel
            </DialogClose>
            <Button
              size="sm"
              className="rounded-xl text-xs"
              disabled={savingOutcome}
              onClick={handleOutcomeSave}
            >
              {savingOutcome
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Saving…</>
                : <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />Save Outcome</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

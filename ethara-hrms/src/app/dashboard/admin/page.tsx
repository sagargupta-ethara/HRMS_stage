"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ElementType, type FormEvent } from "react";
import {
  AlertTriangle, ArrowRight, BarChart3, Bell, Briefcase,
  CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, Clock3,
  Download, FileText, RefreshCw, Search, Sparkles, TrendingDown,
  TrendingUp, UploadCloud, UserCheck, UserPlus, Users,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { StageBadge } from "@/components/shared/stage-timeline";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DashboardDateRangeFilter,
  dashboardDateRangeParams,
  type DashboardDateRange,
} from "@/components/dashboard/date-range-filter";
import {
  attendanceApi, candidatesApi, employeesApi, escalationsApi, evaluationsApi,
  notificationsApi, reportsApi,
  type EmployeeRecord, type NotificationRecord,
} from "@/lib/api";
import { attendanceRangeForShortcut } from "@/lib/attendance-dates";
import { useAuth } from "@/lib/auth-context";
import { cn, formatCurrentDateLabel, formatDateTime, formatLabel, getInitials, SOURCE_LABELS, timeAgo } from "@/lib/utils";
import type { CandidateStage, SourceType } from "@/types";
import { exportToCsv } from "@/lib/export";

// ─── Types ───────────────────────────────────────────────────────────────────

type CandidateRow = {
  id: string;
  candidateCode: string;
  fullName: string;
  personalEmail: string;
  sourceType: SourceType;
  currentStage: CandidateStage;
  priorityScore: number;
  createdAt: string;
  position?: { title?: string; urgencyLevel?: number };
};

type FunnelRow = { month: string; applied: number; shortlisted: number; joined: number };
type GraphRange = "month" | "week";
type HiringChartRow = { label: string; applications: number; shortlisted: number; joined: number };
type WeeklySummaryRow = { label: string; from: string; to: string; summary?: Summary };

type Summary = {
  totalCandidates: number;
  thisMonth: number;
  joined: number;
  activeEscalations: number;
  pendingEvaluations: number;
  sourceBreakdown: Array<{ sourceType: SourceType; _count: number }>;
  stageBreakdown?: Array<{ currentStage: string; _count: number }>;
};

type EvalRound = {
  id?: string;
  roundNumber?: number;
  scheduledAt?: string | null;
  completedAt?: string | null;
  score?: number | null;
  evaluatorName?: string | null;
  panelLabel?: string | null;
  finalVerdict?: string | null;
};

type EvaluationItem = {
  id: string;
  candidateId: string;
  candidate?: { fullName?: string; full_name?: string } | null;
  evaluator?: { name?: string } | null;
  position?: { title?: string } | null;
  createdAt?: string;
  completedAt?: string | null;
  totalScore?: number | null;
  recommendation?: string | null;
  interviewScheduledAt?: string | null;
  piRounds?: EvalRound[];
};

type Tone = "default" | "success" | "warning" | "danger" | "info";
type Priority = "High" | "Medium" | "Low";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_COLORS = ["#ED00ED", "#908DCE", "#38BDF8", "#22c55e", "#f59e0b", "#ef4444"];

const CARD_STYLE = {
  background: "rgba(25,24,44,0.85)",
  border: "1px solid rgba(144,141,206,0.18)",
  backdropFilter: "blur(16px)",
};

const TONE_CLASS: Record<Tone, string> = {
  default: "bg-primary/15 text-primary",
  success: "bg-emerald-500/15 text-emerald-400",
  warning: "bg-amber-500/15 text-amber-400",
  danger: "bg-red-500/15 text-red-400",
  info: "bg-sky-500/15 text-sky-400",
};

const PRIORITY_CLASS: Record<Priority, string> = {
  High: "bg-red-500/15 text-red-300",
  Medium: "bg-amber-500/15 text-amber-300",
  Low: "bg-sky-500/15 text-sky-300",
};

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: "rgba(8,8,16,0.96)",
    border: "1px solid rgba(144,141,206,0.22)",
    borderRadius: 10,
    fontSize: 12,
    color: "#C5CBE8",
  },
  itemStyle: { color: "#F8FAFC", fontWeight: 600 },
  labelStyle: { color: "#C5CBE8", fontWeight: 600 },
  cursor: { stroke: "rgba(237,0,237,0.15)", strokeWidth: 1 },
};

type PipelineStageConfig = { label: string; keys: string[]; href: string };

// Pipeline buckets keyed to candidate `currentStage` values.
const PIPELINE_STAGES: PipelineStageConfig[] = [
  { label: "Applied", keys: ["new_application", "source_tagged", "resume_uploaded"], href: "/dashboard/candidates" },
  { label: "Screening", keys: ["resume_screening_pending"], href: "/dashboard/screening" },
  { label: "Shortlisted", keys: ["resume_shortlisted"], href: "/dashboard/candidates" },
  { label: "Evaluation", keys: ["evaluation_assigned", "evaluation_in_progress"], href: "/dashboard/evaluations" },
  { label: "Offer & Forms", keys: ["evaluation_passed", "selection_form_sent", "selection_form_submitted", "selection_form_validated"], href: "/dashboard/selection-forms" },
  { label: "Contract", keys: ["contract_sent", "contract_signed"], href: "/dashboard/contracts" },
  { label: "Onboarding", keys: ["induction_completed", "it_email_created", "welcome_mail_sent", "statutory_forms_sent", "statutory_forms_submitted", "compliance_verified"], href: "/dashboard/compliance" },
  { label: "Joined", keys: ["onboarding_completed"], href: "/dashboard/employees" },
];

const CURRENT_PIPELINE_STAGES: PipelineStageConfig[] = [
  ...PIPELINE_STAGES,
  { label: "Rejected", keys: ["resume_rejected", "evaluation_failed"], href: "/dashboard/candidates" },
];

const REJECTED_STAGE_REACH: Record<string, number> = {
  resume_rejected: 1,
  evaluation_failed: 3,
};

const PERF_METRICS: Array<{ key: "applications" | "shortlisted" | "joined"; label: string; color: string }> = [
  { key: "applications", label: "Applications", color: "#ED00ED" },
  { key: "shortlisted", label: "Resume Screened", color: "#908DCE" },
  { key: "joined", label: "Joined", color: "#38BDF8" },
];

const GRAPH_RANGE_OPTIONS: Array<{ key: GraphRange; label: string }> = [
  { key: "month", label: "Monthly" },
  { key: "week", label: "Weekly" },
];

const MS_PER_DAY = 86_400_000;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORTLISTED_OR_LATER_STAGE_NAMES = new Set(PIPELINE_STAGES.slice(2).flatMap((stage) => stage.keys));

function cumulativePipelineCounts(summary?: Summary | null) {
  const counts = PIPELINE_STAGES.map(() => 0);
  const stageToBucket = new Map<string, number>();
  PIPELINE_STAGES.forEach((bucket, index) => bucket.keys.forEach((stage) => stageToBucket.set(stage, index)));
  (summary?.stageBreakdown ?? []).forEach((row) => {
    const reach = stageToBucket.get(row.currentStage) ?? REJECTED_STAGE_REACH[row.currentStage];
    if (reach === undefined) return;
    const count = Number(row._count ?? 0);
    for (let index = 0; index <= reach; index += 1) counts[index] += count;
  });
  return counts;
}

function localIsoDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function compactDayLabel(value: Date) {
  return `${MONTH_SHORT[value.getMonth()]} ${String(value.getDate()).padStart(2, "0")}`;
}

function buildWeeklySlots(now: Date): WeeklySummaryRow[] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: 6 }, (_, index) => {
    const slotEnd = new Date(end.getTime() - (5 - index) * 7 * MS_PER_DAY);
    const slotStart = new Date(slotEnd.getTime() - 6 * MS_PER_DAY);
    return {
      label: `${compactDayLabel(slotStart)}-${compactDayLabel(slotEnd)}`,
      from: localIsoDate(slotStart),
      to: localIsoDate(slotEnd),
    };
  });
}

function countShortlistedOrLater(summary?: Summary | null) {
  return (summary?.stageBreakdown ?? []).reduce((total, row) => (
    total + (SHORTLISTED_OR_LATER_STAGE_NAMES.has(row.currentStage) ? row._count : 0)
  ), 0);
}

function percent(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// ─── Small building blocks ─────────────────────────────────────────────────────

function Panel({ title, subtitle, action, icon: Icon, children, className }: {
  title: string;
  subtitle?: string;
  action?: { label: string; href: string };
  icon?: ElementType;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-2xl p-4 sm:p-5", className)} style={CARD_STYLE}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#C5CBE8" }}>
            {Icon && <Icon className="h-4 w-4 text-primary" />}{title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs" style={{ color: "rgba(197,203,232,0.42)" }}>{subtitle}</p>}
        </div>
        {action && (
          <Link href={action.href} className="shrink-0 text-xs font-medium text-primary hover:underline">
            {action.label}
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function OpStatCard({ label, value, detail, icon: Icon, tone = "default", trend, href }: {
  label: string; value: string | number; detail: string; icon: ElementType;
  tone?: Tone; trend?: string; href: string;
}) {
  const down = trend?.trim().startsWith("-");
  return (
    <Link href={href} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30" style={CARD_STYLE}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}>{label}</p>
          <p className="mt-1.5 text-2xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{value}</p>
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {trend ? (
        <p className={cn("mt-2 flex items-center gap-1 text-[11px] font-medium", down ? "text-red-400" : "text-emerald-400")}>
          {down ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />} {trend}
        </p>
      ) : (
        <p className="mt-2 truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{detail}</p>
      )}
    </Link>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DashboardDateRange>({ from: "", to: "" });
  const [nowMs, setNowMs] = useState<number | null>(null);
  const [graphRange, setGraphRange] = useState<GraphRange>("month");
  const [activeMetrics, setActiveMetrics] = useState<Record<string, boolean>>({ applications: true, shortlisted: true, joined: true });
  const [globalSearch, setGlobalSearch] = useState("");
  const dateParams = useMemo(() => dashboardDateRangeParams(dateRange), [dateRange]);
  const todayIso = nowMs ? localIsoDate(new Date(nowMs)) : "";
  const weeklySlots = useMemo(() => (nowMs ? buildWeeklySlots(new Date(nowMs)) : []), [nowMs]);
  const weeklyRangeStart = weeklySlots[0]?.from ?? "";
  const weeklyRangeEnd = weeklySlots[weeklySlots.length - 1]?.to ?? "";

  const { data: escalations = [] } = useQuery({
    queryKey: ["escalations-admin"],
    queryFn: () => escalationsApi.list({ status: "open" }),
    staleTime: 30_000,
  });
  const { data: evaluationsRaw = [] } = useQuery({
    queryKey: ["evaluations-admin"],
    queryFn: () => evaluationsApi.list(),
    staleTime: 30_000,
  });
  const { data: funnelRows = [], isLoading: isFunnelLoading } = useQuery({
    queryKey: ["reports-funnel-admin", dateRange.from, dateRange.to],
    queryFn: () => reportsApi.funnel(dateParams),
    staleTime: 60_000,
  });
  const { data: employees = [] } = useQuery({
    queryKey: ["employees-admin"],
    queryFn: () => employeesApi.list({ limit: 5000 }),
    staleTime: 60_000,
  });
  const { data: attendance } = useQuery({
    queryKey: ["attendance-today-admin"],
    queryFn: () => attendanceApi.summary({ ...attendanceRangeForShortcut("today"), mapped: true }),
    staleTime: 60_000,
  });
  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications-admin"],
    queryFn: () => notificationsApi.list(),
    staleTime: 30_000,
  });
  const { data: todaySummary } = useQuery({
    queryKey: ["reports-summary-today-admin", todayIso],
    queryFn: () => reportsApi.summary({ createdFrom: todayIso, createdTo: todayIso }) as Promise<Summary>,
    enabled: Boolean(todayIso),
    staleTime: 60_000,
  });
  const { data: weeklySummaries = [], isFetching: isFetchingWeekly } = useQuery({
    queryKey: ["reports-weekly-admin", weeklyRangeStart, weeklyRangeEnd],
    queryFn: () => Promise.all(weeklySlots.map(async (slot) => ({
      ...slot,
      summary: (await reportsApi.summary({ createdFrom: slot.from, createdTo: slot.to })) as Summary,
    }))),
    enabled: graphRange === "week" && weeklySlots.length > 0,
    staleTime: 60_000,
  });

  const evaluations = useMemo(() => (Array.isArray(evaluationsRaw) ? (evaluationsRaw as EvaluationItem[]) : []), [evaluationsRaw]);
  const employeeList = useMemo(() => (Array.isArray(employees) ? (employees as EmployeeRecord[]) : []), [employees]);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [summaryData, candidateData] = await Promise.all([
        reportsApi.summary(dateParams),
        candidatesApi.list({ ...dateParams, limit: 100, sortBy: "createdAt", sortDir: "desc" }),
      ]);
      setSummary(summaryData);
      setCandidates(candidateData.data ?? []);
      setCandidateTotal(candidateData.total ?? candidateData.data?.length ?? 0);
    } catch {
      // Non-fatal: dashboard degrades to empty states.
    } finally {
      setIsLoading(false);
    }
  }, [dateParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────
  const stageCount = useCallback((keys: string[]) => {
    const set = new Set(keys);
    return (summary?.stageBreakdown ?? []).reduce((t, s) => t + (set.has(s.currentStage) ? s._count : 0), 0);
  }, [summary]);

  const totalCandidates = summary?.totalCandidates ?? candidateTotal;

  const candidateTrend = useMemo(() => {
    const rows = Array.isArray(funnelRows) ? (funnelRows as FunnelRow[]) : [];
    const current = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    if (!current || !previous || !previous.applied) return undefined;
    const delta = Math.round(((current.applied - previous.applied) / previous.applied) * 100);
    return `${delta >= 0 ? "+" : ""}${delta}% vs last month`;
  }, [funnelRows]);

  const newAppsToday = useMemo(() => candidates.filter((c) => String(c.createdAt).slice(0, 10) === todayIso).length, [candidates, todayIso]);
  const todayNewApplications = todaySummary?.totalCandidates ?? newAppsToday;
  const joinedToday = useMemo(() => employeeList.filter((e) => String(e.createdAt).slice(0, 10) === todayIso).length, [employeeList, todayIso]);

  // Interview rounds flattened from evaluations.
  const upcomingRounds = useMemo(() => {
    const rows: Array<{ id: string; candidate: string; position: string; scheduledAt: string; interviewer: string; round: number }> = [];
    evaluations.forEach((ev) => {
      (ev.piRounds ?? []).forEach((r) => {
        if (!r.scheduledAt || r.completedAt) return;
        rows.push({
          id: r.id ?? `${ev.id}-${r.roundNumber}`,
          candidate: ev.candidate?.fullName ?? ev.candidate?.full_name ?? "—",
          position: ev.position?.title ?? "Unassigned",
          scheduledAt: r.scheduledAt,
          interviewer: r.evaluatorName ?? ev.evaluator?.name ?? "Unassigned",
          round: r.roundNumber ?? 1,
        });
      });
    });
    return rows.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [evaluations]);

  const interviewsToday = useMemo(() => upcomingRounds.filter((r) => String(r.scheduledAt).slice(0, 10) === todayIso).length, [upcomingRounds, todayIso]);
  const totalEscalations = useMemo(() => (Array.isArray(escalations) ? escalations : []).length, [escalations]);
  const escalationAging = useMemo(() => {
    if (!nowMs) return 0;
    return (Array.isArray(escalations) ? escalations : []).filter((e: { createdAt?: string; created_at?: string }) => {
      const created = new Date(e.createdAt ?? e.created_at ?? "").getTime();
      return Number.isFinite(created) && (nowMs - created) / 36e5 > 48;
    }).length;
  }, [escalations, nowMs]);

  const screeningPending = useMemo(() => stageCount(["resume_screening_pending"]), [stageCount]);
  const shortlisted = useMemo(() => stageCount(["resume_shortlisted"]), [stageCount]);
  const offersPending = useMemo(() => stageCount(["evaluation_passed", "selection_form_sent", "selection_form_submitted"]), [stageCount]);
  const onboardingPending = useMemo(() => employeeList.filter((e) => e.selectionFormStatus && e.selectionFormStatus !== "submitted").length, [employeeList]);
  const pendingEvaluations = summary?.pendingEvaluations ?? 0;
  const tasksDueToday = interviewsToday + screeningPending + pendingEvaluations;

  const activeEmployees = useMemo(() => employeeList.filter((e) => e.isActive).length, [employeeList]);
  const newJoinersMonth = useMemo(() => {
    if (!nowMs) return 0;
    const d = new Date(nowMs);
    const prefix = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return employeeList.filter((e) => String(e.createdAt).slice(0, 7) === prefix).length;
  }, [employeeList, nowMs]);
  const presentToday = attendance?.present ?? 0;
  const attendanceTracked = attendance?.total ?? 0;
  const presentRate = attendanceTracked ? Math.round((presentToday / attendanceTracked) * 100) : 0;
  const departments = useMemo(() => new Set(employeeList.map((e) => e.department).filter(Boolean)).size, [employeeList]);

  const todayTiles: Array<{ label: string; value: string | number; detail: string; icon: ElementType; tone: Tone; trend?: string; href: string }> = [
    { label: "New Applications", value: todayNewApplications, detail: `${summary?.thisMonth ?? 0} this month`, icon: UserPlus, tone: "default" as Tone, trend: candidateTrend, href: "/dashboard/candidates" },
    { label: "Interviews Today", value: interviewsToday, detail: `${upcomingRounds.length} scheduled total`, icon: CalendarClock, tone: "info" as Tone, href: "/dashboard/evaluations" },
    { label: "Offers Pending", value: offersPending, detail: "Awaiting acceptance", icon: FileText, tone: offersPending ? "warning" : "success", href: "/dashboard/selection-forms" },
    { label: "Employees Joined", value: joinedToday, detail: `${newJoinersMonth} this month`, icon: UserCheck, tone: "success" as Tone, href: "/dashboard/employees" },
    { label: "Resume Reviews Pending", value: screeningPending, detail: "Waiting on screening", icon: ClipboardCheck, tone: screeningPending ? "warning" : "success", href: "/dashboard/screening" },
    { label: "Tasks Due Today", value: tasksDueToday, detail: "Interviews + queues", icon: Clock3, tone: tasksDueToday ? "danger" : "success", href: "/dashboard/evaluations" },
  ];

  const currentPipeline = useMemo(() => {
    const rows = CURRENT_PIPELINE_STAGES.map((s) => {
      const count = stageCount(s.keys);
      return { ...s, count, conversion: percent(count, totalCandidates) };
    });
    const knownTotal = rows.reduce((sum, row) => sum + row.count, 0);
    const otherCount = Math.max(0, totalCandidates - knownTotal);
    return otherCount > 0
      ? [...rows, { label: "Other", keys: [], href: "/dashboard/candidates", count: otherCount, conversion: percent(otherCount, totalCandidates) }]
      : rows;
  }, [stageCount, totalCandidates]);

  const pipeline = useMemo(() => {
    const counts = cumulativePipelineCounts(summary);
    return PIPELINE_STAGES.map((stage, index) => {
      const count = counts[index] ?? 0;
      return { ...stage, count, conversion: percent(count, totalCandidates) };
    });
  }, [summary, totalCandidates]);

  const currentPipelineTotal = useMemo(() => currentPipeline.reduce((sum, row) => sum + row.count, 0), [currentPipeline]);

  const topSource = useMemo(() => {
    const rows = summary?.sourceBreakdown ?? [];
    return [...rows].sort((a, b) => Number(b._count ?? 0) - Number(a._count ?? 0))[0];
  }, [summary?.sourceBreakdown]);

  const workspaceInsights = useMemo(() => {
    const items: Array<{ text: string; icon: ElementType; href: string; cta: string }> = [];
    if (screeningPending > 0) {
      items.push({ text: `${screeningPending} candidate${screeningPending === 1 ? "" : "s"} need resume screening.`, icon: ClipboardCheck, href: "/dashboard/screening", cta: "Screen" });
    }
    if (pendingEvaluations > 0) {
      items.push({ text: `${pendingEvaluations} evaluation${pendingEvaluations === 1 ? "" : "s"} are pending feedback.`, icon: CalendarClock, href: "/dashboard/evaluations", cta: "Review" });
    }
    if (offersPending > 0) {
      items.push({ text: `${offersPending} offer-stage candidate${offersPending === 1 ? "" : "s"} need follow-up.`, icon: FileText, href: "/dashboard/selection-forms", cta: "Open" });
    }
    if (escalationAging > 0) {
      items.push({ text: `${escalationAging} escalation${escalationAging === 1 ? "" : "s"} have aged beyond 48 hours.`, icon: AlertTriangle, href: "/dashboard/escalations", cta: "Resolve" });
    }
    if (candidateTrend?.startsWith("-")) {
      items.push({ text: `Applications are down ${candidateTrend.replace("-", "").replace(" vs last month", "")} versus last month.`, icon: TrendingDown, href: "/dashboard/candidates", cta: "Analyse" });
    }
    if (topSource && Number(topSource._count ?? 0) > 0) {
      items.push({ text: `${SOURCE_LABELS[topSource.sourceType] ?? formatLabel(topSource.sourceType)} is the largest candidate source with ${topSource._count} record${topSource._count === 1 ? "" : "s"}.`, icon: Briefcase, href: "/dashboard/candidates", cta: "View" });
    }
    if (items.length === 0) {
      items.push({ text: "Pipeline activity is stable; keep sourcing aligned with open roles.", icon: Sparkles, href: "/dashboard/candidates", cta: "Open" });
    }
    return items.slice(0, 4);
  }, [candidateTrend, escalationAging, offersPending, pendingEvaluations, screeningPending, topSource]);

  const workQueue: Array<{ label: string; count: number; priority: Priority; aging?: string; href: string }> = ([
    { label: "Resume Screening", count: screeningPending, priority: "High", href: "/dashboard/screening" },
    { label: "Evaluations Pending", count: pendingEvaluations, priority: "High", href: "/dashboard/evaluations" },
    { label: "Shortlisted → Interview", count: shortlisted, priority: "Medium", href: "/dashboard/candidates" },
    { label: "Offer Letters", count: offersPending, priority: "Medium", href: "/dashboard/selection-forms" },
    { label: "Employee Onboarding", count: onboardingPending, priority: "Low", href: "/dashboard/employees" },
    { label: "Escalations", count: totalEscalations, priority: "High", aging: escalationAging ? `${escalationAging} over 48h` : undefined, href: "/dashboard/escalations" },
  ] as Array<{ label: string; count: number; priority: Priority; aging?: string; href: string }>).filter((q) => q.count > 0);

  const monthlyChartData = useMemo<HiringChartRow[]>(() => (
    (Array.isArray(funnelRows) ? funnelRows : []).map((row: FunnelRow) => ({
      label: row.month,
      applications: row.applied ?? 0,
      shortlisted: row.shortlisted ?? 0,
      joined: row.joined ?? 0,
    }))
  ), [funnelRows]);

  const weeklyChartData = useMemo<HiringChartRow[]>(() => (
    (weeklySummaries.length > 0 ? weeklySummaries : weeklySlots).map((row) => ({
      label: row.label,
      applications: row.summary?.totalCandidates ?? 0,
      shortlisted: countShortlistedOrLater(row.summary),
      joined: row.summary?.joined ?? 0,
    }))
  ), [weeklySlots, weeklySummaries]);

  const hiringChartData = graphRange === "week" ? weeklyChartData : monthlyChartData;
  const hiringMeasured = useMemo(() => {
    const applications = hiringChartData.reduce((sum, row) => sum + row.applications, 0);
    const shortlistedTotal = hiringChartData.reduce((sum, row) => sum + row.shortlisted, 0);
    const joinedTotal = hiringChartData.reduce((sum, row) => sum + row.joined, 0);
    return {
      applications,
      shortlisted: shortlistedTotal,
      joined: joinedTotal,
      conversion: percent(joinedTotal, applications),
    };
  }, [hiringChartData]);
  const isHiringChartLoading = graphRange === "week" ? isFetchingWeekly : isFunnelLoading;

  const unreadNotifications = useMemo(() => (Array.isArray(notifications) ? (notifications as NotificationRecord[]) : []).filter((n) => !n.isRead), [notifications]);

  const recentEmployees = useMemo(() => [...employeeList].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6), [employeeList]);

  const handleExportCandidates = () => {
    exportToCsv(
      candidates.map((c) => ({
        name: c.fullName, email: c.personalEmail, code: c.candidateCode,
        role: c.position?.title ?? "", stage: c.currentStage,
        source: SOURCE_LABELS[c.sourceType] ?? formatLabel(c.sourceType), applied: timeAgo(c.createdAt),
      })),
      [
        { key: "name", header: "Name" }, { key: "email", header: "Email" }, { key: "code", header: "Code" },
        { key: "role", header: "Role" }, { key: "stage", header: "Stage" }, { key: "source", header: "Source" },
        { key: "applied", header: "Applied" },
      ],
      `admin_candidates_${todayIso || "export"}.csv`,
    );
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = globalSearch.trim();
    router.push(q ? `/dashboard/candidates?search=${encodeURIComponent(q)}` : "/dashboard/candidates");
  };

  const quickActions = [
    { label: "Add Candidate", href: "/dashboard/candidates", icon: UserPlus },
    { label: "Upload Resume", href: "/dashboard/screening", icon: UploadCloud },
    { label: "Schedule Interview", href: "/dashboard/evaluations", icon: CalendarClock },
    { label: "Add Employee", href: "/dashboard/employees", icon: Users },
  ];

  const employeeTiles: Array<{ label: string; value: string | number; icon: ElementType; tone: Tone; href: string }> = [
    { label: "Active Employees", value: activeEmployees, icon: Users, tone: "default" as Tone, href: "/dashboard/employees" },
    { label: "New Joiners", value: newJoinersMonth, icon: UserPlus, tone: "success" as Tone, href: "/dashboard/employees" },
    { label: "Present Today", value: attendanceTracked ? `${presentRate}%` : "—", icon: UserCheck, tone: "info" as Tone, href: "/dashboard/attendance" },
    { label: "Absent Today", value: attendance?.absent ?? 0, icon: AlertTriangle, tone: (attendance?.absent ?? 0) ? "warning" : "success", href: "/dashboard/attendance" },
    { label: "Onboarding Pending", value: onboardingPending, icon: ClipboardCheck, tone: onboardingPending ? "warning" : "success", href: "/dashboard/employees" },
    { label: "Departments", value: departments, icon: Briefcase, tone: "default" as Tone, href: "/dashboard/employees" },
  ];

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden animate-fade-in">
      {/* 1 · Workspace header */}
      <div className="relative overflow-hidden rounded-2xl px-5 py-5 sm:px-6" style={CARD_STYLE}>
        <div className="pointer-events-none absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(ellipse at 85% 15%, rgba(237,0,237,0.25) 0%, transparent 55%)" }} />
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(197,203,232,0.50)" }}>Operations Workspace</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "#C5CBE8" }}>
                {user?.name ?? "Admin"}
              </h1>
              <p className="mt-1 flex items-center gap-1.5 text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>
                <CalendarDays className="h-3.5 w-3.5" /> {formatCurrentDateLabel({ weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DashboardDateRangeFilter value={dateRange} onChange={setDateRange} />
              <Link href="/dashboard/employee-evaluation">
                <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> AI Assistant</Button>
              </Link>
              <Link href="/dashboard/notifications" className="relative">
                <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5"><Bell className="h-3.5 w-3.5" /> Alerts</Button>
                {unreadNotifications.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-white">{unreadNotifications.length}</span>
                )}
              </Link>
              <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={handleExportCandidates}><Download className="h-3.5 w-3.5" /> Export</Button>
              <Button size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => void load()}><RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} /> Refresh</Button>
            </div>
          </div>
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <form onSubmit={handleSearch} className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: "rgba(197,203,232,0.4)" }} />
              <input
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Search candidates, employees, resumes…"
                className="h-10 w-full rounded-xl border border-[rgba(144,141,206,0.2)] bg-[rgba(20,19,36,0.6)] pl-9 pr-3 text-sm outline-none focus:border-primary/40"
                style={{ color: "#C5CBE8" }}
              />
            </form>
            <div className="flex flex-wrap gap-2">
              {quickActions.map((a) => {
                const Icon = a.icon;
                return (
                  <Link key={a.label} href={a.href}>
                    <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5"><Icon className="h-3.5 w-3.5 text-primary" /> {a.label}</Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 2 · Today's work summary */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 px-1">
          <Clock3 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Today&apos;s Work Summary</h2>
          <span className="text-xs" style={{ color: "rgba(197,203,232,0.42)" }}>· what needs attention right now</span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {todayTiles.map((t) => <OpStatCard key={t.label} {...t} />)}
        </div>
      </div>

      {/* 3 · Recruitment pipeline · Employee overview · Pending actions */}
      <div className="grid gap-3 xl:grid-cols-3 xl:items-start">
        <Panel title="Recruitment Pipeline" subtitle="Cumulative candidate movement by stage" icon={BarChart3} action={{ label: "Candidates", href: "/dashboard/candidates" }}>
          <div className="space-y-2.5">
            {pipeline.map((s) => (
              <Link key={s.label} href={s.href} className="block space-y-1 rounded-lg px-1 py-1 transition-colors hover:bg-white/[0.04]">
                <div className="flex items-center justify-between text-xs">
                  <span style={{ color: "rgba(197,203,232,0.65)" }}>{s.label}</span>
                  <span className="font-semibold" style={{ color: "#C5CBE8" }}>
                    {s.count} <span style={{ color: "rgba(197,203,232,0.4)" }}>· {s.conversion}%</span>
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, s.conversion)}%`, background: CHART_COLORS[0] }} />
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title="Employee Overview" subtitle="Workforce at a glance" icon={Users} action={{ label: "Directory", href: "/dashboard/employees" }}>
          <div className="grid grid-cols-2 gap-2.5">
            {employeeTiles.map((t) => {
              const Icon = t.icon;
              return (
                <Link key={t.label} href={t.href} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
                  <div className={cn("mb-1.5 flex h-7 w-7 items-center justify-center rounded-lg", TONE_CLASS[t.tone])}><Icon className="h-3.5 w-3.5" /></div>
                  <p className="text-lg font-bold leading-none" style={{ color: "#C5CBE8" }}>{t.value}</p>
                  <p className="mt-1 truncate text-[10px]" style={{ color: "rgba(197,203,232,0.5)" }}>{t.label}</p>
                </Link>
              );
            })}
          </div>
        </Panel>

        <Panel title="Pending Actions" subtitle="Team work queue by priority" icon={ClipboardCheck} action={{ label: "Escalations", href: "/dashboard/escalations" }}>
          {workQueue.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>All queues clear.</p></div>
          ) : (
            <div className="space-y-2">
              {workQueue.map((q) => (
                <Link key={q.label} href={q.href} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition-colors hover:border-primary/30">
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", PRIORITY_CLASS[q.priority])}>{q.priority}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{q.label}</p>
                    {q.aging && <p className="truncate text-[10px] text-red-400">{q.aging}</p>}
                  </div>
                  <span className="shrink-0 text-base font-semibold text-primary">{q.count}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* 4 · Hiring performance graph */}
      <Panel title="Hiring Performance" subtitle="Applications, screening, and joins by selected period" icon={TrendingUp}>
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {PERF_METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => setActiveMetrics((p) => ({ ...p, [m.key]: !p[m.key] }))}
                className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors", activeMetrics[m.key] ? "border-transparent text-[#0b0b14]" : "border-white/10 text-muted-foreground hover:border-primary/30")}
                style={activeMetrics[m.key] ? { background: m.color } : undefined}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: activeMetrics[m.key] ? "#0b0b14" : m.color }} /> {m.label}
              </button>
            ))}
          </div>
          <div className="inline-flex w-fit shrink-0 rounded-full border border-white/10 bg-white/[0.03] p-1">
            {GRAPH_RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setGraphRange(option.key)}
                className={cn("rounded-full px-3 py-1 text-[11px] font-semibold transition-colors", graphRange === option.key ? "bg-primary text-white" : "text-muted-foreground hover:text-primary")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Applications", value: hiringMeasured.applications },
            { label: "Resume Screened", value: hiringMeasured.shortlisted },
            { label: "Joined", value: hiringMeasured.joined },
            { label: "Join Rate", value: `${hiringMeasured.conversion}%` },
          ].map((item) => (
            <div key={item.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-lg font-bold leading-none" style={{ color: "#C5CBE8" }}>{item.value}</p>
              <p className="mt-1 truncate text-[10px] uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>{item.label}</p>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={hiringChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              {PERF_METRICS.map((m) => (
                <linearGradient key={m.key} id={`ga-${m.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={m.color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={m.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            {PERF_METRICS.filter((m) => activeMetrics[m.key]).map((m) => (
              <Area key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2} fill={`url(#ga-${m.key})`} dot={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
        {isHiringChartLoading ? (
          <p className="mt-3 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Loading hiring records...</p>
        ) : hiringChartData.every((row) => row.applications === 0 && row.shortlisted === 0 && row.joined === 0) && (
          <p className="mt-3 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No hiring activity recorded for the selected period.</p>
        )}
      </Panel>

      {/* 5 · AI insights */}
      <Panel title="AI Insights" subtitle="Recommendations from live Workspace data" icon={Sparkles}>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {workspaceInsights.map((insight) => {
            const Icon = insight.icon;
            return (
              <Link key={insight.text} href={insight.href} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{insight.text}</p>
                  <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">{insight.cta} <ArrowRight className="h-3 w-3" /></span>
                </div>
              </Link>
            );
          })}
        </div>
      </Panel>

      {/* 6 · Recent candidates */}
      <Panel title="Recent Candidates" subtitle="Latest applicants" icon={Users} action={{ label: `View all (${totalCandidates})`, href: "/dashboard/candidates" }}>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No candidates yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {candidates.slice(0, 8).map((c) => (
              <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar className="h-8 w-8 shrink-0"><AvatarFallback className="text-xs" style={{ background: "rgba(237,0,237,0.15)", color: "#ED00ED" }}>{getInitials(c.fullName)}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <Link href={`/dashboard/candidates/${c.id}`}><p className="truncate text-sm font-medium transition-colors hover:text-primary" style={{ color: "#C5CBE8" }}>{c.fullName}</p></Link>
                    <p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{c.position?.title ?? "Unassigned"} · {timeAgo(c.createdAt)}</p>
                  </div>
                  <StageBadge stage={c.currentStage} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Link href={`/dashboard/candidates/${c.id}`} className="flex-1"><Button variant="outline" size="sm" className="h-7 w-full rounded-lg text-[11px]">View</Button></Link>
                  <Link href="/dashboard/evaluations" className="flex-1"><Button variant="outline" size="sm" className="h-7 w-full rounded-lg text-[11px]">Schedule</Button></Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* 7 · Resume database · Candidate pipeline */}
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <Panel title="Resume Database" subtitle="Candidate resumes and sourcing" icon={FileText}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {[
              { label: "Total Resumes", value: totalCandidates },
              { label: "New This Month", value: summary?.thisMonth ?? 0 },
              { label: "Screening", value: screeningPending },
              { label: "Shortlisted", value: shortlisted },
            ].map((t) => (
              <div key={t.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <p className="text-xl font-bold" style={{ color: "#C5CBE8" }}>{t.value}</p>
                <p className="mt-1 truncate text-[10px]" style={{ color: "rgba(197,203,232,0.5)" }}>{t.label}</p>
              </div>
            ))}
          </div>
          {(summary?.sourceBreakdown ?? []).length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>Resume sources</p>
              {(summary?.sourceBreakdown ?? []).slice(0, 5).map((s, i) => {
                const max = Math.max(...(summary?.sourceBreakdown ?? []).map((x) => x._count), 1);
                return (
                  <div key={s.sourceType} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span style={{ color: "rgba(197,203,232,0.65)" }}>{SOURCE_LABELS[s.sourceType] ?? formatLabel(s.sourceType)}</span>
                      <span className="font-semibold" style={{ color: "#C5CBE8" }}>{s._count}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(3, (s._count / max) * 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/dashboard/candidates"><Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5"><Search className="h-3.5 w-3.5" /> Advanced Search</Button></Link>
            <Link href="/dashboard/screening"><Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> AI Resume Match</Button></Link>
          </div>
        </Panel>

        <Panel title="Candidate Pipeline" subtitle="Where candidates sit right now" icon={BarChart3} action={{ label: "Talent view", href: "/dashboard/module-overview/talent" }}>
          <div className="space-y-2.5">
            {currentPipeline.every((s) => s.count === 0) ? (
              <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No stage data yet.</p>
            ) : currentPipeline.map((s) => {
              const max = Math.max(...currentPipeline.map((x) => x.count), 1);
              return (
                <div key={s.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span style={{ color: "rgba(197,203,232,0.65)" }}>{s.label}</span>
                    <span className="font-semibold" style={{ color: "#C5CBE8" }}>{s.count}</span>
                  </div>
                  <div className="h-2 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, (s.count / max) * 100)}%`, background: CHART_COLORS[2] }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
            <span style={{ color: "rgba(197,203,232,0.55)" }}>Total current-stage records</span>
            <span className="font-semibold" style={{ color: "#C5CBE8" }}>{currentPipelineTotal} / {totalCandidates}</span>
          </div>
        </Panel>
      </div>

      {/* 8 · Recent employees · Upcoming interviews */}
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <Panel title="Recent Employees" subtitle="Newest joiners" icon={UserCheck} action={{ label: "Directory", href: "/dashboard/employees" }}>
          {recentEmployees.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No employees yet.</p>
          ) : (
            <div className="space-y-2">
              {recentEmployees.map((e) => (
                <Link key={e.id} href="/dashboard/employees" className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition-colors hover:border-primary/30">
                  <Avatar className="h-8 w-8 shrink-0"><AvatarFallback className="text-xs" style={{ background: "rgba(144,141,206,0.15)", color: "#908DCE" }}>{getInitials(e.name)}</AvatarFallback></Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: "#C5CBE8" }}>{e.name}</p>
                    <p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{e.designation ?? "—"}{e.department ? ` · ${e.department}` : ""}</p>
                  </div>
                  <span className="shrink-0 text-[11px]" style={{ color: "rgba(197,203,232,0.4)" }}>{e.createdAt ? timeAgo(e.createdAt) : "—"}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Upcoming Interviews" subtitle={`${upcomingRounds.length} scheduled`} icon={CalendarClock} action={{ label: "Evaluations", href: "/dashboard/evaluations" }}>
          {upcomingRounds.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No interviews scheduled.</p>
          ) : (
            <div className="space-y-2">
              {upcomingRounds.slice(0, 6).map((r) => {
                const overdue = nowMs ? new Date(r.scheduledAt).getTime() < nowMs : false;
                return (
                  <div key={r.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                    <div className={cn("flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg", overdue ? "bg-red-500/15 text-red-400" : "bg-sky-500/15 text-sky-400")}>
                      <CalendarClock className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" style={{ color: "#C5CBE8" }}>{r.candidate}</p>
                      <p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{r.position} · Round {r.round} · {r.interviewer}</p>
                      <p className={cn("truncate text-[10px]", overdue ? "text-red-400" : "text-sky-300")}>{formatDateTime(r.scheduledAt)}{overdue ? " · overdue" : ""}</p>
                    </div>
                    <Link href="/dashboard/evaluations"><Button size="sm" className="h-7 rounded-lg text-[11px]">Open</Button></Link>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

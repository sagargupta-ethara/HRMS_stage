"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Briefcase,
  ClipboardCheck, Download, Eye, FileCheck, FileText,
  Loader2, Plus, RefreshCw, Scale, Search, Star,
  UserCheck, Users,
} from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell, LabelList,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useQuery } from "@tanstack/react-query";
import { StageBadge } from "@/components/shared/stage-timeline";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardInsightStrip } from "@/components/dashboard/insight-strip";
import {
  DashboardDateRangeFilter,
  dashboardDateRangeParams,
  isWithinDashboardDateRange,
  type DashboardDateRange,
} from "@/components/dashboard/date-range-filter";
import { candidatesApi, escalationsApi, pmsApi, reportsApi, separationApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn, formatLabel, getInitials, STAGE_LABELS, timeAgo } from "@/lib/utils";
import type { CandidateStage } from "@/types";
import { exportToCsv } from "@/lib/export";

type StageSummary = { currentStage: string; _count: number };
type RecentCandidate = {
  id: string;
  fullName: string;
  personalEmail: string;
  currentStage: CandidateStage;
  createdAt: string;
  position?: { title?: string };
};

const CHART_COLORS = ["#ED00ED", "#908DCE", "#38BDF8", "#22c55e", "#f59e0b", "#ef4444"];
const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: "rgba(8,8,16,0.96)",
    border: "1px solid rgba(144,141,206,0.22)",
    borderRadius: 10,
    fontSize: 12,
    color: "#C5CBE8",
  },
  labelStyle: { color: "rgba(197,203,232,0.70)" },
  itemStyle: { color: "#F8FAFC" },
  cursor: { stroke: "rgba(237,0,237,0.15)", strokeWidth: 1 },
};

function KpiCard({
  title, value, subtitle, icon: Icon, tone = "default", loading,
}: {
  title: string; value: string | number; subtitle?: string;
  icon: React.ElementType; tone?: "default" | "danger" | "success" | "warning";
  loading?: boolean;
}) {
  const iconBg = {
    default: "bg-primary/15 text-primary",
    danger: "bg-destructive/15 text-destructive",
    success: "bg-success/15 text-success",
    warning: "bg-warning/15 text-warning",
  }[tone];
  return (
    <div
      className="relative min-w-0 overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 sm:p-5"
      style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
    >
      <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(ellipse at top right, rgba(237,0,237,0.08) 0%, transparent 60%)" }} />
      <div className="relative flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.50)" }}>{title}</p>
          <p className="mt-2 break-words text-2xl font-bold sm:text-3xl" style={{ color: "#C5CBE8" }}>{loading ? "—" : value}</p>
          {subtitle && !loading && <p className="mt-0.5 break-words text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>{subtitle}</p>}
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11", iconBg)}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
      </div>
    </div>
  );
}

function taActionFromStage(stage: CandidateStage): string {
  const actions: Partial<Record<CandidateStage, string>> = {
    resume_screening_pending: "Resume Screening",
    resume_shortlisted: "Assign Evaluator",
    evaluation_passed: "Send Selection Form",
    selection_form_submitted: "Review Selection Form",
    selection_form_validated: "Prepare Contract",
    contract_signed: "Induction & IT Setup",
    statutory_forms_submitted: "Verify Compliance",
  };
  return actions[stage] ?? STAGE_LABELS[stage] ?? formatLabel(stage);
}

export default function TADashboard() {
  const { user } = useAuth();
  const [summary, setSummary] = useState<(Record<string, number> & { stageBreakdown?: StageSummary[] }) | null>(null);
  const [recentCandidates, setRecentCandidates] = useState<RecentCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<DashboardDateRange>({ from: "", to: "" });
  const dateParams = useMemo(() => dashboardDateRangeParams(dateRange), [dateRange]);

  const { data: escalations = [] } = useQuery({
    queryKey: ["escalations-ta"],
    queryFn: () => escalationsApi.list({ status: "open" }),
    staleTime: 30_000,
  });

  const { data: pmsRecords = [] } = useQuery({
    queryKey: ["pms-evaluations-ta"],
    queryFn: () => pmsApi.list(),
    staleTime: 30_000,
  });

  const { data: separations = [] } = useQuery({
    queryKey: ["separations-ta"],
    queryFn: () => separationApi.list(),
    staleTime: 30_000,
  });

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [summaryData, candidateData] = await Promise.all([
        reportsApi.summary(dateParams),
        candidatesApi.list({ ...dateParams, limit: 8, sortBy: "createdAt", sortDir: "desc" }),
      ]);
      setSummary(summaryData);
      setRecentCandidates(candidateData.data ?? []);
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [dateParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const stageMap = useMemo(() => {
    const map: Record<string, number> = {};
    summary?.stageBreakdown?.forEach((s) => { map[s.currentStage] = s._count; });
    return map;
  }, [summary]);

  const filteredEscalations = useMemo(() => (
    (Array.isArray(escalations) ? escalations : []).filter((e: { createdAt?: string; created_at?: string }) =>
      isWithinDashboardDateRange(e.createdAt ?? e.created_at, dateRange)
    )
  ), [dateRange, escalations]);
  const filteredSeparations = useMemo(() => (
    (Array.isArray(separations) ? separations : []).filter((s: { createdAt?: string | null; created_at?: string | null; appliedAt?: string | null }) =>
      isWithinDashboardDateRange(s.createdAt ?? s.created_at ?? s.appliedAt, dateRange)
    )
  ), [dateRange, separations]);
  const filteredPmsRecords = useMemo(() => (
    (Array.isArray(pmsRecords) ? pmsRecords : []).filter((r: { submittedAt?: string | null; createdAt?: string | null }) =>
      isWithinDashboardDateRange(r.submittedAt ?? r.createdAt, dateRange)
    )
  ), [dateRange, pmsRecords]);

  const totalEscalations = filteredEscalations.length;
  const activeSeparations = Array.isArray(filteredSeparations)
    ? filteredSeparations.filter((s: { status?: string }) => !["approved", "rejected"].includes(s.status ?? "")).length
    : 0;

  const pipelineData = [
    { stage: "Applied", count: summary?.totalCandidates ?? 0, fill: CHART_COLORS[0] },
    { stage: "Screening", count: stageMap["resume_screening_pending"] ?? 0, fill: CHART_COLORS[1] },
    { stage: "Shortlisted", count: stageMap["resume_shortlisted"] ?? 0, fill: CHART_COLORS[2] },
    { stage: "Evaluation", count: stageMap["evaluation_assigned"] ?? 0, fill: CHART_COLORS[3] },
    { stage: "Forms", count: stageMap["selection_form_sent"] ?? 0, fill: CHART_COLORS[4] },
    { stage: "Joined", count: summary?.joined ?? 0, fill: CHART_COLORS[5] },
  ];

  const pmsRatingDist = useMemo(() => {
    const arr = filteredPmsRecords;
    const g = {
      unsatisfactory: 0,
      needs_improvement: 0,
      average: 0,
      meets_expectations: 0,
      exceeds_expectations: 0,
    };
    arr.forEach((r: { overallRating?: string | null }) => {
      const rating = r.overallRating === "above_expectation" ? "exceeds_expectations" : r.overallRating;
      if (rating && rating in g) g[rating as keyof typeof g]++;
    });
    return [
      { name: "Unsat.", value: g.unsatisfactory, fill: "#e11d48" },
      { name: "Needs Imp.", value: g.needs_improvement, fill: "#f97316" },
      { name: "Average", value: g.average, fill: CHART_COLORS[4] },
      { name: "Meets Exp.", value: g.meets_expectations, fill: "#0ea5e9" },
      { name: "Exceeds Exp.", value: g.exceeds_expectations, fill: CHART_COLORS[3] },
    ].filter((x) => x.value > 0);
  }, [filteredPmsRecords]);

  const handleExport = () => {
    exportToCsv(
      recentCandidates.map((c) => ({
        name: c.fullName,
        email: c.personalEmail,
        role: c.position?.title ?? "",
        stage: c.currentStage,
        action: taActionFromStage(c.currentStage),
        applied: timeAgo(c.createdAt),
      })),
      [
        { key: "name", header: "Name" }, { key: "email", header: "Email" },
        { key: "role", header: "Role" }, { key: "stage", header: "Stage" },
        { key: "action", header: "TA Action" }, { key: "applied", header: "Applied" },
      ],
      `ta_candidates_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const taInsights = [
    {
      label: "Screening Load",
      value: stageMap["resume_screening_pending"] ?? 0,
      detail: "Profiles waiting for resume screening before shortlist movement.",
      icon: Search,
      tone: (stageMap["resume_screening_pending"] ?? 0) > 0 ? "warning" as const : "success" as const,
      href: "/dashboard/screening",
    },
    {
      label: "Candidate Handoffs",
      value: (stageMap["selection_form_submitted"] ?? 0) + (stageMap["contract_sent"] ?? 0),
      detail: "Selection forms and contracts where TA follow-up can unblock closure.",
      icon: FileCheck,
      tone: ((stageMap["selection_form_submitted"] ?? 0) + (stageMap["contract_sent"] ?? 0)) > 0 ? "warning" as const : "success" as const,
      href: "/dashboard/selection-forms",
    },
    {
      label: "Pipeline Outcome",
      value: summary?.joined ?? 0,
      detail: `${summary?.totalCandidates ?? 0} candidates tracked in the selected view.`,
      icon: UserCheck,
      tone: "success" as const,
      progress: summary?.totalCandidates ? Math.round(((summary?.joined ?? 0) / (summary.totalCandidates || 1)) * 100) : 0,
      href: "/dashboard/candidates",
    },
    {
      label: "TA Risk",
      value: totalEscalations,
      detail: totalEscalations ? "Open SLA breaches affecting hiring flow." : "No TA escalation backlog visible.",
      icon: AlertTriangle,
      tone: totalEscalations ? "danger" as const : "success" as const,
      href: "/dashboard/escalations",
    },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div
        className="relative overflow-hidden rounded-2xl px-6 py-5"
        style={{ background: "linear-gradient(135deg, rgba(144,141,206,0.12) 0%, rgba(19,18,44,0.95) 50%, rgba(8,8,16,0.98) 100%)", border: "1px solid rgba(144,141,206,0.18)" }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(ellipse at 80% 20%, rgba(144,141,206,0.3) 0%, transparent 60%)" }} />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>Welcome back</p>
            <h1 className="text-2xl font-bold mt-0.5" style={{ color: "#C5CBE8" }}>{user?.name ?? "TA"}</h1>
            <p className="text-sm mt-1" style={{ color: "rgba(197,203,232,0.50)" }}>Here&apos;s your Talent Acquisition pipeline overview for today.</p>
          </div>
          <div className="flex items-center gap-2">
            <DashboardDateRangeFilter value={dateRange} onChange={setDateRange} />
            <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={handleExport}><Download className="h-3.5 w-3.5" /> Export</Button>
            <Button size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => void load()}><RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} /> Refresh</Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Total Candidates" value={summary?.totalCandidates ?? 0} subtitle="Active pipeline" icon={Users} loading={isLoading} />
        <KpiCard title="Screening Pending" value={stageMap["resume_screening_pending"] ?? 0} subtitle="Resume review" icon={Search} loading={isLoading} tone="warning" />
        <KpiCard title="Selection Forms" value={stageMap["selection_form_sent"] ?? 0} subtitle="Awaiting submission" icon={FileText} loading={isLoading} />
        <KpiCard title="Contracts Pending" value={stageMap["contract_sent"] ?? 0} subtitle="Awaiting signature" icon={FileCheck} loading={isLoading} />
        <KpiCard title="Compliance Pending" value={stageMap["statutory_forms_sent"] ?? 0} subtitle="Statutory forms" icon={Scale} loading={isLoading} tone="warning" />
        <KpiCard title="PMS Reviews" value={filteredPmsRecords.length} subtitle="Total evaluations" icon={Star} loading={isLoading} tone="success" />
        <KpiCard title="Active Separations" value={activeSeparations} subtitle="Resignations & exits" icon={UserCheck} loading={isLoading} />
        <KpiCard title="TA Escalations" value={totalEscalations} subtitle="SLA breaches" icon={AlertTriangle} loading={isLoading} tone="danger" />
      </div>

      <DashboardInsightStrip
        title="Talent Acquisition Summary"
        subtitle="Screening, candidate handoffs, outcomes, and SLA risk."
        insights={taInsights}
      />

      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Hiring Pipeline Overview</h2>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={pipelineData} margin={{ top: 18, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
              <XAxis dataKey="stage" tick={{ fontSize: 11, fill: "rgba(248,250,252,0.72)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "rgba(248,250,252,0.72)" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="count" name="Candidates" radius={[4, 4, 0, 0]}>
                <LabelList dataKey="count" position="top" fill="#F8FAFC" fontSize={12} fontWeight={700} />
                {pipelineData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>PMS Rating Distribution</h2>
              <Link href="/dashboard/hr/pms"><span className="text-xs" style={{ color: "#ED00ED" }}>View All</span></Link>
            </div>
            {pmsRatingDist.length > 0 ? (
              <div className="flex items-center gap-4">
                <PieChart width={90} height={90}>
                  <Pie data={pmsRatingDist} cx={42} cy={42} innerRadius={25} outerRadius={42} dataKey="value" strokeWidth={0}>
                    {pmsRatingDist.map((e, i) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                </PieChart>
                <div className="flex-1 space-y-1.5">
                  {pmsRatingDist.map((e) => (
                    <div key={e.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-full" style={{ background: e.fill }} />
                        <span style={{ color: "rgba(197,203,232,0.65)" }}>{e.name}</span>
                      </div>
                      <span className="font-semibold" style={{ color: "#C5CBE8" }}>{e.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center py-4 text-center">
                <Star className="h-7 w-7 mb-2 opacity-20" />
                <p className="text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No PMS evaluations yet</p>
                <Link href="/dashboard/hr/pms">
                  <Button size="sm" variant="outline" className="rounded-xl text-xs mt-2">Start Evaluation</Button>
                </Link>
              </div>
            )}
          </div>

        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Recent Candidates</h2>
            <div className="flex items-center gap-2">
              <Link href="/dashboard/candidates">
                <span className="text-xs" style={{ color: "#ED00ED" }}>View All</span>
              </Link>
            </div>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : recentCandidates.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: "rgba(197,203,232,0.40)" }}>No candidates yet</p>
          ) : (
            <div className="space-y-2">
              {recentCandidates.slice(0, 6).map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors" style={{ background: "rgba(144,141,206,0.05)", border: "1px solid rgba(144,141,206,0.10)" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="text-xs" style={{ background: "rgba(144,141,206,0.15)", color: "#908DCE" }}>{getInitials(c.fullName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <Link href={`/dashboard/candidates/${c.id}`}>
                        <p className="text-sm font-medium truncate hover:text-primary" style={{ color: "#C5CBE8" }}>{c.fullName}</p>
                      </Link>
                      <p className="text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>{taActionFromStage(c.currentStage)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StageBadge stage={c.currentStage} />
                    <span className="text-[10px] hidden sm:block" style={{ color: "rgba(197,203,232,0.35)" }}>{timeAgo(c.createdAt)}</span>
                    <Link href={`/dashboard/candidates/${c.id}`}>
                      <Button variant="ghost" size="icon" className="h-7 w-7"><Eye className="h-3.5 w-3.5" /></Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Recent PMS Reviews</h2>
              <Link href="/dashboard/hr/pms"><span className="text-xs" style={{ color: "#ED00ED" }}>View All</span></Link>
            </div>
            <div className="space-y-2">
              {filteredPmsRecords.slice(0, 4).map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ background: "rgba(144,141,206,0.05)" }}>
                  <div className="flex items-center gap-2">
                    <Avatar className="h-7 w-7 shrink-0">
                      <AvatarFallback className="text-[10px]" style={{ background: "rgba(237,0,237,0.12)", color: "#ED00ED" }}>{getInitials(r.candidateName ?? "?")}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="text-xs font-medium" style={{ color: "#C5CBE8" }}>{r.candidateName ?? "—"}</p>
                      <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.40)" }}>{r.submittedAt ? timeAgo(r.submittedAt) : "—"}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold" style={{ color: "#ED00ED" }}>{r.averageScore ?? "—"}/3</p>
                    <Badge variant="outline" className={cn("text-[9px]", {
                      "text-emerald-400 border-emerald-400/30": r.overallRating === "above_expectation" || r.overallRating === "exceeds_expectations",
                      "text-sky-400 border-sky-400/30": r.overallRating === "meets_expectations",
                      "text-amber-400 border-amber-400/30": r.overallRating === "average",
                      "text-orange-400 border-orange-400/30": r.overallRating === "needs_improvement",
                      "text-rose-400 border-rose-400/30": r.overallRating === "unsatisfactory",
                    })}>
                      {r.overallRating === "above_expectation" || r.overallRating === "exceeds_expectations" ? "Exceeds" : r.overallRating === "meets_expectations" ? "Meets" : r.overallRating === "average" ? "Avg" : r.overallRating === "needs_improvement" ? "Needs" : r.overallRating === "unsatisfactory" ? "Unsat." : "—"}
                    </Badge>
                  </div>
                </div>
              ))}
              {filteredPmsRecords.length === 0 && (
                <p className="text-xs text-center py-3" style={{ color: "rgba(197,203,232,0.40)" }}>No PMS reviews yet</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
            <h2 className="text-sm font-semibold mb-3" style={{ color: "#C5CBE8" }}>Pending TA Actions</h2>
            <div className="space-y-2">
              {[
                { label: "Screening Pending", count: stageMap["resume_screening_pending"] ?? 0, icon: Search, href: "/dashboard/screening", color: CHART_COLORS[0] },
                { label: "Forms to Review", count: stageMap["selection_form_submitted"] ?? 0, icon: FileText, href: "/dashboard/selection-forms", color: CHART_COLORS[1] },
                { label: "Contracts Pending", count: stageMap["contract_sent"] ?? 0, icon: FileCheck, href: "/dashboard/contracts", color: CHART_COLORS[2] },
                { label: "Compliance Due", count: stageMap["statutory_forms_sent"] ?? 0, icon: Scale, href: "/dashboard/compliance", color: CHART_COLORS[4] },
              ].map((action) => (
                <Link key={action.label} href={action.href}>
                  <div className="flex items-center justify-between rounded-xl px-3 py-2 transition-all hover:bg-white/5 cursor-pointer" style={{ border: "1px solid rgba(144,141,206,0.10)" }}>
                    <div className="flex items-center gap-2">
                      <action.icon className="h-3.5 w-3.5" style={{ color: action.color }} />
                      <span className="text-xs" style={{ color: "rgba(197,203,232,0.65)" }}>{action.label}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold" style={{ color: "#C5CBE8" }}>{isLoading ? "—" : action.count}</span>
                      <ArrowRight className="h-3 w-3" style={{ color: "rgba(197,203,232,0.30)" }} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Add Candidate", icon: Plus, href: "/dashboard/candidates/new", desc: "Create candidate profile" },
          { label: "Job Positions", icon: Briefcase, href: "/dashboard/positions", desc: "Create & manage JDs" },
          { label: "Assessment Platform", icon: ClipboardCheck, href: "/dashboard/assessment-platform", desc: "Tests, scores & reports" },
          { label: "Separations", icon: UserCheck, href: "/dashboard/separation", desc: "Resignation workflow" },
        ].map((a) => (
          <Link key={a.label} href={a.href}>
            <div className="flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 cursor-pointer" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)" }}>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0" style={{ background: "rgba(237,0,237,0.12)" }}>
                <a.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>{a.label}</p>
                <p className="text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>{a.desc}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

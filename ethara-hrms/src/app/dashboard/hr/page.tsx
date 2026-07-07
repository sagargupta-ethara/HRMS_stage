"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties, type ElementType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Briefcase, CalendarDays, CheckCircle2,
  ClipboardCheck, Clock3, FolderKanban, Gauge, Landmark, Laptop, Loader2, ReceiptText,
  Scale, Sparkles, Star, TrendingUp, UserCheck, UserMinus, Users,
} from "lucide-react";
import {
  assetsApi, attendanceApi, bankVerificationApi, candidateIdCardApi, candidatesApi,
  dinnerRequestsApi, employeeEvaluationApi, employeesApi, escalationsApi, evaluationsApi,
  itRequestsApi, leaveApi, pmsApi, projectsApi, reportsApi, reimbursementsApi, separationApi,
} from "@/lib/api";
import { attendanceRangeForShortcut } from "@/lib/attendance-dates";
import { useAuth } from "@/lib/auth-context";
import { cn, formatCurrentDateLabel, timeAgo } from "@/lib/utils";

// Executive HR Command Center: an org-wide SUMMARY that correlates every module
// and links out to each source dashboard — it deliberately does not re-implement
// the detailed module charts. Counts are consistent with the other dashboards
// because they come from the same backend endpoints. Data that does not exist in
// this system (workspace/seat occupancy, employee-satisfaction survey, cost
// centres, FX rates) is omitted rather than mocked.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PENDING_REIMB = new Set(["submitted", "pending_manager_review", "manager_approved", "pending_hr_review", "pending_leadership_review", "missing_information", "returned_by_manager", "returned_by_hr", "returned_by_leadership", "returned_by_finance"]);
const PAID_REIMB = new Set(["paid", "acknowledged"]);
const ACTIVE_SEP = new Set(["submitted", "manager_approved", "hr_review", "it_clearance", "office_admin_clearance"]);

const CARD: CSSProperties = { background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" };
type Tone = "default" | "success" | "warning" | "danger";
const TONE: Record<Tone, string> = { default: "bg-primary/15 text-primary", success: "bg-emerald-500/15 text-emerald-400", warning: "bg-amber-500/15 text-amber-400", danger: "bg-red-500/15 text-red-400" };
const CHART_TOOLTIP = { contentStyle: { background: "rgba(8,8,16,0.96)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 10, fontSize: 12, color: "#C5CBE8" }, itemStyle: { color: "#F8FAFC", fontWeight: 600 }, labelStyle: { color: "#C5CBE8", fontWeight: 600 }, cursor: { fill: "rgba(144,141,206,0.06)" } } as const;
const COLORS = ["#ED00ED", "#908DCE", "#38BDF8", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa"];

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
function inr(n: number) { const a = Math.abs(n); if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`; if (a >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`; if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`; return `₹${Math.round(n).toLocaleString("en-IN")}`; }
function band(score: number) { if (score >= 80) return { label: "Healthy", color: "#22c55e", emoji: "🟢" }; if (score >= 65) return { label: "Needs Attention", color: "#eab308", emoji: "🟡" }; if (score >= 50) return { label: "Warning", color: "#f59e0b", emoji: "🟠" }; return { label: "Critical", color: "#ef4444", emoji: "🔴" }; }

// ─── data ─────────────────────────────────────────────────────────────────────

async function opt<T>(fn: () => Promise<T>): Promise<T | undefined> { try { return await fn(); } catch { return undefined; } }
function arr<T>(v: unknown): T[] { if (Array.isArray(v)) return v as T[]; if (v && typeof v === "object" && Array.isArray((v as { data?: unknown }).data)) return (v as { data: T[] }).data; return []; }

async function loadCommandCenter() {
  const [summary, funnel, domains, employees, attendance, reimbursements, dinners, bank, itPending, itCompleted, assets, idCards, evaluations, pms, separations, leaves, projects, highlights, escalations, candidates] = await Promise.all([
    opt(() => reportsApi.summary()), opt(() => reportsApi.funnel()), opt(() => reportsApi.domains()),
    opt(() => employeesApi.list({ limit: 500 })), opt(() => attendanceApi.summary({ ...attendanceRangeForShortcut("today"), mapped: true })),
    opt(() => reimbursementsApi.list()), opt(() => dinnerRequestsApi.list()), opt(() => bankVerificationApi.list()),
    opt(() => itRequestsApi.list({ status: "pending" })), opt(() => itRequestsApi.list({ status: "completed" })),
    opt(() => assetsApi.list()), opt(() => candidateIdCardApi.listQueue()), opt(() => evaluationsApi.list()), opt(() => pmsApi.list()),
    opt(() => separationApi.list()), opt(() => leaveApi.list()), opt(() => projectsApi.analytics()), opt(() => employeeEvaluationApi.getHighlights()),
    opt(() => escalationsApi.list({ status: "open" })), opt(() => candidatesApi.list({ limit: 10, sortBy: "createdAt", sortDir: "desc" })),
  ]);
  return { summary, funnel, domains, employees: arr(employees), attendance, reimbursements: arr(reimbursements), dinners: arr(dinners), bank: arr(bank), itPending: arr(itPending), itCompleted: arr(itCompleted), assets: arr(assets), idCards: arr(idCards), evaluations: arr(evaluations), pms: arr(pms), separations: arr(separations), leaves: arr(leaves), projects, highlights, escalations: arr(escalations), candidates: arr((candidates as { data?: unknown })?.data ?? candidates) };
}

type CC = Awaited<ReturnType<typeof loadCommandCenter>>;
/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ─── derive ───────────────────────────────────────────────────────────────────

function derive(d: CC, nowMs: number) {
  const monthKey = `${new Date(nowMs).getFullYear()}-${String(new Date(nowMs).getMonth() + 1).padStart(2, "0")}`;
  const s = d.summary as Any;
  const emps = d.employees as Any[];
  const activeEmps = emps.filter((e) => e.isActive !== false);
  const joinDate = (e: Any) => e.dateOfJoining || e.createdAt;
  const newJoiners = emps.filter((e) => String(joinDate(e) ?? "").slice(0, 7) === monthKey).length;

  const totalCandidates = s?.totalCandidates ?? 0;
  const joined = s?.joined ?? 0;
  const conversion = pct(joined, totalCandidates);
  const pendingEvals = s?.pendingEvaluations ?? 0;
  const escalations = d.escalations.length;

  const present = (d.attendance as Any)?.present ?? 0;
  const attTotal = (d.attendance as Any)?.total ?? 0;
  const presentRate = pct(present, attTotal);

  const completedExits = d.separations.filter((x: Any) => String(x.status ?? "") === "completed").length;
  const activeExits = d.separations.filter((x: Any) => { const st = String(x.status ?? ""); return ACTIVE_SEP.has(st) || (!["completed", "revoked", "cancelled"].includes(st) && Boolean(st)); }).length;
  const attrition = pct(completedExits, activeEmps.length + completedExits);

  const pmsSubmitted = d.pms.filter((r: Any) => r.submittedAt).length;
  const pmsRate = d.pms.length ? pct(pmsSubmitted, d.pms.length) : 100;
  const hl = d.highlights as Any;
  const verdicts = hl?.verdictDistribution ?? {};
  const strongPerf = (verdicts.strong ?? 0) + (verdicts.solid ?? 0);
  const perfHealth = hl?.totalEmployees ? pct(strongPerf, hl.scoredCount || hl.totalEmployees) : pmsRate;

  const reimb = d.reimbursements as Any[];
  const pendingReimbAmt = reimb.filter((r) => PENDING_REIMB.has(String(r.status ?? ""))).reduce((a, r) => a + Number(r.expenseAmount ?? 0), 0);
  const paidReimb = reimb.filter((r) => PAID_REIMB.has(String(r.status ?? ""))).length;
  const pendingReimb = reimb.filter((r) => PENDING_REIMB.has(String(r.status ?? ""))).length;
  const financeHealth = paidReimb + pendingReimb > 0 ? pct(paidReimb, paidReimb + pendingReimb) : 100;

  const bank = d.bank as Any[];
  const bankVerified = bank.filter((b) => b.status === "validated").length;
  const bankPct = bank.length ? pct(bankVerified, bank.length) : 100;

  const itDone = d.itCompleted.length;
  const itPend = d.itPending.length;
  const itHealth = itDone + itPend > 0 ? pct(itDone, itDone + itPend) : 100;
  const idPending = d.idCards.filter((c: Any) => c.status !== "done").length;

  const proj = (d.projects as Any)?.totals;
  const projUtil = proj?.totalApprovedBudget > 0 ? pct(proj.totalConsumedBudget, proj.totalApprovedBudget) : 0;
  const projHealth = Math.max(0, 100 - Math.max(0, projUtil - 100) * 2);

  const complianceStatutory = (s?.stageBreakdown ?? []).filter((r: Any) => ["statutory_forms_submitted", "compliance_verified"].includes(r.currentStage)).reduce((a: number, r: Any) => a + Number(r._count ?? 0), 0);
  const complianceHealth = Math.round((bankPct + Math.min(100, complianceStatutory ? 90 : 70)) / 2);

  const leavePending = d.leaves.filter((l: Any) => /pending/i.test(String(l.status ?? ""))).length;

  const pillars = [
    { key: "Hiring", score: Math.min(100, conversion), href: "/dashboard/module-overview/talent" },
    { key: "Performance", score: perfHealth, href: "/dashboard/module-overview/performance" },
    { key: "Attendance", score: attTotal ? presentRate : 75, href: "/dashboard/module-overview/lifecycle" },
    { key: "Finance", score: financeHealth, href: "/dashboard/module-overview/finance" },
    { key: "Compliance", score: complianceHealth, href: "/dashboard/compliance" },
    { key: "IT", score: itHealth, href: "/dashboard/module-overview/it-operations" },
    { key: "Projects", score: projHealth, href: "/dashboard/projects" },
    { key: "Retention", score: 100 - attrition, href: "/dashboard/separation" },
  ];
  const orgScore = Math.round(pillars.reduce((a, p) => a + p.score, 0) / pillars.length);
  const strong = pillars.filter((p) => p.score >= 80).map((p) => p.key);
  const weak = pillars.filter((p) => p.score < 65).map((p) => p.key);

  return {
    monthKey, s, emps, activeEmps, newJoiners, totalCandidates, joined, conversion, pendingEvals, escalations,
    present, attTotal, presentRate, completedExits, activeExits, attrition, pmsRate, perfHealth, hl,
    pendingReimbAmt, pendingReimb, financeHealth, bank, bankVerified, bankPct, itPend, itDone, itHealth, idPending,
    proj, projUtil, projHealth, complianceHealth, leavePending, pillars, orgScore, strong, weak,
  };
}
type Derived = ReturnType<typeof derive>;

// ─── page ─────────────────────────────────────────────────────────────────────

export default function HRDashboard() {
  const { user } = useAuth();
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setNowMs(Date.now()), 0); return () => window.clearTimeout(t); }, []);
  const { data, isLoading, refetch, isFetching } = useQuery({ queryKey: ["hr-command-center"], queryFn: loadCommandCenter, staleTime: 60_000 });
  const m = useMemo(() => (data && nowMs != null ? derive(data, nowMs) : null), [data, nowMs]);

  if (isLoading || !data || !m || nowMs == null) {
    return <div className="flex h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading command center…</div>;
  }
  const b = band(m.orgScore);
  const greeting = new Date(nowMs).getHours() < 12 ? "Good morning" : new Date(nowMs).getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden animate-fade-in">
      {/* Header + Org health banner */}
      <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={CARD}>
        <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(ellipse at 12% 0%, ${b.color}22 0%, transparent 55%)` }} />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(197,203,232,0.5)" }}>Executive HR Command Center</p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl" style={{ color: "#F8FAFC" }}>{greeting}, {user?.name ?? "HR"}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm" style={{ color: "rgba(197,203,232,0.55)" }}><CalendarDays className="h-3.5 w-3.5" /> {formatCurrentDateLabel({ weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</p>
          </div>
          <button onClick={() => void refetch()} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/30" style={{ color: "#C5CBE8" }}>
            <TrendingUp className={cn("h-3.5 w-3.5", isFetching && "animate-pulse")} /> Refresh
          </button>
        </div>
        <div className="relative mt-4 grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-center">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.55)" }}><span aria-hidden>{b.emoji}</span> Organization Health</p>
            <div className="mt-1 flex items-end gap-2"><span className="text-5xl font-bold leading-none" style={{ color: "#F8FAFC" }}>{m.orgScore}</span><span className="pb-1 text-lg" style={{ color: "rgba(197,203,232,0.4)" }}>/ 100</span></div>
            <p className="mt-2 inline-flex rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${b.color}1f`, color: b.color }}>{b.label}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] p-3.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">Strong areas</p>
              <p className="text-xs" style={{ color: "rgba(197,203,232,0.72)" }}>{m.strong.length ? m.strong.join(" · ") : "Building momentum across pillars"}</p>
            </div>
            <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.06] p-3.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400">Needs attention</p>
              <p className="text-xs" style={{ color: "rgba(197,203,232,0.72)" }}>{m.weak.length ? m.weak.join(" · ") : "No pillar is below target"}</p>
            </div>
          </div>
        </div>
      </section>

      <ExecKpis m={m} nowMs={nowMs} data={data} />
      <AiSummary m={m} data={data} />
      <CrossModuleGrid m={m} data={data} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <HiringFunnel m={m} />
        <WorkforceComposition m={m} data={data} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <EmployeeMovement m={m} data={data} nowMs={nowMs} />
        <DepartmentHealthMatrix data={data} />
      </div>
      <div className="grid gap-3 xl:grid-cols-3 xl:items-start">
        <PerformanceOverview m={m} data={data} />
        <FinancialSnapshot m={m} />
        <ProjectCompliance m={m} />
      </div>
      <ActionCenter m={m} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <ExecutiveTimeline data={data} />
        <AiRecommendations m={m} data={data} />
      </div>
    </div>
  );
}

// ─── shared ───────────────────────────────────────────────────────────────────

function Panel({ title, subtitle, icon: Icon, action, children }: { title: string; subtitle?: string; icon?: ElementType; action?: { label: string; href: string }; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-2xl p-4 sm:p-5" style={CARD}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#C5CBE8" }}>{Icon && <Icon className="h-4 w-4 text-primary" />}{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs" style={{ color: "rgba(197,203,232,0.42)" }}>{subtitle}</p>}
        </div>
        {action && <Link href={action.href} className="shrink-0 text-xs font-medium text-primary hover:underline">{action.label}</Link>}
      </div>
      {children}
    </div>
  );
}

function Spark({ points, color }: { points: number[]; color: string }) {
  const data = points.length > 1 ? points : [...points, ...points, 0].slice(0, 2);
  const max = Math.max(...data, 1); const min = Math.min(...data, 0); const range = max - min || 1;
  const step = data.length > 1 ? 100 / (data.length - 1) : 100;
  const coords = data.map((v, i) => `${(i * step).toFixed(1)},${(28 - ((v - min) / range) * 28).toFixed(1)}`);
  const gid = `s${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-6 w-full">
      <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.35} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient></defs>
      <path d={`M ${coords.join(" L ")} L 100,28 L 0,28 Z`} fill={`url(#${gid})`} />
      <path d={`M ${coords.join(" L ")}`} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function monthSlots(nowMs: number) {
  const now = new Date(nowMs); const out: Array<{ key: string; label: string }> = [];
  for (let i = 5; i >= 0; i -= 1) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()] }); }
  return out;
}

// ─── 1. Executive KPIs ─────────────────────────────────────────────────────────

function ExecKpis({ m, nowMs, data }: { m: Derived; nowMs: number; data: CC }) {
  const slots = monthSlots(nowMs);
  const appsSpark = (data.funnel as Any[] ?? []).map((r) => r.applied ?? 0);
  const joinSpark = slots.map((sl) => (m.emps as Any[]).filter((e) => String(e.dateOfJoining || e.createdAt || "").slice(0, 7) === sl.key).length);
  const kpis: Array<{ label: string; value: string | number; sub: string; icon: ElementType; tone: Tone; dot: string; href: string; spark?: number[] }> = [
    { label: "Total Employees", value: m.emps.length, sub: `${m.activeEmps.length} active · +${m.newJoiners} this month`, icon: Users, tone: "default", dot: "#ED00ED", href: "/dashboard/employees", spark: joinSpark },
    { label: "Active Candidates", value: m.totalCandidates, sub: `${m.pendingEvals} in evaluation`, icon: Briefcase, tone: "default", dot: "#908DCE", href: "/dashboard/candidates", spark: appsSpark },
    { label: "New Joiners", value: m.newJoiners, sub: "this month", icon: UserCheck, tone: "success", dot: "#22c55e", href: "/dashboard/employees" },
    { label: "Attrition Rate", value: `${m.attrition}%`, sub: `${m.completedExits} exits · ${m.activeExits} active`, icon: UserMinus, tone: m.attrition > 15 ? "danger" : "success", dot: m.attrition > 15 ? "#ef4444" : "#22c55e", href: "/dashboard/separation" },
    { label: "Hiring Conversion", value: `${m.conversion}%`, sub: `${m.joined} of ${m.totalCandidates} joined`, icon: TrendingUp, tone: m.conversion >= 40 ? "success" : "warning", dot: m.conversion >= 40 ? "#22c55e" : "#f59e0b", href: "/dashboard/module-overview/talent", spark: appsSpark },
    { label: "Org Health", value: `${m.orgScore}`, sub: band(m.orgScore).label, icon: Gauge, tone: m.orgScore >= 80 ? "success" : "warning", dot: band(m.orgScore).color, href: "/dashboard/module-overview" },
    { label: "Active Projects", value: (m.proj as Any)?.activeProjects ?? 0, sub: `${(m.proj as Any)?.totalProjects ?? 0} total`, icon: FolderKanban, tone: "default", dot: "#38BDF8", href: "/dashboard/projects" },
    { label: "Finance Pending", value: inr(m.pendingReimbAmt), sub: `${m.pendingReimb} claims`, icon: ReceiptText, tone: m.pendingReimb ? "warning" : "success", dot: m.pendingReimb ? "#f59e0b" : "#22c55e", href: "/dashboard/module-overview/finance" },
    { label: "Present Today", value: m.attTotal ? `${m.presentRate}%` : "—", sub: `${m.present} of ${m.attTotal}`, icon: Clock3, tone: m.presentRate >= 75 ? "success" : "warning", dot: m.presentRate >= 75 ? "#22c55e" : "#f59e0b", href: "/dashboard/attendance" },
    { label: "Open HR Risks", value: m.escalations, sub: "escalations open", icon: AlertTriangle, tone: m.escalations ? "danger" : "success", dot: m.escalations ? "#ef4444" : "#22c55e", href: "/dashboard/escalations" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {kpis.map((k) => { const Icon = k.icon; return (
        <Link key={k.label} href={k.href} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5" style={CARD}>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: k.dot }} />{k.label}</p>
              <p className="mt-1.5 text-xl font-bold leading-none" style={{ color: "#F8FAFC" }}>{k.value}</p>
            </div>
            <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", TONE[k.tone])}><Icon className="h-4 w-4" /></div>
          </div>
          <div className="mt-2 flex items-end justify-between gap-2">
            <p className="truncate text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>{k.sub}</p>
            {k.spark && <div className="h-5 w-12 shrink-0"><Spark points={k.spark} color={k.dot} /></div>}
          </div>
        </Link>
      ); })}
    </div>
  );
}

// ─── 3. AI executive summary ────────────────────────────────────────────────────

function AiSummary({ m, data }: { m: Derived; data: CC }) {
  const topDomain = ([...(data.domains as Any[] ?? [])].filter((x) => x.candidates > 0).sort((a, b) => b.candidates - a.candidates))[0];
  const lines = [
    `${m.totalCandidates} candidates in the pipeline · ${m.conversion}% conversion to joined.`,
    `${m.emps.length} employees (${m.activeEmps.length} active) · ${m.newJoiners} joined this month · ${m.attrition}% attrition.`,
    m.attTotal ? `Attendance at ${m.presentRate}% today.` : "Attendance records still syncing.",
    `${inr(m.pendingReimbAmt)} pending finance approval across ${m.pendingReimb} claims.`,
    `Bank verification ${m.bankPct}% complete · IT completion ${m.itHealth}%.`,
    topDomain ? `${topDomain.department} has the highest hiring demand (${topDomain.candidates} candidates).` : "",
    m.escalations ? `${m.escalations} HR escalation${m.escalations === 1 ? "" : "s"} require attention.` : "No open escalations.",
  ].filter(Boolean);
  return (
    <Panel title="AI Executive Summary" subtitle="Live org-wide read, auto-generated from module data" icon={Sparkles}>
      <div className="grid gap-2 sm:grid-cols-2">
        {lines.slice(0, 6).map((l) => <div key={l} className="flex items-start gap-2 text-xs leading-5" style={{ color: "rgba(197,203,232,0.74)" }}><span className="mt-0.5 text-primary">•</span><span className="min-w-0">{l}</span></div>)}
      </div>
    </Panel>
  );
}

// ─── 4. Cross-module health grid ─────────────────────────────────────────────────

function CrossModuleGrid({ m, data }: { m: Derived; data: CC }) {
  const mods = [
    { name: "Talent Acquisition", score: Math.min(100, m.conversion), pending: `${m.pendingEvals} in evaluation`, icon: Briefcase, href: "/dashboard/module-overview/talent" },
    { name: "Employee Lifecycle", score: m.attTotal ? m.presentRate : 75, pending: `${m.leavePending} leave pending`, icon: UserCheck, href: "/dashboard/module-overview/lifecycle" },
    { name: "Performance", score: m.perfHealth, pending: `${(m.hl as Any)?.atRisk?.length ?? 0} at risk`, icon: Star, href: "/dashboard/module-overview/performance" },
    { name: "Finance", score: m.financeHealth, pending: `${inr(m.pendingReimbAmt)} pending`, icon: ReceiptText, href: "/dashboard/module-overview/finance" },
    { name: "IT Operations", score: m.itHealth, pending: `${m.itPend + m.idPending} pending`, icon: Laptop, href: "/dashboard/module-overview/it-operations" },
    { name: "Projects", score: m.projHealth, pending: `${(m.proj as Any)?.activeProjects ?? 0} active`, icon: FolderKanban, href: "/dashboard/projects" },
    { name: "Compliance", score: m.complianceHealth, pending: `${m.bank.length - m.bankVerified} unverified`, icon: Scale, href: "/dashboard/compliance" },
  ];
  void data;
  return (
    <Panel title="Cross-Module Health" subtitle="Every module summarised — click to open its dashboard" icon={Activity}>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {mods.map((mod) => { const bb = band(mod.score); const Icon = mod.icon; return (
          <Link key={mod.name} href={mod.href} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
            <div className="flex items-center justify-between gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15 text-primary"><Icon className="h-3.5 w-3.5" /></div>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: bb.color }} />
            </div>
            <p className="mt-2 truncate text-xs font-semibold" style={{ color: "#F8FAFC" }}>{mod.name}</p>
            <p className="mt-0.5 text-lg font-bold" style={{ color: bb.color }}>{mod.score}%</p>
            <p className="truncate text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>{mod.pending}</p>
          </Link>
        ); })}
      </div>
    </Panel>
  );
}

// ─── 5. Hiring funnel ───────────────────────────────────────────────────────────

function HiringFunnel({ m }: { m: Derived }) {
  const stage = (keys: string[]) => (m.s?.stageBreakdown ?? []).reduce((a: number, r: Any) => a + (keys.includes(r.currentStage) ? Number(r._count ?? 0) : 0), 0);
  const rows = [
    { label: "Applications", value: m.totalCandidates },
    { label: "Screened", value: m.totalCandidates - stage(["new_application", "source_tagged", "resume_uploaded", "resume_screening_pending"]) },
    { label: "Interviewed", value: stage(["evaluation_assigned", "evaluation_in_progress", "evaluation_passed", "evaluation_failed"]) + m.joined },
    { label: "Selected", value: stage(["evaluation_passed", "selection_form_sent", "selection_form_submitted", "selection_form_validated", "contract_sent", "contract_signed"]) + m.joined },
    { label: "Joined", value: m.joined },
  ];
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Panel title="Hiring Funnel" subtitle="Applications → joined · conversion & drop-off" icon={BarChart3} action={{ label: "Talent dashboard", href: "/dashboard/module-overview/talent" }}>
      <div className="space-y-2.5">
        {rows.map((r, i) => { const prev = i === 0 ? r.value : rows[i - 1].value; const drop = prev > 0 ? Math.round(((prev - r.value) / prev) * 100) : 0; return (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs"><span style={{ color: "rgba(197,203,232,0.65)" }}>{r.label}</span><span className="font-semibold" style={{ color: "#F8FAFC" }}>{r.value} <span className="font-normal" style={{ color: "rgba(197,203,232,0.4)" }}>({pct(r.value, m.totalCandidates)}%{i > 0 && drop > 0 ? ` · −${drop}%` : ""})</span></span></div>
            <div className="mx-auto h-2.5 rounded-full" style={{ width: `${Math.max(14, (r.value / max) * 100)}%`, background: COLORS[i % COLORS.length], opacity: 0.85 }} />
          </div>
        ); })}
      </div>
    </Panel>
  );
}

// ─── 6. Workforce composition ────────────────────────────────────────────────────

function WorkforceComposition({ m, data }: { m: Derived; data: CC }) {
  const deptMap = new Map<string, number>();
  (m.emps as Any[]).forEach((e) => { const k = (e.department ?? "").trim() || "Unassigned"; deptMap.set(k, (deptMap.get(k) ?? 0) + 1); });
  const chart = [...deptMap.entries()].map(([department, Employees]) => ({ department: department.length > 14 ? `${department.slice(0, 13)}…` : department, Employees })).sort((a, b) => b.Employees - a.Employees).slice(0, 8);
  const proj = (data.projects as Any)?.totals;
  return (
    <Panel title="Workforce Composition" subtitle={`${m.emps.length} employees by department`} icon={Users} action={{ label: "Directory", href: "/dashboard/employees" }}>
      {chart.length === 0 ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.4)" }}>No employee records yet.</p> : (
        <ResponsiveContainer width="100%" height={Math.max(180, chart.length * 34)}>
          <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="department" width={100} tick={{ fontSize: 10, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <Tooltip {...CHART_TOOLTIP} />
            <Bar dataKey="Employees" fill="#908DCE" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      {proj && <p className="mt-2 text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>Project mix: {proj.technical ?? 0} technical · {proj.generalist ?? 0} generalist.</p>}
    </Panel>
  );
}

// ─── 7. Employee movement ────────────────────────────────────────────────────────

function EmployeeMovement({ m, data, nowMs }: { m: Derived; data: CC; nowMs: number }) {
  const slots = monthSlots(nowMs);
  const rows = slots.map((sl) => ({
    month: sl.label,
    Joined: (m.emps as Any[]).filter((e) => String(e.dateOfJoining || e.createdAt || "").slice(0, 7) === sl.key).length,
    Exited: (data.separations as Any[]).filter((s) => String(s.lastWorkingDay ?? s.createdAt ?? "").slice(0, 7) === sl.key).length,
  }));
  const empty = rows.every((r) => r.Joined === 0 && r.Exited === 0);
  return (
    <Panel title="Employee Movement" subtitle="Joiners vs exits · last 6 months" icon={TrendingUp} action={{ label: "Lifecycle", href: "/dashboard/module-overview/lifecycle" }}>
      {empty ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.4)" }}>No movement recorded.</p> : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} barSize={14}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...CHART_TOOLTIP} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.6)" }} />
            <Bar dataKey="Joined" fill="#22c55e" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Exited" fill="#ef4444" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ─── 11. Department health matrix ────────────────────────────────────────────────

function DepartmentHealthMatrix({ data }: { data: CC }) {
  const domains = ([...(data.domains as Any[] ?? [])].filter((x) => x.candidates > 0 || x.joined > 0).sort((a, b) => b.candidates - a.candidates)).slice(0, 7);
  const cell = (v: number) => (v >= 70 ? "#22c55e" : v >= 45 ? "#f59e0b" : "#ef4444");
  return (
    <Panel title="Department Health Matrix" subtitle="Hiring conversion & pipeline per department" icon={Gauge} action={{ label: "Reports", href: "/dashboard/reports" }}>
      {domains.length === 0 ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.4)" }}>No department data yet.</p> : (
        <div className="space-y-2">
          {domains.map((d) => (
            <div key={d.department} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs" style={{ color: "rgba(197,203,232,0.7)" }}>{d.department}</span>
              <div className="flex flex-1 items-center gap-1.5">
                <div className="flex-1 rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold" style={{ background: `${cell(d.conversionRate ?? 0)}22`, color: cell(d.conversionRate ?? 0) }}>{d.conversionRate ?? 0}% conv</div>
                <span className="w-24 shrink-0 text-[11px]" style={{ color: "rgba(197,203,232,0.5)" }}>{d.candidates} cand · {d.joined} joined</span>
                {d.rejected > 0 ? <span className="w-14 shrink-0 rounded-lg px-1.5 py-0.5 text-center text-[10px] font-medium" style={{ background: "#ef444418", color: "#ef4444" }}>{d.rejected} rej</span> : <span className="w-14 shrink-0" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── 8/13/16 snapshots ───────────────────────────────────────────────────────────

function PerformanceOverview({ m, data }: { m: Derived; data: CC }) {
  const hl = data.highlights as Any;
  const top = hl?.topPerformers ?? []; const risk = hl?.atRisk ?? [];
  return (
    <Panel title="Performance Overview" subtitle="Company-wide performance summary" icon={Star} action={{ label: "Performance", href: "/dashboard/module-overview/performance" }}>
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center"><p className="text-lg font-bold" style={{ color: "#F8FAFC" }}>{m.perfHealth}%</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Perf health</p></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center"><p className="text-lg font-bold" style={{ color: "#F8FAFC" }}>{hl?.skillTaggedPct ?? 0}%</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Skill coverage</p></div>
        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.05] p-2.5 text-center"><p className="text-lg font-bold text-emerald-400">{top.length}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Top performers</p></div>
        <div className="rounded-xl border border-red-500/15 bg-red-500/[0.05] p-2.5 text-center"><p className="text-lg font-bold text-red-400">{risk.length}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>At risk</p></div>
      </div>
    </Panel>
  );
}

function FinancialSnapshot({ m }: { m: Derived }) {
  return (
    <Panel title="Financial Snapshot" subtitle="Reimbursements & approvals" icon={ReceiptText} action={{ label: "Finance", href: "/dashboard/module-overview/finance" }}>
      <div className="space-y-2">
        <Row label="Pending approval" value={inr(m.pendingReimbAmt)} tone="warning" />
        <Row label="Pending claims" value={`${m.pendingReimb}`} />
        <Row label="Finance health" value={`${m.financeHealth}%`} tone={m.financeHealth >= 70 ? "success" : "warning"} />
        <Row label="Bank verification" value={`${m.bankPct}%`} tone={m.bankPct >= 60 ? "success" : "warning"} />
      </div>
    </Panel>
  );
}

function ProjectCompliance({ m }: { m: Derived }) {
  return (
    <Panel title="Projects & Compliance" subtitle="Delivery & risk" icon={FolderKanban} action={{ label: "Projects", href: "/dashboard/projects" }}>
      <div className="space-y-2">
        <Row label="Active projects" value={`${(m.proj as Any)?.activeProjects ?? 0}`} />
        <Row label="Budget utilisation" value={`${m.projUtil}%`} tone={m.projUtil > 100 ? "danger" : "default"} />
        <Row label="Compliance health" value={`${m.complianceHealth}%`} tone={m.complianceHealth >= 70 ? "success" : "warning"} />
        <Row label="Accounts unverified" value={`${m.bank.length - m.bankVerified}`} tone={(m.bank.length - m.bankVerified) ? "warning" : "success"} />
      </div>
    </Panel>
  );
}

function Row({ label, value, tone = "default" }: { label: string; value: string; tone?: Tone }) {
  const c = tone === "success" ? "#22c55e" : tone === "warning" ? "#f59e0b" : tone === "danger" ? "#ef4444" : "#C5CBE8";
  return <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs"><span style={{ color: "rgba(197,203,232,0.65)" }}>{label}</span><span className="font-semibold" style={{ color: c }}>{value}</span></div>;
}

// ─── 18. Action center ───────────────────────────────────────────────────────────

function ActionCenter({ m }: { m: Derived }) {
  const items = [
    { label: "Finance approvals pending", value: inr(m.pendingReimbAmt), sev: m.pendingReimbAmt > 100000 ? "High" : "Medium", href: "/dashboard/reimbursements" },
    { label: "Accounts missing bank verification", value: `${m.bank.length - m.bankVerified}`, sev: (m.bank.length - m.bankVerified) > 100 ? "High" : "Medium", href: "/dashboard/bank-verification" },
    { label: "Candidates in evaluation", value: `${m.pendingEvals}`, sev: "Medium", href: "/dashboard/evaluations" },
    { label: "IT setups + ID cards pending", value: `${m.itPend + m.idPending}`, sev: "Medium", href: "/dashboard/it-requests" },
    { label: "Active exits in progress", value: `${m.activeExits}`, sev: m.activeExits ? "Medium" : "Low", href: "/dashboard/separation" },
    { label: "Open escalations", value: `${m.escalations}`, sev: m.escalations ? "High" : "Low", href: "/dashboard/escalations" },
  ].filter((x) => x.value !== "0" && x.value !== "₹0");
  const dot: Record<string, string> = { High: "🔴", Medium: "🟠", Low: "🟢" };
  const rank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
  items.sort((a, b) => rank[a.sev] - rank[b.sev]);
  return (
    <Panel title="Action Center" subtitle="Ranked by impact — what HR should tackle today" icon={Clock3}>
      {items.length === 0 ? <div className="flex flex-col items-center gap-2 py-8"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>Nothing urgent — all queues are clear.</p></div> : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((x) => (
            <Link key={x.label} href={x.href} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
              <span aria-hidden>{dot[x.sev]}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{x.label}</span>
              <span className="shrink-0 text-sm font-bold text-primary">{x.value}</span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── 19. Executive timeline ──────────────────────────────────────────────────────

function ExecutiveTimeline({ data }: { data: CC }) {
  type Ev = { at: string; text: string; icon: ElementType; tone: Tone; href: string };
  const events: Ev[] = [];
  (data.candidates as Any[]).slice(0, 10).forEach((c) => events.push({ at: c.createdAt, text: `${c.fullName ?? "Candidate"} applied${c.position?.title ? ` — ${c.position.title}` : ""}`, icon: Briefcase, tone: "default", href: `/dashboard/candidates/${c.id}` }));
  (data.employees as Any[]).slice(0, 30).forEach((e) => { const jd = e.dateOfJoining || e.createdAt; if (jd) events.push({ at: jd, text: `${e.name ?? "Employee"} joined${e.department ? ` · ${e.department}` : ""}`, icon: UserCheck, tone: "success", href: "/dashboard/employees" }); });
  (data.evaluations as Any[]).filter((e) => e.completedAt).slice(0, 15).forEach((e) => events.push({ at: e.completedAt, text: `Evaluation completed — ${e.candidate?.fullName ?? "candidate"}`, icon: ClipboardCheck, tone: "default", href: "/dashboard/evaluations" }));
  (data.separations as Any[]).slice(0, 10).forEach((s) => { if (s.createdAt) events.push({ at: s.createdAt, text: `Exit initiated — ${s.employeeName ?? "employee"}`, icon: UserMinus, tone: "danger", href: "/dashboard/separation" }); });
  const rows = events.filter((e) => e.at && Number.isFinite(new Date(e.at).getTime())).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 10);
  return (
    <Panel title="Executive Timeline" subtitle="Latest activity across modules" icon={Activity} action={{ label: "Reports", href: "/dashboard/reports" }}>
      {rows.length === 0 ? <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.4)" }}>No recent activity.</p> : (
        <div className="space-y-3">
          {rows.map((ev, i) => { const Icon = ev.icon; return (
            <Link key={`${ev.at}-${i}`} href={ev.href} className="flex min-w-0 items-start gap-3">
              <div className="flex flex-col items-center"><span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", TONE[ev.tone])}><Icon className="h-3.5 w-3.5" /></span>{i < rows.length - 1 && <span className="mt-1 h-full w-px flex-1" style={{ background: "rgba(144,141,206,0.15)", minHeight: 12 }} />}</div>
              <div className="min-w-0 flex-1 pb-1"><p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{ev.text}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{timeAgo(ev.at)}</p></div>
            </Link>
          ); })}
        </div>
      )}
    </Panel>
  );
}

// ─── 20. AI recommendations ──────────────────────────────────────────────────────

function AiRecommendations({ m, data }: { m: Derived; data: CC }) {
  const recs: Array<{ text: string; icon: ElementType; href: string }> = [];
  if (m.bankPct < 60) recs.push({ text: `Bank verification is only ${m.bankPct}% — complete it to unblock new-joiner payouts.`, icon: Landmark, href: "/dashboard/bank-verification" });
  if (m.pendingReimbAmt > 0) recs.push({ text: `Clear ${inr(m.pendingReimbAmt)} in pending reimbursements to avoid slowing onboarding.`, icon: ReceiptText, href: "/dashboard/reimbursements" });
  const topDomain = ([...(data.domains as Any[] ?? [])].filter((x) => x.candidates > 0).sort((a, b) => (b.candidates - b.joined) - (a.candidates - a.joined)))[0];
  if (topDomain) recs.push({ text: `Prioritise hiring for ${topDomain.department} — ${topDomain.candidates - topDomain.joined} candidates still in pipeline.`, icon: Briefcase, href: "/dashboard/module-overview/talent" });
  if (((m.hl as Any)?.topPerformers?.length ?? 0) > 0) recs.push({ text: `${(m.hl as Any).topPerformers.length} high performers are eligible for promotion review.`, icon: Star, href: "/dashboard/module-overview/performance" });
  if (m.activeExits > 0) recs.push({ text: `${m.activeExits} exits in progress — ensure knowledge transfer and clearances.`, icon: UserMinus, href: "/dashboard/separation" });
  if (recs.length === 0) recs.push({ text: "Organisation is running smoothly — focus on strategic hiring and development.", icon: Sparkles, href: "/dashboard/module-overview" });
  return (
    <Panel title="AI Recommendations" subtitle="Suggested next actions from correlated data" icon={Sparkles}>
      <div className="space-y-2">
        {recs.slice(0, 5).map((r) => { const Icon = r.icon; return (
          <Link key={r.text} href={r.href} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{r.text}</p>
            <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          </Link>
        ); })}
      </div>
    </Panel>
  );
}

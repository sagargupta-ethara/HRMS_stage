"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ElementType } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, ArrowUpRight, Briefcase, CheckCircle2, Clock3, Coins,
  FolderKanban, Gauge, Loader2, Search, Sparkles, TrendingUp, Users, Wallet,
} from "lucide-react";

import { projectsApi, type ProjectAnalytics, type ProjectRecord } from "@/lib/api";
import { CHART_COLORS, CHART_TOOLTIP_STYLE, Panel, fmtMoney } from "./shared";
import { EmptyState } from "@/components/shared/empty-state";

// This dashboard is budget/resource/delivery centric because that is what the
// projects module actually tracks. Revenue, profit, margin, expense categories,
// department spend, cash flow and FX conversion are NOT stored, so those
// prompt sections are honestly omitted rather than mocked. Real signals used:
// approved/consumed budget, per-project currency, delivery (deliveredVolume /
// targetVolume), and resources (fteCount / fteDemand).

type P = ProjectRecord;

const GREEN = "#22c55e", YELLOW = "#f59e0b", RED = "#ef4444", BLUE = "#38BDF8", PURPLE = "#ED00ED";

function compact(n: number, cur = "INR"): string {
  const sym = cur === "USD" ? "$" : "₹";
  const a = Math.abs(n);
  if (cur !== "USD" && a >= 1e7) return `${sym}${(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e6) return `${sym}${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sym}${(n / 1e3).toFixed(1)}K`;
  return `${sym}${Math.round(n).toLocaleString("en-IN")}`;
}

const budgetUtil = (p: P) => (p.approvedBudget > 0 ? Math.round((p.consumedBudget / p.approvedBudget) * 100) : 0);
const deliveryPct = (p: P) => (p.targetVolume ? Math.min(100, Math.round(((p.deliveredVolume ?? 0) / p.targetVolume) * 100)) : p.deliveryStatus === "completed" ? 100 : 0);
const resourceUtil = (p: P) => (p.fteDemand ? Math.min(150, Math.round(((p.fteCount ?? 0) / p.fteDemand) * 100)) : 0);
const benchOf = (p: P) => Math.max(0, (p.fteDemand ?? 0) - (p.fteCount ?? 0));
const isCompleted = (p: P) => p.deliveryStatus === "completed" || p.rfpStatus === "delivered";
const isActive = (p: P) => !p.isArchived && !isCompleted(p);
const overdue = (p: P, nowMs: number) => Boolean(p.dateOfDelivery) && new Date(p.dateOfDelivery as string).getTime() < nowMs && !isCompleted(p);
const overBudget = (p: P) => budgetUtil(p) > 100;
function healthOf(p: P, nowMs: number): { label: "Healthy" | "Warning" | "Critical"; color: string } {
  if (overBudget(p) || overdue(p, nowMs)) return { label: "Critical", color: RED };
  if (budgetUtil(p) > 85 || benchOf(p) > 0 || (isActive(p) && deliveryPct(p) < 40)) return { label: "Warning", color: YELLOW };
  return { label: "Healthy", color: GREEN };
}

function bandOf(score: number) {
  if (score >= 80) return { label: "Healthy Portfolio", color: GREEN, emoji: "🟢" };
  if (score >= 60) return { label: "Needs Attention", color: YELLOW, emoji: "🟡" };
  if (score >= 45) return { label: "At Risk", color: "#f97316", emoji: "🟠" };
  return { label: "Critical", color: RED, emoji: "🔴" };
}

export default function ProjectGovernanceDashboardPage() {
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(t);
  }, []);
  // Both queries are optional so the page degrades gracefully for any role that
  // can open it but is blocked on one endpoint (avoids an infinite loader).
  const { data: analytics, isLoading: aLoading } = useQuery({ queryKey: ["project-analytics"], queryFn: projectsApi.analytics, staleTime: 60_000, retry: false });
  const { data: projectList, isLoading: pLoading } = useQuery({ queryKey: ["project-list"], queryFn: () => projectsApi.list(), staleTime: 60_000, retry: false });

  if (nowMs == null || (aLoading && pLoading)) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading portfolio analytics…
      </div>
    );
  }

  const projects = projectList ?? [];
  if (!analytics && projects.length === 0) {
    return <EmptyState icon={FolderKanban} title="No project data available" description="No projects are visible for your role yet, or project analytics could not be loaded." className="h-[60vh]" />;
  }
  return <Dashboard analytics={analytics} projects={projects} nowMs={nowMs} />;
}

function Dashboard({ analytics, projects, nowMs }: { analytics: ProjectAnalytics | undefined; projects: P[]; nowMs: number }) {
  // Totals come from analytics when available, else are computed from the project
  // list so KPIs still render if the analytics endpoint is unavailable for a role.
  const t = analytics?.totals ?? {
    totalProjects: projects.length,
    activeProjects: 0,
    deliveredProjects: 0,
    totalApprovedBudget: projects.reduce((s, p) => s + p.approvedBudget, 0),
    totalConsumedBudget: projects.reduce((s, p) => s + p.consumedBudget, 0),
    remainingBudget: projects.reduce((s, p) => s + p.remainingBudget, 0),
    technical: 0,
    generalist: 0,
  };
  const utilization = t.totalApprovedBudget > 0 ? Math.round((t.totalConsumedBudget / t.totalApprovedBudget) * 100) : 0;

  const active = projects.filter(isActive).length;
  const completed = projects.filter(isCompleted).length;
  const delayed = projects.filter((p) => overdue(p, nowMs) || overBudget(p)).length;
  const fteDemand = projects.reduce((s, p) => s + (p.fteDemand ?? 0), 0);
  const fteCount = projects.reduce((s, p) => s + (p.fteCount ?? 0), 0);
  const resUtil = fteDemand ? Math.round((fteCount / fteDemand) * 100) : 0;
  const bench = Math.max(0, fteDemand - fteCount);
  const idleBudget = projects.filter((p) => budgetUtil(p) < 40 && p.approvedBudget > 0).reduce((s, p) => s + p.remainingBudget, 0);

  const greenN = projects.filter((p) => healthOf(p, nowMs).label === "Healthy").length;
  const yellowN = projects.filter((p) => healthOf(p, nowMs).label === "Warning").length;
  const redN = projects.filter((p) => healthOf(p, nowMs).label === "Critical").length;
  const score = projects.length ? Math.round((greenN * 100 + yellowN * 60 + redN * 25) / projects.length) : 100;
  const band = bandOf(score);

  const overBudgetProjects = projects.filter(overBudget).sort((a, b) => budgetUtil(b) - budgetUtil(a));
  const idleProjects = projects.filter((p) => budgetUtil(p) < 40 && p.approvedBudget > 0);

  const highlights = [
    `${greenN} of ${projects.length} projects are healthy (${band.label}).`,
    overBudgetProjects.length ? `${overBudgetProjects[0].internalName} is over budget at ${budgetUtil(overBudgetProjects[0])}%.` : "No project is over budget.",
    idleBudget > 0 ? `${compact(idleBudget)} sits idle across ${idleProjects.length} under-utilised project${idleProjects.length === 1 ? "" : "s"}.` : "Budget allocation is well utilised.",
    `Resource utilisation at ${resUtil}% · ${bench} FTE on bench.`,
    delayed > 0 ? `${delayed} project${delayed === 1 ? "" : "s"} flagged delayed or over budget.` : "No delivery delays flagged.",
  ];
  const recommendations = [
    overBudgetProjects.length ? `Review spend on ${overBudgetProjects.slice(0, 2).map((p) => p.internalName).join(" & ")}.` : "Maintain current budget discipline.",
    idleProjects.length ? `Reallocate idle budget/resources from ${idleProjects[0].internalName}.` : "Resource allocation looks balanced.",
    bench > 0 ? `Redeploy ${bench} benched FTE to demand-heavy projects.` : "No bench to redeploy.",
  ];

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-semibold" style={{ color: "#F8FAFC" }}>
            <FolderKanban className="h-5 w-5 text-primary" /> Project Governance & Budget
          </h1>
          <p className="text-sm text-muted-foreground">Executive portfolio command center — budgets, delivery, resources & risk.</p>
        </div>
        <Link href="/dashboard/projects/master" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
          Open Project Master <ArrowRight className="size-3.5" />
        </Link>
      </div>

      {/* 2 · AI Portfolio Summary banner */}
      <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={{ background: "rgba(25,24,44,0.78)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
        <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(ellipse at 12% 0%, ${band.color}22 0%, transparent 55%)` }} />
        <div className="relative grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-center">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.55)" }}><span aria-hidden>{band.emoji}</span> Portfolio Health</p>
            <div className="mt-2 flex items-end gap-2"><span className="text-5xl font-bold leading-none" style={{ color: "#F8FAFC" }}>{score}</span><span className="pb-1 text-lg font-medium" style={{ color: "rgba(197,203,232,0.4)" }}>/ 100</span></div>
            <p className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${band.color}1f`, color: band.color }}>{band.label}</p>
            <div className="mt-3 flex gap-2 text-[11px]">
              <span className="rounded-lg px-2 py-1" style={{ background: `${GREEN}18`, color: GREEN }}>{greenN} healthy</span>
              <span className="rounded-lg px-2 py-1" style={{ background: `${YELLOW}18`, color: YELLOW }}>{yellowN} warning</span>
              <span className="rounded-lg px-2 py-1" style={{ background: `${RED}18`, color: RED }}>{redN} critical</span>
            </div>
          </div>
          <div className="min-w-0 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400"><Sparkles className="h-3.5 w-3.5" /> Highlights</p>
              <ul className="space-y-1.5">{highlights.map((h) => <li key={h} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}><span className="text-emerald-400">•</span><span className="min-w-0">{h}</span></li>)}</ul>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/[0.07] p-3.5">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" /> Recommendations</p>
              <ul className="space-y-1.5">{recommendations.map((r) => <li key={r} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}><span className="text-primary">→</span><span className="min-w-0">{r}</span></li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      {/* 1 · Executive KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total Projects" value={t.totalProjects} sub={`${active} active · ${completed} completed`} icon={Briefcase} tone={BLUE} href="/dashboard/projects/master" />
        <Kpi label="Approved Budget" value={compact(t.totalApprovedBudget)} sub="across all projects" icon={Wallet} tone={PURPLE} href="/dashboard/projects/budgets" />
        <Kpi label="Consumed Budget" value={compact(t.totalConsumedBudget)} sub={`${utilization}% utilisation`} icon={TrendingUp} tone={utilization > 85 ? YELLOW : GREEN} href="/dashboard/projects/budgets" />
        <Kpi label="Remaining Budget" value={compact(t.remainingBudget)} sub={t.remainingBudget < 0 ? "over-allocated" : "available"} icon={CheckCircle2} tone={t.remainingBudget < 0 ? RED : GREEN} href="/dashboard/projects/budgets" />
        <Kpi label="Budget Utilisation" value={`${utilization}%`} sub={utilization > 100 ? "Critical" : utilization > 85 ? "Warning" : "Healthy"} icon={Gauge} tone={utilization > 100 ? RED : utilization > 85 ? YELLOW : GREEN} href="/dashboard/projects/budgets" />
        <Kpi label="Resource Utilisation" value={`${resUtil}%`} sub={`${fteCount}/${fteDemand} FTE · ${bench} bench`} icon={Users} tone={resUtil >= 80 ? GREEN : YELLOW} href="/dashboard/projects/master" />
        <Kpi label="Delayed Projects" value={delayed} sub={delayed ? "over-budget or overdue" : "on track"} icon={AlertTriangle} tone={delayed ? RED : GREEN} href="/dashboard/projects/master" />
        <Kpi label="Idle Budget" value={compact(idleBudget)} sub={`${idleProjects.length} under-utilised`} icon={Coins} tone={idleProjects.length ? YELLOW : GREEN} href="/dashboard/projects/budgets" />
      </div>

      {/* 3 · Health matrix + 4 · Burn trend */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProjectHealthMatrix projects={projects} nowMs={nowMs} />
        <BudgetBurnTrend analytics={analytics} totalApproved={t.totalApprovedBudget} totalConsumed={t.totalConsumedBudget} />
      </div>

      {/* 5 · Currency + 6 · Allocation vs actual */}
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <CurrencyAnalysis projects={projects} />
        <BudgetAllocation projects={projects} nowMs={nowMs} />
      </div>

      {/* 8 · Client portfolio + 10 · Resource heatmap */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ClientPortfolio projects={projects} />
        <ResourceHeatmap projects={projects} />
      </div>

      {/* 9 · Health cards */}
      <ProjectHealthCards projects={projects} nowMs={nowMs} />

      {/* 14 · Timeline risk + 15 · AI cost optimisation */}
      <div className="grid gap-4 lg:grid-cols-2">
        <TimelineRisk projects={projects} nowMs={nowMs} />
        <CostOptimisation projects={projects} idleBudget={idleBudget} bench={bench} nowMs={nowMs} />
      </div>

      {/* 18 · Breakdown table */}
      <ProjectTable projects={projects} nowMs={nowMs} />
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone, href }: { label: string; value: string | number; sub: string; icon: ElementType; tone: string; href: string }) {
  return (
    <Link href={href} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5" style={{ background: "rgba(25,24,44,0.78)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: tone }} />{label}</p>
          <p className="mt-1.5 text-2xl font-bold leading-none" style={{ color: "#F8FAFC" }}>{value}</p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `${tone}1f`, color: tone }}><Icon className="h-4 w-4" /></div>
      </div>
      <p className="mt-2 truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{sub}</p>
    </Link>
  );
}

// 3 · Bubble scatter — budget utilisation × delivery, sized by budget, coloured by health
function ProjectHealthMatrix({ projects, nowMs }: { projects: P[]; nowMs: number }) {
  const pts = projects.filter((p) => p.approvedBudget > 0).map((p) => ({ x: budgetUtil(p), y: deliveryPct(p), z: p.approvedBudget, name: p.internalName, fill: healthOf(p, nowMs).color }));
  return (
    <Panel title="Project Health Matrix" subtitle="Budget utilisation × delivery · bubble = budget, colour = health">
      {pts.length === 0 ? <EmptyState icon={Gauge} title="No project data" description="Health matrix appears once projects have budgets." className="h-[280px]" /> : (
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 10, right: 14, left: -18, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
            <XAxis type="number" dataKey="x" name="Budget %" domain={[0, 140]} tick={{ fontSize: 11, fill: "#C5CBE8" }} tickFormatter={(v) => `${v}%`} />
            <YAxis type="number" dataKey="y" name="Delivery %" domain={[0, 100]} tick={{ fontSize: 11, fill: "#C5CBE8" }} tickFormatter={(v) => `${v}%`} />
            <ZAxis type="number" dataKey="z" range={[60, 460]} name="Budget" />
            <Tooltip {...CHART_TOOLTIP_STYLE} cursor={{ strokeDasharray: "3 3" }} formatter={(v, n) => (n === "Budget" ? fmtMoney(v as number) : `${v}%`)} />
            <Scatter data={pts}>{pts.map((p, i) => <Cell key={i} fill={p.fill} fillOpacity={0.7} />)}</Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// 4 · Burn trend + linear forecast + exhaustion estimate
function BudgetBurnTrend({ analytics, totalApproved, totalConsumed }: { analytics: ProjectAnalytics | undefined; totalApproved: number; totalConsumed: number }) {
  const trend = analytics?.monthlyExpenseTrend ?? [];
  const rows = trend.map((r, i) => ({ month: r.month, Spend: r.spend, Cumulative: trend.slice(0, i + 1).reduce((s, x) => s + x.spend, 0) }));
  const recent = trend.slice(-3);
  const burnRate = recent.length ? Math.round(recent.reduce((s, r) => s + r.spend, 0) / recent.length) : 0;
  const remaining = totalApproved - totalConsumed;
  const monthsLeft = burnRate > 0 ? Math.max(0, Math.round((remaining / burnRate) * 10) / 10) : null;
  // Extend forecast line 3 months at current burn rate (pure — no mutation).
  const cumTotal = rows.length ? rows[rows.length - 1].Cumulative : 0;
  const forecast = rows.length > 0 && burnRate > 0
    ? [...rows, ...[1, 2, 3].map((i) => ({ month: `+${i}m`, Spend: burnRate, Cumulative: cumTotal + burnRate * i }))]
    : rows;
  return (
    <Panel title="Budget Burn Trend" subtitle="Monthly spend, cumulative burn & 3-month forecast">
      {rows.length === 0 ? <EmptyState icon={TrendingUp} title="No spend activity" description="Burn trend appears once expenses are recorded." className="h-[280px]" /> : (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center"><p className="text-base font-bold" style={{ color: "#F8FAFC" }}>{compact(burnRate)}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Burn / month</p></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center"><p className="text-base font-bold" style={{ color: monthsLeft != null && monthsLeft < 3 ? RED : "#F8FAFC" }}>{monthsLeft != null ? `${monthsLeft}m` : "—"}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Runway left</p></div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center"><p className="text-base font-bold" style={{ color: "#F8FAFC" }}>{compact(remaining)}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Remaining</p></div>
          </div>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={forecast} margin={{ top: 5, right: 10, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#C5CBE8" }} />
              <YAxis tick={{ fontSize: 10, fill: "#C5CBE8" }} tickFormatter={(v) => compact(v as number)} />
              <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => fmtMoney(v as number)} />
              <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
              <Line type="monotone" dataKey="Spend" stroke={BLUE} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Cumulative" stroke={PURPLE} strokeWidth={2} strokeDasharray="5 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </Panel>
  );
}

// 5 · Currency split (no FX conversion — kept per-currency)
function CurrencyAnalysis({ projects }: { projects: P[] }) {
  const map = new Map<string, { approved: number; consumed: number; count: number }>();
  projects.forEach((p) => { const c = (p.currency || "INR").toUpperCase(); const r = map.get(c) ?? { approved: 0, consumed: 0, count: 0 }; r.approved += p.approvedBudget; r.consumed += p.consumedBudget; r.count += 1; map.set(c, r); });
  const rows = [...map.entries()].map(([cur, v], i) => ({ cur, ...v, fill: CHART_COLORS[i % CHART_COLORS.length] })).sort((a, b) => b.count - a.count);
  const slices = rows.map((r) => ({ name: r.cur, value: r.count, fill: r.fill }));
  return (
    <Panel title="Currency Analysis" subtitle="Budget by project currency (not FX-converted)">
      {rows.length === 0 ? <EmptyState icon={Coins} title="No currency data" description="Currency split appears once projects exist." className="h-[220px]" /> : (
        <>
          <div className="flex items-center gap-4">
            <div className="relative h-28 w-28 shrink-0">
              <PieChart width={112} height={112}>
                <Pie data={slices} cx={52} cy={52} innerRadius={34} outerRadius={52} dataKey="value" strokeWidth={0}>{slices.map((s, i) => <Cell key={i} fill={s.fill} />)}</Pie>
              </PieChart>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-sm font-bold" style={{ color: "#F8FAFC" }}>{projects.length}</span><span className="text-[9px]" style={{ color: "rgba(197,203,232,0.45)" }}>projects</span></div>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {rows.map((r) => (
                <div key={r.cur} className="text-xs">
                  <div className="flex items-center justify-between"><span className="flex items-center gap-1.5" style={{ color: "rgba(197,203,232,0.7)" }}><span className="h-2 w-2 rounded-full" style={{ background: r.fill }} />{r.cur}</span><span className="font-semibold" style={{ color: "#F8FAFC" }}>{compact(r.approved, r.cur)}</span></div>
                  <p className="mt-0.5 text-[10px]" style={{ color: "rgba(197,203,232,0.42)" }}>{r.count} projects · {compact(r.consumed, r.cur)} consumed</p>
                </div>
              ))}
            </div>
          </div>
          <p className="mt-3 text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>Amounts are shown per currency; no exchange-rate conversion is applied.</p>
        </>
      )}
    </Panel>
  );
}

// 7 · Budget allocation vs actual — per-project progress bars
function BudgetAllocation({ projects, nowMs }: { projects: P[]; nowMs: number }) {
  const rows = [...projects].filter((p) => p.approvedBudget > 0).sort((a, b) => budgetUtil(b) - budgetUtil(a)).slice(0, 10);
  return (
    <Panel title="Budget Allocation vs Actual" subtitle="Utilisation per project">
      {rows.length === 0 ? <EmptyState icon={Wallet} title="No budgets yet" description="Per-project utilisation appears once budgets exist." className="h-[240px]" /> : (
        <div className="space-y-3">
          {rows.map((p) => {
            const u = budgetUtil(p); const h = healthOf(p, nowMs);
            return (
              <Link key={p.id} href="/dashboard/projects/budgets" className="block space-y-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-white/[0.04]">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium" style={{ color: "#E5E7EB" }}>{p.internalName}</span>
                  <span className="shrink-0 font-semibold" style={{ color: h.color }}>{u}%{u > 100 ? " 🔴" : u < 40 ? " 🟡" : ""}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, u)}%`, background: h.color }} />
                </div>
                <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.42)" }}>{fmtMoney(p.consumedBudget, p.currency)} of {fmtMoney(p.approvedBudget, p.currency)} · {fmtMoney(p.remainingBudget, p.currency)} left</p>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// 8 · Client budget & utilisation (no revenue/profit tracked)
function ClientPortfolio({ projects }: { projects: P[] }) {
  const map = new Map<string, { approved: number; consumed: number; count: number }>();
  projects.forEach((p) => { const c = p.client || "Unassigned"; const r = map.get(c) ?? { approved: 0, consumed: 0, count: 0 }; r.approved += p.approvedBudget; r.consumed += p.consumedBudget; r.count += 1; map.set(c, r); });
  const rows = [...map.entries()].map(([client, v]) => ({ client, ...v, util: v.approved ? Math.round((v.consumed / v.approved) * 100) : 0 })).sort((a, b) => b.approved - a.approved).slice(0, 8);
  const max = Math.max(...rows.map((r) => r.approved), 1);
  return (
    <Panel title="Client Portfolio" subtitle="Budget & utilisation by client">
      {rows.length === 0 ? <EmptyState icon={Briefcase} title="No client data" description="Client budgets appear here." className="h-[240px]" /> : (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div key={r.client} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate" style={{ color: "rgba(197,203,232,0.72)" }}>{r.client}</span>
                <span className="shrink-0 font-semibold" style={{ color: "#F8FAFC" }}>{compact(r.approved)} <span className="font-normal" style={{ color: r.util > 100 ? RED : "rgba(197,203,232,0.42)" }}>· {r.util}%</span></span>
              </div>
              <div className="h-1.5 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}><div className="h-full rounded-full" style={{ width: `${Math.max(3, (r.approved / max) * 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} /></div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// 10 · Resource utilisation heatmap (projects × utilisation / bench)
function ResourceHeatmap({ projects }: { projects: P[] }) {
  const rows = projects.filter((p) => (p.fteDemand ?? 0) > 0).sort((a, b) => (b.fteDemand ?? 0) - (a.fteDemand ?? 0)).slice(0, 10);
  const cell = (u: number) => (u >= 90 ? GREEN : u >= 60 ? BLUE : u >= 30 ? YELLOW : RED);
  return (
    <Panel title="Resource Utilisation Heatmap" subtitle="FTE demand vs allocation per project">
      {rows.length === 0 ? <EmptyState icon={Users} title="No FTE data" description="Resource utilisation appears once demand is set." className="h-[240px]" /> : (
        <div className="space-y-2">
          {rows.map((p) => {
            const u = resourceUtil(p); const b = benchOf(p);
            return (
              <div key={p.id} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs" style={{ color: "rgba(197,203,232,0.7)" }}>{p.internalName}</span>
                <div className="flex flex-1 items-center gap-2">
                  <div className="flex-1 rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold" style={{ background: `${cell(u)}22`, color: cell(u) }}>{u}% used</div>
                  <span className="w-24 shrink-0 text-[11px]" style={{ color: "rgba(197,203,232,0.5)" }}>{p.fteCount ?? 0}/{p.fteDemand ?? 0} FTE</span>
                  {b > 0 ? <span className="w-16 shrink-0 rounded-lg px-1.5 py-0.5 text-center text-[10px] font-medium" style={{ background: `${YELLOW}18`, color: YELLOW }}>{b} bench</span> : <span className="w-16 shrink-0 text-center text-[10px]" style={{ color: GREEN }}>full</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// 9 · Compact project health cards
function ProjectHealthCards({ projects, nowMs }: { projects: P[]; nowMs: number }) {
  const rows = [...projects].filter(isActive).sort((a, b) => budgetUtil(b) - budgetUtil(a)).slice(0, 8);
  return (
    <Panel title="Project Health Cards" subtitle="Active projects at a glance">
      {rows.length === 0 ? <EmptyState icon={FolderKanban} title="No active projects" description="Active project cards appear here." className="h-[160px]" /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((p) => {
            const h = healthOf(p, nowMs); const u = budgetUtil(p); const d = deliveryPct(p); const r = resourceUtil(p);
            return (
              <Link key={p.id} href="/dashboard/projects/master" className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold" style={{ color: "#F8FAFC" }}>{p.internalName}</p>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.color }} />
                </div>
                <p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{p.client ?? "—"} · {p.tpmName ?? "No TPM"}</p>
                <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]">
                  <div><p className="text-sm font-bold" style={{ color: u > 100 ? RED : "#F8FAFC" }}>{u}%</p><p style={{ color: "rgba(197,203,232,0.4)" }}>budget</p></div>
                  <div><p className="text-sm font-bold" style={{ color: "#F8FAFC" }}>{d}%</p><p style={{ color: "rgba(197,203,232,0.4)" }}>delivery</p></div>
                  <div><p className="text-sm font-bold" style={{ color: "#F8FAFC" }}>{r}%</p><p style={{ color: "rgba(197,203,232,0.4)" }}>resource</p></div>
                </div>
                <span className="mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${h.color}18`, color: h.color }}>{h.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// 14 · Timeline & delivery risk (Gantt-inspired)
function TimelineRisk({ projects, nowMs }: { projects: P[]; nowMs: number }) {
  const rows = [...projects].filter(isActive).sort((a, b) => deliveryPct(a) - deliveryPct(b)).slice(0, 8);
  return (
    <Panel title="Project Timeline & Risk" subtitle="Delivery progress · overdue flagged">
      {rows.length === 0 ? <EmptyState icon={Clock3} title="No active timelines" description="Delivery progress appears here." className="h-[220px]" /> : (
        <div className="space-y-3">
          {rows.map((p) => {
            const d = deliveryPct(p); const od = overdue(p, nowMs); const color = od ? RED : d >= 70 ? GREEN : d >= 40 ? BLUE : YELLOW;
            return (
              <div key={p.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate" style={{ color: "rgba(197,203,232,0.72)" }}>{p.internalName}{od && <span className="ml-1.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-red-300">overdue</span>}</span>
                  <span className="shrink-0 font-semibold" style={{ color }}>{d}%</span>
                </div>
                <div className="h-2 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}><div className="h-full rounded-full" style={{ width: `${Math.max(3, d)}%`, background: color }} /></div>
                <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{(p.deliveredVolume ?? 0).toLocaleString("en-IN")} / {(p.targetVolume ?? 0).toLocaleString("en-IN")} delivered{p.dateOfDelivery ? ` · due ${new Date(p.dateOfDelivery).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : ""}</p>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// 15 · AI cost optimisation
function CostOptimisation({ projects, idleBudget, bench, nowMs }: { projects: P[]; idleBudget: number; bench: number; nowMs: number }) {
  const over = projects.filter(overBudget).sort((a, b) => budgetUtil(b) - budgetUtil(a));
  const items: Array<{ text: string; icon: ElementType; href: string; tone: string }> = [];
  if (over.length) items.push({ text: `${over.length} project${over.length === 1 ? "" : "s"} over budget — ${over[0].internalName} at ${budgetUtil(over[0])}%. Review spend.`, icon: AlertTriangle, href: "/dashboard/projects/budgets", tone: RED });
  if (idleBudget > 0) items.push({ text: `${compact(idleBudget)} idle budget could be reallocated to demand-heavy projects.`, icon: Coins, href: "/dashboard/projects/budgets", tone: YELLOW });
  if (bench > 0) items.push({ text: `${bench} FTE on bench — redeploy to reduce cost of idle capacity.`, icon: Users, href: "/dashboard/projects/master", tone: YELLOW });
  const overdueN = projects.filter((p) => overdue(p, nowMs)).length;
  if (overdueN > 0) items.push({ text: `${overdueN} project${overdueN === 1 ? "" : "s"} past delivery date — delivery risk to margins.`, icon: Clock3, href: "/dashboard/projects/master", tone: RED });
  if (items.length === 0) items.push({ text: "No cost anomalies detected — portfolio spend is within expectations.", icon: CheckCircle2, href: "/dashboard/projects/budgets", tone: GREEN });
  const savings = idleBudget * 0.5;
  return (
    <Panel title="AI Cost Optimisation" subtitle="Anomalies, idle budget & savings opportunities">
      <div className="mb-3 rounded-xl border border-primary/20 bg-primary/[0.06] p-3 text-center">
        <p className="text-2xl font-bold text-primary">{compact(savings)}</p>
        <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>estimated reclaimable budget</p>
      </div>
      <div className="space-y-2">
        {items.map((x) => { const Icon = x.icon; return (
          <Link key={x.text} href={x.href} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
            <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: x.tone }} />
            <p className="min-w-0 flex-1 text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{x.text}</p>
            <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-primary" />
          </Link>
        ); })}
      </div>
    </Panel>
  );
}

// 18 · Project breakdown table with search
function ProjectTable({ projects, nowMs }: { projects: P[]; nowMs: number }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = s ? projects.filter((p) => [p.internalName, p.client, p.tpmName].some((v) => String(v ?? "").toLowerCase().includes(s))) : projects;
    return [...rows].sort((a, b) => b.approvedBudget - a.approvedBudget);
  }, [projects, q]);
  return (
    <Panel
      title="Project Breakdown"
      subtitle={`${filtered.length} of ${projects.length} projects`}
      action={
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: "rgba(197,203,232,0.4)" }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search project, client, TPM" className="h-8 w-52 rounded-lg border border-[rgba(144,141,206,0.2)] bg-[rgba(20,19,36,0.6)] pl-8 pr-2 text-xs outline-none focus:border-primary/40" style={{ color: "#F8FAFC" }} />
        </div>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.55)" }}>
              <th className="px-3 py-2">Project</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">TPM</th>
              <th className="px-3 py-2 text-right">Approved</th><th className="px-3 py-2 text-right">Consumed</th><th className="px-3 py-2 text-right">Util</th>
              <th className="px-3 py-2 text-right">Delivery</th><th className="px-3 py-2 text-right">FTE</th><th className="px-3 py-2">Health</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => { const u = budgetUtil(p); const h = healthOf(p, nowMs); return (
              <tr key={p.id} className="border-t transition-colors hover:bg-white/[0.03]" style={{ borderColor: "rgba(144,141,206,0.12)" }}>
                <td className="px-3 py-2 font-medium" style={{ color: "#E5E7EB" }}>{p.internalName}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.client ?? "—"}</td>
                <td className="px-3 py-2 capitalize text-muted-foreground">{p.projectType}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.tpmName ?? "—"}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(p.approvedBudget, p.currency)}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(p.consumedBudget, p.currency)}</td>
                <td className="px-3 py-2 text-right font-semibold" style={{ color: u > 100 ? RED : u > 85 ? YELLOW : "#E5E7EB" }}>{u}%</td>
                <td className="px-3 py-2 text-right">{deliveryPct(p)}%</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{p.fteCount ?? 0}/{p.fteDemand ?? 0}</td>
                <td className="px-3 py-2"><span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${h.color}18`, color: h.color }}>{h.label}</span></td>
              </tr>
            ); })}
            {filtered.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-xs text-muted-foreground">No projects match your search.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>Revenue, profit and margin are not tracked in the projects module, so financials here are budget-based.</p>
    </Panel>
  );
}

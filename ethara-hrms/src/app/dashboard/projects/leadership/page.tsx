"use client";

import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Loader2, TrendingDown, Wallet } from "lucide-react";

import { DashboardInsightStrip, type DashboardInsight } from "@/components/dashboard/insight-strip";
import { Progress } from "@/components/ui/progress";
import { projectsApi } from "@/lib/api";
import { BudgetStatusBadge, CHART_TOOLTIP_STYLE, Panel, fmtCompact, fmtMoney } from "../shared";
import { EmptyState } from "@/components/shared/empty-state";

export default function LeadershipViewPage() {
  const { data, isLoading } = useQuery({ queryKey: ["project-leadership"], queryFn: projectsApi.leadership, staleTime: 60_000 });

  if (isLoading || !data) {
    return <div className="flex h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading leadership view…</div>;
  }

  const t = data.totals;
  const utilization = t.totalApprovedBudget > 0 ? Math.round((t.totalConsumedBudget / t.totalApprovedBudget) * 100) : 0;
  const insights: DashboardInsight[] = [
    { label: "Total Approved Budget", value: fmtCompact(t.totalApprovedBudget), detail: `${t.totalProjects} projects`, icon: Wallet, tone: "info" },
    { label: "Total Consumed", value: fmtCompact(t.totalConsumedBudget), detail: `${utilization}% utilization`, icon: TrendingDown, tone: utilization > 85 ? "warning" : "default", progress: utilization },
    { label: "Budget Remaining", value: fmtCompact(t.remainingBudget), detail: "Across portfolio", icon: Wallet, tone: t.remainingBudget < 0 ? "danger" : "success" },
    { label: "Pending Approvals", value: data.approvalQueue.length, detail: "Awaiting decision", icon: TrendingDown, tone: data.approvalQueue.length > 0 ? "warning" : "success" },
  ];

  const topCosting = data.topCosting.map((p) => ({ name: p.internalName, Consumed: p.consumedBudget }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#F8FAFC" }}>Leadership View</h1>
        <p className="text-sm text-muted-foreground">Portfolio budget health, top-cost projects and the approval queue.</p>
      </div>

      <DashboardInsightStrip title="Portfolio Budget Health" insights={insights} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Top Costing Projects" subtitle="By consumed spend">
          {topCosting.length === 0 ? (
            <EmptyState icon={BarChart3} title="No spend data yet" description="Projects appear here once they have consumed budget." className="h-[300px]" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart layout="vertical" data={topCosting} margin={{ top: 5, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#C5CBE8" }} tickFormatter={(v) => fmtCompact(v as number)} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "#C5CBE8" }} width={90} />
                <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => fmtMoney(v as number)} />
                <Bar dataKey="Consumed" fill="#ED00ED" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Project Profitability" subtitle="Budget utilization (consumed ÷ approved)">
          <div className="space-y-3">
            {data.profitability.slice(0, 8).map((p) => (
              <div key={p.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span style={{ color: "#E5E7EB" }}>{p.internalName}</span>
                  <span className="text-muted-foreground">{fmtMoney(p.consumedBudget)} / {fmtMoney(p.approvedBudget)} · {p.utilization}%</span>
                </div>
                <Progress value={Math.min(100, p.utilization)} className={p.utilization > 100 ? "[&>div]:bg-red-500" : ""} />
              </div>
            ))}
            {data.profitability.length === 0 && <p className="text-sm text-muted-foreground">No budget data yet.</p>}
          </div>
        </Panel>
      </div>

      <Panel title="Budget Approval Queue" subtitle="Pending CTO/COO and Leadership decisions">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.55)" }}>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Proposed By</th>
                <th className="px-3 py-2">Approver</th>
                <th className="px-3 py-2">Submitted</th>
              </tr>
            </thead>
            <tbody>
              {data.approvalQueue.map((b) => (
                <tr key={b.id} className="border-t" style={{ borderColor: "rgba(144,141,206,0.12)" }}>
                  <td className="px-3 py-2 font-medium" style={{ color: "#E5E7EB" }}>{fmtMoney(b.amount, b.currency)}</td>
                  <td className="px-3 py-2"><BudgetStatusBadge status={b.status} /></td>
                  <td className="px-3 py-2 text-muted-foreground">{b.proposedBy ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{b.functionalApprover ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{b.submittedAt ? new Date(b.submittedAt).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {data.approvalQueue.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">Nothing pending.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

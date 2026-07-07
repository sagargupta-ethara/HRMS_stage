"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { BarChart3, TrendingUp, Download, Users, Trophy, CheckCircle2, XCircle, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHiringFunnel, usePiSummaryReport, useReportSummary } from "@/lib/queries";
import { reportsApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { formatLabel } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";

type SourceBreakdownRow = {
  sourceType?: string | null;
  _count?: number;
  applied?: number;
  shortlisted?: number;
  joined?: number;
};

type PositionReportRow = {
  department?: string | null;
  candidateCount?: number | null;
};

function sourceLabel(source?: string | null): string {
  if (!source) return "Unspecified";
  return formatLabel(source);
}

function EmptyAnalyticsState({ message }: { message: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-border text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export default function ReportsPage() {
  const { data: funnelData } = useHiringFunnel();
  const { data: summary } = useReportSummary();
  const { data: positionReport = [] } = useQuery({
    queryKey: ["reports", "positions"],
    queryFn: reportsApi.positions,
    staleTime: 300_000,
  });
  const { data: piSummary } = usePiSummaryReport();
  const monthlyHiring = Array.isArray(funnelData) ? funnelData : [];
  const hasMonthlyHiring = monthlyHiring.some((row) => row.applied || row.shortlisted || row.joined);
  const departmentHiring = (positionReport as PositionReportRow[])
    .reduce<Array<{ name: string; value: number; fill: string }>>((rows, position) => {
      const department = position.department || "Unspecified";
      const count = Number(position.candidateCount || 0);
      if (!count) return rows;
      const existing = rows.find((row) => row.name === department);
      if (existing) existing.value += count;
      else rows.push({ name: department, value: count, fill: `var(--color-chart-${(rows.length % 5) + 1})` });
      return rows;
    }, []);
  const sourceConversion = ((summary?.sourceBreakdown ?? summary?.source_breakdown ?? []) as SourceBreakdownRow[])
    .map((row) => ({
      source: sourceLabel(row.sourceType),
      applied: Number(row.applied ?? row._count ?? 0),
      shortlisted: Number(row.shortlisted ?? 0),
      joined: Number(row.joined ?? 0),
    }))
    .filter((row) => row.applied || row.shortlisted || row.joined);

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        title="Reports & Analytics"
        icon={BarChart3}
        description="Comprehensive hiring pipeline analytics"
        actions={
          <>
            <Select defaultValue="2026">
              <SelectTrigger className="w-32 rounded-xl h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2026">2026</SelectItem>
                <SelectItem value="2025">2025</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="rounded-xl text-xs">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Export PDF
            </Button>
          </>
        }
      />

      {/* Monthly Trend */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monthly Hiring Funnel</CardTitle>
          <CardDescription>Applications → Shortlisted → Joined trend over months</CardDescription>
        </CardHeader>
          <CardContent>
          {hasMonthlyHiring ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <LineChart data={monthlyHiring} margin={{ top: 5, right: 20, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="var(--color-muted-foreground)" />
                  <YAxis tick={{ fontSize: 12 }} stroke="var(--color-muted-foreground)" />
                  <Tooltip contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: "0.75rem", fontSize: "0.75rem" }} />
                  <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                  <Line type="monotone" dataKey="applied" stroke="var(--color-chart-1)" strokeWidth={2.5} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="shortlisted" stroke="var(--color-chart-3)" strokeWidth={2.5} dot={{ r: 4 }} />
                  <Line type="monotone" dataKey="joined" stroke="var(--color-chart-2)" strokeWidth={2.5} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyAnalyticsState message="No hiring funnel data available yet." />
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Department Distribution */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Hiring by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {departmentHiring.length > 0 ? (
              <>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <PieChart>
                      <Pie data={departmentHiring} cx="50%" cy="50%" innerRadius={60} outerRadius={90} paddingAngle={3} dataKey="value">
                        {departmentHiring.map((entry, i) => (<Cell key={`cell-${i}`} fill={entry.fill} />))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: "0.75rem", fontSize: "0.75rem" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1.5 mt-2">
                  {departmentHiring.map((d) => (
                    <div key={d.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                        <span className="text-muted-foreground">{d.name}</span>
                      </div>
                      <span className="font-semibold">{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyAnalyticsState message="No department hiring data available yet." />
            )}
          </CardContent>
        </Card>

        {/* Source Conversion */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Source Conversion Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            {sourceConversion.length > 0 ? (
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart data={sourceConversion} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.5} />
                    <XAxis dataKey="source" tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                    <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-foreground)" />
                    <Tooltip contentStyle={{ backgroundColor: "var(--color-card)", border: "1px solid var(--color-border)", borderRadius: "0.75rem", fontSize: "0.75rem" }} />
                    <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                    <Bar dataKey="applied" fill="var(--color-chart-1)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="shortlisted" fill="var(--color-chart-3)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="joined" fill="var(--color-chart-2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyAnalyticsState message="No source conversion data available yet." />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Average Time per Stage (Days)
          </CardTitle>
          <CardDescription>Average days spent at each pipeline stage</CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyAnalyticsState message="No stage timing data available yet." />
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">PI Interview Analytics</CardTitle>
          </div>
          <CardDescription>Personal Interview round outcomes, completion rates, and average scores across all candidates.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {[
              { label: "Total Rounds", value: piSummary?.totalRounds ?? "—", icon: Users, color: "text-primary" },
              { label: "Scheduled", value: piSummary?.scheduled ?? "—", icon: BarChart3, color: "text-info" },
              { label: "Completed", value: piSummary?.completed ?? "—", icon: CheckCircle2, color: "text-success" },
              { label: "Selected", value: piSummary?.selected ?? "—", icon: Trophy, color: "text-success" },
              { label: "Rejected", value: piSummary?.rejected ?? "—", icon: XCircle, color: "text-destructive" },
              { label: "Avg Score", value: piSummary?.avgScore != null ? `${piSummary.avgScore}` : "—", icon: Star, color: "text-warning" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl border border-border p-3 text-center">
                <Icon className={`h-5 w-5 mx-auto mb-1 ${color}`} />
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">{label}</p>
              </div>
            ))}
          </div>

          {piSummary && piSummary.byRound.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Rounds Distribution</p>
              <div className="flex flex-wrap gap-2">
                {piSummary.byRound.map(({ roundNumber, count }) => (
                  <div key={roundNumber} className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2">
                    <Badge variant="outline" className="text-[10px] rounded-full">Round {roundNumber}</Badge>
                    <span className="text-sm font-semibold">{count}</span>
                    <span className="text-[10px] text-muted-foreground">interview{count !== 1 ? "s" : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(!piSummary || piSummary.totalRounds === 0) && (
            <p className="text-sm text-muted-foreground text-center py-6">No PI round data available yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

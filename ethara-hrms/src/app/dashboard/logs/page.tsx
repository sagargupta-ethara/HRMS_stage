"use client";

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Bot,
  CircleCheck,
  CircleX,
  Clock,
  Cpu,
  Database,
  DollarSign,
  FileText,
  Gauge,
  HardDrive,
  KeyRound,
  Loader2,
  Mail,
  MemoryStick,
  RefreshCw,
  Search,
  Server,
  Terminal,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatDateTime, formatLabel, ROLE_LABELS, timeAgo } from "@/lib/utils";
import { logsApi, type LogEntry, type LogInsightCard, type LogStreamInsights, type LogStreamSummary, type SystemStatusResponse } from "@/lib/api";
import type { Role } from "@/types";

const PAGE_SIZE = 30;
const DEFAULT_STREAM = "audit-db";
const EMPTY_STREAMS: LogStreamSummary[] = [];

type StatusHistoryPoint = {
  time: string;
  label: string;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  dbLatency: number | null;
  liveSessions: number;
};

function formatBytes(value?: number | null) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function formatNumber(value?: number | null) {
  return new Intl.NumberFormat("en-IN").format(value ?? 0);
}

function formatCurrency(value?: number | string | null) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "$0.00";
  if (numeric < 0.01) return `$${numeric.toFixed(4)}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(numeric);
}

function formatDuration(value?: number | string | null) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  if (numeric < 1000) return `${Math.round(numeric)} ms`;
  return `${(numeric / 1000).toFixed(1)} s`;
}

function formatInsightValue(card: LogInsightCard) {
  if (card.format === "currency") return formatCurrency(card.value);
  if (card.format === "duration") return formatDuration(card.value);
  if (card.format === "bytes") return formatBytes(typeof card.value === "number" ? card.value : Number(card.value ?? 0));
  if (typeof card.value === "number") return formatNumber(card.value);
  return String(card.value ?? "—");
}

function insightToneClass(tone?: string | null) {
  switch (tone) {
    case "success":
      return "border-emerald-500/20 bg-emerald-500/10 text-emerald-500";
    case "danger":
      return "border-red-500/20 bg-red-500/10 text-red-500";
    case "cost":
      return "border-amber-500/20 bg-amber-500/10 text-amber-500";
    default:
      return "border-cyan-500/20 bg-cyan-500/10 text-cyan-500";
  }
}

function streamAccentIcon(key: string) {
  const className = "size-4 text-primary";
  if (key === "auth") return <KeyRound className={className} />;
  if (key === "email") return <Mail className={className} />;
  if (key === "llm-usage") return <Bot className={className} />;
  if (key === "audit-db") return <Database className={className} />;
  return <Activity className={className} />;
}

function safeDateLabel(value?: string | null) {
  if (!value) return "No activity";
  return formatDateTime(value);
}

function streamIcon(group?: string) {
  switch (group) {
    case "Events":
      return Activity;
    case "Code":
      return FileText;
    case "Cron":
      return Clock;
    case "System":
      return Server;
    case "Agent":
      return Zap;
    default:
      return Terminal;
  }
}

function levelClass(level?: string | null) {
  const value = (level ?? "").toUpperCase();
  if (value.includes("ERROR") || value.includes("CRITICAL") || value.includes("FAILED")) {
    return "border-red-500/25 bg-red-500/10 text-red-500";
  }
  if (value.includes("WARN")) {
    return "border-amber-500/25 bg-amber-500/10 text-amber-500";
  }
  if (value.includes("DEBUG")) {
    return "border-slate-500/25 bg-slate-500/10 text-slate-400";
  }
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-500";
}

function eventLabel(entry: LogEntry) {
  return entry.event || entry.level || "log";
}

function fieldEntries(entry: LogEntry) {
  if (!entry.fields) return [];
  const hidden = new Set(["message", "summary", "timestamp", "time"]);
  const priority = [
    "provider",
    "operation",
    "model",
    "error",
    "httpStatus",
    "errorDetail",
    "email",
    "role",
    "clientIp",
    "userAgent",
    "toEmail",
    "subject",
    "backend",
    "entityType",
    "entityId",
    "performedByName",
  ];
  const entries = Object.entries(entry.fields)
    .filter(([key, value]) => !["message", "summary", "timestamp", "time"].includes(key) && value !== null && value !== undefined && value !== "")
    .sort(([left], [right]) => {
      const leftIndex = priority.indexOf(left);
      const rightIndex = priority.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) return 0;
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
  return entries.filter(([key]) => !hidden.has(key)).slice(0, 8);
}

function compactValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function SummaryCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/80" size="sm">
      <CardContent className="flex min-h-[96px] items-center gap-3">
        <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", tone)}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold leading-tight">{value}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function InsightMetric({ card }: { card: LogInsightCard }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background/55 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium uppercase text-muted-foreground">{card.label}</p>
          <p className="mt-1 truncate text-xl font-semibold leading-tight">{formatInsightValue(card)}</p>
          {card.detail && <p className="mt-1 truncate text-xs text-muted-foreground">{card.detail}</p>}
        </div>
        <span className={cn("mt-0.5 size-2.5 shrink-0 rounded-full border", insightToneClass(card.tone))} />
      </div>
    </div>
  );
}

function StreamInsightsPanel({ streamKey, insights }: { streamKey: string; insights?: LogStreamInsights | null }) {
  if (!insights) return null;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {insights.cards.slice(0, 6).map((card) => (
          <InsightMetric key={`${card.label}-${card.format ?? "plain"}`} card={card} />
        ))}
      </div>
      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
        <div className="rounded-lg border bg-background/45 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {streamAccentIcon(streamKey)}
              <span className="truncate text-sm font-semibold">Activity trend</span>
            </div>
            {insights.cost?.estimatedUsd ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-500">
                <DollarSign className="size-3.5" />
                {formatCurrency(insights.cost.estimatedUsd)}
              </span>
            ) : null}
          </div>
          {insights.timeline.length > 0 ? (
            <ResponsiveContainer width="100%" height={170}>
              <AreaChart data={insights.timeline} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.18} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value, name) => [
                    name === "costUsd" ? formatCurrency(Number(value)) : formatNumber(Number(value)),
                    name === "costUsd" ? "Estimated cost" : formatLabel(String(name)),
                  ]}
                />
                <Area type="monotone" dataKey="events" stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.18} strokeWidth={2} />
                <Line type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={2} dot={false} />
                {insights.cost?.estimatedUsd ? <Line type="monotone" dataKey="costUsd" stroke="#f59e0b" strokeWidth={2} dot={false} /> : null}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-[170px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">No timestamped events</div>
          )}
          {insights.cost?.note && <p className="mt-2 text-xs text-muted-foreground">{insights.cost.note}</p>}
        </div>

        <div className="space-y-3 rounded-lg border bg-background/45 p-3">
          {insights.breakdown.length > 0 ? (
            insights.breakdown.map((section) => (
              <div key={section.label} className="space-y-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">{section.label}</p>
                <div className="space-y-1.5">
                  {section.items.length > 0 ? (
                    section.items.map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-2.5 py-1.5 text-xs">
                        <span className="min-w-0 truncate">{item.label}</span>
                        <span className="font-semibold tabular-nums">{formatNumber(item.value)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground">No breakdown yet</p>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No structured breakdown yet</p>
          )}
        </div>
      </div>
    </div>
  );
}

function formatUptime(seconds?: number | null) {
  if (!seconds || seconds <= 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d ? `${d}d` : "", h ? `${h}h` : "", `${m}m`].filter(Boolean).join(" ");
}

function meterTone(percent?: number | null) {
  if (percent == null) return "bg-slate-500/10 text-slate-400";
  if (percent >= 90) return "bg-red-500/10 text-red-500";
  if (percent >= 75) return "bg-amber-500/10 text-amber-500";
  return "bg-emerald-500/10 text-emerald-500";
}

function MetricCard({
  icon,
  label,
  percent,
  detail,
}: {
  icon: ReactNode;
  label: string;
  percent: number | null | undefined;
  detail: string;
}) {
  return (
    <Card className="rounded-lg border-border/70 bg-card/80" size="sm">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("flex size-8 items-center justify-center rounded-lg", meterTone(percent))}>{icon}</div>
            <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
          </div>
          <span className="text-xl font-semibold tabular-nums">{percent == null ? "—" : `${percent}%`}</span>
        </div>
        <Progress value={percent ?? 0} className="h-2" />
        <p className="truncate text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function ServicePill({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg border bg-background/60 px-3 py-2">
      <div className="flex items-center gap-2">
        {ok ? <CircleCheck className="size-4 text-emerald-500" /> : <CircleX className="size-4 text-red-500" />}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <span className={cn("text-xs font-medium", ok ? "text-emerald-500" : "text-red-500")}>
        {ok ? detail || "Healthy" : "Unavailable"}
      </span>
    </div>
  );
}

/** External-resource pill with a tri-state: ok=true → reachable, ok=false → down,
 *  ok=null → not actively pinged (report configured / not-configured only). */
function IntegrationPill({ label, ok, configured, detail, latencyMs }: {
  label: string; ok: boolean | null; configured: boolean; detail?: string | null; latencyMs?: number | null;
}) {
  const status = ok === true ? "up" : ok === false ? "down" : configured ? "configured" : "off";
  const dot = { up: "bg-emerald-500", down: "bg-red-500", configured: "bg-blue-500", off: "bg-muted-foreground/40" }[status];
  const text = { up: "text-emerald-500", down: "text-red-500", configured: "text-blue-500", off: "text-muted-foreground" }[status];
  const statusText =
    status === "up" ? (latencyMs != null ? `${latencyMs} ms` : "Reachable")
    : status === "down" ? "Down"
    : status === "configured" ? "Configured"
    : "Not configured";
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border bg-background/60 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", dot)} />
        <span className="truncate text-sm font-medium">{label}</span>
        {detail ? <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">· {detail}</span> : null}
      </div>
      <span className={cn("shrink-0 text-xs font-medium", text)}>{statusText}</span>
    </div>
  );
}

function SystemTrendChart({ history }: { history: StatusHistoryPoint[] }) {
  const rows = history.length > 0 ? history : [];
  return (
    <div className="rounded-lg border bg-background/45 p-3">
      <div className="mb-2 flex items-center gap-2">
        <TrendingUp className="size-4 text-primary" />
        <span className="text-sm font-semibold">Live health trend</span>
      </div>
      {rows.length > 1 ? (
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.18} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={18} />
            <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
            <Tooltip
              formatter={(value, name) => [
                name === "dbLatency" ? `${Number(value).toFixed(1)} ms` : name === "liveSessions" ? formatNumber(Number(value)) : `${Number(value).toFixed(1)}%`,
                name === "dbLatency" ? "DB latency" : name === "liveSessions" ? "Live sessions" : formatLabel(String(name)),
              ]}
            />
            <Line type="monotone" dataKey="cpu" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="memory" stroke="var(--color-chart-5)" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="disk" stroke="#f59e0b" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-[210px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">Collecting live samples</div>
      )}
    </div>
  );
}

function TopProcessPanel({ processes }: { processes: NonNullable<SystemStatusResponse["processes"]>["topCpu"] }) {
  if (!processes.length) return null;
  return (
    <div className="overflow-hidden rounded-lg border bg-background/45">
      <div className="flex items-center gap-2 border-b px-3 py-2.5">
        <Cpu className="size-4 text-primary" />
        <span className="text-sm font-semibold">Top CPU right now</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="px-3">Process</TableHead>
            <TableHead className="w-[100px] px-3">CPU</TableHead>
            <TableHead className="w-[110px] px-3">Memory</TableHead>
            <TableHead className="w-[110px] px-3">RSS</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {processes.slice(0, 6).map((process) => (
            <TableRow key={`${process.pid}-${process.command}`}>
              <TableCell className="max-w-0 px-3 py-2.5">
                <div className="truncate text-sm font-medium">{process.command}</div>
                <div className="truncate text-xs text-muted-foreground">PID {process.pid} · {process.args}</div>
              </TableCell>
              <TableCell className="px-3 py-2.5 text-sm font-semibold tabular-nums">{process.cpuPercent}%</TableCell>
              <TableCell className="px-3 py-2.5 text-sm tabular-nums">{process.memoryPercent}%</TableCell>
              <TableCell className="px-3 py-2.5 text-sm tabular-nums">{formatBytes(process.rssBytes)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background/60 px-3 py-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function SystemStatusPanel({
  data,
  history,
  search,
  isLoading,
  isError,
  onRetry,
}: {
  data?: SystemStatusResponse;
  history: StatusHistoryPoint[];
  search: string;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
        <AlertTriangle className="size-8 text-red-500" />
        <p className="font-medium text-red-500">Could not load system status.</p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw />
          Retry
        </Button>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { performance: perf, services, activeUsers, stats } = data;
  const query = search.trim().toLowerCase();
  const visibleRecentUsers = query
    ? activeUsers.recent.filter((user) =>
        [user.name, user.email, user.role, user.hasSession ? "active" : "signed out"].some((value) =>
          String(value ?? "").toLowerCase().includes(query),
        ),
      )
    : activeUsers.recent;
  const visibleRoles = query
    ? stats.byRole.filter((entry) =>
        [entry.role, ROLE_LABELS[entry.role as Role] ?? formatLabel(entry.role)].some((value) =>
          String(value ?? "").toLowerCase().includes(query),
        ),
      )
    : stats.byRole;
  const visibleProcesses = query
    ? (data.processes?.topCpu ?? []).filter((process) =>
        [process.command, process.args, process.pid].some((value) =>
          String(value ?? "").toLowerCase().includes(query),
        ),
      )
    : data.processes?.topCpu ?? [];
  const cpu = perf.cpu;
  const mem = perf.memory;
  const disk = perf.disk;
  const cpuSource =
    cpu.source === "load"
      ? "load estimate"
      : cpu.source === "sample"
        ? "live sample"
        : "live";

  return (
    <div className="space-y-5">
      {/* Performance */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Gauge className="size-4" /> Performance
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<Cpu className="size-4" />}
            label="CPU"
            percent={cpu.percent}
            detail={`${cpuSource} · ${cpu.cores ?? "?"} cores · load ${cpu.load1 ?? "—"} / ${cpu.load5 ?? "—"} / ${cpu.load15 ?? "—"}`}
          />
          <MetricCard
            icon={<MemoryStick className="size-4" />}
            label="Memory"
            percent={mem?.percent}
            detail={mem ? `${formatBytes(mem.usedBytes)} of ${formatBytes(mem.totalBytes)} used` : "Unavailable"}
          />
          <MetricCard
            icon={<HardDrive className="size-4" />}
            label="Disk (/)"
            percent={disk?.percent}
            detail={disk ? `${formatBytes(disk.usedBytes)} of ${formatBytes(disk.totalBytes)} used` : "Unavailable"}
          />
          <Card className="rounded-lg border-border/70 bg-card/80" size="sm">
            <CardContent className="space-y-3 py-4">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                  <Clock className="size-4" />
                </div>
                <span className="text-xs font-medium uppercase text-muted-foreground">Uptime</span>
              </div>
              <p className="text-xl font-semibold">{formatUptime(perf.uptimeSeconds)}</p>
              <p className="truncate text-xs text-muted-foreground">
                API process: {perf.processRssBytes ? formatBytes(perf.processRssBytes) : "—"} RSS
              </p>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <ServicePill label="Database" ok={services.database.ok} detail={services.database.latencyMs != null ? `${services.database.latencyMs} ms` : undefined} />
          <ServicePill label="Redis" ok={services.redis.ok} />
        </div>
        {(data.integrations?.length ?? 0) > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase text-muted-foreground">External resources</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {data.integrations!.map((i) => (
                <IntegrationPill key={i.key} label={i.label} ok={i.ok} configured={i.configured} detail={i.detail} latencyMs={i.latencyMs} />
              ))}
            </div>
          </div>
        )}
        <SystemTrendChart history={history} />
        <TopProcessPanel processes={visibleProcesses} />
      </section>

      {/* Active users */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Users className="size-4" /> Active users
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryCard icon={<Activity className="size-4" />} label="Live sessions" value={formatNumber(activeUsers.liveSessions)} detail="Users with an active session" tone="bg-emerald-500/10 text-emerald-500" />
          <SummaryCard icon={<Users className="size-4" />} label="Active · 15 min" value={formatNumber(activeUsers.activeLast15m)} detail="Logged in within 15 minutes" tone="bg-cyan-500/10 text-cyan-500" />
          <SummaryCard icon={<Clock className="size-4" />} label="Active · 24 h" value={formatNumber(activeUsers.activeLast24h)} detail="Logged in within 24 hours" tone="bg-blue-500/10 text-blue-500" />
        </div>
        {visibleRecentUsers.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="px-3">User</TableHead>
                  <TableHead className="px-3">Role</TableHead>
                  <TableHead className="px-3">Last login</TableHead>
                  <TableHead className="px-3">Session</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleRecentUsers.map((user) => (
                  <TableRow key={user.email}>
                    <TableCell className="px-3 py-2.5">
                      <div className="text-sm font-medium">{user.name}</div>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      <Badge variant="outline" className="rounded-md">{ROLE_LABELS[user.role as Role] ?? formatLabel(user.role)}</Badge>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">
                      {user.lastLoginAt ? timeAgo(user.lastLoginAt) : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2.5">
                      {user.hasSession ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500"><CircleCheck className="size-3.5" /> Active</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Signed out</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Platform stats */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
          <Database className="size-4" /> Platform stats
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          <StatTile label="Users (active)" value={`${formatNumber(stats.usersActive)} / ${formatNumber(stats.usersTotal)}`} />
          <StatTile label="Candidates" value={formatNumber(stats.candidatesTotal)} />
          <StatTile label="New this month" value={formatNumber(stats.candidatesThisMonth)} />
          <StatTile label="Employees" value={formatNumber(stats.employeesTotal)} />
          <StatTile label="Open IT requests" value={formatNumber(stats.itRequestsOpen)} />
          <StatTile label="Pending evaluations" value={formatNumber(stats.evaluationsPending)} />
          <StatTile label="Signed contracts" value={formatNumber(stats.contractsSigned)} />
          <StatTile label="Audit events" value={formatNumber(stats.auditEvents)} />
        </div>
        {visibleRoles.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {visibleRoles.map((entry) => (
              <span key={entry.role} className="inline-flex items-center gap-1.5 rounded-md border bg-background/60 px-2.5 py-1 text-xs">
                <span className="text-muted-foreground">{ROLE_LABELS[entry.role as Role] ?? formatLabel(entry.role)}</span>
                <span className="font-semibold tabular-nums">{formatNumber(entry.count)}</span>
              </span>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground">Updated {timeAgo(data.generatedAt)}</p>
      </section>
    </div>
  );
}

export default function SystemLogsPage() {
  const [view, setView] = useState<"streams" | "status">("streams");
  const [activeStream, setActiveStream] = useState(DEFAULT_STREAM);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const activeSearch = view === "streams" ? deferredSearch : "";
  const statusSearch = view === "status" ? deferredSearch : "";
  const [page, setPage] = useState(1);
  const [statusHistory, setStatusHistory] = useState<StatusHistoryPoint[]>([]);

  const summaryQuery = useQuery({
    queryKey: ["logs-summary"],
    queryFn: logsApi.summary,
    refetchInterval: 60_000,
  });

  const statusQuery = useQuery({
    queryKey: ["logs-system-status"],
    queryFn: logsApi.systemStatus,
    refetchInterval: 15_000,
    enabled: view === "status",
  });

  const streams = summaryQuery.data?.streams ?? EMPTY_STREAMS;
  const activeKey = streams.some((stream) => stream.key === activeStream) ? activeStream : streams[0]?.key ?? DEFAULT_STREAM;
  const selectedSummary = streams.find((stream) => stream.key === activeKey);

  const streamQuery = useQuery({
    queryKey: ["logs-stream", activeKey, activeSearch, page],
    queryFn: () => logsApi.stream(activeKey, { search: activeSearch || undefined, page, limit: PAGE_SIZE }),
    enabled: view === "streams" && Boolean(activeKey),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const status = statusQuery.data;
    if (!status) return;
    const generatedAt = new Date(status.generatedAt);
    const label = Number.isNaN(generatedAt.getTime())
      ? timeAgo(status.generatedAt)
      : generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const point: StatusHistoryPoint = {
      time: status.generatedAt,
      label,
      cpu: status.performance.cpu.percent,
      memory: status.performance.memory?.percent ?? null,
      disk: status.performance.disk?.percent ?? null,
      dbLatency: status.services.database.latencyMs,
      liveSessions: status.activeUsers.liveSessions,
    };
    const handle = window.setTimeout(() => {
      setStatusHistory((current) => {
        if (current.some((item) => item.time === point.time)) return current;
        return [...current, point].slice(-24);
      });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [statusQuery.data]);

  const latestStream = useMemo(() => {
    return streams.reduce<LogStreamSummary | null>((latest, stream) => {
      if (!stream.lastModified) return latest;
      if (!latest?.lastModified) return stream;
      return new Date(stream.lastModified).getTime() > new Date(latest.lastModified).getTime() ? stream : latest;
    }, null);
  }, [streams]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    return streams
      .map((stream) => stream.group)
      .filter((group) => {
        if (seen.has(group)) return false;
        seen.add(group);
        return true;
      });
  }, [streams]);

  const streamData = streamQuery.data;
  const rows = streamData?.data ?? [];
  const totalPages = Math.max(streamData?.totalPages ?? 1, 1);
  const isRefreshing = summaryQuery.isFetching || streamQuery.isFetching || statusQuery.isFetching;

  const refresh = () => {
    if (view === "status") {
      void statusQuery.refetch();
      return;
    }
    void summaryQuery.refetch();
    void streamQuery.refetch();
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Terminal className="size-6 text-primary" />
            System Logs
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            App, login, SES, Gemini, cron, code change, EC2, and CloudWatch agent activity in one admin view.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={isRefreshing} className="w-fit">
          {isRefreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Refresh
        </Button>
      </div>

      <Tabs value={view} onValueChange={(value) => setView(value as "streams" | "status")}>
        <TabsList className="bg-muted/60 p-1">
          <TabsTrigger value="streams" className="gap-1.5 px-3 text-sm">
            <Terminal className="size-4" /> Log Streams
          </TabsTrigger>
          <TabsTrigger value="status" className="gap-1.5 px-3 text-sm">
            <Gauge className="size-4" /> System Status
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {view === "status" ? (
        <>
          <div className="relative w-full max-w-xl">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search users, roles, services"
              className="pl-8"
            />
          </div>
          <SystemStatusPanel
            data={statusQuery.data}
            history={statusHistory}
            search={statusSearch}
            isLoading={statusQuery.isLoading}
            isError={statusQuery.isError}
            onRetry={() => void statusQuery.refetch()}
          />
        </>
      ) : (
      <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard
          icon={<Activity className="size-4" />}
          label="Log Events"
          value={formatNumber(summaryQuery.data?.totals.events)}
          detail={`${formatNumber(streamData?.total)} in selected stream`}
          tone="bg-emerald-500/10 text-emerald-500"
        />
        <SummaryCard
          icon={<Database className="size-4" />}
          label="Streams"
          value={formatNumber(summaryQuery.data?.totals.streams)}
          detail={groups.length ? groups.join(", ") : "Waiting for summary"}
          tone="bg-cyan-500/10 text-cyan-500"
        />
        <SummaryCard
          icon={<HardDrive className="size-4" />}
          label="Storage"
          value={formatBytes(summaryQuery.data?.totals.bytes)}
          detail={`${formatNumber(summaryQuery.data?.totals.files)} source files`}
          tone="bg-amber-500/10 text-amber-500"
        />
        <SummaryCard
          icon={<Clock className="size-4" />}
          label="Latest"
          value={latestStream?.lastModified ? timeAgo(latestStream.lastModified) : "No activity"}
          detail={latestStream?.label ?? "No stream activity"}
          tone="bg-blue-500/10 text-blue-500"
        />
        <SummaryCard
          icon={<Terminal className="size-4" />}
          label="Selected"
          value={selectedSummary?.label ?? streamData?.label ?? activeKey}
          detail={safeDateLabel(selectedSummary?.lastModified ?? streamData?.lastModified)}
          tone="bg-fuchsia-500/10 text-fuchsia-500"
        />
      </div>

      <div className="space-y-4 rounded-lg border bg-card/70 p-3 sm:p-4">
        <div className="min-w-0 overflow-x-auto pb-1">
          <Tabs
            value={activeKey}
            onValueChange={(value) => {
              setActiveStream(value);
              setPage(1);
            }}
          >
            <TabsList className="h-auto max-w-full justify-start gap-1 overflow-x-auto bg-muted/60 p-1">
              {streams.length === 0 && (
                <TabsTrigger value={DEFAULT_STREAM} className="h-8 px-3 text-xs">
                  Loading
                </TabsTrigger>
              )}
              {streams.map((stream) => {
                const Icon = streamIcon(stream.group);
                return (
                  <TabsTrigger key={stream.key} value={stream.key} className="h-8 flex-none gap-1.5 px-3 text-xs">
                    <Icon className="size-3.5" />
                    <span>{stream.label}</span>
                    <span className="text-muted-foreground">({formatNumber(stream.lines)})</span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        <div className="relative w-full">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search logs by event, message, email, source, or raw detail"
            className="pl-8"
          />
        </div>

        <div className="flex flex-col gap-2 border-y py-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 truncate">
            <span className="font-medium text-foreground">{streamData?.label ?? selectedSummary?.label ?? activeKey}</span>
            <span> · {formatNumber(streamData?.total)} events · {formatBytes(streamData?.bytes)}</span>
          </div>
          <div className="min-w-0 truncate">
            {(streamData?.files ?? []).length > 0 ? streamData?.files.join(" · ") : "database:audit_logs"}
          </div>
        </div>

        <StreamInsightsPanel streamKey={activeKey} insights={streamData?.insights} />

        {summaryQuery.isError || streamQuery.isError ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-6 text-center">
            <AlertTriangle className="size-8 text-red-500" />
            <p className="font-medium text-red-500">Could not load logs.</p>
            <Button variant="outline" size="sm" onClick={refresh}>
              <RefreshCw />
              Retry
            </Button>
          </div>
        ) : streamQuery.isLoading ? (
          <div className="flex min-h-[260px] items-center justify-center rounded-lg border border-dashed">
            <Loader2 className="size-8 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center">
            <Terminal className="size-8 text-muted-foreground" />
            <p className="font-medium">No log entries found</p>
            <p className="max-w-md text-sm text-muted-foreground">Try another stream or search value.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="w-[180px] px-3">Time</TableHead>
                  <TableHead className="w-[170px] px-3">Event</TableHead>
                  <TableHead className="min-w-[360px] px-3">Message</TableHead>
                  <TableHead className="w-[260px] px-3">Context</TableHead>
                  <TableHead className="w-[220px] px-3">Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((entry) => {
                  const details = fieldEntries(entry);
                  const structured = entry.structured;
                  return (
                    <TableRow key={entry.id} className="align-top">
                      <TableCell className="px-3 py-3 align-top whitespace-normal">
                        <div className="min-w-[150px] text-sm">{entry.timestamp ? formatDateTime(entry.timestamp) : "No timestamp"}</div>
                        {entry.timestamp && <div className="mt-1 text-xs text-muted-foreground">{timeAgo(entry.timestamp)}</div>}
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top whitespace-normal">
                        <Badge variant="outline" className={cn("max-w-[150px] rounded-md", levelClass(entry.level ?? entry.event))}>
                          <span className="truncate">{structured?.title || eventLabel(entry)}</span>
                        </Badge>
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top whitespace-normal">
                        <p className="max-w-[760px] break-words text-sm font-medium leading-relaxed">
                          {structured?.description || entry.message || entry.raw}
                        </p>
                        {entry.message && structured?.description && entry.message !== structured.description && (
                          <p className="mt-1 max-w-[760px] break-words text-xs text-muted-foreground">{entry.message}</p>
                        )}
                        {structured?.costUsd ? (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-500">
                            <DollarSign className="size-3.5" />
                            {formatCurrency(structured.costUsd)}
                          </span>
                        ) : null}
                        {entry.raw && (
                          <details className="mt-2 max-w-[760px] rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                            <summary className="cursor-pointer select-none font-medium text-foreground">Raw details</summary>
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words leading-relaxed">{entry.raw}</pre>
                          </details>
                        )}
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top whitespace-normal">
                        <div className="flex max-w-[260px] flex-wrap gap-1.5">
                          {details.length ? (
                            details.map(([key, value]) => (
                              <span key={key} className="max-w-full truncate rounded-md border bg-background/70 px-2 py-1 text-xs text-muted-foreground">
                                <span className="text-foreground">{key}</span>: {compactValue(value)}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">No fields</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-3 py-3 align-top whitespace-normal">
                        <code className="block max-w-[220px] truncate rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                          {entry.source}
                        </code>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Page {formatNumber(page)} of {formatNumber(totalPages)}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

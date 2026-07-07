"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowRight, Briefcase, CheckCircle2, Download,
  Eye, Loader2, Plus, RefreshCw, ShieldX, TrendingUp,
  Upload, UserCheck, UserX, Users,
} from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import { candidatesApi, positionsApi, vendorsApi } from "@/lib/api";
import { exportToCsv } from "@/lib/export";
import {
  DashboardDateRangeFilter,
  dashboardDateRangeParams,
  type DashboardDateRange,
} from "@/components/dashboard/date-range-filter";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardInsightStrip } from "@/components/dashboard/insight-strip";
import { EmptyState } from "@/components/shared/empty-state";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/lib/auth-context";
import { cn, formatLabel, getInitials, STAGE_LABELS } from "@/lib/utils";

type Candidate = {
  id: string;
  fullName: string;
  candidateCode: string;
  currentStage: string;
  currentStatus: string;
  isBlacklisted?: boolean;
  vendorId?: string | null;
  position?: { title: string } | null;
  createdAt?: string;
};

type Position = { id: string; title: string };
type BulkSummary = { total: number; saved: number; failed: number; errors: string[] };

const CHART_COLORS = ["#ED00ED", "#908DCE", "#38BDF8", "#22c55e", "#f59e0b", "#ef4444"];
const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: "rgba(8,8,16,0.96)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 10, fontSize: 12, color: "#C5CBE8" },
  labelStyle: { color: "rgba(197,203,232,0.70)" },
};

function stageLabel(stage: string) {
  return STAGE_LABELS[stage as keyof typeof STAGE_LABELS] ?? formatLabel(stage);
}

function KpiCard({ title, value, icon: Icon, tone = "default", loading }: {
  title: string; value: number; icon: React.ElementType; tone?: "default" | "danger" | "success" | "warning"; loading?: boolean;
}) {
  const iconBg = { default: "bg-primary/15 text-primary", danger: "bg-destructive/15 text-destructive", success: "bg-success/15 text-success", warning: "bg-warning/15 text-warning" }[tone];
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 sm:p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
      <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(ellipse at top right, rgba(237,0,237,0.08) 0%, transparent 60%)" }} />
      <div className="relative flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.50)" }}>{title}</p>
          <p className="mt-2 break-words text-2xl font-bold sm:text-3xl" style={{ color: "#C5CBE8" }}>{loading ? "—" : value}</p>
        </div>
        <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11", iconBg)}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
      </div>
    </div>
  );
}

export default function VendorDashboard() {
  const router = useRouter();
  const { user } = useAuth();

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "blacklisted">("all");

  const [bulkOpen, setBulkOpen] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<BulkSummary | null>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const [dateRange, setDateRange] = useState<DashboardDateRange>({ from: "", to: "" });
  const dateParams = useMemo(() => dashboardDateRangeParams(dateRange), [dateRange]);

  const loadCandidates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await candidatesApi.list({ ...dateParams, sourceType: "vendor", limit: 200 });
      setCandidates(result.data ?? []);
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [dateParams]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCandidates();
  }, [loadCandidates]);

  const submitted = candidates.length;
  const shortlisted = candidates.filter((c) => ["resume_shortlisted", "evaluation_assigned", "evaluation_in_progress", "evaluation_passed", "selection_form_sent", "selection_form_submitted", "selection_form_validated", "contract_sent", "contract_signed", "onboarding_completed"].includes(c.currentStage)).length;
  const rejected = candidates.filter((c) => ["resume_rejected", "evaluation_failed"].includes(c.currentStage)).length;
  const evalPending = candidates.filter((c) => ["evaluation_assigned", "evaluation_in_progress"].includes(c.currentStage)).length;
  const selected = candidates.filter((c) => ["contract_sent", "contract_signed", "onboarding_completed"].includes(c.currentStage)).length;
  const joined = candidates.filter((c) => c.currentStage === "onboarding_completed").length;

  const visibleCandidates = activeTab === "blacklisted"
    ? candidates.filter((c) => c.isBlacklisted)
    : candidates.filter((c) => !c.isBlacklisted);

  const stageDistData = useMemo(() => {
    const stageCounts: Record<string, number> = {};
    candidates.forEach((c) => {
      const label = stageLabel(c.currentStage);
      stageCounts[label] = (stageCounts[label] ?? 0) + 1;
    });
    return Object.entries(stageCounts).slice(0, 6).map(([name, value], i) => ({ name, value, fill: CHART_COLORS[i % CHART_COLORS.length] }));
  }, [candidates]);

  const roleDistData = useMemo(() => {
    const counts: Record<string, number> = {};
    candidates.forEach((c) => { const r = c.position?.title ?? "Unassigned"; counts[r] = (counts[r] ?? 0) + 1; });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, value], i) => ({ name, value, fill: CHART_COLORS[i % CHART_COLORS.length] }));
  }, [candidates]);

  const openBulkUpload = async () => {
    try {
      const data = await positionsApi.list();
      setPositions(Array.isArray(data) ? data : []);
    } catch { setPositions([]); }
    setBulkSummary(null); setCsvFile(null); setSelectedPositionId(""); setBulkOpen(true);
  };

  const handleBulkUpload = async () => {
    if (!csvFile) { toast.error("Please select a CSV file."); return; }
    if (!selectedPositionId) { toast.error("Please select a job role."); return; }
    setUploading(true); setBulkSummary(null);
    try {
      const result = await vendorsApi.bulkUpload(csvFile, selectedPositionId) as BulkSummary;
      setBulkSummary(result);
      toast.success(`Uploaded ${result.saved} of ${result.total} candidates.`);
      void loadCandidates();
    } catch (err) {
      const apiErr = err as { response?: { data?: { detail?: string } }; message?: string };
      toast.error(apiErr.response?.data?.detail || apiErr.message || "Bulk upload failed.");
    } finally { setUploading(false); }
  };

  const handleExport = () => {
    exportToCsv(
      visibleCandidates.map((c) => ({ name: c.fullName, code: c.candidateCode, role: c.position?.title ?? "", stage: stageLabel(c.currentStage), status: c.currentStatus })),
      [{ key: "name", header: "Name" }, { key: "code", header: "Code" }, { key: "role", header: "Role" }, { key: "stage", header: "Stage" }, { key: "status", header: "Status" }],
      `vendor_candidates_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };
  const vendorInsights = [
    {
      label: "Shortlist Quality",
      value: submitted ? `${Math.round((shortlisted / submitted) * 100)}%` : "—",
      detail: `${shortlisted} of ${submitted} submitted profiles crossed screening.`,
      icon: UserCheck,
      tone: shortlisted ? "success" as const : "default" as const,
      progress: submitted ? Math.round((shortlisted / submitted) * 100) : 0,
      href: "/dashboard/candidates",
    },
    {
      label: "Evaluation Backlog",
      value: evalPending,
      detail: "Candidates currently in assigned or in-progress evaluation.",
      icon: CheckCircle2,
      tone: evalPending ? "warning" as const : "success" as const,
      href: "/dashboard/evaluations",
    },
    {
      label: "Selection Outcome",
      value: selected,
      detail: `${joined} joined from vendor-submitted candidates.`,
      icon: TrendingUp,
      tone: selected ? "success" as const : "default" as const,
      progress: submitted ? Math.round((selected / submitted) * 100) : 0,
      href: "/dashboard/candidates",
    },
    {
      label: "Profile Risk",
      value: candidates.filter((c) => c.isBlacklisted).length,
      detail: "Blacklisted candidate records in this vendor view.",
      icon: ShieldX,
      tone: candidates.some((c) => c.isBlacklisted) ? "danger" as const : "success" as const,
      href: "/dashboard/vendor",
    },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="relative overflow-hidden rounded-2xl px-6 py-5" style={{ background: "linear-gradient(135deg, rgba(56,189,248,0.10) 0%, rgba(19,18,44,0.95) 50%, rgba(8,8,16,0.98) 100%)", border: "1px solid rgba(144,141,206,0.18)" }}>
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(ellipse at 80% 20%, rgba(56,189,248,0.3) 0%, transparent 60%)" }} />
        <div className="relative flex items-center justify-between flex-wrap gap-4">
          <div>
            <p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>Welcome back</p>
            <h1 className="text-2xl font-bold mt-0.5" style={{ color: "#C5CBE8" }}>{user?.name ?? "Vendor"}</h1>
            <p className="text-sm mt-1" style={{ color: "rgba(197,203,232,0.50)" }}>Track your submitted candidates and hiring performance.</p>
          </div>
          <div className="flex items-center gap-2">
            <DashboardDateRangeFilter value={dateRange} onChange={setDateRange} />
            <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={handleExport}><Download className="h-3.5 w-3.5" /> Export</Button>
            <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={openBulkUpload}><Upload className="h-3.5 w-3.5" /> Bulk Upload</Button>
            <Button size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => router.push("/dashboard/candidates/new")}><Plus className="h-3.5 w-3.5" /> Submit Candidate</Button>
            <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9" onClick={() => void loadCandidates()}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /></Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Total Submitted" value={submitted} icon={Users} loading={loading} />
        <KpiCard title="Screening Passed" value={shortlisted} icon={UserCheck} tone="success" loading={loading} />
        <KpiCard title="Eval Pending" value={evalPending} icon={CheckCircle2} tone="warning" loading={loading} />
        <KpiCard title="Selected" value={selected} icon={TrendingUp} tone="success" loading={loading} />
        <KpiCard title="Rejected" value={rejected} icon={UserX} tone="danger" loading={loading} />
        <KpiCard title="Joined" value={joined} icon={Briefcase} tone="success" loading={loading} />
        <KpiCard title="Blacklisted" value={candidates.filter((c) => c.isBlacklisted).length} icon={ShieldX} tone="danger" loading={loading} />
        <KpiCard title="Active Openings" value={positions.length} icon={Briefcase} loading={loading} />
      </div>

      <DashboardInsightStrip
        title="Vendor Performance Summary"
        subtitle="Submitted quality, evaluation flow, selection outcome, and profile risk."
        insights={vendorInsights}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: "#C5CBE8" }}>Candidate Stage Distribution</h2>
          {stageDistData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stageDistData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "rgba(197,203,232,0.45)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "rgba(197,203,232,0.45)" }} axisLine={false} tickLine={false} />
                <Tooltip {...CHART_TOOLTIP_STYLE} />
                <Bar dataKey="value" name="Candidates" radius={[4, 4, 0, 0]}>
                  {stageDistData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState
              icon={Users}
              title="No candidate data yet"
              description="Stage breakdown appears once you submit candidates."
            />
          )}
        </div>

        <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: "#C5CBE8" }}>Job Role Distribution</h2>
          {roleDistData.length > 0 ? (
            <div className="flex items-center gap-4">
              <PieChart width={110} height={110}>
                <Pie data={roleDistData} cx={52} cy={52} innerRadius={30} outerRadius={52} dataKey="value" strokeWidth={0}>
                  {roleDistData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
              </PieChart>
              <div className="flex-1 space-y-2">
                {roleDistData.map((e) => (
                  <div key={e.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="h-2 w-2 rounded-full shrink-0" style={{ background: e.fill }} />
                      <span className="truncate max-w-[120px]" style={{ color: "rgba(197,203,232,0.65)" }}>{e.name}</span>
                    </div>
                    <span className="font-semibold ml-2" style={{ color: "#C5CBE8" }}>{e.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={Briefcase}
              title="No role data yet"
              description="Role split appears once candidates are linked to job openings."
            />
          )}
        </div>
      </div>

      <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {(["all", "blacklisted"] as const).map((tab) => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={cn("px-3 py-1.5 text-xs font-medium rounded-full border transition-colors", activeTab === tab ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/30")}>
                {tab === "all" ? "My Candidates" : <span className="flex items-center gap-1"><ShieldX className="h-3 w-3" />Blacklisted</span>}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={handleExport}><Download className="h-3.5 w-3.5" /> Export</Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : visibleCandidates.length === 0 ? (
          activeTab === "blacklisted" ? (
            <EmptyState
              icon={ShieldX}
              title="No blacklisted candidates"
              description="Candidates that fail screening checks or are flagged will be listed here."
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No candidates submitted yet"
              description="Submit your first candidate or bulk-upload a CSV to start tracking their progress through the hiring pipeline."
              action={
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => router.push("/dashboard/candidates/new")}>
                    <Plus className="h-3.5 w-3.5" /> Submit Candidate
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={openBulkUpload}>
                    <Upload className="h-3.5 w-3.5" /> Bulk Upload
                  </Button>
                </div>
              }
            />
          )
        ) : (
          <div className="space-y-2">
            {visibleCandidates.slice(0, 10).map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors" style={{ background: "rgba(144,141,206,0.05)", border: "1px solid rgba(144,141,206,0.10)" }}>
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-xs" style={{ background: "rgba(56,189,248,0.15)", color: "#38BDF8" }}>{getInitials(c.fullName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: "#C5CBE8" }}>{c.fullName}</p>
                    <p className="text-xs truncate" style={{ color: "rgba(197,203,232,0.45)" }}>{c.position?.title ?? "No role"} · {c.candidateCode}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {c.isBlacklisted && <Badge variant="destructive" className="text-[10px]">Blacklisted</Badge>}
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(144,141,206,0.12)", color: "rgba(197,203,232,0.70)" }}>
                    {stageLabel(c.currentStage)}
                  </span>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => router.push(`/dashboard/candidates/${c.id}`)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Submit Candidate", icon: Plus, href: "/dashboard/candidates/new", desc: "Add new candidate to pipeline" },
          { label: "Bulk Upload", icon: Upload, action: openBulkUpload, desc: "Upload CSV of candidates" },
          { label: "View Analytics", icon: ArrowRight, href: "/dashboard/config/vendors", desc: "Detailed vendor analytics" },
        ].map((a) => (
          a.href ? (
            <a key={a.label} href={a.href}>
              <div className="flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 cursor-pointer" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)" }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0" style={{ background: "rgba(56,189,248,0.12)" }}>
                  <a.icon className="h-4 w-4" style={{ color: "#38BDF8" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>{a.label}</p>
                  <p className="text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>{a.desc}</p>
                </div>
              </div>
            </a>
          ) : (
            <button key={a.label} onClick={a.action} className="text-left w-full">
              <div className="flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 cursor-pointer" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)" }}>
                <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0" style={{ background: "rgba(56,189,248,0.12)" }}>
                  <a.icon className="h-4 w-4" style={{ color: "#38BDF8" }} />
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>{a.label}</p>
                  <p className="text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>{a.desc}</p>
                </div>
              </div>
            </button>
          )
        ))}
      </div>

      <Dialog open={bulkOpen} onOpenChange={(open) => { if (!open) { setBulkSummary(null); setCsvFile(null); } setBulkOpen(open); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-primary" /> Bulk Upload Candidates</DialogTitle>
          </DialogHeader>
          {bulkSummary ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4 text-success" /><span>{bulkSummary.saved} candidates saved</span></div>
                {bulkSummary.failed > 0 && <div className="flex items-center gap-2 text-sm text-destructive"><AlertCircle className="h-4 w-4" /><span>{bulkSummary.failed} failed</span></div>}
              </div>
              <DialogFooter><Button onClick={() => { setBulkSummary(null); setBulkOpen(false); }} className="rounded-xl text-xs">Done</Button></DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              <div className="space-y-1.5">
                <Label>Job Role *</Label>
                <Select value={selectedPositionId} onValueChange={(v) => setSelectedPositionId(v ?? "")}>
                  <SelectTrigger className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm">
                    <SelectValue placeholder="Select a position…" />
                  </SelectTrigger>
                  <SelectContent>
                    {positions.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>CSV File *</Label>
                <label className={cn("flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm", csvFile ? "border-success/40 bg-success/5 text-success" : "border-border bg-muted/10 text-muted-foreground")}>
                  {csvFile ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Upload className="h-4 w-4 shrink-0" />}
                  <span className="truncate">{csvFile ? csvFile.name : "Upload CSV"}</span>
                  <input ref={csvRef} type="file" className="hidden" accept=".csv" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" size="sm" className="rounded-xl text-xs" />}>Cancel</DialogClose>
                <Button size="sm" className="rounded-xl text-xs" disabled={uploading || !csvFile || !selectedPositionId} onClick={handleBulkUpload}>
                  {uploading ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />Uploading…</> : "Upload"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

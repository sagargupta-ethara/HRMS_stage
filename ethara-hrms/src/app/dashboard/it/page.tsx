"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, ArrowRightLeft, CheckCircle2,
  CreditCard, Download, FileSpreadsheet, Laptop, Loader2, Mail,
  Package, RefreshCw, Upload, Users,
} from "lucide-react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DashboardInsightStrip } from "@/components/dashboard/insight-strip";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  DashboardDateRangeFilter,
  isWithinDashboardDateRange,
  type DashboardDateRange,
} from "@/components/dashboard/date-range-filter";
import { itRequestsApi, assetsApi, employeesApi, candidateIdCardApi, escalationsApi, type CandidateIdCardQueueItem, type EmployeeAsset } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDate, getInitials, timeAgo } from "@/lib/utils";
import { exportToCsv } from "@/lib/export";
import { toast } from "sonner";

type ITRequest = {
  id: string;
  candidateId: string;
  candidateName: string | null;
  candidatePersonalEmail?: string | null;
  status: string;
  suggestedEmail: string;
  createdEmail?: string;
  createdAt: string;
  completedAt?: string;
  isOverdue?: boolean;
};

type Employee = {
  id: string;
  fullName?: string | null;
  name?: string | null;
  employeeCode?: string | null;
  etharaEmail?: string | null;
};

const CHART_COLORS = ["#ED00ED", "#908DCE", "#38BDF8", "#22c55e", "#f59e0b", "#ef4444"];
const CHART_TOOLTIP_STYLE = {
  contentStyle: { background: "rgba(8,8,16,0.96)", border: "1px solid rgba(144,141,206,0.22)", borderRadius: 10, fontSize: 12, color: "#C5CBE8" },
  labelStyle: { color: "rgba(197,203,232,0.70)" },
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  assigned: "default",
  returned: "secondary",
  damaged: "destructive",
};

const USER_IMPORT_TEMPLATE =
  "name,company_email,employee_code,personal_email,phone,department,designation,gender\n" +
  "Jane Doe,jane.doe@ethara.ai,GRP1001,jane@gmail.com,9876543210,Engineering,Software Engineer,female\n" +
  "John Smith,john.smith@ethara.ai,GRP1002,john@gmail.com,9123456789,IT,System Admin,male";

const ASSET_IMPORT_TEMPLATE =
  "employee_code,employee_email,asset_type,model,serial_number,asset_tag,charger_issued,status,assigned_at,notes\n" +
  "EMP001,jane.doe@ethara.ai,Laptop,MacBook Pro 14,MBP-001,ETH-LAP-001,yes,assigned,2026-06-05,Issued during onboarding\n" +
  "EMP002,john.smith@ethara.ai,Monitor,Dell 24,D24-009,ETH-MON-009,no,assigned,2026-06-05,";

type BulkResultSummary = {
  label: string;
  total: number;
  success: number;
  failed: number;
  errors: string[];
  // Per-row outcome for a downloadable result file (status + reason per row).
  rows?: Record<string, unknown>[];
  fileBase?: string;
};

function employeeOptionLabel(employee?: Employee | null): string {
  if (!employee) return "";
  const name = employee.fullName || employee.name || "Unnamed employee";
  const code = employee.employeeCode || employee.etharaEmail || "";
  return `${name}${code ? ` (${code})` : ""}`;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadTextFile(content: string, fileName: string) {
  downloadBlob(new Blob([content], { type: "text/csv;charset=utf-8;" }), fileName);
}

function apiErrorMessage(error: unknown, fallback: string) {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

function KpiCard({ title, value, icon: Icon, tone = "default", loading }: {
  title: string; value: number; icon: React.ElementType; tone?: "default" | "danger" | "success" | "warning"; loading?: boolean;
}) {
  const iconBg = { default: "bg-primary/15 text-primary", danger: "bg-destructive/15 text-destructive", success: "bg-success/15 text-success", warning: "bg-warning/15 text-warning" }[tone];
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl p-3.5 transition-all sm:p-5 sm:hover:-translate-y-0.5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
      <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(ellipse at top right, rgba(237,0,237,0.08) 0%, transparent 60%)" }} />
      <div className="relative flex min-w-0 items-center justify-between gap-2 sm:items-start sm:gap-3">
        <div className="min-w-0">
          <p className="break-words text-[10px] font-medium uppercase tracking-wider sm:text-xs" style={{ color: "rgba(197,203,232,0.50)" }}>{title}</p>
          <p className="mt-2 break-words text-2xl font-bold sm:text-3xl" style={{ color: "#C5CBE8" }}>{loading ? "—" : value}</p>
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11", iconBg)}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
      </div>
    </div>
  );
}

export default function ITDashboard() {
  const { user } = useAuth();
  const userImportRef = useRef<HTMLInputElement>(null);
  const assetImportRef = useRef<HTMLInputElement>(null);
  const [pendingRequests, setPendingRequests] = useState<ITRequest[]>([]);
  const [completedRequests, setCompletedRequests] = useState<ITRequest[]>([]);
  const [idCardQueue, setIdCardQueue] = useState<CandidateIdCardQueueItem[]>([]);
  const [selectedIdCardCandidateIds, setSelectedIdCardCandidateIds] = useState<string[]>([]);
  const [assets, setAssets] = useState<EmployeeAsset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [escalations, setEscalations] = useState<unknown[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [markingIdCardsDone, setMarkingIdCardsDone] = useState(false);

  const [reassignAsset, setReassignAsset] = useState<EmployeeAsset | null>(null);
  const [reassignEmployeeId, setReassignEmployeeId] = useState("");
  const [reassignCharger, setReassignCharger] = useState(false);
  const [reassignNotes, setReassignNotes] = useState("");
  const [reassigning, setReassigning] = useState(false);

  const [dateRange, setDateRange] = useState<DashboardDateRange>({ from: "", to: "" });
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkImporting, setBulkImporting] = useState<"users" | "assets" | null>(null);
  const [exportingUsers, setExportingUsers] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResultSummary | null>(null);

  const loadAll = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const [pending, completed, idCards, allAssets, emps, esc] = await Promise.all([
        itRequestsApi.list({ status: "pending" }),
        itRequestsApi.list({ status: "completed" }),
        candidateIdCardApi.listQueue(),
        assetsApi.list(),
        employeesApi.list({ limit: 500 }).then((r) => Array.isArray(r) ? r : (r as { data?: unknown[] }).data ?? []),
        escalationsApi.list({ status: "open" }).catch(() => []),
      ]);
      const now = Date.now();
      const pendingWithFlags = ((pending ?? []) as ITRequest[]).map((req) => ({
        ...req,
        isOverdue: (now - new Date(req.createdAt).getTime()) / (1000 * 60 * 60 * 24) >= 3,
      }));
      setPendingRequests(pendingWithFlags);
      setCompletedRequests((completed ?? []) as ITRequest[]);
      setIdCardQueue(idCards ?? []);
      setAssets(allAssets ?? []);
      setEmployees(emps as Employee[]);
      setEscalations(Array.isArray(esc) ? esc : []);
      setSelectedIdCardCandidateIds((prev) => prev.filter((id) => (idCards ?? []).some((item) => item.candidateId === id && item.canMarkDone)));
    } catch {
      setError("Unable to load IT dashboard data.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadAll();
  }, []);

  const filteredPendingRequests = pendingRequests.filter((r) => isWithinDashboardDateRange(r.createdAt, dateRange));
  const filteredCompletedRequests = completedRequests.filter((r) => isWithinDashboardDateRange(r.completedAt ?? r.createdAt, dateRange));
  const filteredAssets = assets.filter((a) => isWithinDashboardDateRange(a.assignedAt ?? a.createdAt, dateRange));
  const filteredIdCardQueue = idCardQueue.filter((item) => isWithinDashboardDateRange(item.submittedAt ?? item.createdAt, dateRange));
  const filteredEscalations = escalations.filter((e) => {
    const row = e as { createdAt?: string; created_at?: string };
    return isWithinDashboardDateRange(row.createdAt ?? row.created_at, dateRange);
  });
  const assignedAssets = filteredAssets.filter((a) => a.status === "assigned");
  const returnedAssets = filteredAssets.filter((a) => a.status === "returned");
  const overdueRequests = filteredPendingRequests.filter((r) => r.isOverdue);
  const readyIdCards = filteredIdCardQueue.filter((item) => item.canMarkDone);
  const allReadySelected = readyIdCards.length > 0 && readyIdCards.every((item) => selectedIdCardCandidateIds.includes(item.candidateId));

  const requestChartData = [
    { label: "Pending", value: filteredPendingRequests.length, fill: CHART_COLORS[4] },
    { label: "Completed", value: filteredCompletedRequests.length, fill: CHART_COLORS[3] },
    { label: "Overdue", value: overdueRequests.length, fill: CHART_COLORS[5] },
  ];

  const assetDistData = (() => {
    const counts: Record<string, number> = {};
    filteredAssets.forEach((a) => { counts[a.assetType] = (counts[a.assetType] ?? 0) + 1; });
    return Object.entries(counts).map(([name, value], i) => ({ name, value, fill: CHART_COLORS[i % CHART_COLORS.length] }));
  })();

  const openReassign = (asset: EmployeeAsset) => {
    setReassignAsset(asset); setReassignEmployeeId(""); setReassignCharger(asset.chargerIssued); setReassignNotes("");
  };

  const handleReassign = async () => {
    if (!reassignAsset || !reassignEmployeeId) { toast.error("Select the new employee"); return; }
    setReassigning(true);
    try {
      await assetsApi.reassign(reassignAsset.id, { employee_profile_id: reassignEmployeeId, charger_issued: reassignCharger, notes: reassignNotes.trim() || undefined });
      toast.success("Asset reassigned");
      setReassignAsset(null);
      void loadAll(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to reassign asset");
    } finally { setReassigning(false); }
  };

  const handleMarkIdCardsDone = async () => {
    if (!selectedIdCardCandidateIds.length) { toast.error("Select at least one ready ID card."); return; }
    setMarkingIdCardsDone(true);
    try {
      const result = await candidateIdCardApi.markDone(selectedIdCardCandidateIds);
      toast.success(`Marked ${result.updatedCount} ID card(s) as done.`);
      setSelectedIdCardCandidateIds([]);
      void loadAll(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not mark ID cards as done.");
    } finally { setMarkingIdCardsDone(false); }
  };

  const handleExport = () => {
    const rows = [
      ...filteredPendingRequests.map((r) => ({
        recordType: "IT Request",
        person: r.candidateName ?? "",
        candidatePersonalEmail: r.candidatePersonalEmail ?? "",
        status: r.status,
        suggestedEmail: r.suggestedEmail,
        createdEmail: r.createdEmail ?? "",
        createdAt: r.createdAt,
        completedAt: "",
        overdue: r.isOverdue ? "Yes" : "No",
      })),
      ...filteredCompletedRequests.map((r) => ({
        recordType: "IT Request",
        person: r.candidateName ?? "",
        candidatePersonalEmail: r.candidatePersonalEmail ?? "",
        status: r.status,
        suggestedEmail: r.suggestedEmail,
        createdEmail: r.createdEmail ?? "",
        createdAt: r.createdAt,
        completedAt: r.completedAt ?? "",
        overdue: "No",
      })),
      ...filteredAssets.map((asset) => ({
        recordType: "Asset",
        person: asset.employeeName ?? "",
        employeeCode: asset.employeeCode ?? "",
        assetType: asset.assetType,
        model: asset.model ?? "",
        serialNumber: asset.serialNumber ?? "",
        assetTag: asset.assetTag ?? "",
        status: asset.status,
        chargerIssued: asset.chargerIssued ? "Yes" : "No",
        assignedAt: asset.assignedAt ?? "",
        returnedAt: asset.returnedAt ?? "",
        notes: asset.notes ?? "",
      })),
      ...filteredIdCardQueue.map((item) => ({
        recordType: "ID Card",
        person: item.candidateName,
        candidatePersonalEmail: item.personalEmail ?? "",
        employeeCode: item.employeeId ?? "",
        status: item.status,
        etharaEmail: item.etharaEmail ?? "",
        submittedAt: item.submittedAt ?? "",
        completedAt: item.itCompletedAt ?? "",
      })),
    ];
    if (rows.length === 0) {
      toast.error("No IT data to export for the selected range.");
      return;
    }
    exportToCsv(
      rows,
      [
        { key: "recordType", header: "Record Type" },
        { key: "person", header: "Person" },
        { key: "candidatePersonalEmail", header: "Candidate Personal Email" },
        { key: "employeeCode", header: "Employee / Candidate Code" },
        { key: "assetType", header: "Asset Type" },
        { key: "model", header: "Model" },
        { key: "serialNumber", header: "Serial Number" },
        { key: "assetTag", header: "Asset Tag" },
        { key: "status", header: "Status" },
        { key: "suggestedEmail", header: "Suggested Email" },
        { key: "createdEmail", header: "Created Email" },
        { key: "etharaEmail", header: "Ethara Email" },
        { key: "chargerIssued", header: "Charger Issued" },
        { key: "createdAt", header: "Created At" },
        { key: "assignedAt", header: "Assigned At" },
        { key: "submittedAt", header: "Submitted At" },
        { key: "completedAt", header: "Completed At" },
        { key: "returnedAt", header: "Returned At" },
        { key: "overdue", header: "Overdue" },
        { key: "notes", header: "Notes" },
      ],
      `it_dashboard_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };

  const handleUserImportFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Only CSV files are accepted.");
      return;
    }
    setBulkImporting("users");
    setBulkResult(null);
    try {
      const result = await employeesApi.bulkRegister(file);
      const resultRows: Record<string, unknown>[] = [
        ...result.results.map((row) => ({
          status: "created",
          name: row.name,
          email: row.email,
          employeeCode: row.employeeCode,
          detail: "",
        })),
        ...result.errors.map((row) => ({
          status: "failed",
          row: row.row,
          name: row.name,
          email: row.email,
          employeeCode: row.employeeCode,
          detail: row.errors.join("; "),
        })),
      ];
      setBulkResult({
        label: "User details",
        total: result.total,
        success: result.created,
        failed: result.failed,
        errors: result.errors.map((row) => `Row ${row.row}: ${row.errors.join(", ")}`),
        rows: resultRows,
        fileBase: "user_import_result",
      });
      toast.success(`Imported ${result.created} user(s).${result.failed ? ` ${result.failed} failed.` : ""}`);
      if (result.created > 0) void loadAll(true);
    } catch (error) {
      toast.error(apiErrorMessage(error, "User bulk import failed."));
    } finally {
      setBulkImporting(null);
      if (userImportRef.current) userImportRef.current.value = "";
    }
  };

  const handleAssetImportFile = async (file?: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Only CSV files are accepted.");
      return;
    }
    setBulkImporting("assets");
    setBulkResult(null);
    try {
      const result = await assetsApi.bulkImport(file);
      setBulkResult({
        label: "Asset inventory",
        total: result.total,
        success: result.imported,
        failed: result.failed,
        errors: result.errors.map((row) => `Row ${row.row}: ${row.errors.join(", ")}`),
      });
      toast.success(`Imported ${result.imported} asset(s).${result.failed ? ` ${result.failed} failed.` : ""}`);
      if (result.imported > 0) void loadAll(true);
    } catch (error) {
      toast.error(apiErrorMessage(error, "Asset bulk import failed."));
    } finally {
      setBulkImporting(null);
      if (assetImportRef.current) assetImportRef.current.value = "";
    }
  };

  const handleExportUsers = async () => {
    setExportingUsers(true);
    try {
      const blob = await employeesApi.exportUsersCsv();
      downloadBlob(blob, `it_user_details_${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success("User details export ready.");
    } catch (error) {
      toast.error(apiErrorMessage(error, "User details export failed."));
    } finally {
      setExportingUsers(false);
    }
  };

  const handleExportAssetInventory = () => {
    if (assets.length === 0) {
      toast.error("No asset inventory data to export.");
      return;
    }
    exportToCsv(
      assets.map((asset) => ({
        employeeName: asset.employeeName ?? "",
        employeeCode: asset.employeeCode ?? "",
        assetType: asset.assetType,
        model: asset.model ?? "",
        serialNumber: asset.serialNumber ?? "",
        assetTag: asset.assetTag ?? "",
        chargerIssued: asset.chargerIssued ? "Yes" : "No",
        status: asset.status,
        assignedAt: asset.assignedAt ? formatDate(asset.assignedAt) : "",
        returnedAt: asset.returnedAt ? formatDate(asset.returnedAt) : "",
        returnCondition: asset.returnCondition ?? "",
        notes: asset.notes ?? "",
        createdAt: asset.createdAt ? formatDate(asset.createdAt) : "",
      })),
      [
        { key: "employeeName", header: "Employee Name" },
        { key: "employeeCode", header: "Employee Code" },
        { key: "assetType", header: "Asset Type" },
        { key: "model", header: "Model" },
        { key: "serialNumber", header: "Serial Number" },
        { key: "assetTag", header: "Asset Tag" },
        { key: "chargerIssued", header: "Charger Issued" },
        { key: "status", header: "Status" },
        { key: "assignedAt", header: "Assigned At" },
        { key: "returnedAt", header: "Returned At" },
        { key: "returnCondition", header: "Return Condition" },
        { key: "notes", header: "Notes" },
        { key: "createdAt", header: "Created At" },
      ],
      `it_asset_inventory_${new Date().toISOString().slice(0, 10)}.csv`,
    );
  };
  const selectedReassignEmployee = employees.find((e) => e.id === reassignEmployeeId);
  const requestTotal = filteredPendingRequests.length + filteredCompletedRequests.length;
  const requestCompletionRate = requestTotal ? Math.round((filteredCompletedRequests.length / requestTotal) * 100) : 0;
  const itInsights = [
    {
      label: "Provisioning Flow",
      value: `${requestCompletionRate}% done`,
      detail: `${filteredCompletedRequests.length} completed and ${filteredPendingRequests.length} pending email requests.`,
      icon: Mail,
      tone: filteredPendingRequests.length ? "warning" as const : "success" as const,
      progress: requestCompletionRate,
      href: "/dashboard/it-requests",
    },
    {
      label: "Overdue Risk",
      value: overdueRequests.length,
      detail: "Requests waiting three or more days need immediate follow-up.",
      icon: AlertTriangle,
      tone: overdueRequests.length ? "danger" as const : "success" as const,
      href: "/dashboard/it-requests",
    },
    {
      label: "ID Card Readiness",
      value: readyIdCards.length,
      detail: `${filteredIdCardQueue.length} ID card records visible in the selected range.`,
      icon: CreditCard,
      tone: readyIdCards.length ? "warning" as const : "success" as const,
      href: "/dashboard/it/id-cards",
    },
    {
      label: "Asset Coverage",
      value: assignedAssets.length,
      detail: `${filteredAssets.length} assets tracked, ${returnedAssets.length} returned.`,
      icon: Laptop,
      tone: "info" as const,
      href: "/dashboard/it/assets",
    },
  ];

  return (
    <div className="space-y-5 overflow-x-hidden animate-fade-in">
      <div className="relative overflow-hidden rounded-2xl px-4 py-5 sm:px-6" style={{ background: "linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(19,18,44,0.95) 50%, rgba(8,8,16,0.98) 100%)", border: "1px solid rgba(144,141,206,0.18)" }}>
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(ellipse at 80% 20%, rgba(34,197,94,0.3) 0%, transparent 60%)" }} />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>Welcome back</p>
            <h1 className="mt-0.5 break-words text-2xl font-bold sm:text-3xl" style={{ color: "#C5CBE8" }}>{user?.name ?? "IT"}</h1>
            <p className="mt-1 max-w-xl text-sm leading-6" style={{ color: "rgba(197,203,232,0.50)" }}>Email provisioning, assets, and IT operations overview.</p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:max-w-xl sm:grid-cols-4 lg:w-[560px]">
            <DashboardDateRangeFilter value={dateRange} onChange={setDateRange} className="col-span-2 sm:col-span-4" />
            <Button variant="outline" size="sm" className="h-10 w-full justify-center rounded-xl text-xs gap-1.5" onClick={() => setBulkOpen(true)}><FileSpreadsheet className="h-3.5 w-3.5" /> Bulk</Button>
            <Button variant="outline" size="sm" className="h-10 w-full justify-center rounded-xl text-xs gap-1.5" onClick={handleExport}><Download className="h-3.5 w-3.5" /> Export</Button>
            <Link href="/dashboard/it/assets" className="min-w-0"><Button variant="outline" size="sm" className="h-10 w-full justify-center rounded-xl text-xs gap-1.5"><Package className="h-3.5 w-3.5" /> All Assets</Button></Link>
            <Button size="sm" className="h-10 w-full justify-center rounded-xl text-xs gap-1.5" onClick={() => void loadAll()}><RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} /> Refresh</Button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Pending Email Creation" value={filteredPendingRequests.length} icon={Mail} tone="warning" loading={isLoading} />
        <KpiCard title="Completed Requests" value={filteredCompletedRequests.length} icon={CheckCircle2} tone="success" loading={isLoading} />
        <KpiCard title="Assets Assigned" value={assignedAssets.length} icon={Laptop} loading={isLoading} />
        <KpiCard title="Overdue (3+ days)" value={overdueRequests.length} icon={AlertTriangle} tone="danger" loading={isLoading} />
        <KpiCard title="ID Cards Pending" value={readyIdCards.length} icon={CreditCard} tone="warning" loading={isLoading} />
        <KpiCard title="IT Escalations" value={filteredEscalations.length} icon={AlertTriangle} tone="danger" loading={isLoading} />
        <KpiCard title="Returned Assets" value={returnedAssets.length} icon={Package} loading={isLoading} />
        <KpiCard title="Total Employees" value={employees.length} icon={Users} loading={isLoading} />
      </div>

      <DashboardInsightStrip
        title="IT Operating Summary"
        subtitle="Provisioning throughput, overdue risk, ID cards, and asset coverage."
        insights={itInsights}
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: "#C5CBE8" }}>IT Request Overview</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={requestChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "rgba(197,203,232,0.45)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "rgba(197,203,232,0.45)" }} axisLine={false} tickLine={false} />
              <Tooltip {...CHART_TOOLTIP_STYLE} />
              <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]}>
                {requestChartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
          <h2 className="text-sm font-semibold mb-4" style={{ color: "#C5CBE8" }}>Asset Type Distribution</h2>
          {assetDistData.length > 0 ? (
            <div className="flex items-center gap-4">
              <PieChart width={110} height={110}>
                <Pie data={assetDistData} cx={52} cy={52} innerRadius={30} outerRadius={52} dataKey="value" strokeWidth={0}>
                  {assetDistData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
              </PieChart>
              <div className="flex-1 space-y-2">
                {assetDistData.map((e) => (
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
            <div className="flex items-center justify-center h-24 text-sm" style={{ color: "rgba(197,203,232,0.35)" }}>No assets found</div>
          )}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
        <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Email Creation Queue</h2>
            <Link href="/dashboard/it-requests"><span className="text-xs" style={{ color: "#ED00ED" }}>View All</span></Link>
          </div>
          {isLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : filteredPendingRequests.length === 0 ? (
            <div className="flex flex-col items-center py-6 text-muted-foreground">
              <Mail className="h-8 w-8 opacity-20 mb-2" />
              <p className="text-sm">No pending email requests</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPendingRequests.slice(0, 6).map((req) => (
                <div key={req.id} className="flex flex-col gap-3 rounded-xl px-3 py-3 transition-colors sm:flex-row sm:items-center sm:justify-between sm:py-2.5" style={{ background: "rgba(144,141,206,0.05)", border: "1px solid rgba(144,141,206,0.10)" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarFallback className="text-xs" style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}>{getInitials(req.candidateName ?? "?")}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: "#C5CBE8" }}>{req.candidateName ?? "Unknown"}</p>
                      <p className="text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Pending since {timeAgo(req.createdAt)} · {req.suggestedEmail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:shrink-0">
                    <Badge variant={req.isOverdue ? "destructive" : "secondary"} className="text-[10px]">
                      {req.isOverdue ? "Overdue" : "Pending"}
                    </Badge>
                    <Link href="/dashboard/it-requests" className="ml-auto sm:ml-0">
                      <Button size="sm" className="h-8 rounded-xl text-xs sm:h-7"><Mail className="mr-1 h-3 w-3" /> Create</Button>
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
              <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Assigned Assets</h2>
              <Link href="/dashboard/it/assets"><span className="text-xs" style={{ color: "#ED00ED" }}>Manage</span></Link>
            </div>
            <div className="space-y-2">
              {assignedAssets.slice(0, 4).map((asset) => (
                <div key={asset.id} className="flex items-center justify-between rounded-xl px-3 py-2 transition-colors group" style={{ background: "rgba(144,141,206,0.05)" }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <Laptop className="h-4 w-4 shrink-0" style={{ color: "rgba(197,203,232,0.40)" }} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: "#C5CBE8" }}>{asset.assetType}{asset.model ? ` — ${asset.model}` : ""}</p>
                      <p className="text-[10px] truncate" style={{ color: "rgba(197,203,232,0.40)" }}>{asset.employeeName ?? "—"}</p>
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100" onClick={() => openReassign(asset)}>
                    <ArrowRightLeft className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {assignedAssets.length === 0 && <p className="text-xs text-center py-3" style={{ color: "rgba(197,203,232,0.35)" }}>No assigned assets</p>}
            </div>
          </div>

        </div>
      </div>

      {filteredIdCardQueue.length > 0 && (
        <div className="rounded-2xl p-5" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "#C5CBE8" }}>
              <CreditCard className="h-4 w-4 text-primary" /> ID Card Queue
            </h2>
            <Button size="sm" className="rounded-xl text-xs" disabled={markingIdCardsDone || !selectedIdCardCandidateIds.length} onClick={() => void handleMarkIdCardsDone()}>
              {markingIdCardsDone ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Mark Done
            </Button>
          </div>
          <div className="flex items-center gap-3 mb-3 rounded-xl px-3 py-2" style={{ background: "rgba(144,141,206,0.06)" }}>
            <label className="flex items-center gap-2 text-xs" style={{ color: "rgba(197,203,232,0.55)" }}>
              <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={allReadySelected} onChange={(e) => setSelectedIdCardCandidateIds(e.target.checked ? readyIdCards.map((item) => item.candidateId) : [])} disabled={readyIdCards.length === 0} />
              Select all ready ({readyIdCards.length})
            </label>
          </div>
          <div className="space-y-2">
            {filteredIdCardQueue.slice(0, 5).map((item) => (
              <div key={item.candidateId} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(144,141,206,0.05)" }}>
                <div className="flex items-center gap-3 min-w-0">
                  <input type="checkbox" className="h-3.5 w-3.5 rounded" checked={selectedIdCardCandidateIds.includes(item.candidateId)} disabled={!item.canMarkDone} onChange={(e) => setSelectedIdCardCandidateIds((prev) => e.target.checked ? [...prev, item.candidateId] : prev.filter((id) => id !== item.candidateId))} />
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="text-[10px]" style={{ background: "rgba(144,141,206,0.15)", color: "#908DCE" }}>{getInitials(item.candidateName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-xs font-medium" style={{ color: "#C5CBE8" }}>{item.candidateName}</p>
                    <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.40)" }}>{item.etharaEmail || "Email pending"}</p>
                  </div>
                </div>
                <Badge variant={{ awaiting_details: "outline" as const, ready: "secondary" as const, done: "default" as const }[item.status] ?? "outline"} className="text-[10px]">
                  {item.status === "awaiting_details" ? "Awaiting" : item.status === "ready" ? "Ready" : "Done"}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-3 min-[420px]:grid-cols-2 sm:grid-cols-4">
        {[
          { label: "Email Requests", icon: Mail, href: "/dashboard/it-requests", desc: "Create Ethara emails" },
          { label: "Asset Management", icon: Laptop, href: "/dashboard/it/assets", desc: "Assign & track devices" },
          { label: "Employees", icon: Users, href: "/dashboard/employees", desc: "View active employees" },
          { label: "Escalations", icon: AlertTriangle, href: "/dashboard/escalations", desc: "IT escalation tracker" },
        ].map((a) => (
          <Link key={a.label} href={a.href}>
            <div className="flex items-center gap-3 rounded-2xl p-4 transition-all hover:-translate-y-0.5 cursor-pointer" style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)" }}>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0" style={{ background: "rgba(34,197,94,0.12)" }}>
                <a.icon className="h-4 w-4" style={{ color: "#22c55e" }} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>{a.label}</p>
                <p className="text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>{a.desc}</p>
              </div>
              <ArrowRight className="h-4 w-4 ml-auto shrink-0" style={{ color: "rgba(197,203,232,0.25)" }} />
            </div>
          </Link>
        ))}
      </div>

      <input
        ref={userImportRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => void handleUserImportFile(event.target.files?.[0])}
      />
      <input
        ref={assetImportRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(event) => void handleAssetImportFile(event.target.files?.[0])}
      />

      <Dialog open={bulkOpen} onOpenChange={(open) => { setBulkOpen(open); if (!open) setBulkResult(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Bulk Import / Export
            </DialogTitle>
          </DialogHeader>

          {bulkResult && (
            <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-muted/20 p-3 text-center text-xs">
              <div>
                <p className="text-lg font-bold text-foreground">{bulkResult.total}</p>
                <p className="text-muted-foreground">Rows</p>
              </div>
              <div>
                <p className="text-lg font-bold text-success">{bulkResult.success}</p>
                <p className="text-muted-foreground">Imported</p>
              </div>
              <div>
                <p className="text-lg font-bold text-destructive">{bulkResult.failed}</p>
                <p className="text-muted-foreground">Failed</p>
              </div>
              {bulkResult.errors.length > 0 && (
                <div className="col-span-3 max-h-28 overflow-y-auto rounded-lg bg-destructive/5 p-2 text-left text-[11px] text-destructive">
                  <p className="mb-1 font-semibold">{bulkResult.label} errors</p>
                  {bulkResult.errors.slice(0, 8).map((error, index) => <p key={index}>{error}</p>)}
                  {bulkResult.errors.length > 8 && <p>+{bulkResult.errors.length - 8} more</p>}
                </div>
              )}
              {bulkResult.rows && bulkResult.rows.length > 0 && (
                <div className="col-span-3 flex justify-center pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs"
                    onClick={() =>
                      exportToCsv(
                        bulkResult.rows ?? [],
                        [
                          { key: "status", header: "Status" },
                          { key: "row", header: "Row" },
                          { key: "name", header: "Name" },
                          { key: "email", header: "Company Email" },
                          { key: "employeeCode", header: "Employee Code" },
                          { key: "detail", header: "Detail" },
                        ],
                        `${bulkResult.fileBase ?? "import_result"}_${new Date().toISOString().slice(0, 10)}.csv`,
                      )
                    }
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download result file
                  </Button>
                </div>
              )}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-muted/10 p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">User Details</h3>
              </div>
              <code className="mt-3 block overflow-x-auto rounded-lg bg-background/60 p-2 text-[11px] text-muted-foreground">
                name, company_email, employee_code, personal_email, phone, department, designation, gender
              </code>
              <div className="mt-4 grid gap-2">
                <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => downloadTextFile(USER_IMPORT_TEMPLATE, "it_user_import_template.csv")}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                </Button>
                <Button size="sm" className="rounded-xl text-xs" disabled={bulkImporting !== null} onClick={() => userImportRef.current?.click()}>
                  {bulkImporting === "users" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                  Import Users CSV
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl text-xs" disabled={exportingUsers} onClick={() => void handleExportUsers()}>
                  {exportingUsers ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                  Export Users
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/10 p-4">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">Asset Inventory</h3>
              </div>
              <code className="mt-3 block overflow-x-auto rounded-lg bg-background/60 p-2 text-[11px] text-muted-foreground">
                employee_code, employee_email, asset_type, model, serial_number, asset_tag, charger_issued, status, assigned_at, notes
              </code>
              <div className="mt-4 grid gap-2">
                <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => downloadTextFile(ASSET_IMPORT_TEMPLATE, "it_asset_import_template.csv")}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Template
                </Button>
                <Button size="sm" className="rounded-xl text-xs" disabled={bulkImporting !== null} onClick={() => assetImportRef.current?.click()}>
                  {bulkImporting === "assets" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
                  Import Assets CSV
                </Button>
                <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={handleExportAssetInventory}>
                  <Download className="mr-1.5 h-3.5 w-3.5" /> Export Assets
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reassignAsset} onOpenChange={(open) => { if (!open) setReassignAsset(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ArrowRightLeft className="h-5 w-5 text-primary" />Reassign Asset</DialogTitle>
          </DialogHeader>
          {reassignAsset && (
            <div className="space-y-4 py-2">
              <div className="rounded-xl p-3 text-sm space-y-1" style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.18)" }}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{reassignAsset.assetType}</span>
                  <Badge variant={STATUS_VARIANT[reassignAsset.status] ?? "outline"} className="text-[10px]">{reassignAsset.status}</Badge>
                </div>
                {reassignAsset.employeeName && <p className="text-xs text-muted-foreground">Currently: <span className="font-medium text-foreground">{reassignAsset.employeeName}</span></p>}
              </div>
              <div className="space-y-2">
                <Label>Assign To *</Label>
                <Select value={reassignEmployeeId} onValueChange={(v) => setReassignEmployeeId(v ?? "")}>
                  <SelectTrigger className="w-full min-w-0 rounded-xl">
                    <SelectValue className="min-w-0 truncate" placeholder="Select new employee…">
                      {selectedReassignEmployee ? employeeOptionLabel(selectedReassignEmployee) : "Select new employee…"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-auto min-w-[var(--anchor-width)] max-w-[calc(100vw-3rem)]">
                    {employees.filter((e) => e.id !== reassignAsset.employeeProfileId).map((e) => (
                      <SelectItem key={e.id} value={e.id}>{employeeOptionLabel(e)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" id="charger" checked={reassignCharger} onChange={(e) => setReassignCharger(e.target.checked)} className="h-4 w-4 rounded" />
                <Label htmlFor="charger">Charger included</Label>
              </div>
              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea placeholder="Handover notes…" value={reassignNotes} onChange={(e) => setReassignNotes(e.target.value)} rows={2} className="rounded-xl resize-none" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReassignAsset(null)} disabled={reassigning}>Cancel</Button>
            <Button onClick={handleReassign} disabled={reassigning || !reassignEmployeeId} className="gap-2">
              {reassigning && <Loader2 className="h-4 w-4 animate-spin" />}
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

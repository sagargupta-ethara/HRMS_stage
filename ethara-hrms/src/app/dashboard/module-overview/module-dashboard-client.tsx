"use client";

import Link from "next/link";
import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Briefcase,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  CreditCard,
  Building2,
  FileCheck,
  FileText,
  Gauge,
  Landmark,
  Laptop,
  Loader2,
  Mail,
  ReceiptText,
  Percent,
  Scale,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Tags,
  TrendingUp,
  Trophy,
  UserCheck,
  UserCog,
  UserMinus,
  Users,
  UtensilsCrossed,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  assetsApi,
  attendanceApi,
  bankVerificationApi,
  candidateIdCardApi,
  candidatesApi,
  dinnerRequestsApi,
  employeeEvaluationApi,
  employeesApi,
  evaluationsApi,
  itRequestsApi,
  leaveApi,
  pmsApi,
  positionsApi,
  reportsApi,
  reimbursementsApi,
  separationApi,
  vendorsApi,
  type BankVerificationRow,
  type CandidateIdCardQueueItem,
  type DomainWiseReportRow,
  type EmployeeEvaluationHighlights,
  type EmployeeEvaluationListItem,
  type EmployeeEvaluationOverview,
  type PiSummaryReport,
} from "@/lib/api";
import {
  attendanceRangeForShortcut,
  type AttendanceRangeShortcut,
} from "@/lib/attendance-dates";
import { cn, formatLabel, getInitials, timeAgo } from "@/lib/utils";

export type ModuleDashboardScope = "all" | "talent" | "lifecycle" | "performance" | "it-operations" | "finance";

type Tone = "default" | "success" | "warning" | "danger";
type IconType = ElementType;

type StageBreakdown = { currentStage: string; _count: number };
type SourceBreakdown = { sourceType: string; _count: number; joined?: number };
type ReportSummary = {
  totalCandidates?: number;
  thisMonth?: number;
  joined?: number;
  activeEscalations?: number;
  pendingEvaluations?: number;
  stageBreakdown?: StageBreakdown[];
  sourceBreakdown?: SourceBreakdown[];
};
type FunnelRow = { month: string; applied: number; shortlisted: number; joined: number };
type CandidateRow = {
  id: string;
  fullName?: string | null;
  personalEmail?: string | null;
  currentStage?: string | null;
  createdAt?: string | null;
  position?: { title?: string | null } | null;
};
type EmployeeRow = {
  id: string;
  fullName?: string | null;
  name?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  designation?: string | null;
  createdAt?: string | null;
};
type EvaluationRow = {
  id: string;
  completedAt?: string | null;
  completed_at?: string | null;
  interviewScheduledAt?: string | null;
  interview_scheduled_at?: string | null;
  totalScore?: number | null;
};
type GenericStatusRow = {
  id?: string;
  status?: string | null;
  statusLabel?: string | null;
  overallRating?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  submittedAt?: string | null;
  expenseAmount?: number | null;
};
type AttendanceSummary = {
  total?: number;
  present?: number;
  absent?: number;
  halfDay?: number;
  edited?: number;
  averageWorkedHours?: number | null;
};
type ModuleMetric = {
  label: string;
  value: string | number;
  detail: string;
  icon: IconType;
  tone?: Tone;
  href?: string;
};
type WorkItem = {
  label: string;
  value: string | number;
  href: string;
  detail: string;
  icon: IconType;
  tone?: Tone;
  // Informational rows (inventory totals, completed counts) are shown in the module's
  // work list but never counted as pending action items.
  informational?: boolean;
};
type QuickLink = {
  label: string;
  href: string;
  icon: IconType;
};
type ModuleView = {
  scope: Exclude<ModuleDashboardScope, "all">;
  title: string;
  eyebrow: string;
  href: string;
  icon: IconType;
  metrics: ModuleMetric[];
  work: WorkItem[];
  links: QuickLink[];
};
type DashboardData = {
  range?: DashRange;
  summary?: ReportSummary;
  prevSummary?: ReportSummary;
  funnel?: FunnelRow[];
  domains?: DomainWiseReportRow[];
  piSummary?: PiSummaryReport;
  candidates?: CandidateRow[];
  candidateTotal?: number;
  positions?: Array<{ isActive?: boolean; openings?: number }>;
  vendors?: unknown[];
  employees?: EmployeeRow[];
  evaluations?: EvaluationRow[];
  pms?: GenericStatusRow[];
  itPending?: GenericStatusRow[];
  itCompleted?: GenericStatusRow[];
  assets?: GenericStatusRow[];
  idCards?: CandidateIdCardQueueItem[];
  reimbursements?: GenericStatusRow[];
  dinners?: GenericStatusRow[];
  leaves?: GenericStatusRow[];
  separations?: GenericStatusRow[];
  attendance?: AttendanceSummary;
  bankVerification?: BankVerificationRow[];
};

const SCOPE_LABELS: Record<ModuleDashboardScope, string> = {
  all: "Master Dashboard",
  talent: "Talent Acquisition & Recruitment",
  lifecycle: "Employee Lifecycle",
  performance: "Performance & Development",
  "it-operations": "IT Operations & Support",
  finance: "Finance",
};

const SHORT_SCOPE_LABELS: Record<Exclude<ModuleDashboardScope, "all">, string> = {
  talent: "Talent",
  lifecycle: "Lifecycle",
  performance: "Performance",
  "it-operations": "IT Operations",
  finance: "Finance",
};

const SCOPE_DESCRIPTIONS: Record<ModuleDashboardScope, string> = {
  all: "Organisation-wide view across Talent, Lifecycle, Performance, IT, and Finance.",
  talent: "Everything in the hiring pipeline: positions, screening, assessments, evaluations, selection forms, and contracts.",
  lifecycle: "Your workforce after joining: directory, attendance, leave, compliance, skills, and exits.",
  performance: "PMS review cycles and personal-interview (PI) rounds, with rating and outcome breakdowns.",
  "it-operations": "IT service delivery: email/access requests, asset allocation, and ID cards.",
  finance: "Money requests in motion: reimbursements, dinner requests, and penny-drop bank verification.",
};

const TONE_CLASS: Record<Tone, string> = {
  default: "bg-primary/15 text-primary",
  success: "bg-emerald-500/15 text-emerald-400",
  warning: "bg-amber-500/15 text-amber-400",
  danger: "bg-red-500/15 text-red-400",
};

const CHART_COLORS = ["#ED00ED", "#908DCE", "#38BDF8", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#34d399"];

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
  cursor: { fill: "rgba(144,141,206,0.06)" },
};

const CARD_STYLE = {
  background: "rgba(25,24,44,0.85)",
  border: "1px solid rgba(144,141,206,0.18)",
  backdropFilter: "blur(16px)",
};

const PENDING_REIMBURSEMENT_STATUSES = new Set([
  "submitted",
  "pending_manager_review",
  "manager_approved",
  "pending_hr_review",
  "pending_leadership_review",
  "missing_information",
  "returned_by_manager",
  "returned_by_hr",
  "returned_by_leadership",
  "returned_by_finance",
]);
const PAID_REIMBURSEMENT_STATUSES = new Set(["paid", "acknowledged"]);
const ACTIVE_SEPARATION_STATUSES = new Set(["submitted", "manager_approved", "hr_review", "it_clearance", "office_admin_clearance"]);

const PIPELINE_BUCKETS: Array<{ label: string; stages: string[] }> = [
  { label: "Applied", stages: ["new_application", "source_tagged", "resume_uploaded"] },
  { label: "Screening", stages: ["resume_screening_pending"] },
  { label: "Shortlisted", stages: ["resume_shortlisted"] },
  { label: "Evaluation", stages: ["evaluation_assigned", "evaluation_in_progress"] },
  { label: "Offer & Forms", stages: ["evaluation_passed", "selection_form_sent", "selection_form_submitted", "selection_form_validated"] },
  { label: "Contract", stages: ["contract_sent", "contract_signed"] },
  { label: "Onboarding", stages: ["induction_completed", "it_email_created", "welcome_mail_sent", "statutory_forms_sent", "statutory_forms_submitted", "compliance_verified"] },
  { label: "Joined", stages: ["onboarding_completed"] },
];
const REJECTED_STAGES = ["resume_rejected", "evaluation_failed"];

// Rejected candidates still progressed part-way: resume_rejected reached Screening,
// evaluation_failed reached Evaluation.
const REJECTED_REACH: Record<string, number> = { resume_rejected: 1, evaluation_failed: 3 };

function cumulativeBucketCounts(summary: ReportSummary | undefined): number[] {
  const counts = PIPELINE_BUCKETS.map(() => 0);
  const stageToBucket = new Map<string, number>();
  PIPELINE_BUCKETS.forEach((bucket, index) => bucket.stages.forEach((stage) => stageToBucket.set(stage, index)));
  (summary?.stageBreakdown ?? []).forEach((row) => {
    const reach = stageToBucket.get(row.currentStage) ?? REJECTED_REACH[row.currentStage];
    if (reach === undefined) return;
    const count = Number(row._count ?? 0);
    for (let index = 0; index <= reach; index += 1) {
      counts[index] += count;
    }
  });
  return counts;
}

function shouldLoad(scope: ModuleDashboardScope, modules: ModuleDashboardScope[]) {
  return scope === "all" || modules.includes(scope);
}

async function optional<T>(request: () => Promise<T>): Promise<T | undefined> {
  try {
    return await request();
  } catch {
    return undefined;
  }
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: T[] }).data;
  }
  return [];
}

function countByStatus(rows: GenericStatusRow[] | undefined, statuses: Set<string>) {
  return (rows ?? []).filter((row) => statuses.has(String(row.status ?? ""))).length;
}

function countStages(summary: ReportSummary | undefined, stages: string[]) {
  const wanted = new Set(stages);
  return (summary?.stageBreakdown ?? []).reduce((total, row) => (
    total + (wanted.has(row.currentStage) ? Number(row._count ?? 0) : 0)
  ), 0);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

type DashRange = "all" | "7d" | "30d" | "90d";

const DASH_RANGE_LABELS: Record<DashRange, string> = {
  all: "All time",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "Quarter",
};

type DateWindow = { from: string; to: string };

function rangeWindows(range: DashRange): { current: DateWindow; previous: DateWindow } | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const now = new Date();
  const fromDate = new Date(now);
  fromDate.setDate(fromDate.getDate() - (days - 1));
  const prevTo = new Date(fromDate);
  prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setDate(prevFrom.getDate() - (days - 1));
  return {
    current: { from: localIsoDate(fromDate), to: localIsoDate(now) },
    previous: { from: localIsoDate(prevFrom), to: localIsoDate(prevTo) },
  };
}

function inWindow(value: string | null | undefined, window: DateWindow): boolean {
  if (!value) return false;
  const day = String(value).slice(0, 10);
  return day >= window.from && day <= window.to;
}

function windowCount<T>(rows: T[] | undefined, getDate: (row: T) => string | null | undefined, window: DateWindow): number {
  return (rows ?? []).filter((row) => inWindow(getDate(row), window)).length;
}

type AttendanceRange = AttendanceRangeShortcut;

const ATTENDANCE_RANGE_LABELS: Record<AttendanceRange, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
};

function localIsoDate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function attendanceRangeParams(range: AttendanceRange): { from: string; to: string } {
  return attendanceRangeForShortcut(range);
}

async function loadDashboardData(scope: ModuleDashboardScope, range: DashRange = "all"): Promise<DashboardData> {
  const windows = rangeWindows(range);
  const summaryParams = windows ? { createdFrom: windows.current.from, createdTo: windows.current.to } : undefined;
  const prevSummaryParams = windows ? { createdFrom: windows.previous.from, createdTo: windows.previous.to } : undefined;
  const [
    summary,
    prevSummary,
    funnel,
    domains,
    piSummary,
    candidates,
    positions,
    vendors,
    employees,
    evaluations,
    pms,
    itPending,
    itCompleted,
    assets,
    idCards,
    reimbursements,
    dinners,
    leaves,
    separations,
    attendance,
    bankVerification,
  ] = await Promise.all([
    shouldLoad(scope, ["talent", "lifecycle", "performance"]) ? optional(() => reportsApi.summary(summaryParams)) : undefined,
    shouldLoad(scope, ["talent", "lifecycle", "performance"]) && prevSummaryParams ? optional(() => reportsApi.summary(prevSummaryParams)) : undefined,
    shouldLoad(scope, ["talent"]) ? optional(() => reportsApi.funnel(summaryParams)) : undefined,
    shouldLoad(scope, ["talent"]) ? optional(() => reportsApi.domains()) : undefined,
    shouldLoad(scope, ["performance"]) ? optional(() => reportsApi.piSummary()) : undefined,
    shouldLoad(scope, ["talent", "lifecycle"]) ? optional(() => candidatesApi.list({ limit: 8, sortBy: "createdAt", sortDir: "desc" })) : undefined,
    shouldLoad(scope, ["talent"]) ? optional(() => positionsApi.list()) : undefined,
    shouldLoad(scope, ["talent"]) ? optional(() => vendorsApi.list()) : undefined,
    shouldLoad(scope, ["lifecycle"]) ? optional(() => employeesApi.list({ limit: 5000 })) : undefined,
    shouldLoad(scope, ["talent", "performance"]) ? optional(() => evaluationsApi.list()) : undefined,
    shouldLoad(scope, ["performance"]) ? optional(() => pmsApi.list()) : undefined,
    shouldLoad(scope, ["it-operations"]) ? optional(() => itRequestsApi.list({ status: "pending" })) : undefined,
    shouldLoad(scope, ["it-operations"]) ? optional(() => itRequestsApi.list({ status: "completed" })) : undefined,
    shouldLoad(scope, ["it-operations"]) ? optional(() => assetsApi.list()) : undefined,
    shouldLoad(scope, ["it-operations"]) ? optional(() => candidateIdCardApi.listQueue()) : undefined,
    shouldLoad(scope, ["finance"]) ? optional(() => reimbursementsApi.list()) : undefined,
    shouldLoad(scope, ["finance"]) ? optional(() => dinnerRequestsApi.list()) : undefined,
    shouldLoad(scope, ["lifecycle"]) ? optional(() => leaveApi.list()) : undefined,
    shouldLoad(scope, ["lifecycle"]) ? optional(() => separationApi.list()) : undefined,
    shouldLoad(scope, ["lifecycle"]) ? optional(() => attendanceApi.summary({ ...attendanceRangeParams("today"), mapped: true })) : undefined,
    shouldLoad(scope, ["finance"]) ? optional(() => bankVerificationApi.list()) : undefined,
  ]);

  const candidateResponse = candidates as { data?: CandidateRow[]; total?: number } | undefined;
  return {
    range,
    summary: summary as ReportSummary | undefined,
    prevSummary: prevSummary as ReportSummary | undefined,
    funnel: Array.isArray(funnel) ? (funnel as FunnelRow[]) : undefined,
    domains: Array.isArray(domains) ? (domains as DomainWiseReportRow[]) : undefined,
    piSummary: piSummary as PiSummaryReport | undefined,
    candidates: asArray<CandidateRow>(candidateResponse),
    candidateTotal: candidateResponse?.total,
    positions: asArray(positions),
    vendors: asArray(vendors),
    employees: asArray<EmployeeRow>(employees),
    evaluations: asArray<EvaluationRow>(evaluations),
    pms: asArray<GenericStatusRow>(pms),
    itPending: asArray<GenericStatusRow>(itPending),
    itCompleted: asArray<GenericStatusRow>(itCompleted),
    assets: asArray<GenericStatusRow>(assets),
    idCards: asArray<CandidateIdCardQueueItem>(idCards),
    reimbursements: asArray<GenericStatusRow>(reimbursements),
    dinners: asArray<GenericStatusRow>(dinners),
    leaves: asArray<GenericStatusRow>(leaves),
    separations: asArray<GenericStatusRow>(separations),
    attendance: attendance as AttendanceSummary | undefined,
    bankVerification: asArray<BankVerificationRow>(bankVerification),
  };
}

function buildModuleViews(data: DashboardData): ModuleView[] {
  const summary = data.summary;
  const openEvaluations = (data.evaluations ?? []).filter((row) => !(row.completedAt ?? row.completed_at)).length;
  const scheduledEvaluations = (data.evaluations ?? []).filter((row) => Boolean(row.interviewScheduledAt ?? row.interview_scheduled_at) && !(row.completedAt ?? row.completed_at)).length;
  const pmsIncomplete = (data.pms ?? []).filter((row) => !row.submittedAt).length;
  const activeAssets = (data.assets ?? []).filter((row) => row.status === "assigned").length;
  const pendingReimbursements = countByStatus(data.reimbursements, PENDING_REIMBURSEMENT_STATUSES);
  const pendingDinner = countByStatus(data.dinners, new Set(["pending_review"]));
  const activeSeparations = (data.separations ?? []).filter((row) => {
    const status = String(row.status ?? "");
    return ACTIVE_SEPARATION_STATUSES.has(status) || (!["completed", "revoked", "cancelled"].includes(status) && Boolean(status));
  }).length;
  const reimbursementAmount = (data.reimbursements ?? []).reduce((total, row) => total + Number(row.expenseAmount ?? 0), 0);
  const bankUnverified = (data.bankVerification ?? []).filter((row) => row.status !== "validated").length;
  const totalCandidates = summary?.totalCandidates ?? data.candidateTotal ?? 0;
  const joined = summary?.joined ?? 0;
  const conversion = percent(joined, totalCandidates);
  const activePositions = (data.positions ?? []).filter((row) => row.isActive !== false).length;
  const presentRate = percent(data.attendance?.present ?? 0, data.attendance?.total ?? 0);

  return [
    {
      scope: "talent",
      title: SCOPE_LABELS.talent,
      eyebrow: "Hiring pipeline",
      href: "/dashboard/module-overview/talent",
      icon: Briefcase,
      metrics: [
        { label: "Candidates", value: summary?.totalCandidates ?? data.candidateTotal ?? "—", detail: `${summary?.thisMonth ?? 0} added this month`, icon: Users, href: "/dashboard/candidates" },
        { label: "In Evaluation", value: summary?.pendingEvaluations ?? openEvaluations, detail: "Assigned or in progress", icon: ClipboardCheck, tone: "warning", href: "/dashboard/evaluations" },
        { label: "Joined", value: joined, detail: totalCandidates ? `${conversion}% overall conversion` : "Completed onboarding", icon: UserCheck, tone: "success", href: "/dashboard/candidates" },
        { label: "Open Positions", value: activePositions || (data.positions?.length ?? "—"), detail: `${data.vendors?.length ?? 0} sourcing partners`, icon: Briefcase, href: "/dashboard/config/positions" },
      ],
      work: [
        { label: "Resume Screening", value: countStages(summary, ["resume_screening_pending"]), href: "/dashboard/screening", detail: "Candidates waiting screening", icon: FileText, tone: "warning" },
        { label: "Evaluation Queue", value: summary?.pendingEvaluations ?? openEvaluations, href: "/dashboard/evaluations", detail: "Assigned or in-progress evaluations", icon: ClipboardCheck, tone: "warning" },
        { label: "Selection Forms", value: countStages(summary, ["selection_form_submitted"]), href: "/dashboard/selection-forms", detail: "Submitted for validation", icon: FileCheck, tone: "warning" },
        { label: "Contracts", value: countStages(summary, ["contract_sent"]), href: "/dashboard/contracts", detail: "Sent and awaiting signature", icon: FileCheck },
      ],
      links: [
        { label: "Candidates", href: "/dashboard/candidates", icon: Users },
        { label: "Resume Screening", href: "/dashboard/screening", icon: Search },
        { label: "Assessment Platform", href: "/dashboard/assessment-platform", icon: ClipboardCheck },
        { label: "Evaluations", href: "/dashboard/evaluations", icon: ClipboardCheck },
        { label: "Selection Forms", href: "/dashboard/selection-forms", icon: FileText },
        { label: "Contracts", href: "/dashboard/contracts", icon: FileCheck },
        { label: "Positions", href: "/dashboard/config/positions", icon: Briefcase },
        { label: "Vendors", href: "/dashboard/config/vendors", icon: Building2 },
      ],
    },
    {
      scope: "lifecycle",
      title: SCOPE_LABELS.lifecycle,
      eyebrow: "People operations",
      href: "/dashboard/module-overview/lifecycle",
      icon: UserCheck,
      metrics: [
        { label: "Employees", value: data.employees?.length ?? "—", detail: "Active directory view", icon: UserCheck, tone: "success", href: "/dashboard/employees" },
        { label: "Onboarded", value: summary?.joined ?? "—", detail: "Completed onboarding", icon: CheckCircle2, tone: "success", href: "/dashboard/employees" },
        { label: "Present Today", value: data.attendance?.present ?? "—", detail: data.attendance?.total ? `${presentRate}% of ${data.attendance.total} tracked` : `${data.attendance?.absent ?? 0} absent`, icon: Clock3, href: "/dashboard/attendance" },
        { label: "Leave Pending", value: countByStatus(data.leaves, new Set(["pending", "pending_manager", "pending_hr"])), detail: "Awaiting review", icon: CalendarDays, tone: "warning", href: "/dashboard/leave" },
      ],
      work: [
        { label: "Leave Approvals", value: countByStatus(data.leaves, new Set(["pending", "pending_manager", "pending_hr"])), href: "/dashboard/leave", detail: "Requests awaiting decision", icon: CalendarDays, tone: "warning" },
        { label: "Compliance Due", value: countStages(summary, ["statutory_forms_sent", "statutory_forms_submitted"]), href: "/dashboard/compliance", detail: "Statutory forms in progress", icon: Scale, tone: "warning" },
        { label: "Separation Active", value: activeSeparations, href: "/dashboard/separation", detail: "Open exit workflows", icon: AlertTriangle, tone: activeSeparations ? "danger" : "default" },
        { label: "Manager Mapping", value: data.employees?.filter((row) => !row.department).length ?? 0, href: "/dashboard/manager-mapping", detail: "Employees missing a department or manager", icon: Users },
      ],
      links: [
        { label: "Employees", href: "/dashboard/employees", icon: UserCheck },
        { label: "Attendance", href: "/dashboard/attendance", icon: Clock3 },
        { label: "Leave", href: "/dashboard/leave", icon: CalendarDays },
        { label: "Compliance", href: "/dashboard/compliance", icon: Scale },
        { label: "Skill Tags", href: "/dashboard/skills", icon: Tags },
        { label: "Manager Mapping", href: "/dashboard/manager-mapping", icon: UserCog },
        { label: "Separation", href: "/dashboard/separation", icon: UserMinus },
        { label: "Documents", href: "/dashboard/documents", icon: FileText },
      ],
    },
    {
      scope: "performance",
      title: SCOPE_LABELS.performance,
      eyebrow: "Evaluation and growth",
      href: "/dashboard/module-overview/performance",
      icon: Star,
      metrics: [
        { label: "PMS Records", value: data.pms?.length ?? "—", detail: "Performance entries", icon: Star, href: "/dashboard/hr/pms" },
        { label: "PMS Pending", value: pmsIncomplete, detail: "Draft or incomplete", icon: Clock3, tone: pmsIncomplete ? "warning" : "success", href: "/dashboard/hr/pms" },
        { label: "PI Open", value: openEvaluations, detail: "Incomplete interviews", icon: ClipboardCheck, tone: openEvaluations ? "warning" : "success", href: "/dashboard/evaluations" },
        { label: "PI Scheduled", value: scheduledEvaluations, detail: "Upcoming interview work", icon: CalendarDays, href: "/dashboard/evaluations" },
      ],
      work: [
        { label: "Evaluation Queue", value: summary?.pendingEvaluations ?? openEvaluations, href: "/dashboard/evaluations", detail: "Candidates in active evaluation", icon: ClipboardCheck, tone: "warning" },
        { label: "PMS Drafts", value: pmsIncomplete, href: "/dashboard/hr/pms", detail: "Reviews not yet submitted", icon: Star, tone: pmsIncomplete ? "warning" : "default" },
      ],
      links: [
        { label: "PMS Evaluation", href: "/dashboard/hr/pms", icon: Star },
        { label: "Evaluations", href: "/dashboard/evaluations", icon: ClipboardCheck },
      ],
    },
    {
      scope: "it-operations",
      title: SCOPE_LABELS["it-operations"],
      eyebrow: "IT service delivery",
      href: "/dashboard/module-overview/it-operations",
      icon: Laptop,
      metrics: [
        { label: "IT Requests", value: data.itPending?.length ?? "—", detail: "Pending onboarding requests", icon: Mail, tone: data.itPending?.length ? "warning" : "success", href: "/dashboard/it-requests" },
        { label: "Requests Completed", value: data.itCompleted?.length ?? 0, detail: "Closed onboarding requests", icon: CheckCircle2, tone: "success", href: "/dashboard/it-requests" },
        { label: "Assets Assigned", value: activeAssets, detail: `${data.assets?.length ?? 0} total assets`, icon: Laptop, tone: "success", href: "/dashboard/it/assets" },
        { label: "ID Cards Created", value: (data.idCards ?? []).filter((item) => item.status === "done").length, detail: `${(data.idCards ?? []).filter((item) => item.status !== "done").length} pending in queue`, icon: CreditCard, tone: "success", href: "/dashboard/it/id-cards" },
      ],
      work: [
        { label: "Email Creation", value: data.itPending?.length ?? 0, href: "/dashboard/it-requests", detail: "Pending onboarding requests", icon: CreditCard, tone: "warning" },
        { label: "ID Card Queue", value: (data.idCards ?? []).filter((item) => item.status !== "done").length, href: "/dashboard/it/id-cards", detail: "Cards awaiting creation", icon: CreditCard, tone: "warning" },
        { label: "Asset Inventory", value: data.assets?.length ?? 0, href: "/dashboard/it/assets", detail: "Devices tracked", icon: Laptop, informational: true },
      ],
      links: [
        { label: "IT Requests", href: "/dashboard/it-requests", icon: CreditCard },
        { label: "IT Assets", href: "/dashboard/it/assets", icon: Laptop },
        { label: "ID Cards", href: "/dashboard/it/id-cards", icon: CreditCard },
      ],
    },
    {
      scope: "finance",
      title: SCOPE_LABELS.finance,
      eyebrow: "Requests and spend",
      href: "/dashboard/module-overview/finance",
      icon: ReceiptText,
      metrics: [
        { label: "Reimbursements", value: data.reimbursements?.length ?? "—", detail: "Total requests", icon: ReceiptText, href: "/dashboard/reimbursements" },
        { label: "Pending Payment", value: pendingReimbursements, detail: "Needs review or payment", icon: Clock3, tone: pendingReimbursements ? "warning" : "success", href: "/dashboard/reimbursements" },
        { label: "Dinner Requests", value: data.dinners?.length ?? "—", detail: `${pendingDinner} pending review`, icon: UtensilsCrossed, href: "/dashboard/dinner-requests" },
        { label: "Claimed Amount", value: formatCurrency(reimbursementAmount), detail: "Across visible claims", icon: TrendingUp, href: "/dashboard/reimbursements" },
      ],
      work: [
        { label: "Reimbursement Review", value: pendingReimbursements, href: "/dashboard/reimbursements", detail: "Claims awaiting review or payment", icon: ReceiptText, tone: "warning" },
        { label: "Dinner Review", value: pendingDinner, href: "/dashboard/dinner-requests", detail: "Requests pending review", icon: UtensilsCrossed, tone: pendingDinner ? "warning" : "success" },
        { label: "Bank Verification", value: bankUnverified, href: "/dashboard/bank-verification", detail: "Accounts not yet penny-drop verified", icon: Landmark, tone: bankUnverified ? "warning" : "success" },
        { label: "Paid Claims", value: countByStatus(data.reimbursements, PAID_REIMBURSEMENT_STATUSES), href: "/dashboard/reimbursements", detail: "Payment completed", icon: CheckCircle2, tone: "success", informational: true },
      ],
      links: [
        { label: "Reimbursements", href: "/dashboard/reimbursements", icon: ReceiptText },
        { label: "Dinner Requests", href: "/dashboard/dinner-requests", icon: UtensilsCrossed },
        { label: "Bank Verification", href: "/dashboard/bank-verification", icon: Landmark },
      ],
    },
  ];
}

// ─── Shared building blocks ─────────────────────────────────────────────────

function Panel({ title, subtitle, action, icon: Icon, children, className }: {
  title: string;
  subtitle?: string;
  action?: { label: string; href: string };
  icon?: IconType;
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

type DonutSlice = { name: string; value: number; fill: string };

function DonutPanel({ title, subtitle, slices, centerLabel, action, footer, toolbar }: {
  title: string;
  subtitle?: string;
  slices: DonutSlice[];
  centerLabel: string;
  action?: { label: string; href: string };
  footer?: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const display = slices.filter((slice) => slice.value > 0);
  return (
    <Panel title={title} subtitle={subtitle} action={action}>
      {toolbar && <div className="-mt-1 mb-4">{toolbar}</div>}
      <div className="flex items-center gap-5">
        <div className="relative h-32 w-32 shrink-0">
          <PieChart width={128} height={128}>
            <Pie
              data={display.length > 0 ? display : [{ name: "None", value: 1, fill: "rgba(144,141,206,0.15)" }]}
              cx={59} cy={59} innerRadius={40} outerRadius={59}
              dataKey="value" strokeWidth={0}
            >
              {(display.length > 0 ? display : [{ name: "None", value: 1, fill: "rgba(144,141,206,0.15)" }]).map((slice, index) => (
                <Cell key={index} fill={slice.fill} />
              ))}
            </Pie>
            {display.length > 0 && <Tooltip {...CHART_TOOLTIP_STYLE} />}
          </PieChart>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("font-bold", total > 99999 ? "text-xs" : total > 9999 ? "text-sm" : total > 999 ? "text-base" : "text-xl")} style={{ color: "#C5CBE8" }}>
              {total.toLocaleString("en-IN")}
            </span>
            <span className="text-[9px]" style={{ color: "rgba(197,203,232,0.45)" }}>{centerLabel}</span>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          {display.map((slice) => (
            <div key={slice.name} className="flex items-center justify-between gap-2 text-xs">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.fill }} />
                <span className="truncate" style={{ color: "rgba(197,203,232,0.65)" }}>{slice.name}</span>
              </div>
              <span className="shrink-0 font-semibold" style={{ color: "#C5CBE8" }}>
                {slice.value} <span style={{ color: "rgba(197,203,232,0.40)" }}>({percent(slice.value, total)}%)</span>
              </span>
            </div>
          ))}
          {display.length === 0 && <p className="text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No data yet</p>}
        </div>
      </div>
      {footer}
    </Panel>
  );
}

type BarRow = { label: string; value: number; detail?: string; fill?: string; href?: string };

function HBarList({ rows, maxRows = 8 }: { rows: BarRow[]; maxRows?: number }) {
  const visible = rows.slice(0, maxRows);
  const max = Math.max(...visible.map((row) => row.value), 1);
  if (visible.length === 0) {
    return <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No data yet</p>;
  }
  return (
    <div className="space-y-2.5">
      {visible.map((row, index) => {
        const bar = (
          <>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate" style={{ color: "rgba(197,203,232,0.65)" }}>{row.label}</span>
              <span className="shrink-0 font-semibold" style={{ color: "#C5CBE8" }}>
                {row.value}{row.detail ? <span className="ml-1 font-normal" style={{ color: "rgba(197,203,232,0.40)" }}>{row.detail}</span> : null}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.max(3, (row.value / max) * 100)}%`, background: row.fill ?? CHART_COLORS[index % CHART_COLORS.length] }}
              />
            </div>
          </>
        );
        if (row.href) {
          return (
            <Link key={row.label} href={row.href} className="block space-y-1 rounded-lg px-1 py-0.5 transition-colors hover:bg-white/[0.04]">
              {bar}
            </Link>
          );
        }
        return (
          <div key={row.label} className="space-y-1">
            {bar}
          </div>
        );
      })}
    </div>
  );
}

// ─── Master dashboard ───────────────────────────────────────────────────────

function modulePendingCount(module: ModuleView) {
  return module.work.reduce((total, item) => total + (!item.informational && typeof item.value === "number" ? item.value : 0), 0);
}

function moduleHasDanger(module: ModuleView) {
  return module.work.some((item) => !item.informational && item.tone === "danger" && typeof item.value === "number" && item.value > 0);
}

// ─── Executive Command Center (master dashboard) ────────────────────────────
//
// The master dashboard ("all" scope) is redesigned as an Executive Decision
// Center: a health-first, insight-led read on the whole organisation. Every
// number below is derived from the same DashboardData the scoped views use —
// nothing here is mocked. Sections follow the executive hierarchy: health →
// KPIs → today → AI summary → performance → alerts → department health →
// health matrix → cross-department workflow → AI insights → deadlines →
// quick actions.

const SCOPE_OWNER: Record<Exclude<ModuleDashboardScope, "all">, string> = {
  talent: "Recruitment",
  lifecycle: "HR Operations",
  performance: "HR / Evaluators",
  "it-operations": "IT Operations",
  finance: "Finance",
};

type HealthBand = { label: string; tone: Tone; emoji: string; dot: string };

type CriticalAlert = {
  label: string;
  value: number;
  href: string;
  icon: IconType;
  tone: "danger" | "warning";
  severity: "High" | "Medium";
  department: string;
  owner: string;
};

type ExecMetrics = {
  score: number;
  band: HealthBand;
  components: Array<{ key: string; score: number | null; weight: number; detail: string; href: string }>;
  totalCandidates: number;
  joined: number;
  conversion: number;
  thisMonth: number;
  employees: number;
  presentToday: number;
  attendanceTracked: number;
  presentRate: number;
  pmsRate: number;
  financeRate: number;
  complianceScore: number;
  pendingItems: number;
  highPriority: number;
  pendingClaims: number;
  pendingClaimAmount: number;
  criticalIssues: number;
  trend?: { value: number; label: string };
  alerts: CriticalAlert[];
  highlights: string[];
  concerns: string[];
  recommendation: string;
};

function healthBand(score: number): HealthBand {
  if (score >= 80) return { label: "Healthy Organization", tone: "success", emoji: "🟢", dot: "#22c55e" };
  if (score >= 65) return { label: "Needs Attention", tone: "warning", emoji: "🟡", dot: "#eab308" };
  if (score >= 50) return { label: "Warning", tone: "warning", emoji: "🟠", dot: "#f59e0b" };
  return { label: "Critical", tone: "danger", emoji: "🔴", dot: "#ef4444" };
}

function actionableWorkItems(modules: ModuleView[]): Array<WorkItem & { value: number }> {
  const seen = new Set<string>();
  return modules.flatMap((module) =>
    module.work.filter((item): item is WorkItem & { value: number } => {
      if (item.informational || typeof item.value !== "number" || item.value <= 0) return false;
      const key = `${item.href}|${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

function buildCriticalAlerts(modules: ModuleView[], summary: ReportSummary | undefined): CriticalAlert[] {
  const alerts: CriticalAlert[] = [];
  const seen = new Set<string>();
  modules.forEach((module) => {
    actionableWorkItems([module]).forEach((item) => {
      const key = `${item.href}|${item.label}`;
      if (seen.has(key)) return;
      seen.add(key);
      const tone: "danger" | "warning" = item.tone === "danger" ? "danger" : "warning";
      alerts.push({
        label: item.label,
        value: item.value,
        href: item.href,
        icon: item.icon,
        tone,
        severity: tone === "danger" ? "High" : "Medium",
        department: SHORT_SCOPE_LABELS[module.scope],
        owner: SCOPE_OWNER[module.scope],
      });
    });
  });
  if ((summary?.activeEscalations ?? 0) > 0) {
    alerts.push({
      label: "Open Escalations",
      value: summary?.activeEscalations ?? 0,
      href: "/dashboard/escalations",
      icon: AlertTriangle,
      tone: "danger",
      severity: "High",
      department: "Talent",
      owner: "HR / TA",
    });
  }
  const rank: Record<"High" | "Medium", number> = { High: 0, Medium: 1 };
  return alerts.sort((a, b) => (rank[a.severity] - rank[b.severity]) || (b.value - a.value));
}

function deriveExecutiveMetrics(data: DashboardData, modules: ModuleView[]): ExecMetrics {
  const summary = data.summary;
  const totalCandidates = summary?.totalCandidates ?? data.candidateTotal ?? 0;
  const joined = summary?.joined ?? 0;
  const conversion = percent(joined, totalCandidates);
  const thisMonth = summary?.thisMonth ?? 0;

  const employees = data.employees?.length ?? 0;
  const presentToday = data.attendance?.present ?? 0;
  const attendanceTracked = data.attendance?.total ?? 0;
  const presentRate = percent(presentToday, attendanceTracked);

  const pms = data.pms ?? [];
  const pmsSubmitted = pms.filter((row) => row.submittedAt).length;
  const pmsRate = pms.length ? percent(pmsSubmitted, pms.length) : 0;

  const paidClaims = countByStatus(data.reimbursements, PAID_REIMBURSEMENT_STATUSES);
  const pendingClaims = countByStatus(data.reimbursements, PENDING_REIMBURSEMENT_STATUSES);
  const financeRate = paidClaims + pendingClaims > 0 ? percent(paidClaims, paidClaims + pendingClaims) : 100;
  const pendingClaimAmount = (data.reimbursements ?? []).reduce((total, row) => (
    PENDING_REIMBURSEMENT_STATUSES.has(String(row.status ?? "")) ? total + Number(row.expenseAmount ?? 0) : total
  ), 0);

  const bank = data.bankVerification ?? [];
  const bankValidated = bank.filter((row) => row.status === "validated").length;
  const bankVerifiedRate = bank.length ? percent(bankValidated, bank.length) : 100;
  const bankFailed = bank.filter((row) => row.status === "failed" || row.status === "missing_details").length;
  const escalations = summary?.activeEscalations ?? 0;
  const complianceScore = Math.max(0, bankVerifiedRate - escalations * 3);
  const criticalIssues = escalations + bankFailed;

  const pendingItems = actionableWorkItems(modules).reduce((total, item) => total + Number(item.value ?? 0), 0);
  const workforce = Math.max(employees, 1);
  const backlogScore = Math.max(10, Math.round(100 - Math.min(90, (pendingItems / workforce) * 45)));

  const attendanceScore = attendanceTracked > 0 ? presentRate : null;
  const hiringScore = totalCandidates > 0 ? Math.min(100, conversion) : null;
  const performanceScore = pms.length > 0 ? pmsRate : null;
  const alerts = buildCriticalAlerts(modules, summary);
  const components = [
    {
      key: "Attendance",
      score: attendanceScore,
      weight: 0.22,
      detail: attendanceTracked > 0 ? `${presentToday}/${attendanceTracked} present today` : "No attendance captured today",
      href: "/dashboard/module-overview/lifecycle",
    },
    {
      key: "Hiring",
      score: hiringScore,
      weight: 0.18,
      detail: totalCandidates > 0 ? `${joined}/${totalCandidates} candidates joined` : "No candidate pipeline data",
      href: "/dashboard/module-overview/talent",
    },
    {
      key: "Performance",
      score: performanceScore,
      weight: 0.15,
      detail: pms.length > 0 ? `${pmsSubmitted}/${pms.length} PMS records submitted` : "No PMS records found",
      href: "/dashboard/module-overview/performance",
    },
    {
      key: "Finance",
      score: financeRate,
      weight: 0.15,
      detail: paidClaims + pendingClaims > 0 ? `${paidClaims}/${paidClaims + pendingClaims} visible claims paid` : "No pending visible claims",
      href: "/dashboard/module-overview/finance",
    },
    {
      key: "Compliance",
      score: complianceScore,
      weight: 0.15,
      detail: bank.length > 0 ? `${bankValidated}/${bank.length} bank checks validated` : `${criticalIssues} critical issue${criticalIssues === 1 ? "" : "s"}`,
      href: "/dashboard/compliance",
    },
    {
      key: "Workload",
      score: backlogScore,
      weight: 0.15,
      detail: `${pendingItems} unique pending action${pendingItems === 1 ? "" : "s"}`,
      href: alerts[0]?.href ?? "/dashboard/module-overview",
    },
  ];
  const scoredComponents = components.filter((part): part is typeof components[number] & { score: number } => typeof part.score === "number");
  const weightTotal = scoredComponents.reduce((total, part) => total + part.weight, 0);
  const score = weightTotal > 0
    ? Math.round(scoredComponents.reduce((total, part) => total + part.score * part.weight, 0) / weightTotal)
    : 0;
  const band = healthBand(score);

  const highPriority = alerts.filter((alert) => alert.severity === "High").reduce((total, alert) => total + alert.value, 0);

  const funnel = data.funnel ?? [];
  const current = funnel[funnel.length - 1];
  const previous = funnel[funnel.length - 2];
  const trend = previous && previous.applied > 0 && current
    ? { value: Math.round(((current.applied - previous.applied) / previous.applied) * 100), label: "vs last month" }
    : undefined;

  const highlights: string[] = [];
  if (totalCandidates > 0 && conversion >= 40) highlights.push(`Hiring pipeline converting at ${conversion}%`);
  if (attendanceTracked > 0 && presentRate >= 75) highlights.push(`Attendance strong at ${presentRate}% today`);
  if (pms.length > 0 && pmsRate >= 90) highlights.push("Performance reviews on track");
  if (financeRate >= 70) highlights.push("Most reimbursements settled");
  if (backlogScore >= 70) highlights.push("Work queues under control");
  if (highlights.length === 0) highlights.push("Core operations running steadily");

  const concerns = alerts.slice(0, 3).map((alert) => `${alert.label} — ${alert.value} pending (${alert.owner})`);
  if (concerns.length === 0) concerns.push("No critical concerns right now");

  const recommendation = alerts.length
    ? `Prioritise ${alerts[0].label}${alerts[1] ? ` and ${alerts[1].label}` : ""} today.`
    : "All queues are clear — focus on strategic priorities this week.";

  return {
    score, band, components,
    totalCandidates, joined, conversion, thisMonth,
    employees, presentToday, attendanceTracked, presentRate,
    pmsRate, financeRate, complianceScore,
    pendingItems, highPriority, pendingClaims, pendingClaimAmount, criticalIssues,
    trend, alerts, highlights: highlights.slice(0, 3), concerns, recommendation,
  };
}

// ─── Performance series ──────────────────────────────────────────────────────

type PerfPoint = {
  month: string;
  Applications: number;
  Shortlisted: number;
  Joined: number;
  "Employee Growth": number;
  Attrition: number;
};

type PerfMetricKey = keyof Omit<PerfPoint, "month">;
type PerfRange = "month" | "week";

const PERF_METRICS: Array<{ key: PerfMetricKey; color: string }> = [
  { key: "Applications", color: "#ED00ED" },
  { key: "Shortlisted", color: "#908DCE" },
  { key: "Joined", color: "#38BDF8" },
  { key: "Employee Growth", color: "#22c55e" },
  { key: "Attrition", color: "#ef4444" },
];

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PERF_RANGE_LABELS: Record<PerfRange, string> = {
  month: "Monthly",
  week: "Weekly",
};
const SHORTLISTED_OR_LATER_STAGE_NAMES = new Set(
  PIPELINE_BUCKETS.slice(2).flatMap((bucket) => bucket.stages),
);

function compactDayLabel(value: Date): string {
  return `${value.getDate()} ${MONTH_SHORT[value.getMonth()]}`;
}

function weekSlots(now = new Date()): Array<{ key: string; label: string; from: string; to: string }> {
  return Array.from({ length: 6 }, (_, index) => {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() - (5 - index) * 7);
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 6);
    const from = localIsoDate(start);
    const to = localIsoDate(end);
    return {
      key: `${from}:${to}`,
      label: `${compactDayLabel(start)}-${compactDayLabel(end)}`,
      from,
      to,
    };
  });
}

function shortlistedFromSummary(summary: ReportSummary | undefined): number {
  return (summary?.stageBreakdown ?? []).reduce((total, row) => (
    SHORTLISTED_OR_LATER_STAGE_NAMES.has(row.currentStage) ? total + Number(row._count ?? 0) : total
  ), 0);
}

function buildPerfSeries(data: DashboardData): PerfPoint[] {
  const funnel = data.funnel ?? [];
  const now = new Date();
  const slots: Array<{ key: string; label: string }> = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    slots.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTH_SHORT[d.getMonth()] });
  }
  const growth = new Array(6).fill(0);
  const attrition = new Array(6).fill(0);
  const slotIndex = (iso?: string | null) => {
    if (!iso) return -1;
    return slots.findIndex((slot) => slot.key === String(iso).slice(0, 7));
  };
  (data.employees ?? []).forEach((row) => {
    const index = slotIndex(row.createdAt);
    if (index >= 0) growth[index] += 1;
  });
  (data.separations ?? []).forEach((row) => {
    const index = slotIndex(row.createdAt ?? row.updatedAt);
    if (index >= 0) attrition[index] += 1;
  });
  return slots.map((slot, index) => ({
    month: funnel[index]?.month ?? slot.label,
    Applications: funnel[index]?.applied ?? 0,
    Shortlisted: funnel[index]?.shortlisted ?? 0,
    Joined: funnel[index]?.joined ?? 0,
    "Employee Growth": growth[index],
    Attrition: attrition[index],
  }));
}

function buildWeeklyPerfSeries(
  data: DashboardData,
  rows: Array<{ from: string; to: string; label: string; summary?: ReportSummary }>,
): PerfPoint[] {
  return rows.map((row) => {
    const window = { from: row.from, to: row.to };
    return {
      month: row.label,
      Applications: row.summary?.totalCandidates ?? 0,
      Shortlisted: shortlistedFromSummary(row.summary),
      Joined: row.summary?.joined ?? 0,
      "Employee Growth": windowCount(data.employees, (employee) => employee.createdAt, window),
      Attrition: windowCount(data.separations, (separation) => separation.createdAt ?? separation.updatedAt, window),
    };
  });
}

// ─── Shared executive UI ─────────────────────────────────────────────────────

function Sparkline({ points, color }: { points: number[]; color: string }) {
  const data = points.length > 1 ? points : [...points, ...points, 0].slice(0, 2);
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const width = 100;
  const height = 28;
  const step = data.length > 1 ? width / (data.length - 1) : width;
  const coords = data.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M ${coords.join(" L ")}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;
  const gradientId = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-7 w-full">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type ExecKpi = {
  label: string;
  value: string;
  secondary: string;
  href?: string;
  icon: IconType;
  tone: Tone;
  dot: string;
  delta?: { value: number; label: string };
  spark: number[];
  sparkColor: string;
};

function ExecKpiCard({ kpi }: { kpi: ExecKpi }) {
  const Icon = kpi.icon;
  const deltaUp = (kpi.delta?.value ?? 0) >= 0;
  const content = (
    <>
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: kpi.dot }} />
            {kpi.label}
          </p>
          <p className="mt-1.5 break-words text-2xl font-bold leading-tight" style={{ color: "#C5CBE8" }}>{kpi.value}</p>
        </div>
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[kpi.tone])}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-1 truncate text-xs" style={{ color: "rgba(197,203,232,0.55)" }}>{kpi.secondary}</p>
      <div className="mt-2.5 flex items-end justify-between gap-2">
        {kpi.delta ? (
          <span className={cn("flex items-center gap-0.5 text-[11px] font-medium", deltaUp ? "text-emerald-400" : "text-red-400")}>
            {deltaUp ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(kpi.delta.value)}% {kpi.delta.label}
          </span>
        ) : <span className="text-[11px]" style={{ color: "rgba(197,203,232,0.35)" }}>Last 6 months</span>}
        <div className="h-7 w-20 shrink-0"><Sparkline points={kpi.spark} color={kpi.sparkColor} /></div>
      </div>
    </>
  );
  const className = cn(
    "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all",
    kpi.href && "hover:-translate-y-0.5 hover:border-primary/30",
  );
  if (!kpi.href) {
    return (
      <div title={`${kpi.label}: ${kpi.value} · ${kpi.secondary}`} className={className} style={CARD_STYLE}>
        {content}
      </div>
    );
  }
  return (
    <Link href={kpi.href} title={`${kpi.label}: ${kpi.value} · ${kpi.secondary}`} className={className} style={CARD_STYLE}>
      {content}
    </Link>
  );
}

// ─── 1. Executive health banner ──────────────────────────────────────────────

function ExecutiveHealthBanner({ metrics }: { metrics: ExecMetrics }) {
  const { band, score, trend, highlights, concerns, recommendation, alerts } = metrics;
  const trendUp = (trend?.value ?? 0) >= 0;
  return (
    <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={CARD_STYLE}>
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{ background: `radial-gradient(ellipse at 12% 0%, ${band.dot}22 0%, transparent 55%)` }}
      />
      <div className="relative grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.55)" }}>
            <span aria-hidden>{band.emoji}</span> Organization Health Score
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-5xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{score}</span>
            <span className="pb-1 text-lg font-medium" style={{ color: "rgba(197,203,232,0.40)" }}>/ 100</span>
          </div>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
            style={{ background: `${band.dot}1f`, color: band.dot }}>
            {band.label}
          </p>
          {trend && (
            <p className={cn("mt-3 flex items-center gap-1 text-xs font-medium", trendUp ? "text-emerald-400" : "text-red-400")}>
              {trendUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
              {Math.abs(trend.value)}% application momentum {trend.label}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {alerts[0] && (
              <Link href={alerts[0].href}>
                <Button size="sm" className="rounded-xl text-xs">Review Top Alert <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button>
              </Link>
            )}
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium",
              alerts.length ? "border-red-500/25 bg-red-500/10 text-red-300" : "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
            )}>
              {alerts.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {alerts.length ? `${alerts.length} critical alert${alerts.length === 1 ? "" : "s"}` : "No critical alerts"}
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="min-w-0 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Key Highlights
            </p>
            <ul className="space-y-1.5">
              {highlights.map((item) => (
                <li key={item} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}>
                  <span className="text-emerald-400">✓</span><span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 rounded-xl border border-amber-500/15 bg-amber-500/[0.06] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Needs Attention
            </p>
            <ul className="space-y-1.5">
              {concerns.map((item) => (
                <li key={item} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}>
                  <span className="text-amber-400">•</span><span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="min-w-0 rounded-xl border border-primary/20 bg-primary/[0.07] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-3.5 w-3.5" /> AI Recommendation
            </p>
            <p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.78)" }}>{recommendation}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 2. Executive KPI cards ──────────────────────────────────────────────────

function ExecutiveKpiCards({ data, metrics }: { data: DashboardData; metrics: ExecMetrics }) {
  const funnel = data.funnel ?? [];
  const appsSpark = funnel.map((row) => row.applied ?? 0);
  const joinsSpark = funnel.map((row) => row.joined ?? 0);
  const perf = buildPerfSeries(data);
  const growthSpark = perf.map((row) => row["Employee Growth"]);
  const kpis: ExecKpi[] = [
    {
      label: "Organization Health", value: `${metrics.score}/100`, secondary: metrics.band.label,
      icon: Gauge, tone: metrics.band.tone, dot: metrics.band.dot,
      spark: metrics.components.flatMap((c) => (typeof c.score === "number" ? [Math.round(c.score)] : [])), sparkColor: metrics.band.dot,
      delta: metrics.trend,
    },
    {
      label: "Hiring", value: `${metrics.totalCandidates} Candidates`,
      secondary: `${metrics.joined} joined · ${metrics.conversion}% conversion`,
      href: "/dashboard/module-overview/talent", icon: Briefcase, tone: "default", dot: "#ED00ED",
      spark: appsSpark, sparkColor: "#ED00ED",
    },
    {
      label: "Employees", value: `${metrics.employees} Active`,
      secondary: metrics.attendanceTracked ? `${metrics.presentToday} present today` : "Attendance syncing",
      href: "/dashboard/module-overview/lifecycle", icon: UserCheck, tone: "success", dot: "#22c55e",
      spark: growthSpark, sparkColor: "#22c55e",
    },
    {
      label: "Pending Tasks", value: `${metrics.pendingItems}`,
      secondary: `${metrics.highPriority} high priority`,
      href: metrics.alerts[0]?.href, icon: Clock3,
      tone: metrics.pendingItems > 0 ? "warning" : "success", dot: metrics.pendingItems > 0 ? "#f59e0b" : "#22c55e",
      spark: metrics.alerts.slice(0, 8).map((a) => a.value), sparkColor: "#f59e0b",
    },
    {
      label: "Finance", value: `${formatCurrency(metrics.pendingClaimAmount)}`,
      secondary: `${metrics.pendingClaims} claims pending`,
      href: "/dashboard/module-overview/finance", icon: ReceiptText,
      tone: metrics.pendingClaims > 0 ? "warning" : "success", dot: metrics.pendingClaims > 0 ? "#f59e0b" : "#22c55e",
      spark: joinsSpark, sparkColor: "#38BDF8",
    },
    {
      label: "Compliance", value: `${metrics.complianceScore}%`,
      secondary: metrics.criticalIssues ? `${metrics.criticalIssues} critical issue${metrics.criticalIssues === 1 ? "" : "s"}` : "No critical issues",
      href: "/dashboard/compliance", icon: ShieldCheck,
      tone: metrics.criticalIssues ? "danger" : "success", dot: metrics.criticalIssues ? "#ef4444" : "#22c55e",
      spark: metrics.components.flatMap((c) => (typeof c.score === "number" ? [Math.round(c.score)] : [])), sparkColor: metrics.criticalIssues ? "#ef4444" : "#22c55e",
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {kpis.map((kpi) => <ExecKpiCard key={kpi.label} kpi={kpi} />)}
    </div>
  );
}

// ─── 3. Today's highlights ───────────────────────────────────────────────────

function TodayHighlights({ data, metrics }: { data: DashboardData; metrics: ExecMetrics }) {
  const today = localIsoDate(new Date());
  const joinedToday = (data.employees ?? []).filter((row) => String(row.createdAt ?? "").slice(0, 10) === today).length;
  const interviewsScheduled = (data.evaluations ?? []).filter((row) => Boolean(row.interviewScheduledAt ?? row.interview_scheduled_at) && !(row.completedAt ?? row.completed_at)).length;
  const shortlisted = countStages(data.summary, ["resume_shortlisted"]);
  const idCardsPending = (data.idCards ?? []).filter((item) => item.status !== "done").length;
  const leavePending = countByStatus(data.leaves, new Set(["pending", "pending_manager", "pending_hr"]));

  const tiles: Array<{ label: string; value: string | number; icon: IconType; href: string; tone: Tone }> = [
    { label: "Joined Today", value: joinedToday, icon: UserCheck, href: "/dashboard/employees", tone: "success" },
    { label: "Interviews Scheduled", value: interviewsScheduled, icon: CalendarDays, href: "/dashboard/evaluations", tone: "default" },
    { label: "Shortlisted", value: shortlisted, icon: FileCheck, href: "/dashboard/screening", tone: "default" },
    { label: "Claims Pending", value: metrics.pendingClaims, icon: ReceiptText, href: "/dashboard/reimbursements", tone: metrics.pendingClaims ? "warning" : "success" },
    { label: "ID Cards Pending", value: idCardsPending, icon: CreditCard, href: "/dashboard/it/id-cards", tone: idCardsPending ? "warning" : "success" },
    { label: "Leave Pending", value: leavePending, icon: CalendarDays, href: "/dashboard/leave", tone: leavePending ? "warning" : "success" },
  ];

  return (
    <Panel title="Today's Highlights" subtitle="What moved across the organisation today">
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Link
              key={tile.label}
              href={tile.href}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30 hover:bg-white/[0.05]"
            >
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", TONE_CLASS[tile.tone])}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-lg font-bold leading-none" style={{ color: "#C5CBE8" }}>{tile.value}</p>
                <p className="mt-1 truncate text-[11px]" style={{ color: "rgba(197,203,232,0.50)" }}>{tile.label}</p>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5">
        <span className="flex items-center gap-2 text-xs" style={{ color: "rgba(197,203,232,0.65)" }}>
          <Clock3 className="h-4 w-4 text-primary" /> Attendance today
        </span>
        <span className="text-lg font-bold" style={{ color: metrics.presentRate >= 75 ? "#22c55e" : metrics.presentRate >= 50 ? "#f59e0b" : "#ef4444" }}>
          {metrics.attendanceTracked ? `${metrics.presentRate}%` : "—"}
        </span>
      </div>
    </Panel>
  );
}

// ─── 4. AI executive summary ─────────────────────────────────────────────────

function AiExecutiveSummary({ data, metrics }: { data: DashboardData; metrics: ExecMetrics }) {
  const funnel = data.funnel ?? [];
  const current = funnel[funnel.length - 1];
  const previous = funnel[funnel.length - 2];
  const deltaLine = (label: string, cur: number, prev: number) => {
    if (!prev) return `${label}: ${cur} recorded this month.`;
    const pct = Math.round(((cur - prev) / prev) * 100);
    const dir = pct >= 0 ? "up" : "down";
    return `${label} ${dir} ${Math.abs(pct)}% month-over-month (${prev} → ${cur}).`;
  };

  const lines: string[] = [];
  if (current && previous) {
    lines.push(deltaLine("Applications", current.applied ?? 0, previous.applied ?? 0));
    lines.push(deltaLine("Joins", current.joined ?? 0, previous.joined ?? 0));
  }
  if (metrics.attendanceTracked) lines.push(`Attendance is at ${metrics.presentRate}% with ${metrics.presentToday} of ${metrics.attendanceTracked} present today.`);
  if (metrics.pendingClaimAmount > 0) lines.push(`${formatCurrency(metrics.pendingClaimAmount)} across ${metrics.pendingClaims} reimbursement claims awaits settlement.`);
  if ((data.pms?.length ?? 0) > 0) {
    lines.push(metrics.pmsRate >= 90 ? "Performance reviews are largely complete." : `${metrics.pmsRate}% of performance reviews are submitted.`);
  } else {
    lines.push("No performance review records are available yet.");
  }
  if (lines.length === 0) lines.push("Not enough historical data yet to summarise trends.");

  return (
    <Panel title="AI Executive Summary" subtitle="Generated from live organisational data">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 space-y-2.5">
          {lines.slice(0, 5).map((line) => (
            <p key={line} className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.74)" }}>{line}</p>
          ))}
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-primary">Recommendation</p>
        <p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.78)" }}>{metrics.recommendation}</p>
      </div>
    </Panel>
  );
}

// ─── 5. Organization performance graph ───────────────────────────────────────

function OrgPerformanceGraph({ data }: { data: DashboardData }) {
  const [range, setRange] = useState<PerfRange>("month");
  const weeklySlots = useMemo(() => weekSlots(), []);
  const weeklyRangeEnd = weeklySlots[weeklySlots.length - 1]?.to;
  const { data: weeklySummaries, isFetching: isFetchingWeekly } = useQuery({
    queryKey: ["module-dashboard", "org-performance-weekly", weeklySlots[0]?.from, weeklyRangeEnd],
    queryFn: () => Promise.all(
      weeklySlots.map(async (slot) => ({
        ...slot,
        summary: await reportsApi.summary({ createdFrom: slot.from, createdTo: slot.to }) as ReportSummary,
      })),
    ),
    enabled: range === "week",
    staleTime: 60_000,
  });
  const series = range === "week"
    ? buildWeeklyPerfSeries(data, weeklySummaries ?? weeklySlots)
    : buildPerfSeries(data);
  const [enabled, setEnabled] = useState<Record<PerfMetricKey, boolean>>({
    Applications: true, Shortlisted: false, Joined: true, "Employee Growth": true, Attrition: false,
  });
  const active = PERF_METRICS.filter((metric) => enabled[metric.key]);
  const toggle = (key: PerfMetricKey) => setEnabled((prev) => ({ ...prev, [key]: !prev[key] }));
  const empty = series.every((row) => PERF_METRICS.every((metric) => row[metric.key] === 0));
  const rangeLabel = range === "week" ? "last 6 weeks" : "last 6 months";

  return (
    <Panel
      title="Organization Performance"
      subtitle={`Applications, joins, growth and attrition · ${rangeLabel}`}
    >
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {PERF_METRICS.map((metric) => (
            <button
              key={metric.key}
              onClick={() => toggle(metric.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                enabled[metric.key] ? "border-transparent text-[#0b0b14]" : "border-white/10 text-muted-foreground hover:border-primary/30"
              )}
              style={enabled[metric.key] ? { background: metric.color } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: enabled[metric.key] ? "#0b0b14" : metric.color }} />
              {metric.key}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 rounded-full border border-white/10 bg-white/[0.03] p-1">
          {(Object.keys(PERF_RANGE_LABELS) as PerfRange[]).map((option) => (
            <button
              key={option}
              onClick={() => setRange(option)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                range === option ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {PERF_RANGE_LABELS[option]}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={series} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <defs>
            {PERF_METRICS.map((metric) => (
              <linearGradient key={metric.key} id={`perf-${metric.key.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={metric.color} stopOpacity={0.28} />
                <stop offset="95%" stopColor={metric.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
          {active.map((metric) => (
            <Area
              key={metric.key}
              type="monotone"
              dataKey={metric.key}
              stroke={metric.color}
              strokeWidth={2}
              fill={`url(#perf-${metric.key.replace(/\s/g, "")})`}
              dot={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      {(empty || active.length === 0) && (
        <p className="mt-2 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>
          {active.length === 0 ? "Select at least one metric to plot." : `No activity recorded in the ${rangeLabel}.`}
        </p>
      )}
      {range === "week" && isFetchingWeekly && (
        <p className="mt-2 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Loading weekly graph...</p>
      )}
    </Panel>
  );
}

// ─── 6. Critical alerts ──────────────────────────────────────────────────────

function CriticalAlertsPanel({ alerts }: { alerts: CriticalAlert[] }) {
  return (
    <Panel title="Critical Alerts" subtitle="Sorted by urgency — resolve the top of the list first">
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>No critical alerts. Every queue is clear.</p>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {alerts.slice(0, 6).map((alert) => {
            const Icon = alert.icon;
            const high = alert.severity === "High";
            return (
              <div key={`${alert.href}-${alert.label}`} className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", high ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400")}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" style={{ color: "#C5CBE8" }}>{alert.label}</p>
                      <p className="text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{alert.department} · {alert.owner}</p>
                    </div>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", high ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300")}>
                    {alert.severity}
                  </span>
                </div>
                <div className="mt-3 flex items-end justify-between gap-2">
                  <div>
                    <p className="text-2xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{alert.value}</p>
                    <p className="mt-0.5 text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>pending</p>
                  </div>
                  <Link href={alert.href}>
                    <Button size="sm" variant="outline" className="rounded-lg text-xs">Resolve <ArrowRight className="ml-1 h-3 w-3" /></Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── 7. Department health overview ───────────────────────────────────────────

type DeptRow = { module: ModuleView; pending: number; completion: number | null; health: HealthBand; risk: string; riskTone: Tone };

function buildDeptRows(data: DashboardData, modules: ModuleView[], metrics: ExecMetrics): DeptRow[] {
  const completionByScope: Record<Exclude<ModuleDashboardScope, "all">, number | null> = {
    talent: metrics.totalCandidates > 0 ? metrics.conversion : null,
    lifecycle: metrics.attendanceTracked ? metrics.presentRate : null,
    performance: (data.pms?.length ?? 0) > 0 ? metrics.pmsRate : null,
    "it-operations": (() => {
      const done = data.itCompleted?.length ?? 0;
      const pend = data.itPending?.length ?? 0;
      return done + pend > 0 ? percent(done, done + pend) : null;
    })(),
    finance: metrics.financeRate,
  };
  return modules.map((module) => {
    const pending = modulePendingCount(module);
    const hasDanger = moduleHasDanger(module);
    const completion = completionByScope[module.scope];
    const health = hasDanger
      ? healthBand(40)
      : pending === 0
        ? healthBand(90)
        : healthBand(Math.max(50, 80 - Math.min(30, pending)));
    const risk = hasDanger ? "High" : pending >= 20 ? "Medium" : pending > 0 ? "Low" : "None";
    const riskTone: Tone = hasDanger ? "danger" : pending >= 20 ? "warning" : pending > 0 ? "default" : "success";
    return { module, pending, completion, health, risk, riskTone };
  });
}

function DepartmentHealthTable({ rows }: { rows: DeptRow[] }) {
  return (
    <Panel title="Department Health Overview" subtitle="Coverage, backlog and risk across every section">
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>
              <th className="px-2 py-2 font-medium">Department</th>
              <th className="px-2 py-2 font-medium">Health</th>
              <th className="px-2 py-2 text-right font-medium">Pending</th>
              <th className="px-2 py-2 font-medium">Completion</th>
              <th className="px-2 py-2 font-medium">Risk</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ module, pending, completion, health, risk, riskTone }) => (
              <tr key={module.scope} className="border-t border-white/[0.06] transition-colors hover:bg-white/[0.03]">
                <td className="px-2 py-3">
                  <Link href={module.href} className="flex min-w-0 items-center gap-2 font-medium hover:text-primary" style={{ color: "#C5CBE8" }}>
                    {module.title}
                  </Link>
                </td>
                <td className="px-2 py-3">
                  <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.65)" }}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: health.dot }} /> {health.emoji}
                  </span>
                </td>
                <td className="px-2 py-3 text-right font-semibold" style={{ color: pending > 0 ? "#f59e0b" : "#22c55e" }}>{pending}</td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-2">
                    {completion == null ? (
                      <span className="text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>No data</span>
                    ) : (
                      <>
                        <div className="h-1.5 w-20 shrink-0 rounded-full" style={{ background: "rgba(144,141,206,0.14)" }}>
                          <div className="h-full rounded-full" style={{ width: `${Math.max(3, completion)}%`, background: health.dot }} />
                        </div>
                        <span className="text-xs tabular-nums" style={{ color: "rgba(197,203,232,0.60)" }}>{completion}%</span>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-2 py-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[riskTone])}>{risk}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ─── 9. Cross-department workflow ────────────────────────────────────────────

type WorkflowStage = { label: string; total: number; pending: number; href: string };

function buildWorkflowStages(data: DashboardData): WorkflowStage[] {
  const summary = data.summary;
  const reach = cumulativeBucketCounts(summary);
  const idCards = data.idCards ?? [];
  const bank = data.bankVerification ?? [];
  return [
    { label: "Candidate", total: reach[0] ?? 0, pending: countStages(summary, ["new_application", "source_tagged", "resume_uploaded", "resume_screening_pending"]), href: "/dashboard/candidates" },
    { label: "Interview", total: reach[3] ?? 0, pending: summary?.pendingEvaluations ?? 0, href: "/dashboard/evaluations" },
    { label: "Offer", total: reach[4] ?? 0, pending: countStages(summary, ["selection_form_sent", "selection_form_submitted"]), href: "/dashboard/selection-forms" },
    { label: "Joined", total: summary?.joined ?? 0, pending: countStages(summary, ["contract_sent", "contract_signed"]), href: "/dashboard/contracts" },
    { label: "HR Approval", total: countStages(summary, ["statutory_forms_sent", "statutory_forms_submitted", "compliance_verified"]), pending: countStages(summary, ["statutory_forms_sent", "statutory_forms_submitted"]), href: "/dashboard/compliance" },
    { label: "IT Assets", total: data.assets?.length ?? 0, pending: data.itPending?.length ?? 0, href: "/dashboard/it-requests" },
    { label: "ID Card", total: idCards.length, pending: idCards.filter((item) => item.status !== "done").length, href: "/dashboard/it/id-cards" },
    { label: "Payroll", total: bank.length, pending: bank.filter((row) => row.status !== "validated").length, href: "/dashboard/bank-verification" },
    { label: "Completed", total: countStages(summary, ["onboarding_completed"]), pending: 0, href: "/dashboard/employees" },
  ];
}

function CrossDeptWorkflow({ data }: { data: DashboardData }) {
  const stages = buildWorkflowStages(data);
  const maxPending = Math.max(...stages.map((stage) => stage.pending), 0);
  return (
    <Panel title="Cross Department Workflow" subtitle="Employee journey from applicant to fully onboarded · bottleneck flagged">
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-stretch gap-1.5">
          {stages.map((stage, index) => {
            const bottleneck = stage.pending > 0 && stage.pending === maxPending;
            return (
              <div key={stage.label} className="flex items-center gap-1.5">
                <Link
                  href={stage.href}
                  className={cn(
                    "flex w-[116px] shrink-0 flex-col rounded-xl border p-3 transition-colors hover:border-primary/40",
                    bottleneck ? "border-red-500/40 bg-red-500/[0.06]" : "border-white/10 bg-white/[0.03]"
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-medium" style={{ color: "rgba(197,203,232,0.60)" }}>{stage.label}</span>
                    {bottleneck && <Zap className="h-3 w-3 shrink-0 text-red-400" />}
                  </div>
                  <span className="mt-1.5 text-xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{stage.total}</span>
                  <span className={cn("mt-1 text-[11px] font-medium", stage.pending > 0 ? "text-amber-400" : "text-emerald-400")}>
                    {stage.pending > 0 ? `${stage.pending} pending` : "clear"}
                  </span>
                </Link>
                {index < stages.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

// ─── 11. Upcoming deadlines ──────────────────────────────────────────────────

function UpcomingDeadlines({ data }: { data: DashboardData }) {
  const interviews = (data.evaluations ?? []).filter((row) => Boolean(row.interviewScheduledAt ?? row.interview_scheduled_at) && !(row.completedAt ?? row.completed_at)).length;
  const pmsReviews = (data.pms ?? []).filter((row) => !row.submittedAt).length;
  const claims = countByStatus(data.reimbursements, PENDING_REIMBURSEMENT_STATUSES);
  const exitClearances = (data.separations ?? []).filter((row) => {
    const status = String(row.status ?? "");
    return ACTIVE_SEPARATION_STATUSES.has(status) || (!["completed", "revoked", "cancelled"].includes(status) && Boolean(status));
  }).length;
  const leave = countByStatus(data.leaves, new Set(["pending", "pending_manager", "pending_hr"]));

  const items: Array<{ label: string; value: number; href: string; icon: IconType }> = [
    { label: "Interviews to conduct", value: interviews, href: "/dashboard/evaluations", icon: CalendarDays },
    { label: "PMS reviews to close", value: pmsReviews, href: "/dashboard/hr/pms", icon: Star },
    { label: "Claims to approve", value: claims, href: "/dashboard/reimbursements", icon: ReceiptText },
    { label: "Exit clearances", value: exitClearances, href: "/dashboard/separation", icon: UserMinus },
    { label: "Leave to approve", value: leave, href: "/dashboard/leave", icon: CalendarDays },
  ].filter((item) => item.value > 0);

  return (
    <Panel title="Upcoming Deadlines" subtitle="Work with a clock on it">
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Nothing time-sensitive is queued.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.label} href={item.href} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold leading-none" style={{ color: "#C5CBE8" }}>{item.value}</p>
                  <p className="mt-1 truncate text-[11px]" style={{ color: "rgba(197,203,232,0.50)" }}>{item.label}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── 12. Quick actions ───────────────────────────────────────────────────────

function QuickActions() {
  const actions: Array<{ label: string; href: string; icon: IconType }> = [
    { label: "Add Candidate", href: "/dashboard/candidates", icon: Users },
    { label: "Start Onboarding", href: "/dashboard/selection-forms", icon: FileCheck },
    { label: "Approve Claim", href: "/dashboard/reimbursements", icon: ReceiptText },
    { label: "Assign Asset", href: "/dashboard/it/assets", icon: Laptop },
    { label: "Review PMS", href: "/dashboard/hr/pms", icon: Star },
    { label: "Create Employee", href: "/dashboard/employees", icon: UserCheck },
    { label: "Review Escalations", href: "/dashboard/escalations", icon: AlertTriangle },
    { label: "AI Insights", href: "/dashboard/employee-evaluation", icon: Sparkles },
  ];
  return (
    <Panel title="Quick Actions" subtitle="Jump straight into the most common tasks">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.label} href={action.href}>
              <Button variant="outline" className="h-11 w-full justify-start rounded-xl text-xs">
                <Icon className="mr-2 h-4 w-4 text-primary" /> {action.label}
              </Button>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── Master view ─────────────────────────────────────────────────────────────

function MasterView({ data, modules }: { data: DashboardData; modules: ModuleView[] }) {
  const metrics = deriveExecutiveMetrics(data, modules);
  const deptRows = buildDeptRows(data, modules, metrics);
  return (
    <>
      <ExecutiveHealthBanner metrics={metrics} />
      <ExecutiveKpiCards data={data} metrics={metrics} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <TodayHighlights data={data} metrics={metrics} />
        <AiExecutiveSummary data={data} metrics={metrics} />
      </div>
      <OrgPerformanceGraph data={data} />
      <CriticalAlertsPanel alerts={metrics.alerts} />
      <DepartmentHealthTable rows={deptRows} />
      <CrossDeptWorkflow data={data} />
      <UpcomingDeadlines data={data} />
      <QuickActions />
    </>
  );
}

// ─── Talent dashboard ───────────────────────────────────────────────────────

// ─── Talent dashboard · Recruitment Command Center ──────────────────────────
//
// Recruiter/TA-facing view of the whole hiring lifecycle. Every value is
// derived from the talent-scoped DashboardData (summary, funnel, domains,
// positions, candidates, evaluations) — nothing is mocked. Metrics with no
// backing data in this system (per-candidate stage timestamps → time-to-hire,
// cost-per-hire, recruiter-per-candidate) are intentionally omitted in favour
// of real efficiency signals (days-open aging, stage conversion, acceptance).

type PositionRow = {
  id?: string;
  title?: string;
  department?: string;
  location?: string | null;
  experienceLevel?: string | null;
  openings?: number;
  urgencyLevel?: number | null;
  isActive?: boolean;
  candidateCount?: number | null;
  createdAt?: string | null;
  postedAt?: string | null;
};

const TALENT_FUNNEL: Array<{ label: string; bucket: number }> = [
  { label: "Applied", bucket: 0 },
  { label: "Screening", bucket: 1 },
  { label: "Shortlisted", bucket: 2 },
  { label: "Interview", bucket: 3 },
  { label: "Offer & Forms", bucket: 4 },
  { label: "Contract", bucket: 5 },
  { label: "Onboarding", bucket: 6 },
  { label: "Joined", bucket: 7 },
];

type TalentMetrics = {
  total: number;
  joined: number;
  conversion: number;
  applied: number;
  rejected: number;
  inPipeline: number;
  activePositions: number;
  totalOpenings: number;
  inInterview: number;
  offersReleased: number;
  screening: number;
  shortlisted: number;
  reach: number[];
  score: number;
  band: HealthBand;
  trend?: { value: number; label: string };
  interviewPass: number;
  offerAcceptance: number;
  dropOff: number;
  screenPass: number;
  alerts: number;
  highlights: string[];
  recommendation: string;
};

function deriveTalentMetrics(data: DashboardData): TalentMetrics {
  const summary = data.summary;
  const total = summary?.totalCandidates ?? data.candidateTotal ?? 0;
  const joined = summary?.joined ?? 0;
  const conversion = percent(joined, total);
  const reach = cumulativeBucketCounts(summary);
  const applied = reach[0] ?? 0;
  const rejected = countStages(summary, REJECTED_STAGES);
  const inPipeline = Math.max(0, total - joined - rejected);
  const positions = (data.positions ?? []) as PositionRow[];
  const activePositions = positions.filter((p) => p.isActive !== false).length;
  const totalOpenings = positions.reduce((t, p) => t + Number(p.openings ?? 0), 0);
  const inInterview = countStages(summary, ["evaluation_assigned", "evaluation_in_progress"]);
  const offersReleased = countStages(summary, ["evaluation_passed", "selection_form_sent", "selection_form_submitted", "selection_form_validated", "contract_sent", "contract_signed"]);
  const screening = countStages(summary, ["resume_screening_pending"]);
  const shortlisted = countStages(summary, ["resume_shortlisted"]);

  const screenPass = percent(reach[2] ?? 0, reach[1] ?? 0);
  const interviewPass = percent(reach[4] ?? 0, reach[3] ?? 0);
  const offerAcceptance = percent(reach[7] ?? 0, reach[4] ?? 0);
  const dropOff = percent(rejected, applied);

  const backlogScore = Math.max(10, 100 - Math.min(90, Math.round((screening / Math.max(applied, 1)) * 120)));
  const flowScore = percent(reach[3] ?? 0, applied);
  const escalations = summary?.activeEscalations ?? 0;
  const score = Math.max(0, Math.min(100, Math.round(0.4 * Math.min(100, conversion) + 0.3 * flowScore + 0.3 * backlogScore - escalations * 4)));
  const band = healthBand(score);

  const funnel = data.funnel ?? [];
  const cur = funnel[funnel.length - 1];
  const prev = funnel[funnel.length - 2];
  const trend = prev && prev.applied > 0 && cur ? { value: Math.round(((cur.applied - prev.applied) / prev.applied) * 100), label: "vs last month" } : undefined;

  const highlights: string[] = [];
  if (total > 0) highlights.push(`${conversion}% hiring conversion (${joined}/${total}).`);
  if (trend) highlights.push(`Applications ${trend.value >= 0 ? "up" : "down"} ${Math.abs(trend.value)}% ${trend.label}.`);
  if (screening > 0) highlights.push(`Resume screening backlog at ${screening}.`);
  if (interviewPass) highlights.push(`Interview-to-offer rate ${interviewPass}%.`);
  if (highlights.length === 0) highlights.push("Pipeline is quiet — no active hiring signals yet.");

  const topBacklog = screening >= inInterview ? "Resume Screening" : "Interview scheduling";
  const recommendation = escalations > 0
    ? `Clear ${escalations} hiring escalation${escalations === 1 ? "" : "s"} and prioritise ${topBacklog}.`
    : screening + inInterview > 0
      ? `Prioritise ${topBacklog} to keep the pipeline moving.`
      : "Pipeline is flowing — focus on sourcing for open roles.";

  return {
    total, joined, conversion, applied, rejected, inPipeline,
    activePositions, totalOpenings, inInterview, offersReleased, screening, shortlisted,
    reach, score, band, trend, interviewPass, offerAcceptance, dropOff, screenPass,
    alerts: escalations, highlights: highlights.slice(0, 4), recommendation,
  };
}

// ─── 1. Recruitment health banner ────────────────────────────────────────────

function RecruitmentHealthBanner({ m }: { m: TalentMetrics }) {
  const stats = [
    { label: "Active Positions", value: m.activePositions, sub: `${m.totalOpenings} openings` },
    { label: "Conversion", value: `${m.conversion}%`, sub: `${m.joined} joined` },
    { label: "Interview → Offer", value: `${m.interviewPass}%`, sub: "pass rate" },
    { label: "Drop-off", value: `${m.dropOff}%`, sub: `${m.rejected} rejected` },
  ];
  return (
    <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={CARD_STYLE}>
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(ellipse at 12% 0%, ${m.band.dot}22 0%, transparent 55%)` }} />
      <div className="relative grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.55)" }}>
            <span aria-hidden>{m.band.emoji}</span> Hiring Health Score
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-5xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{m.score}</span>
            <span className="pb-1 text-lg font-medium" style={{ color: "rgba(197,203,232,0.4)" }}>/ 100</span>
          </div>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${m.band.dot}1f`, color: m.band.dot }}>{m.band.label}</p>
          {m.trend && (
            <p className={cn("mt-3 flex items-center gap-1 text-xs font-medium", m.trend.value >= 0 ? "text-emerald-400" : "text-red-400")}>
              {m.trend.value >= 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />} {Math.abs(m.trend.value)}% application momentum {m.trend.label}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/dashboard/candidates"><Button size="sm" className="rounded-xl text-xs">Open pipeline <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></Link>
            {m.alerts > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300">
                <AlertTriangle className="h-3.5 w-3.5" /> {m.alerts} hiring alert{m.alerts === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="truncate text-[10px] uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.45)" }}>{s.label}</p>
                <p className="mt-1 text-xl font-bold" style={{ color: "#C5CBE8" }}>{s.value}</p>
                <p className="truncate text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{s.sub}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" /> AI Hiring Summary</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {m.highlights.map((h) => (
                <li key={h} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}><span className="text-primary">•</span><span className="min-w-0">{h}</span></li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-white/10 pt-2.5 text-xs" style={{ color: "rgba(197,203,232,0.78)" }}>
              <span className="font-semibold text-primary">Recommendation:</span> {m.recommendation}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 2. Recruitment KPI cards ────────────────────────────────────────────────

function RecruitmentKpis({ data, m }: { data: DashboardData; m: TalentMetrics }) {
  const funnel = data.funnel ?? [];
  const apps = funnel.map((r) => r.applied ?? 0);
  const joins = funnel.map((r) => r.joined ?? 0);
  const shorts = funnel.map((r) => r.shortlisted ?? 0);
  const kpis: Array<{ label: string; value: string | number; secondary: string; href: string; icon: IconType; tone: Tone; dot: string; spark: number[]; color: string; delta?: { value: number; label: string } }> = [
    { label: "Active Candidates", value: m.inPipeline, secondary: `${m.total} total · ${m.rejected} rejected`, href: "/dashboard/candidates", icon: Users, tone: "default", dot: "#ED00ED", spark: apps, color: "#ED00ED", delta: m.trend },
    { label: "Open Positions", value: m.activePositions, secondary: `${m.totalOpenings} openings`, href: "/dashboard/config/positions", icon: Briefcase, tone: "default", dot: "#908DCE", spark: shorts, color: "#908DCE" },
    { label: "In Interview", value: m.inInterview, secondary: `${m.reach[3] ?? 0} reached interview`, href: "/dashboard/evaluations", icon: ClipboardCheck, tone: m.inInterview ? "warning" : "success", dot: m.inInterview ? "#f59e0b" : "#22c55e", spark: shorts, color: "#38BDF8" },
    { label: "Offers Released", value: m.offersReleased, secondary: `${m.offerAcceptance}% acceptance`, href: "/dashboard/selection-forms", icon: FileCheck, tone: "default", dot: "#38BDF8", spark: joins, color: "#38BDF8" },
    { label: "Joined", value: m.joined, secondary: `${m.conversion}% conversion`, href: "/dashboard/employees", icon: UserCheck, tone: "success", dot: "#22c55e", spark: joins, color: "#22c55e" },
    { label: "Conversion Rate", value: `${m.conversion}%`, secondary: `${m.joined} of ${m.total}`, href: "/dashboard/candidates", icon: Percent, tone: m.conversion >= 40 ? "success" : "warning", dot: m.conversion >= 40 ? "#22c55e" : "#f59e0b", spark: apps, color: "#22c55e" },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {kpis.map((k) => {
        const Icon = k.icon;
        const up = (k.delta?.value ?? 0) >= 0;
        return (
          <Link key={k.label} href={k.href} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30" style={CARD_STYLE}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: k.dot }} />{k.label}
                </p>
                <p className="mt-1.5 text-2xl font-bold leading-tight" style={{ color: "#C5CBE8" }}>{k.value}</p>
              </div>
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[k.tone])}><Icon className="h-4 w-4" /></div>
            </div>
            <p className="mt-1 truncate text-xs" style={{ color: "rgba(197,203,232,0.55)" }}>{k.secondary}</p>
            <div className="mt-2.5 flex items-end justify-between gap-2">
              {k.delta ? (
                <span className={cn("flex items-center gap-0.5 text-[11px] font-medium", up ? "text-emerald-400" : "text-red-400")}>
                  {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(k.delta.value)}% {k.delta.label}
                </span>
              ) : <span className="text-[11px]" style={{ color: "rgba(197,203,232,0.35)" }}>Last 6 months</span>}
              <div className="h-7 w-20 shrink-0"><Sparkline points={k.spark} color={k.color} /></div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── 3. Hiring funnel overview ────────────────────────────────────────────────

function HiringFunnelOverview({ m }: { m: TalentMetrics }) {
  const rows = TALENT_FUNNEL.map((stage, i) => {
    const value = m.reach[stage.bucket] ?? 0;
    const prev = i === 0 ? value : (m.reach[TALENT_FUNNEL[i - 1].bucket] ?? 0);
    const drop = prev > 0 ? Math.round(((prev - value) / prev) * 100) : 0;
    return { label: stage.label, value, conversion: percent(value, m.applied), drop };
  });
  const maxDrop = Math.max(...rows.slice(1).map((r) => r.drop), 0);
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Panel title="Hiring Funnel Overview" subtitle="Cumulative reach, conversion, and drop-off · bottleneck flagged" action={{ label: "View candidates", href: "/dashboard/candidates" }}>
      <div className="space-y-2.5">
        {rows.map((r, i) => {
          const bottleneck = i > 0 && r.drop > 0 && r.drop === maxDrop;
          return (
            <Link key={r.label} href="/dashboard/candidates" className="block space-y-1 rounded-lg px-1 py-1 transition-colors hover:bg-white/[0.04]">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5" style={{ color: "rgba(197,203,232,0.65)" }}>
                  {r.label}{bottleneck && <span className="inline-flex items-center gap-0.5 rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-red-300"><Zap className="h-2.5 w-2.5" /> bottleneck</span>}
                </span>
                <span className="shrink-0 font-semibold" style={{ color: "#C5CBE8" }}>
                  {r.value} <span style={{ color: "rgba(197,203,232,0.4)" }}>({r.conversion}%{i > 0 && r.drop > 0 ? ` · −${r.drop}%` : ""})</span>
                </span>
              </div>
              <div className="h-2 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: bottleneck ? "#ef4444" : CHART_COLORS[i % CHART_COLORS.length] }} />
              </div>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── 4. Hiring performance graph ──────────────────────────────────────────────

function TalentPerformanceGraph({ data }: { data: DashboardData }) {
  const series = (data.funnel ?? []).map((r) => ({ month: r.month, Applications: r.applied ?? 0, Shortlisted: r.shortlisted ?? 0, Joined: r.joined ?? 0 }));
  const metrics: Array<{ key: "Applications" | "Shortlisted" | "Joined"; color: string }> = [
    { key: "Applications", color: "#ED00ED" }, { key: "Shortlisted", color: "#908DCE" }, { key: "Joined", color: "#38BDF8" },
  ];
  const [on, setOn] = useState<Record<string, boolean>>({ Applications: true, Shortlisted: true, Joined: true });
  const active = metrics.filter((x) => on[x.key]);
  const empty = series.every((r) => r.Applications === 0 && r.Shortlisted === 0 && r.Joined === 0);
  return (
    <Panel title="Hiring Performance" subtitle="Applications, shortlists, and joins · last 6 months">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {metrics.map((x) => (
          <button key={x.key} onClick={() => setOn((p) => ({ ...p, [x.key]: !p[x.key] }))}
            className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors", on[x.key] ? "border-transparent text-[#0b0b14]" : "border-white/10 text-muted-foreground hover:border-primary/30")}
            style={on[x.key] ? { background: x.color } : undefined}>
            <span className="h-2 w-2 rounded-full" style={{ background: on[x.key] ? "#0b0b14" : x.color }} />{x.key}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={series} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <defs>
            {metrics.map((x) => (
              <linearGradient key={x.key} id={`tp-${x.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={x.color} stopOpacity={0.28} /><stop offset="95%" stopColor={x.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip {...CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
          {active.map((x) => <Area key={x.key} type="monotone" dataKey={x.key} stroke={x.color} strokeWidth={2} fill={`url(#tp-${x.key})`} dot={false} />)}
        </AreaChart>
      </ResponsiveContainer>
      {(empty || active.length === 0) && (
        <p className="mt-2 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>{active.length === 0 ? "Select at least one metric." : "No hiring activity in the last six months."}</p>
      )}
    </Panel>
  );
}

// ─── 5. Open positions dashboard ──────────────────────────────────────────────

function OpenPositionsTable({ data, nowMs }: { data: DashboardData; nowMs: number | null }) {
  const positions = ((data.positions ?? []) as PositionRow[])
    .filter((p) => p.isActive !== false)
    .map((p) => {
      const opened = p.createdAt ?? p.postedAt;
      const days = nowMs && opened ? Math.max(0, Math.floor((nowMs - new Date(opened).getTime()) / 86_400_000)) : null;
      return { ...p, days };
    })
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
    .slice(0, 8);
  return (
    <Panel title="Open Positions" subtitle="Active roles by time open · aging roles flagged" icon={Briefcase} action={{ label: "All positions", href: "/dashboard/config/positions" }}>
      {positions.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No active positions.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[440px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 text-right font-medium">Openings</th>
                <th className="px-2 py-2 text-right font-medium">Candidates</th>
                <th className="px-2 py-2 text-right font-medium">Days Open</th>
                <th className="px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const aging = (p.days ?? 0) > 30;
                return (
                  <tr key={p.id ?? p.title} className="border-t border-white/[0.06] transition-colors hover:bg-white/[0.03]">
                    <td className="px-2 py-2.5">
                      <Link href="/dashboard/config/positions" className="min-w-0 font-medium hover:text-primary" style={{ color: "#C5CBE8" }}>{p.title ?? "Untitled"}</Link>
                      <p className="truncate text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{p.department ?? "—"}{p.location ? ` · ${p.location}` : ""}</p>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: "rgba(197,203,232,0.7)" }}>{p.openings ?? 0}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums" style={{ color: "rgba(197,203,232,0.7)" }}>{p.candidateCount ?? 0}</td>
                    <td className={cn("px-2 py-2.5 text-right font-semibold tabular-nums", aging ? "text-amber-400" : "")} style={aging ? undefined : { color: "#C5CBE8" }}>{p.days ?? "—"}</td>
                    <td className="px-2 py-2.5">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", aging ? "bg-amber-500/15 text-amber-300" : "bg-emerald-500/15 text-emerald-400")}>{aging ? "Aging" : "On track"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ─── 6. Recruitment bottlenecks ───────────────────────────────────────────────

function RecruitmentBottlenecks({ data, m }: { data: DashboardData; m: TalentMetrics }) {
  const queues = ([
    { label: "Resume Screening", count: m.screening, priority: "High", href: "/dashboard/screening" },
    { label: "Interview Scheduling", count: m.inInterview, priority: "High", href: "/dashboard/evaluations" },
    { label: "Selection Forms", count: countStages(data.summary, ["selection_form_submitted"]), priority: "Medium", href: "/dashboard/selection-forms" },
    { label: "Contract Signing", count: countStages(data.summary, ["contract_sent"]), priority: "Medium", href: "/dashboard/contracts" },
    { label: "Onboarding", count: countStages(data.summary, ["induction_completed", "statutory_forms_sent", "statutory_forms_submitted"]), priority: "Low", href: "/dashboard/compliance" },
    { label: "Escalations", count: m.alerts, priority: "High", href: "/dashboard/escalations" },
  ] as Array<{ label: string; count: number; priority: "High" | "Medium" | "Low"; href: string }>).filter((q) => q.count > 0).sort((a, b) => {
    const rank = { High: 0, Medium: 1, Low: 2 };
    return rank[a.priority] - rank[b.priority] || b.count - a.count;
  });
  const cls: Record<"High" | "Medium" | "Low", string> = { High: "bg-red-500/15 text-red-300", Medium: "bg-amber-500/15 text-amber-300", Low: "bg-sky-500/15 text-sky-300" };
  return (
    <Panel title="Recruitment Bottlenecks" subtitle="Operational queues, most urgent first" icon={AlertTriangle} action={{ label: "Candidates", href: "/dashboard/candidates" }}>
      {queues.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>No bottlenecks — pipeline is flowing.</p></div>
      ) : (
        <div className="space-y-2">
          {queues.map((q) => (
            <Link key={q.label} href={q.href} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition-colors hover:border-primary/30">
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", cls[q.priority])}>{q.priority}</span>
              <p className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{q.label}</p>
              <span className="shrink-0 text-base font-semibold text-primary">{q.count}</span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── 7. Candidate source analytics ────────────────────────────────────────────

function SourceAnalytics({ data }: { data: DashboardData }) {
  const rows = (data.summary?.sourceBreakdown ?? [])
    .map((s) => ({ name: formatLabel(String(s.sourceType ?? "")), count: Number(s._count ?? 0), joined: Number(s.joined ?? 0) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <Panel title="Candidate Source Analytics" subtitle="Volume and join rate per source" icon={BarChart3} action={{ label: "Candidates", href: "/dashboard/candidates" }}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No source data yet.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div key={r.name} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate" style={{ color: "rgba(197,203,232,0.65)" }}>{r.name}</span>
                <span className="shrink-0 font-semibold" style={{ color: "#C5CBE8" }}>
                  {r.count}{r.joined > 0 && <span className="ml-1 font-normal text-emerald-400">· {percent(r.joined, r.count)}% joined</span>}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
                <div className="h-full rounded-full" style={{ width: `${Math.max(3, (r.count / max) * 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── 8 & candidate quality ────────────────────────────────────────────────────

function CandidateQuality({ m }: { m: TalentMetrics }) {
  const bars = [
    { label: "Screening → Shortlist", value: m.screenPass },
    { label: "Interview → Offer", value: m.interviewPass },
    { label: "Offer Acceptance", value: m.offerAcceptance },
    { label: "Overall Conversion", value: m.conversion },
    { label: "Drop-off Rate", value: m.dropOff, danger: true },
  ];
  const color = (v: number, danger?: boolean) => danger ? (v >= 40 ? "#ef4444" : v >= 20 ? "#f59e0b" : "#22c55e") : (v >= 60 ? "#22c55e" : v >= 35 ? "#f59e0b" : "#ef4444");
  return (
    <Panel title="Candidate Quality Metrics" subtitle="Stage pass rates and acceptance" icon={Percent}>
      <div className="space-y-3.5">
        {bars.map((b) => (
          <div key={b.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: "rgba(197,203,232,0.65)" }}>{b.label}</span>
              <span className="font-semibold" style={{ color: "#C5CBE8" }}>{b.value}%</span>
            </div>
            <div className="h-2 rounded-full" style={{ background: "rgba(144,141,206,0.14)" }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, b.value)}%`, background: color(b.value, b.danger) }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── AI hiring insights ───────────────────────────────────────────────────────

function TalentAiInsights({ data, m }: { data: DashboardData; m: TalentMetrics }) {
  const insights: Array<{ text: string; icon: IconType; href: string; cta: string }> = [];
  if (m.screening > 0) insights.push({ text: `Resume screening queue holds ${m.screening} candidate${m.screening === 1 ? "" : "s"}.`, icon: ClipboardCheck, href: "/dashboard/screening", cta: "Screen" });
  const topDrop = (data.domains ?? []).filter((d) => d.candidates > 0).sort((a, b) => b.rejected - a.rejected)[0];
  if (topDrop && topDrop.rejected > 0) insights.push({ text: `${topDrop.department} has the highest drop-off (${topDrop.rejected} rejected).`, icon: TrendingUp, href: "/dashboard/module-overview/talent", cta: "Review" });
  const topSource = (data.summary?.sourceBreakdown ?? []).map((s) => ({ name: formatLabel(String(s.sourceType ?? "")), rate: percent(Number(s.joined ?? 0), Number(s._count ?? 0)), count: Number(s._count ?? 0) })).filter((s) => s.count >= 3).sort((a, b) => b.rate - a.rate)[0];
  if (topSource && topSource.rate > 0) insights.push({ text: `${topSource.name} delivers the best join rate (${topSource.rate}%).`, icon: Sparkles, href: "/dashboard/candidates", cta: "Review" });
  if (m.inInterview > 0) insights.push({ text: `${m.inInterview} candidate${m.inInterview === 1 ? "" : "s"} in interview — keep feedback moving.`, icon: CalendarClock, href: "/dashboard/evaluations", cta: "Open" });
  if (insights.length === 0) insights.push({ text: "Pipeline is healthy — focus on sourcing for open roles.", icon: Sparkles, href: "/dashboard/candidates", cta: "Source" });
  return (
    <Panel title="AI Hiring Insights" subtitle="Recommendations from live pipeline data" icon={Sparkles}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {insights.slice(0, 4).map((x) => {
          const Icon = x.icon;
          return (
            <Link key={x.text} href={x.href} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{x.text}</p>
                <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">{x.cta} <ArrowRight className="h-3 w-3" /></span>
              </div>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── Recent candidate activity ────────────────────────────────────────────────

function RecentCandidateActivity({ candidates }: { candidates: CandidateRow[] | undefined }) {
  const rows = candidates ?? [];
  return (
    <Panel title="Recent Candidate Activity" subtitle="Latest applicants and their next step" icon={Activity} action={{ label: "All candidates", href: "/dashboard/candidates" }}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No candidate records available.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {rows.slice(0, 8).map((c) => (
            <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link href={`/dashboard/candidates/${c.id}`}><p className="truncate text-sm font-medium transition-colors hover:text-primary" style={{ color: "#C5CBE8" }}>{c.fullName ?? "Unnamed"}</p></Link>
                  <p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{c.position?.title ?? "Unassigned"} · {c.createdAt ? timeAgo(c.createdAt) : "—"}</p>
                </div>
                <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{formatLabel(String(c.currentStage ?? ""))}</span>
              </div>
              <div className="mt-2.5 flex items-center gap-1.5">
                <Link href={`/dashboard/candidates/${c.id}`} className="flex-1"><Button variant="outline" size="sm" className="h-7 w-full rounded-lg text-[11px]">View</Button></Link>
                <Link href="/dashboard/evaluations" className="flex-1"><Button variant="outline" size="sm" className="h-7 w-full rounded-lg text-[11px]">Interview</Button></Link>
                <Link href="/dashboard/selection-forms" className="flex-1"><Button variant="outline" size="sm" className="h-7 w-full rounded-lg text-[11px]">Offer</Button></Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function TalentView({ data, module }: { data: DashboardData; module: ModuleView }) {
  void module;
  const m = deriveTalentMetrics(data);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <>
      <RecruitmentHealthBanner m={m} />
      <RecruitmentKpis data={data} m={m} />
      <HiringFunnelOverview m={m} />
      <TalentPerformanceGraph data={data} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <OpenPositionsTable data={data} nowMs={nowMs} />
        <RecruitmentBottlenecks data={data} m={m} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <SourceAnalytics data={data} />
        <CandidateQuality m={m} />
      </div>
      <TalentAiInsights data={data} m={m} />
      <RecentCandidateActivity candidates={data.candidates} />
    </>
  );
}

// ─── Lifecycle dashboard ────────────────────────────────────────────────────

function AttendanceRangeChips({ value, onChange }: { value: AttendanceRange; onChange: (range: AttendanceRange) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(ATTENDANCE_RANGE_LABELS) as AttendanceRange[]).map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className={cn(
            "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
            value === range
              ? "border-primary bg-primary/10 text-primary"
              : "border-white/10 text-muted-foreground hover:border-primary/30"
          )}
        >
          {ATTENDANCE_RANGE_LABELS[range]}
        </button>
      ))}
    </div>
  );
}

// ─── Employee Lifecycle · People Operations Command Center ──────────────────
//
// Workforce-after-joining view for HR Ops / HRBPs. Everything is derived from
// the lifecycle-scoped data (employees, attendance, leaves, separations,
// summary). Charts are deliberately distinct from the other dashboards:
// stacked workforce composition, employee-movement bars, and an attrition
// trend. Metrics with no backing data (per-day/per-dept attendance heatmap,
// promotions/transfers, PF/ESI/KYC categories) are omitted in favour of real
// signals (tenure, manager coverage, form completion, exit types).

type EmployeeRich = {
  id: string;
  name?: string | null;
  fullName?: string | null;
  employeeCode?: string | null;
  department?: string | null;
  designation?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  dateOfJoining?: string | null;
  isActive?: boolean;
  selectionFormStatus?: string | null;
  createdAt?: string | null;
  managerId?: string | null;
  managerName?: string | null;
};

type SeparationRich = {
  id?: string;
  separationType?: string;
  separationTypeLabel?: string | null;
  status?: string | null;
  reason?: string | null;
  lastWorkingDay?: string | null;
  employeeName?: string | null;
  department?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

type LeaveRich = {
  id?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  department?: string | null;
  employeeName?: string | null;
  leaveType?: string;
  managerActionAt?: string | null;
  createdAt?: string;
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const MONTH_MS = 30.44 * DAY_MS;

function joinDateOf(e: EmployeeRich): string | null {
  return e.dateOfJoining || e.createdAt || null;
}
function isLeaveActiveStatus(s?: string | null): boolean {
  return !/pending|reject|cancel|withdraw|return|draft/i.test(String(s ?? ""));
}
function isExitActive(s?: string | null): boolean {
  const status = String(s ?? "");
  return Boolean(status) && !["completed", "revoked", "cancelled"].includes(status);
}
// Days until the next annual occurrence (birthday / anniversary) of a date.
function daysUntilAnnual(dateStr: string | null | undefined, nowMs: number): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return null;
  const now = new Date(nowMs);
  let next = new Date(now.getFullYear(), d.getMonth(), d.getDate());
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (next.getTime() < startOfToday.getTime()) next = new Date(now.getFullYear() + 1, d.getMonth(), d.getDate());
  return Math.round((next.getTime() - startOfToday.getTime()) / DAY_MS);
}

type LifeMetrics = {
  employees: EmployeeRich[];
  separations: SeparationRich[];
  leaves: LeaveRich[];
  total: number;
  active: number;
  newJoiners30: number;
  presentToday: number;
  attendanceTracked: number;
  presentRate: number;
  onLeaveToday: number;
  compliancePending: number;
  complianceScore: number;
  activeExits: number;
  completedExits: number;
  attritionRate: number;
  retention: number;
  managerCoverage: number;
  missingManagers: number;
  avgTenureMonths: number;
  probation: number;
  confirmed: number;
  score: number;
  band: HealthBand;
  highlights: string[];
  recommendation: string;
};

function deriveLifecycle(data: DashboardData, nowMs: number): LifeMetrics {
  const employees = (data.employees ?? []) as unknown as EmployeeRich[];
  const separations = (data.separations ?? []) as unknown as SeparationRich[];
  const leaves = (data.leaves ?? []) as unknown as LeaveRich[];
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);

  const activeEmployees = employees.filter((e) => e.isActive !== false);
  const total = employees.length;
  const active = activeEmployees.length;

  const tenureMonths = (e: EmployeeRich) => {
    const jd = joinDateOf(e);
    if (!jd) return null;
    const t = new Date(jd).getTime();
    return Number.isFinite(t) ? (nowMs - t) / MONTH_MS : null;
  };
  const newJoiners30 = employees.filter((e) => {
    const jd = joinDateOf(e);
    return jd && nowMs - new Date(jd).getTime() < 30 * DAY_MS;
  }).length;
  const probation = activeEmployees.filter((e) => { const t = tenureMonths(e); return t != null && t < 6; }).length;
  const confirmed = activeEmployees.filter((e) => { const t = tenureMonths(e); return t != null && t >= 6; }).length;
  const tenures = activeEmployees.map(tenureMonths).filter((t): t is number => t != null);
  const avgTenureMonths = tenures.length ? Math.round(tenures.reduce((a, b) => a + b, 0) / tenures.length) : 0;

  const presentToday = data.attendance?.present ?? 0;
  const attendanceTracked = data.attendance?.total ?? 0;
  const presentRate = attendanceTracked ? Math.round((presentToday / attendanceTracked) * 100) : 0;

  const onLeaveToday = leaves.filter((l) => isLeaveActiveStatus(l.status) && l.startDate && l.endDate && String(l.startDate).slice(0, 10) <= todayIso && String(l.endDate).slice(0, 10) >= todayIso).length;

  const formsSubmitted = activeEmployees.filter((e) => e.selectionFormStatus === "submitted").length;
  const complianceScore = active ? Math.round((formsSubmitted / active) * 100) : 100;
  const compliancePending = active - formsSubmitted;

  const activeExits = separations.filter((s) => isExitActive(s.status)).length;
  const completedExits = separations.filter((s) => String(s.status ?? "") === "completed").length;
  const attritionRate = active + completedExits > 0 ? Math.round((completedExits / (active + completedExits)) * 100) : 0;
  const retention = 100 - attritionRate;

  const withManager = activeEmployees.filter((e) => e.managerId || e.managerName).length;
  const managerCoverage = active ? Math.round((withManager / active) * 100) : 0;
  const missingManagers = active - withManager;

  const attendanceScore = attendanceTracked ? presentRate : 75;
  const score = Math.max(0, Math.min(100, Math.round(0.3 * attendanceScore + 0.25 * complianceScore + 0.25 * retention + 0.2 * managerCoverage)));
  const band = healthBand(score);

  const highlights: string[] = [];
  if (attendanceTracked) highlights.push(`Attendance at ${presentRate}% (${presentToday}/${attendanceTracked} present today).`);
  if (compliancePending > 0) highlights.push(`${compliancePending} onboarding form${compliancePending === 1 ? "" : "s"} pending completion.`);
  highlights.push(`Attrition at ${attritionRate}% · ${retention}% retention.`);
  if (missingManagers > 0) highlights.push(`${missingManagers} employee${missingManagers === 1 ? "" : "s"} have no manager mapped.`);
  if (newJoiners30 > 0) highlights.push(`${newJoiners30} joined in the last 30 days.`);

  const recommendation = missingManagers > 0
    ? `Complete manager mapping for ${missingManagers} employee${missingManagers === 1 ? "" : "s"}.`
    : compliancePending > 0
      ? `Chase ${compliancePending} pending onboarding form${compliancePending === 1 ? "" : "s"}.`
      : "Workforce is healthy — review employees approaching probation completion.";

  return {
    employees, separations, leaves,
    total, active, newJoiners30, presentToday, attendanceTracked, presentRate,
    onLeaveToday, compliancePending, complianceScore, activeExits, completedExits,
    attritionRate, retention, managerCoverage, missingManagers, avgTenureMonths, probation, confirmed,
    score, band, highlights: highlights.slice(0, 5), recommendation,
  };
}

function monthSlots(nowMs: number): Array<{ key: string; label: string }> {
  const now = new Date(nowMs);
  const slots: Array<{ key: string; label: string }> = [];
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    slots.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS_SHORT[d.getMonth()] });
  }
  return slots;
}

// ─── 1. Employee health banner ────────────────────────────────────────────────

function EmployeeHealthBanner({ m }: { m: LifeMetrics }) {
  const stats = [
    { label: "Total", value: m.total, sub: `${m.active} active` },
    { label: "Attendance", value: m.attendanceTracked ? `${m.presentRate}%` : "—", sub: "present today" },
    { label: "Attrition", value: `${m.attritionRate}%`, sub: `${m.retention}% retention` },
    { label: "Compliance", value: `${m.complianceScore}%`, sub: `${m.compliancePending} pending` },
  ];
  return (
    <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={CARD_STYLE}>
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(ellipse at 12% 0%, ${m.band.dot}22 0%, transparent 55%)` }} />
      <div className="relative grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.55)" }}>
            <span aria-hidden>{m.band.emoji}</span> Workforce Health Score
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-5xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{m.score}</span>
            <span className="pb-1 text-lg font-medium" style={{ color: "rgba(197,203,232,0.4)" }}>/ 100</span>
          </div>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${m.band.dot}1f`, color: m.band.dot }}>{m.band.label}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/dashboard/employees"><Button size="sm" className="rounded-xl text-xs">Employee directory <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></Link>
            {m.activeExits > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs font-medium text-amber-300">
                <UserMinus className="h-3.5 w-3.5" /> {m.activeExits} active exit{m.activeExits === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="truncate text-[10px] uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.45)" }}>{s.label}</p>
                <p className="mt-1 text-xl font-bold" style={{ color: "#C5CBE8" }}>{s.value}</p>
                <p className="truncate text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{s.sub}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" /> AI Workforce Summary</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {m.highlights.map((h) => (
                <li key={h} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}><span className="text-primary">•</span><span className="min-w-0">{h}</span></li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-white/10 pt-2.5 text-xs" style={{ color: "rgba(197,203,232,0.78)" }}>
              <span className="font-semibold text-primary">Recommendation:</span> {m.recommendation}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 2. People operations KPIs ────────────────────────────────────────────────

function PeopleOpsKpis({ m, nowMs }: { m: LifeMetrics; nowMs: number }) {
  const slots = monthSlots(nowMs);
  const joinByMonth = slots.map((s) => m.employees.filter((e) => String(joinDateOf(e) ?? "").slice(0, 7) === s.key).length);
  const kpis: Array<{ label: string; value: string | number; secondary: string; href: string; icon: IconType; tone: Tone; dot: string; spark: number[]; color: string }> = [
    { label: "Active Employees", value: m.active, secondary: `${m.total} on record`, href: "/dashboard/employees", icon: Users, tone: "default", dot: "#ED00ED", spark: joinByMonth, color: "#ED00ED" },
    { label: "New Joiners (30d)", value: m.newJoiners30, secondary: `${m.probation} in probation`, href: "/dashboard/employees", icon: UserCheck, tone: "success", dot: "#22c55e", spark: joinByMonth, color: "#22c55e" },
    { label: "Attendance Today", value: m.attendanceTracked ? `${m.presentRate}%` : "—", secondary: `${m.presentToday} of ${m.attendanceTracked} present`, href: "/dashboard/attendance", icon: Clock3, tone: m.presentRate >= 75 ? "success" : "warning", dot: m.presentRate >= 75 ? "#22c55e" : "#f59e0b", spark: [m.presentToday], color: "#38BDF8" },
    { label: "On Leave", value: m.onLeaveToday, secondary: "Away today", href: "/dashboard/leave", icon: CalendarDays, tone: m.onLeaveToday ? "warning" : "success", dot: m.onLeaveToday ? "#f59e0b" : "#22c55e", spark: [m.onLeaveToday], color: "#f59e0b" },
    { label: "Compliance Pending", value: m.compliancePending, secondary: `${m.complianceScore}% complete`, href: "/dashboard/compliance", icon: ShieldCheck, tone: m.compliancePending ? "warning" : "success", dot: m.compliancePending ? "#f59e0b" : "#22c55e", spark: [m.compliancePending], color: "#908DCE" },
    { label: "Active Exits", value: m.activeExits, secondary: `${m.completedExits} completed`, href: "/dashboard/separation", icon: UserMinus, tone: m.activeExits ? "danger" : "success", dot: m.activeExits ? "#ef4444" : "#22c55e", spark: [m.activeExits], color: "#ef4444" },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {kpis.map((k) => {
        const Icon = k.icon;
        return (
          <Link key={k.label} href={k.href} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30" style={CARD_STYLE}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: k.dot }} />{k.label}
                </p>
                <p className="mt-1.5 text-2xl font-bold leading-tight" style={{ color: "#C5CBE8" }}>{k.value}</p>
              </div>
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[k.tone])}><Icon className="h-4 w-4" /></div>
            </div>
            <p className="mt-1 truncate text-xs" style={{ color: "rgba(197,203,232,0.55)" }}>{k.secondary}</p>
            <div className="mt-2.5 flex items-end justify-between gap-2">
              <span className="text-[11px]" style={{ color: "rgba(197,203,232,0.35)" }}>Last 6 months</span>
              <div className="h-7 w-20 shrink-0"><Sparkline points={k.spark} color={k.color} /></div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── 3. Workforce distribution (stacked) ──────────────────────────────────────

function WorkforceDistribution({ m, nowMs }: { m: LifeMetrics; nowMs: number }) {
  const deptMap = new Map<string, { department: string; Active: number; Probation: number; OnLeave: number; Exiting: number }>();
  const get = (d: string) => {
    const key = d.trim() || "Unassigned";
    if (!deptMap.has(key)) deptMap.set(key, { department: key, Active: 0, Probation: 0, OnLeave: 0, Exiting: 0 });
    return deptMap.get(key)!;
  };
  const today = new Date(nowMs).toISOString().slice(0, 10);
  m.employees.filter((e) => e.isActive !== false).forEach((e) => {
    const row = get(e.department ?? "Unassigned");
    const jd = joinDateOf(e);
    const probation = jd ? (nowMs - new Date(jd).getTime()) < 6 * MONTH_MS : false;
    if (probation) row.Probation += 1; else row.Active += 1;
  });
  m.leaves.filter((l) => isLeaveActiveStatus(l.status) && l.startDate && l.endDate).forEach((l) => {
    if (String(l.startDate).slice(0, 10) <= today && String(l.endDate).slice(0, 10) >= today) {
      const row = get(l.department ?? "Unassigned");
      if (row.Active > 0) { row.Active -= 1; row.OnLeave += 1; }
    }
  });
  m.separations.filter((s) => isExitActive(s.status)).forEach((s) => {
    const row = get(s.department ?? "Unassigned");
    if (row.Active > 0) { row.Active -= 1; row.Exiting += 1; }
  });
  const chart = [...deptMap.values()]
    .map((r) => ({ ...r, "On Leave": r.OnLeave, total: r.Active + r.Probation + r.OnLeave + r.Exiting }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
  return (
    <Panel title="Workforce Distribution" subtitle="Composition by department · active, probation, on-leave, exiting" icon={BarChart3} action={{ label: "Directory", href: "/dashboard/employees" }}>
      {chart.length === 0 ? (
        <p className="py-8 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No employee records yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, chart.length * 40)}>
          <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }} barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="department" width={120} tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            <Bar dataKey="Active" stackId="a" fill="#22c55e" />
            <Bar dataKey="Probation" stackId="a" fill="#38BDF8" />
            <Bar dataKey="On Leave" stackId="a" fill="#f59e0b" />
            <Bar dataKey="Exiting" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ─── 4. Attendance & productivity ─────────────────────────────────────────────

function AttendancePanel({ attendance, toolbar, rangeLabel }: { attendance: AttendanceSummary | undefined; toolbar: React.ReactNode; rangeLabel: string }) {
  const present = attendance?.present ?? 0;
  const half = attendance?.halfDay ?? 0;
  const absent = attendance?.absent ?? 0;
  const total = attendance?.total ?? 0;
  const rows = [
    { label: "Present", value: present, fill: "#22c55e" },
    { label: "Half Day", value: half, fill: "#f59e0b" },
    { label: "Absent", value: absent, fill: "#ef4444" },
  ];
  const max = Math.max(present, half, absent, 1);
  return (
    <Panel title={`Attendance & Productivity · ${rangeLabel}`} subtitle={attendance?.averageWorkedHours ? `Avg ${Number(attendance.averageWorkedHours).toFixed(1)}h worked per employee` : "Attendance snapshot"} icon={Clock3} action={{ label: "Attendance", href: "/dashboard/attendance" }}>
      <div className="-mt-1 mb-3">{toolbar}</div>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-center">
          <p className="text-2xl font-bold text-emerald-400">{total ? Math.round((present / total) * 100) : 0}%</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Present rate</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
          <p className="text-2xl font-bold" style={{ color: "#C5CBE8" }}>{attendance?.averageWorkedHours ? Number(attendance.averageWorkedHours).toFixed(1) : "—"}</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Avg hours</p>
        </div>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-center">
          <p className="text-2xl font-bold text-amber-400">{half}</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Half days</p>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: "rgba(197,203,232,0.65)" }}>{r.label}</span>
              <span className="font-semibold" style={{ color: "#C5CBE8" }}>{r.value}{total ? <span className="ml-1 font-normal" style={{ color: "rgba(197,203,232,0.4)" }}>({Math.round((r.value / total) * 100)}%)</span> : null}</span>
            </div>
            <div className="h-1.5 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: r.fill }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── 5. Employee lifecycle funnel ─────────────────────────────────────────────

function LifecycleFunnel({ m }: { m: LifeMetrics }) {
  const onboarding = m.employees.filter((e) => e.isActive !== false && e.selectionFormStatus !== "submitted").length;
  const stages = [
    { label: "Joined", value: m.total, sub: "all records" },
    { label: "Onboarding", value: onboarding, sub: "forms pending" },
    { label: "Probation", value: m.probation, sub: "< 6 months" },
    { label: "Confirmed", value: m.confirmed, sub: "≥ 6 months" },
    { label: "Exiting", value: m.activeExits, sub: "in progress" },
    { label: "Exited", value: m.completedExits, sub: "completed" },
  ];
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <Panel title="Employee Lifecycle Funnel" subtitle={`Avg tenure ${m.avgTenureMonths} months across active employees`} icon={Activity} action={{ label: "Directory", href: "/dashboard/employees" }}>
      <div className="space-y-2.5">
        {stages.map((s, i) => (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span style={{ color: "rgba(197,203,232,0.65)" }}>{s.label} <span style={{ color: "rgba(197,203,232,0.4)" }}>· {s.sub}</span></span>
              <span className="shrink-0 font-semibold" style={{ color: "#C5CBE8" }}>{s.value}</span>
            </div>
            <div className="h-2 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, (s.value / max) * 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── 6. Employee movement ─────────────────────────────────────────────────────

function EmployeeMovement({ m, nowMs }: { m: LifeMetrics; nowMs: number }) {
  const slots = monthSlots(nowMs);
  const data = slots.map((s) => ({
    month: s.label,
    Joiners: m.employees.filter((e) => String(joinDateOf(e) ?? "").slice(0, 7) === s.key).length,
    Exits: m.separations.filter((sep) => String(sep.lastWorkingDay ?? sep.createdAt ?? "").slice(0, 7) === s.key).length,
  }));
  const empty = data.every((d) => d.Joiners === 0 && d.Exits === 0);
  return (
    <Panel title="Employee Movement" subtitle="Joiners vs exits · last 6 months" icon={TrendingUp}>
      {empty ? (
        <p className="py-8 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No movement recorded in the last six months.</p>
      ) : (
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            <Bar dataKey="Joiners" fill="#22c55e" radius={[4, 4, 0, 0]} />
            <Bar dataKey="Exits" fill="#ef4444" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ─── 7. Compliance & risk ─────────────────────────────────────────────────────

function ComplianceRisk({ data, m }: { data: DashboardData; m: LifeMetrics }) {
  const active = Math.max(m.active, 1);
  const formsSubmitted = m.employees.filter((e) => e.isActive !== false && e.selectionFormStatus === "submitted").length;
  const withManager = m.active - m.missingManagers;
  const statutory = countStages(data.summary, ["statutory_forms_submitted", "compliance_verified"]);
  const statutoryPending = countStages(data.summary, ["statutory_forms_sent"]);
  const rows = [
    { label: "Onboarding Forms", done: formsSubmitted, total: m.active, pending: m.compliancePending },
    { label: "Manager Mapping", done: withManager, total: m.active, pending: m.missingManagers },
    { label: "Statutory / Compliance", done: statutory, total: statutory + statutoryPending, pending: statutoryPending },
  ];
  return (
    <Panel title="Compliance & Risk" subtitle="Completion and outstanding risk" icon={Scale} action={{ label: "Compliance", href: "/dashboard/compliance" }}>
      <div className="space-y-3.5">
        {rows.map((r) => {
          const pct = r.total ? Math.round((r.done / r.total) * 100) : 100;
          const risk = pct >= 90 ? { label: "Low", color: "#22c55e" } : pct >= 60 ? { label: "Medium", color: "#f59e0b" } : { label: "High", color: "#ef4444" };
          return (
            <div key={r.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span style={{ color: "rgba(197,203,232,0.65)" }}>{r.label}</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold" style={{ color: "#C5CBE8" }}>{pct}%</span>
                  <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${risk.color}22`, color: risk.color }}>{risk.label}</span>
                </span>
              </div>
              <div className="h-2 rounded-full" style={{ background: "rgba(144,141,206,0.14)" }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, pct)}%`, background: risk.color }} />
              </div>
              {r.pending > 0 && <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{r.pending} pending</p>}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>Based on {active} active employees.</p>
    </Panel>
  );
}

// ─── 8. Attrition & retention ─────────────────────────────────────────────────

function AttritionRetention({ m, nowMs }: { m: LifeMetrics; nowMs: number }) {
  const slots = monthSlots(nowMs);
  const series = slots.map((s) => ({ month: s.label, Exits: m.separations.filter((sep) => String(sep.lastWorkingDay ?? sep.createdAt ?? "").slice(0, 7) === s.key).length }));
  const voluntary = m.separations.filter((s) => s.separationType === "resignation").length;
  const involuntary = m.separations.length - voluntary;
  const reasons = new Map<string, number>();
  m.separations.forEach((s) => {
    const key = s.separationTypeLabel || formatLabel(String(s.separationType ?? "other"));
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  });
  const topReasons = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const empty = series.every((s) => s.Exits === 0);
  return (
    <Panel title="Attrition & Retention" subtitle={`${m.retention}% retention · avg tenure ${m.avgTenureMonths} months`} icon={TrendingUp} action={{ label: "Separations", href: "/dashboard/separation" }}>
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center">
          <p className="text-lg font-bold" style={{ color: "#C5CBE8" }}>{m.attritionRate}%</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Attrition</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 text-center">
          <p className="text-lg font-bold text-emerald-400">{voluntary}</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Voluntary</p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-2.5 text-center">
          <p className="text-lg font-bold text-red-400">{involuntary}</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Involuntary</p>
        </div>
      </div>
      {!empty && (
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={series} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="attr" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} /><stop offset="95%" stopColor="#ef4444" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Area type="monotone" dataKey="Exits" stroke="#ef4444" strokeWidth={2} fill="url(#attr)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      )}
      {topReasons.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>Exit reasons</p>
          {topReasons.map(([name, count]) => (
            <div key={name} className="flex items-center justify-between text-xs">
              <span style={{ color: "rgba(197,203,232,0.65)" }}>{name}</span>
              <span className="font-semibold" style={{ color: "#C5CBE8" }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── 9. Employee demographics ─────────────────────────────────────────────────

function groupBars(items: string[]): BarRow[] {
  const map = new Map<string, number>();
  items.forEach((i) => map.set(i, (map.get(i) ?? 0) + 1));
  return [...map.entries()].map(([label, value], idx) => ({ label, value, fill: CHART_COLORS[idx % CHART_COLORS.length] })).sort((a, b) => b.value - a.value);
}

function Demographics({ m, nowMs }: { m: LifeMetrics; nowMs: number }) {
  const genderSlices: DonutSlice[] = groupBars(m.employees.map((e) => e.gender ? formatLabel(e.gender) : "Not set"))
    .map((r) => ({ name: r.label, value: r.value, fill: r.fill ?? CHART_COLORS[0] }));
  const ageBands = m.employees.map((e) => {
    if (!e.dateOfBirth) return "Unknown";
    const age = (nowMs - new Date(e.dateOfBirth).getTime()) / (365.25 * DAY_MS);
    if (!Number.isFinite(age)) return "Unknown";
    return age < 25 ? "Under 25" : age < 35 ? "25–34" : age < 45 ? "35–44" : "45+";
  });
  const tenureBands = m.employees.map((e) => {
    const jd = joinDateOf(e);
    if (!jd) return "Unknown";
    const months = (nowMs - new Date(jd).getTime()) / MONTH_MS;
    return months < 6 ? "< 6 mo" : months < 12 ? "6–12 mo" : months < 36 ? "1–3 yrs" : "3+ yrs";
  });
  return (
    <Panel title="Employee Demographics" subtitle="Workforce composition" icon={Users} action={{ label: "Directory", href: "/dashboard/employees" }}>
      <div className="grid gap-4 sm:grid-cols-2">
        <DonutPanel title="Gender" slices={genderSlices} centerLabel="Employees" />
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>Age groups</p>
            <HBarList rows={groupBars(ageBands)} maxRows={5} />
          </div>
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>Tenure bands</p>
            <HBarList rows={groupBars(tenureBands)} maxRows={5} />
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ─── 10. Department health scorecards ─────────────────────────────────────────

function DepartmentHealth({ m }: { m: LifeMetrics }) {
  const map = new Map<string, { dept: string; headcount: number; withManager: number; exits: number }>();
  m.employees.filter((e) => e.isActive !== false).forEach((e) => {
    const key = e.department?.trim() || "Unassigned";
    const row = map.get(key) ?? { dept: key, headcount: 0, withManager: 0, exits: 0 };
    row.headcount += 1;
    if (e.managerId || e.managerName) row.withManager += 1;
    map.set(key, row);
  });
  m.separations.filter((s) => isExitActive(s.status)).forEach((s) => {
    const key = s.department?.trim() || "Unassigned";
    const row = map.get(key);
    if (row) row.exits += 1;
  });
  const rows = [...map.values()].sort((a, b) => b.headcount - a.headcount).slice(0, 6).map((r) => {
    const mgr = r.headcount ? Math.round((r.withManager / r.headcount) * 100) : 0;
    const attrition = r.headcount ? Math.round((r.exits / r.headcount) * 100) : 0;
    const score = Math.max(0, Math.min(100, Math.round(0.6 * mgr + 0.4 * (100 - attrition * 4))));
    return { ...r, mgr, attrition, band: healthBand(score) };
  });
  return (
    <Panel title="Department Health" subtitle="Manager coverage and attrition per department" icon={Gauge} action={{ label: "Directory", href: "/dashboard/employees" }}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No department data yet.</p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.dept} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold" style={{ color: "#C5CBE8" }}>{r.dept}</p>
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.band.dot }} />
              </div>
              <p className="mt-0.5 text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{r.headcount} people</p>
              <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
                <span style={{ color: "rgba(197,203,232,0.6)" }}>Manager <span className="font-semibold" style={{ color: "#C5CBE8" }}>{r.mgr}%</span></span>
                <span style={{ color: "rgba(197,203,232,0.6)" }}>Exiting <span className="font-semibold" style={{ color: r.exits ? "#ef4444" : "#22c55e" }}>{r.exits}</span></span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── 11. Manager insights ─────────────────────────────────────────────────────

function ManagerInsights({ m }: { m: LifeMetrics }) {
  const teams = new Map<string, number>();
  m.employees.filter((e) => e.isActive !== false).forEach((e) => {
    if (e.managerName) teams.set(e.managerName, (teams.get(e.managerName) ?? 0) + 1);
  });
  const largest = [...teams.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  const managers = teams.size;
  const span = managers ? Math.round((m.active - m.missingManagers) / managers) : 0;
  return (
    <Panel title="Manager Insights" subtitle="Team structure and span of control" icon={UserCog} action={{ label: "Manager mapping", href: "/dashboard/manager-mapping" }}>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center">
          <p className="text-lg font-bold" style={{ color: "#C5CBE8" }}>{managers}</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Managers</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-center">
          <p className="text-lg font-bold" style={{ color: "#C5CBE8" }}>{span}</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Avg span</p>
        </div>
        <div className={cn("rounded-xl border p-2.5 text-center", m.missingManagers ? "border-amber-500/20 bg-amber-500/[0.06]" : "border-white/10 bg-white/[0.03]")}>
          <p className={cn("text-lg font-bold", m.missingManagers ? "text-amber-400" : "")} style={m.missingManagers ? undefined : { color: "#C5CBE8" }}>{m.missingManagers}</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>No manager</p>
        </div>
      </div>
      {largest.length > 0 ? <><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>Largest teams</p><HBarList rows={largest} maxRows={6} /></>
        : <p className="py-3 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No manager assignments yet.</p>}
    </Panel>
  );
}

// ─── 12. Upcoming HR activities ───────────────────────────────────────────────

function UpcomingHrActivities({ m, nowMs }: { m: LifeMetrics; nowMs: number }) {
  type Item = { label: string; detail: string; days: number; icon: IconType; href: string };
  const items: Item[] = [];
  m.employees.forEach((e) => {
    const name = e.name ?? e.fullName ?? "Employee";
    const bd = daysUntilAnnual(e.dateOfBirth, nowMs);
    if (bd != null && bd <= 30) items.push({ label: `${name}'s birthday`, detail: e.department ?? "", days: bd, icon: Star, href: "/dashboard/employees" });
    const jd = joinDateOf(e);
    const ann = daysUntilAnnual(jd, nowMs);
    if (ann != null && ann <= 30 && jd && nowMs - new Date(jd).getTime() > 330 * DAY_MS) {
      const years = Math.max(1, Math.round((nowMs - new Date(jd).getTime()) / (365.25 * DAY_MS)));
      items.push({ label: `${name} · ${years}yr anniversary`, detail: e.department ?? "", days: ann, icon: Trophy, href: "/dashboard/employees" });
    }
    const tenure = jd ? (nowMs - new Date(jd).getTime()) / MONTH_MS : null;
    if (tenure != null && tenure >= 5 && tenure < 6.5 && e.selectionFormStatus === "submitted") {
      items.push({ label: `${name} · probation review`, detail: "approaching 6 months", days: Math.round((6 - tenure) * 30), icon: ClipboardCheck, href: "/dashboard/employees" });
    }
  });
  m.separations.filter((s) => isExitActive(s.status) && s.lastWorkingDay).forEach((s) => {
    const days = Math.round((new Date(s.lastWorkingDay as string).getTime() - nowMs) / DAY_MS);
    if (days >= 0 && days <= 30) items.push({ label: `${s.employeeName ?? "Employee"} · last working day`, detail: s.department ?? "", days, icon: UserMinus, href: "/dashboard/separation" });
  });
  const groups: Array<{ title: string; filter: (d: number) => boolean }> = [
    { title: "Today", filter: (d) => d === 0 },
    { title: "This Week", filter: (d) => d > 0 && d <= 7 },
    { title: "This Month", filter: (d) => d > 7 && d <= 30 },
  ];
  const has = items.length > 0;
  return (
    <Panel title="Upcoming HR Activities" subtitle="Birthdays, anniversaries, probation, and exits" icon={CalendarDays} action={{ label: "Directory", href: "/dashboard/employees" }}>
      {!has ? (
        <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Nothing scheduled in the next 30 days.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => {
            const rows = items.filter((i) => g.filter(i.days)).sort((a, b) => a.days - b.days).slice(0, 5);
            if (rows.length === 0) return null;
            return (
              <div key={g.title}>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>{g.title}</p>
                <div className="space-y-1.5">
                  {rows.map((r, idx) => {
                    const Icon = r.icon;
                    return (
                      <Link key={`${r.label}-${idx}`} href={r.href} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition-colors hover:border-primary/30">
                        <Icon className="h-4 w-4 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{r.label}</p>
                          {r.detail && <p className="truncate text-[10px]" style={{ color: "rgba(197,203,232,0.42)" }}>{r.detail}</p>}
                        </div>
                        <span className="shrink-0 text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{r.days === 0 ? "today" : `${r.days}d`}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── 13. Recent employee activities ───────────────────────────────────────────

function RecentEmployeeActivities({ m }: { m: LifeMetrics }) {
  type Ev = { at: string; text: string; icon: IconType; tone: Tone; href: string };
  const events: Ev[] = [];
  m.employees.forEach((e) => { const jd = joinDateOf(e); if (jd) events.push({ at: jd, text: `${e.name ?? e.fullName ?? "Employee"} joined${e.department ? ` · ${e.department}` : ""}`, icon: UserCheck, tone: "success", href: "/dashboard/employees" }); });
  m.leaves.filter((l) => isLeaveActiveStatus(l.status)).forEach((l) => { const at = l.managerActionAt ?? l.createdAt; if (at) events.push({ at, text: `Leave approved — ${l.employeeName ?? "employee"}${l.leaveType ? ` (${formatLabel(l.leaveType)})` : ""}`, icon: CalendarDays, tone: "default", href: "/dashboard/leave" }); });
  m.separations.forEach((s) => { const at = s.createdAt; if (at) events.push({ at, text: `Exit initiated — ${s.employeeName ?? "employee"}${s.separationTypeLabel ? ` (${s.separationTypeLabel})` : ""}`, icon: UserMinus, tone: "danger", href: "/dashboard/separation" }); });
  const rows = events.filter((e) => Number.isFinite(new Date(e.at).getTime())).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 10);
  return (
    <Panel title="Recent Employee Activities" subtitle="Latest lifecycle events" icon={Activity} action={{ label: "Directory", href: "/dashboard/employees" }}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No recent activity.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((ev, i) => {
            const Icon = ev.icon;
            return (
              <Link key={`${ev.at}-${i}`} href={ev.href} className="flex min-w-0 items-start gap-3">
                <div className="flex flex-col items-center">
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full", TONE_CLASS[ev.tone])}><Icon className="h-3.5 w-3.5" /></span>
                  {i < rows.length - 1 && <span className="mt-1 h-full w-px flex-1" style={{ background: "rgba(144,141,206,0.15)", minHeight: 12 }} />}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{ev.text}</p>
                  <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{timeAgo(ev.at)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── 14. AI workforce insights ────────────────────────────────────────────────

function AiWorkforceInsights({ m }: { m: LifeMetrics }) {
  const insights: Array<{ text: string; icon: IconType; href: string; cta: string }> = [];
  if (m.compliancePending > 0) insights.push({ text: `${m.compliancePending} onboarding form${m.compliancePending === 1 ? "" : "s"} still pending.`, icon: Scale, href: "/dashboard/compliance", cta: "Chase" });
  if (m.missingManagers > 0) insights.push({ text: `${m.missingManagers} employee${m.missingManagers === 1 ? "" : "s"} have no manager assigned.`, icon: UserCog, href: "/dashboard/manager-mapping", cta: "Map" });
  insights.push({ text: `Attrition is ${m.attritionRate}% with average tenure of ${m.avgTenureMonths} months.`, icon: TrendingUp, href: "/dashboard/separation", cta: "Review" });
  if (m.probation > 0) insights.push({ text: `${m.probation} employee${m.probation === 1 ? "" : "s"} in probation — review those approaching confirmation.`, icon: ClipboardCheck, href: "/dashboard/employees", cta: "Open" });
  if (insights.length < 4 && m.attendanceTracked) insights.push({ text: `Attendance is holding at ${m.presentRate}% today.`, icon: Clock3, href: "/dashboard/attendance", cta: "View" });
  return (
    <Panel title="AI Workforce Insights" subtitle="Recommendations from live people data" icon={Sparkles}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {insights.slice(0, 4).map((x) => {
          const Icon = x.icon;
          return (
            <Link key={x.text} href={x.href} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{x.text}</p>
                <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">{x.cta} <ArrowRight className="h-3 w-3" /></span>
              </div>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── 15. Quick actions ────────────────────────────────────────────────────────

function LifecycleQuickActions() {
  const actions: Array<{ label: string; href: string; icon: IconType }> = [
    { label: "Add Employee", href: "/dashboard/employees", icon: UserCheck },
    { label: "Approve Leave", href: "/dashboard/leave", icon: CalendarDays },
    { label: "Assign Manager", href: "/dashboard/manager-mapping", icon: UserCog },
    { label: "Start Exit", href: "/dashboard/separation", icon: UserMinus },
    { label: "Documents", href: "/dashboard/documents", icon: FileText },
    { label: "Audit Logs", href: "/dashboard/logs", icon: Clock3 },
    { label: "Employee Directory", href: "/dashboard/employees", icon: Users },
    { label: "Compliance Audit", href: "/dashboard/compliance", icon: Scale },
  ];
  return (
    <Panel title="Quick Actions" subtitle="Common people-operations tasks">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.label} href={a.href}>
              <Button variant="outline" className="h-11 w-full justify-start rounded-xl text-xs"><Icon className="mr-2 h-4 w-4 text-primary" /> {a.label}</Button>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

function LifecycleView({ data, module }: { data: DashboardData; module: ModuleView }) {
  void module;
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const [attendanceRange, setAttendanceRange] = useState<AttendanceRange>("today");
  const { data: rangedAttendance } = useQuery({
    queryKey: ["module-attendance-summary", attendanceRange, "mapped"],
    queryFn: () => attendanceApi.summary({ ...attendanceRangeParams(attendanceRange), mapped: true }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const attendance = (rangedAttendance as AttendanceSummary | undefined) ?? (attendanceRange === "today" ? data.attendance : undefined);
  const m = useMemo(() => (nowMs == null ? null : deriveLifecycle(data, nowMs)), [data, nowMs]);

  if (nowMs == null || m == null) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <EmployeeHealthBanner m={m} />
      <PeopleOpsKpis m={m} nowMs={nowMs} />
      <WorkforceDistribution m={m} nowMs={nowMs} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <AttendancePanel attendance={attendance} rangeLabel={ATTENDANCE_RANGE_LABELS[attendanceRange]} toolbar={<AttendanceRangeChips value={attendanceRange} onChange={setAttendanceRange} />} />
        <LifecycleFunnel m={m} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <EmployeeMovement m={m} nowMs={nowMs} />
        <ComplianceRisk data={data} m={m} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <AttritionRetention m={m} nowMs={nowMs} />
        <Demographics m={m} nowMs={nowMs} />
      </div>
      <DepartmentHealth m={m} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <ManagerInsights m={m} />
        <UpcomingHrActivities m={m} nowMs={nowMs} />
      </div>
      <AiWorkforceInsights m={m} />
      <RecentEmployeeActivities m={m} />
      <LifecycleQuickActions />
    </>
  );
}

// ─── Performance dashboard ──────────────────────────────────────────────────

// ─── Performance & Development · Performance Intelligence ────────────────────
//
// Executive performance view for HR / Managers / Leadership. Real sources for
// this scope: employee-evaluation records (per-employee department, verdict,
// PI score, assessment score, skills), PMS reviews (rating, evaluator, score,
// submittedAt), and the PI summary. Distinct chart types (line trend, skill
// radar, promotion scatter, verdict heatmap, stacked distribution, funnel) are
// used here and nowhere else. Metrics with no backing data — goal completion,
// engagement, potential score, years-of-experience, calibration stages — are
// omitted or replaced with honest proxies (assessment vs PI, review completion,
// evaluator effectiveness) rather than mocked.

type PerfEmp = EmployeeEvaluationListItem;
type PmsRich = {
  id?: string;
  overallRating?: string | null;
  averageScore?: number | null;
  totalScore?: number | null;
  submittedAt?: string | null;
  createdAt?: string | null;
  evaluatorName?: string | null;
  positionTitle?: string | null;
  employeeName?: string | null;
  candidateName?: string | null;
};

const VERDICT_ORDER = ["strong", "solid", "developing", "at_risk"];
const VERDICT_META: Record<string, { label: string; color: string }> = {
  strong: { label: "Strong", color: "#22c55e" },
  solid: { label: "Solid", color: "#38BDF8" },
  developing: { label: "Developing", color: "#f59e0b" },
  at_risk: { label: "At Risk", color: "#ef4444" },
};

function scoreOf(e: PerfEmp): number | null {
  if (typeof e.piScore === "number") return e.piScore;
  if (typeof e.assessmentScore === "number") return e.assessmentScore;
  return null;
}

type PerfMetrics = {
  employees: PerfEmp[];
  total: number;
  scored: number;
  avgScore: number;
  high: number;
  atRisk: number;
  promotionReady: number;
  trainingRecommended: number;
  skillCoverage: number;
  reviewsPending: number;
  reviewCompletion: number;
  piCompleted: number;
  piSelected: number;
  score: number;
  band: HealthBand;
  highlights: string[];
  recommendation: string;
};

function derivePerf(employees: PerfEmp[], highlights: EmployeeEvaluationHighlights | undefined, pms: PmsRich[], pi: PiSummaryReport | undefined, pendingEvaluations: number): PerfMetrics {
  const total = highlights?.totalEmployees ?? employees.length;
  const scoredList = employees.filter((e) => scoreOf(e) != null);
  const scored = highlights?.scoredCount ?? scoredList.length;
  const avgScore = scoredList.length ? Math.round(scoredList.reduce((a, e) => a + (scoreOf(e) ?? 0), 0) / scoredList.length) : 0;
  const high = employees.filter((e) => (scoreOf(e) ?? 0) >= 90 || e.evaluationVerdict === "strong").length;
  const atRisk = employees.filter((e) => e.evaluationVerdict === "at_risk" || ((scoreOf(e) ?? 100) < 50 && scoreOf(e) != null)).length;
  const promotionReady = employees.filter((e) => e.evaluationVerdict === "strong" && (scoreOf(e) ?? 0) >= 80).length;
  const trainingRecommended = employees.filter((e) => e.skillCount === 0 || e.evaluationVerdict === "developing" || e.evaluationVerdict === "at_risk").length;
  const skillCoverage = highlights?.skillTaggedPct ?? 0;
  const reviewsPending = pendingEvaluations || Math.max(0, total - scored);
  const reviewCompletion = total ? Math.round((scored / total) * 100) : 0;
  const piCompleted = pi?.completed ?? 0;
  const piSelected = pi?.selected ?? 0;

  const healthScore = Math.max(0, Math.min(100, Math.round(0.45 * avgScore + 0.3 * reviewCompletion + 0.25 * skillCoverage)));
  const band = healthBand(healthScore);

  const hi: string[] = [];
  hi.push(`Average performance score is ${avgScore} across ${scored} scored employees.`);
  hi.push(`${high} high performer${high === 1 ? "" : "s"} · ${promotionReady} promotion-ready.`);
  if (atRisk > 0) hi.push(`${atRisk} employee${atRisk === 1 ? "" : "s"} flagged at risk.`);
  hi.push(`Review completion at ${reviewCompletion}% · skill coverage ${skillCoverage}%.`);
  if (pi) hi.push(`${piCompleted} PI rounds completed, ${piSelected} selected.`);

  const recommendation = reviewsPending > 0
    ? `Close ${reviewsPending} pending review${reviewsPending === 1 ? "" : "s"} and coach ${atRisk} at-risk employee${atRisk === 1 ? "" : "s"}.`
    : atRisk > 0
      ? `Prioritise coaching for ${atRisk} at-risk employee${atRisk === 1 ? "" : "s"}.`
      : "Performance is healthy — advance promotion-ready employees.";

  return { employees, total, scored, avgScore, high, atRisk, promotionReady, trainingRecommended, skillCoverage, reviewsPending, reviewCompletion, piCompleted, piSelected, score: healthScore, band, highlights: hi.slice(0, 5), recommendation };
}

function topDepartments(employees: PerfEmp[], n: number): string[] {
  const map = new Map<string, number>();
  employees.forEach((e) => { const k = e.department?.trim() || "Unassigned"; map.set(k, (map.get(k) ?? 0) + 1); });
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
}

// ─── Header + KPIs ────────────────────────────────────────────────────────────

function PerfHeader({ m }: { m: PerfMetrics }) {
  const stats = [
    { label: "Avg Score", value: m.avgScore, sub: `${m.scored} scored` },
    { label: "High Performers", value: m.high, sub: "90+ / strong" },
    { label: "At Risk", value: m.atRisk, sub: "need coaching" },
    { label: "Review Done", value: `${m.reviewCompletion}%`, sub: `${m.reviewsPending} pending` },
  ];
  return (
    <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={CARD_STYLE}>
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(ellipse at 12% 0%, ${m.band.dot}22 0%, transparent 55%)` }} />
      <div className="relative grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.55)" }}><span aria-hidden>{m.band.emoji}</span> Performance Health Score</p>
          <div className="mt-2 flex items-end gap-2"><span className="text-5xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{m.score}</span><span className="pb-1 text-lg font-medium" style={{ color: "rgba(197,203,232,0.4)" }}>/ 100</span></div>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${m.band.dot}1f`, color: m.band.dot }}>{m.band.label}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/dashboard/employee-evaluation"><Button size="sm" className="rounded-xl text-xs">Evaluations <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></Link>
            {m.atRisk > 0 && <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {m.atRisk} at risk</span>}
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="truncate text-[10px] uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.45)" }}>{s.label}</p>
                <p className="mt-1 text-xl font-bold" style={{ color: "#C5CBE8" }}>{s.value}</p>
                <p className="truncate text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{s.sub}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" /> AI Performance Summary</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">{m.highlights.map((h) => <li key={h} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}><span className="text-primary">•</span><span className="min-w-0">{h}</span></li>)}</ul>
            <p className="mt-2.5 border-t border-white/10 pt-2.5 text-xs" style={{ color: "rgba(197,203,232,0.78)" }}><span className="font-semibold text-primary">Recommendation:</span> {m.recommendation}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PerfKpis({ m }: { m: PerfMetrics }) {
  const kpis: Array<{ label: string; value: string | number; sub: string; icon: IconType; tone: Tone; href: string }> = [
    { label: "Employees Evaluated", value: m.total, sub: `${m.scored} scored`, icon: Users, tone: "default", href: "/dashboard/employee-evaluation" },
    { label: "Reviews Pending", value: m.reviewsPending, sub: `${m.reviewCompletion}% complete`, icon: ClipboardCheck, tone: m.reviewsPending ? "warning" : "success", href: "/dashboard/hr/pms" },
    { label: "Avg Performance", value: m.avgScore, sub: "across scored", icon: Gauge, tone: "default", href: "/dashboard/employee-evaluation" },
    { label: "High Performers", value: m.high, sub: "90+ / strong", icon: Trophy, tone: "success", href: "/dashboard/employee-evaluation" },
    { label: "Employees At Risk", value: m.atRisk, sub: "need coaching", icon: AlertTriangle, tone: m.atRisk ? "danger" : "success", href: "/dashboard/employee-evaluation" },
    { label: "Promotion Ready", value: m.promotionReady, sub: "strong + 80+", icon: Star, tone: "success", href: "/dashboard/employee-evaluation" },
    { label: "Training Recommended", value: m.trainingRecommended, sub: "skill / coaching gaps", icon: Tags, tone: m.trainingRecommended ? "warning" : "success", href: "/dashboard/skills" },
    { label: "Skill Coverage", value: `${m.skillCoverage}%`, sub: "employees tagged", icon: Percent, tone: m.skillCoverage >= 60 ? "success" : "warning", href: "/dashboard/skills" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map((k) => {
        const Icon = k.icon;
        return (
          <Link key={k.label} href={k.href} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30" style={CARD_STYLE}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}>{k.label}</p>
                <p className="mt-1.5 text-2xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{k.value}</p>
              </div>
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[k.tone])}><Icon className="h-4 w-4" /></div>
            </div>
            <p className="mt-2 truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{k.sub}</p>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Distribution (stacked) + Heatmap ─────────────────────────────────────────

function PerformanceDistribution({ m }: { m: PerfMetrics }) {
  const depts = topDepartments(m.employees, 4);
  const data = VERDICT_ORDER.map((v) => {
    const row: Record<string, string | number> = { verdict: VERDICT_META[v].label };
    let other = 0;
    m.employees.filter((e) => e.evaluationVerdict === v).forEach((e) => {
      const d = e.department?.trim() || "Unassigned";
      if (depts.includes(d)) row[d] = (Number(row[d] ?? 0)) + 1; else other += 1;
    });
    row.Other = other;
    return row;
  });
  const empty = m.employees.every((e) => !e.evaluationVerdict);
  return (
    <Panel title="Performance Distribution" subtitle="Verdict split, stacked by department" icon={BarChart3} action={{ label: "Evaluations", href: "/dashboard/employee-evaluation" }}>
      {empty ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No verdicts recorded yet.</p> : (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} barSize={34}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" vertical={false} />
            <XAxis dataKey="verdict" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            {depts.map((d, i) => <Bar key={d} dataKey={d} stackId="a" fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            <Bar dataKey="Other" stackId="a" fill="rgba(144,141,206,0.35)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

function DepartmentHeatmap({ m }: { m: PerfMetrics }) {
  const depts = topDepartments(m.employees, 7);
  const grid = depts.map((d) => {
    const cells = VERDICT_ORDER.map((v) => m.employees.filter((e) => (e.department?.trim() || "Unassigned") === d && e.evaluationVerdict === v).length);
    const total = cells.reduce((a, b) => a + b, 0) || 1;
    const scoredEmps = m.employees.filter((e) => (e.department?.trim() || "Unassigned") === d && scoreOf(e) != null);
    const avg = scoredEmps.length ? Math.round(scoredEmps.reduce((a, e) => a + (scoreOf(e) ?? 0), 0) / scoredEmps.length) : null;
    return { dept: d, cells, total, avg };
  });
  const max = Math.max(...grid.flatMap((g) => g.cells), 1);
  return (
    <Panel title="Department Performance Heatmap" subtitle="Verdict spread and average score per department" icon={Activity} action={{ label: "Evaluations", href: "/dashboard/employee-evaluation" }}>
      {grid.length === 0 ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No department data yet.</p> : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[420px] border-separate text-xs" style={{ borderSpacing: "3px" }}>
            <thead>
              <tr>
                <th className="px-2 py-1 text-left font-medium" style={{ color: "rgba(197,203,232,0.45)" }}>Dept</th>
                {VERDICT_ORDER.map((v) => <th key={v} className="px-1 py-1 text-center font-medium" style={{ color: VERDICT_META[v].color }}>{VERDICT_META[v].label}</th>)}
                <th className="px-2 py-1 text-right font-medium" style={{ color: "rgba(197,203,232,0.45)" }}>Avg</th>
              </tr>
            </thead>
            <tbody>
              {grid.map((g) => (
                <tr key={g.dept}>
                  <td className="max-w-[120px] truncate px-2 py-1.5 font-medium" style={{ color: "#C5CBE8" }}>{g.dept}</td>
                  {g.cells.map((c, i) => (
                    <td key={i} className="rounded-lg px-1 py-2 text-center font-semibold" style={{ background: `${VERDICT_META[VERDICT_ORDER[i]].color}${c ? Math.round((0.12 + (c / max) * 0.5) * 255).toString(16).padStart(2, "0") : "12"}`, color: c ? "#0b0b14" : "rgba(197,203,232,0.35)" }}>{c || "·"}</td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-bold" style={{ color: g.avg != null ? (g.avg >= 80 ? "#22c55e" : g.avg >= 60 ? "#f59e0b" : "#ef4444") : "rgba(197,203,232,0.35)" }}>{g.avg ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ─── Trend (line) + Radar ─────────────────────────────────────────────────────

function PerformanceTrend({ pms }: { pms: PmsRich[] }) {
  const now = new Date();
  const slots: Array<{ key: string; label: string }> = [];
  for (let i = 11; i >= 0; i -= 1) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); slots.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS_SHORT[d.getMonth()] }); }
  const data = slots.map((s) => {
    const rows = pms.filter((r) => String(r.submittedAt ?? r.createdAt ?? "").slice(0, 7) === s.key && typeof r.averageScore === "number");
    const avg = rows.length ? Math.round((rows.reduce((a, r) => a + (r.averageScore ?? 0), 0) / rows.length) * 10) / 10 : null;
    return { month: s.label, "Avg Score": avg };
  });
  const empty = data.every((d) => d["Avg Score"] == null);
  return (
    <Panel title="Performance Trend" subtitle="Average review score · last 12 months" icon={TrendingUp} action={{ label: "PMS panel", href: "/dashboard/hr/pms" }}>
      {empty ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Not enough submitted reviews to trend.</p> : (
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Line type="monotone" dataKey="Avg Score" stroke="#ED00ED" strokeWidth={2.5} dot={{ r: 3, fill: "#ED00ED" }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

function SkillRadar({ employees }: { employees: PerfEmp[] }) {
  const map = new Map<string, { sum: number; n: number }>();
  employees.forEach((e) => (e.skills ?? []).forEach((s) => { const cur = map.get(s.label) ?? { sum: 0, n: 0 }; cur.sum += s.rating; cur.n += 1; map.set(s.label, cur); }));
  const data = [...map.entries()].map(([label, v]) => ({ skill: label, value: Math.round((v.sum / v.n) * 10) / 10, count: v.n })).sort((a, b) => b.count - a.count).slice(0, 6);
  return (
    <Panel title="Skill Capability" subtitle="Average rating across the most-tagged skills" icon={Tags} action={{ label: "Skills", href: "/dashboard/skills" }}>
      {data.length < 3 ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Not enough skill data to chart.</p> : (
        <ResponsiveContainer width="100%" height={250}>
          <RadarChart data={data} outerRadius="72%">
            <PolarGrid stroke="rgba(144,141,206,0.18)" />
            <PolarAngleAxis dataKey="skill" tick={{ fontSize: 10, fill: "#C5CBE8" }} />
            <PolarRadiusAxis tick={{ fontSize: 9, fill: "rgba(197,203,232,0.4)" }} axisLine={false} />
            <Radar dataKey="value" stroke="#38BDF8" fill="#38BDF8" fillOpacity={0.35} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
          </RadarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ─── Promotion matrix (scatter) + Team comparison ─────────────────────────────

function PromotionMatrix({ employees }: { employees: PerfEmp[] }) {
  const points = employees
    .filter((e) => typeof e.piScore === "number" && typeof e.assessmentScore === "number")
    .map((e) => ({ x: e.piScore as number, y: e.assessmentScore as number, z: (e.skillCount ?? 0) + 2, name: e.name }));
  return (
    <Panel title="Promotion Readiness Matrix" subtitle="Interview score vs assessment score · quadrants at 70" icon={Star} action={{ label: "Evaluations", href: "/dashboard/employee-evaluation" }}>
      {points.length < 2 ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Not enough dual-scored employees to plot.</p> : (
        <>
          <ResponsiveContainer width="100%" height={250}>
            <ScatterChart margin={{ top: 10, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
              <XAxis type="number" dataKey="x" name="PI" domain={[0, 100]} tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
              <YAxis type="number" dataKey="y" name="Assessment" domain={[0, 100]} tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
              <ZAxis type="number" dataKey="z" range={[40, 260]} />
              <Tooltip {...CHART_TOOLTIP_STYLE} cursor={{ strokeDasharray: "3 3" }} />
              <Scatter data={points} fill="#ED00ED" fillOpacity={0.65} />
            </ScatterChart>
          </ResponsiveContainer>
          <div className="mt-1 grid grid-cols-2 gap-1.5 text-[10px]" style={{ color: "rgba(197,203,232,0.5)" }}>
            <span>↗ High PI · High assessment = Promotion ready</span>
            <span>↘ High PI · Low assessment = Strong contributor</span>
            <span>↖ Low PI · High assessment = Future potential</span>
            <span>↙ Low · Low = Needs coaching</span>
          </div>
        </>
      )}
    </Panel>
  );
}

function TeamComparison({ employees }: { employees: PerfEmp[] }) {
  const depts = topDepartments(employees, 6);
  const data = depts.map((d) => {
    const emps = employees.filter((e) => (e.department?.trim() || "Unassigned") === d);
    const pi = emps.filter((e) => typeof e.piScore === "number");
    const asm = emps.filter((e) => typeof e.assessmentScore === "number");
    return {
      dept: d.length > 12 ? `${d.slice(0, 11)}…` : d,
      "Avg PI": pi.length ? Math.round(pi.reduce((a, e) => a + (e.piScore ?? 0), 0) / pi.length) : 0,
      "Avg Assessment": asm.length ? Math.round(asm.reduce((a, e) => a + (e.assessmentScore ?? 0), 0) / asm.length) : 0,
    };
  });
  const empty = data.every((d) => d["Avg PI"] === 0 && d["Avg Assessment"] === 0);
  return (
    <Panel title="Team Comparison" subtitle="Average interview and assessment scores by department" icon={Users} action={{ label: "Evaluations", href: "/dashboard/employee-evaluation" }}>
      {empty ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No scored departments yet.</p> : (
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} barSize={12}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" vertical={false} />
            <XAxis dataKey="dept" tick={{ fontSize: 10, fill: "#C5CBE8" }} axisLine={false} tickLine={false} interval={0} angle={-15} textAnchor="end" height={50} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            <Bar dataKey="Avg PI" fill="#ED00ED" radius={[3, 3, 0, 0]} />
            <Bar dataKey="Avg Assessment" fill="#38BDF8" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ─── Skill gaps + Evaluator effectiveness ─────────────────────────────────────

function SkillGaps({ employees }: { employees: PerfEmp[] }) {
  const map = new Map<string, { count: number; sum: number }>();
  employees.forEach((e) => (e.skills ?? []).forEach((s) => { const cur = map.get(s.label) ?? { count: 0, sum: 0 }; cur.count += 1; cur.sum += s.rating; map.set(s.label, cur); }));
  const rows: BarRow[] = [...map.entries()].map(([label, v]) => ({ label, value: v.count, detail: `· avg ${Math.round((v.sum / v.count) * 10) / 10}` })).sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <Panel title="Training & Skill Priorities" subtitle="Most-tagged skills across the workforce" icon={Tags} action={{ label: "Skills", href: "/dashboard/skills" }}>
      {rows.length === 0 ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No skills tagged yet.</p> : <HBarList rows={rows} maxRows={8} />}
    </Panel>
  );
}

function EvaluatorEffectiveness({ pms }: { pms: PmsRich[] }) {
  const map = new Map<string, { name: string; count: number; sum: number; n: number }>();
  pms.forEach((r) => { const name = r.evaluatorName; if (!name) return; const row = map.get(name) ?? { name, count: 0, sum: 0, n: 0 }; row.count += 1; if (typeof r.averageScore === "number") { row.sum += r.averageScore; row.n += 1; } map.set(name, row); });
  const rows = [...map.values()].map((r) => ({ ...r, avg: r.n ? Math.round((r.sum / r.n) * 10) / 10 : null })).sort((a, b) => b.count - a.count).slice(0, 6);
  return (
    <Panel title="Evaluator Effectiveness" subtitle="Reviews completed and average score per evaluator" icon={Trophy} action={{ label: "PMS panel", href: "/dashboard/hr/pms" }}>
      {rows.length === 0 ? <p className="py-8 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No submitted reviews yet.</p> : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.name} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={{ background: i === 0 ? "rgba(237,0,237,0.15)" : "rgba(144,141,206,0.1)", color: i === 0 ? "#ED00ED" : "rgba(197,203,232,0.7)" }}>{i + 1}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" style={{ color: "#C5CBE8" }}>{r.name}</p><p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{r.count} review{r.count === 1 ? "" : "s"}</p></div>
              <div className="shrink-0 text-right"><p className="text-sm font-bold text-primary">{r.avg != null ? r.avg : "—"}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>avg score</p></div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── Performance funnel ───────────────────────────────────────────────────────

function PerformanceFunnel({ m, pi }: { m: PerfMetrics; pi: PiSummaryReport | undefined }) {
  const stages = [
    { label: "Employees", value: m.total },
    { label: "Scored", value: m.scored },
    { label: "PI Completed", value: pi?.completed ?? 0 },
    { label: "Selected", value: pi?.selected ?? 0 },
    { label: "Promotion Ready", value: m.promotionReady },
  ];
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <Panel title="Performance Funnel" subtitle="From evaluated to promotion-ready" icon={Activity} action={{ label: "Evaluations", href: "/dashboard/employee-evaluation" }}>
      <div className="space-y-2.5">
        {stages.map((s, i) => (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs"><span style={{ color: "rgba(197,203,232,0.65)" }}>{s.label}</span><span className="font-semibold" style={{ color: "#C5CBE8" }}>{s.value} <span style={{ color: "rgba(197,203,232,0.4)" }}>({percent(s.value, stages[0].value)}%)</span></span></div>
            <div className="mx-auto h-3 rounded-full" style={{ width: `${Math.max(18, (s.value / max) * 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length], opacity: 0.85 }} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Top performers + attention ───────────────────────────────────────────────

function TopPerformers({ m, highlights }: { m: PerfMetrics; highlights: EmployeeEvaluationHighlights | undefined }) {
  const byId = new Map(m.employees.map((e) => [e.id, e]));
  const people = (highlights?.topPerformers ?? []).slice(0, 6).map((p) => ({ p, e: byId.get(p.id) }));
  return (
    <Panel title="Top Performers" subtitle="Highest evaluation scores" icon={Trophy} action={{ label: "Evaluations", href: "/dashboard/employee-evaluation" }}>
      {people.length === 0 ? <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No scored employees yet.</p> : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {people.map(({ p, e }) => (
            <Link key={p.id} href={`/dashboard/employee-evaluation/${p.id}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: "rgba(237,0,237,0.15)", color: "#ED00ED" }}>{getInitials(p.name)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: "#C5CBE8" }}>{p.name}</p>
                <p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{e?.department ?? p.employeeCode ?? "—"}{e?.skillCount ? ` · ${e.skillCount} skills` : ""}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-bold text-emerald-400">{p.score ?? "—"}</p>
                {e?.evaluationVerdict === "strong" && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">Promo ready</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AttentionEmployees({ m, highlights }: { m: PerfMetrics; highlights: EmployeeEvaluationHighlights | undefined }) {
  const byId = new Map(m.employees.map((e) => [e.id, e]));
  const fromHighlights = (highlights?.atRisk ?? []).map((p) => ({ id: p.id, name: p.name, score: p.score, e: byId.get(p.id) }));
  const extra = m.employees.filter((e) => e.evaluationVerdict === "at_risk" && !fromHighlights.some((h) => h.id === e.id)).map((e) => ({ id: e.id, name: e.name, score: scoreOf(e), e }));
  const people = [...fromHighlights, ...extra].slice(0, 6);
  const reasons = (e: PerfEmp | undefined, score: number | null): string[] => {
    const r: string[] = [];
    if (e?.evaluationVerdict === "at_risk") r.push("High attrition risk");
    if (score != null && score < 50) r.push("Low performance");
    if ((e?.skillCount ?? 0) === 0) r.push("Skill gap");
    if (e?.piVerdict === "reject" || e?.assessmentVerdict === "fail") r.push("Missed review");
    return r.length ? r : ["Needs coaching"];
  };
  return (
    <Panel title="Employees Requiring Attention" subtitle="At-risk and low-scoring employees" icon={AlertTriangle} action={{ label: "Evaluations", href: "/dashboard/employee-evaluation" }}>
      {people.length === 0 ? <div className="flex flex-col items-center gap-2 py-8"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>No employees flagged.</p></div> : (
        <div className="space-y-2">
          {people.map(({ id, name, score, e }) => (
            <div key={id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }}>{getInitials(name)}</div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" style={{ color: "#C5CBE8" }}>{name}</p><p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{e?.department ?? "—"}</p></div>
                <span className="shrink-0 text-sm font-bold text-red-400">{score ?? "—"}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {reasons(e, score).map((t) => <span key={t} className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-300">{t}</span>)}
                <Link href={`/dashboard/employee-evaluation/${id}`} className="ml-auto"><Button variant="outline" size="sm" className="h-6 rounded-lg text-[10px]">Schedule review</Button></Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── AI insights (overview) + priority + quick actions ───────────────────────

function PerfAiInsights({ m }: { m: PerfMetrics }) {
  const [overview, setOverview] = useState<EmployeeEvaluationOverview["overview"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: () => employeeEvaluationApi.generateOverview(),
    onSuccess: (d) => { setOverview(d.overview); setError(null); },
    onError: (err: unknown) => { const status = (err as { response?: { status?: number } })?.response?.status; setError(status === 503 ? "AI overview unavailable (model key not configured)." : "Could not generate the overview. Please try again."); },
  });
  return (
    <Panel title="AI Performance Insights" subtitle="Executive narrative generated from evaluation data" icon={Sparkles}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-2.5">
          {[
            `Average performance score sits at ${m.avgScore} with ${m.reviewCompletion}% of reviews complete.`,
            `${m.high} high performer${m.high === 1 ? "" : "s"} and ${m.promotionReady} promotion-ready; ${m.atRisk} need coaching.`,
            `Skill coverage is ${m.skillCoverage}% — ${m.trainingRecommended} employee${m.trainingRecommended === 1 ? "" : "s"} flagged for training.`,
          ].map((t) => (
            <div key={t} className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{t}</p>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5">
          <Button size="sm" className="mb-2 w-full rounded-xl text-xs gap-1.5" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {overview ? "Regenerate summary" : "Generate executive summary"}
          </Button>
          {error && <p className="text-xs text-amber-300">{error}</p>}
          {!overview && !error && !mutation.isPending && <p className="text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>Generate an AI narrative of team performance, highlights, and a recommendation.</p>}
          {overview && (
            <div className="space-y-2 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}>
              <p>{overview.summary}</p>
              {overview.highlights.length > 0 && <ul className="list-disc space-y-0.5 pl-4">{overview.highlights.slice(0, 4).map((h, i) => <li key={i}>{h}</li>)}</ul>}
              <p className="rounded-lg border border-white/10 bg-white/[0.03] p-2"><span className="font-semibold text-primary">Recommendation: </span>{overview.recommendation}</p>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function PerfPriorityActions({ m }: { m: PerfMetrics }) {
  const cards: Array<{ label: string; value: number; priority: "High" | "Medium" | "Low"; href: string }> = ([
    { label: "Reviews Pending", value: m.reviewsPending, priority: "High", href: "/dashboard/hr/pms" },
    { label: "Employees At Risk", value: m.atRisk, priority: "High", href: "/dashboard/employee-evaluation" },
    { label: "Promotion Approvals", value: m.promotionReady, priority: "Medium", href: "/dashboard/employee-evaluation" },
    { label: "Training Assignments", value: m.trainingRecommended, priority: "Medium", href: "/dashboard/skills" },
    { label: "Unscored Employees", value: Math.max(0, m.total - m.scored), priority: "Low", href: "/dashboard/employee-evaluation" },
  ] as Array<{ label: string; value: number; priority: "High" | "Medium" | "Low"; href: string }>).filter((c) => c.value > 0);
  const cls: Record<"High" | "Medium" | "Low", string> = { High: "bg-red-500/15 text-red-300", Medium: "bg-amber-500/15 text-amber-300", Low: "bg-sky-500/15 text-sky-300" };
  return (
    <Panel title="Priority Actions" subtitle="Performance tasks needing attention" icon={ClipboardCheck}>
      {cards.length === 0 ? <div className="flex flex-col items-center gap-2 py-8"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>Nothing outstanding.</p></div> : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.label} href={c.href} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", cls[c.priority])}>{c.priority}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{c.label}</span>
              <span className="shrink-0 text-lg font-bold text-primary">{c.value}</span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PerfQuickActions() {
  const actions: Array<{ label: string; href: string; icon: IconType }> = [
    { label: "Start PMS Cycle", href: "/dashboard/hr/pms", icon: Star },
    { label: "Evaluate Employee", href: "/dashboard/employee-evaluation", icon: ClipboardCheck },
    { label: "Schedule PI", href: "/dashboard/evaluations", icon: CalendarDays },
    { label: "Assign Skills", href: "/dashboard/skills", icon: Tags },
    { label: "Team Insights", href: "/dashboard/employee-evaluation", icon: Users },
    { label: "PMS Records", href: "/dashboard/hr/pms", icon: BarChart3 },
    { label: "Skill Catalog", href: "/dashboard/skills", icon: Tags },
    { label: "Completed Evaluations", href: "/dashboard/evaluations/completed", icon: FileText },
  ];
  return (
    <Panel title="Quick Actions" subtitle="Common performance-management tasks">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {actions.map((a) => { const Icon = a.icon; return <Link key={a.label} href={a.href}><Button variant="outline" className="h-11 w-full justify-start rounded-xl text-xs"><Icon className="mr-2 h-4 w-4 text-primary" /> {a.label}</Button></Link>; })}
      </div>
    </Panel>
  );
}

function PerformanceView({ data, module }: { data: DashboardData; module: ModuleView }) {
  void module;
  const { data: employees = [], isLoading: empLoading } = useQuery({
    queryKey: ["perf-eval-employees"],
    queryFn: () => employeeEvaluationApi.listEmployees({}),
    staleTime: 60_000,
  });
  const { data: highlights } = useQuery({
    queryKey: ["perf-eval-highlights"],
    queryFn: () => employeeEvaluationApi.getHighlights(),
    staleTime: 60_000,
  });
  const pms = useMemo(() => (data.pms ?? []) as unknown as PmsRich[], [data.pms]);
  const pi = data.piSummary;
  const list = employees as PerfEmp[];
  const m = useMemo(() => derivePerf(list, highlights, pms, pi, data.summary?.pendingEvaluations ?? 0), [list, highlights, pms, pi, data.summary]);

  if (empLoading && list.length === 0) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  return (
    <>
      <PerfHeader m={m} />
      <PerfKpis m={m} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <PerformanceDistribution m={m} />
        <DepartmentHeatmap m={m} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <PerformanceTrend pms={pms} />
        <SkillRadar employees={list} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <PromotionMatrix employees={list} />
        <TeamComparison employees={list} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <SkillGaps employees={list} />
        <EvaluatorEffectiveness pms={pms} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <TopPerformers m={m} highlights={highlights} />
        <PerformanceFunnel m={m} pi={pi} />
      </div>
      <AttentionEmployees m={m} highlights={highlights} />
      <PerfAiInsights m={m} />
      <PerfPriorityActions m={m} />
      <PerfQuickActions />
    </>
  );
}

// ─── IT operations dashboard ────────────────────────────────────────────────

// ─── IT Operations · IT Service Operations Center ───────────────────────────
//
// IT service view for HR / IT Admins. Real data sources for this scope are
// onboarding email requests (itPending/itCompleted), asset allocation records
// (assigned/returned with assetType + timestamps), and the ID-card queue.
// There is no ticketing system with categories/technician/priority/SLA target,
// so those prompt features are honestly substituted with real proxies:
// resolution rate + measured resolution time (from timestamps), workstream
// distribution, aging buckets, and asset utilisation. Technician leaderboard
// and priority-bubble are omitted (no backing data) rather than mocked.

type ItReqRich = {
  id?: string;
  candidateName?: string;
  suggestedEmail?: string;
  createdEmail?: string;
  status?: string;
  createdAt?: string;
  completedAt?: string;
};

type AssetRich = {
  id?: string;
  employeeName?: string;
  employeeCode?: string;
  assetType?: string;
  model?: string;
  status?: string;
  assignedAt?: string;
  returnedAt?: string;
  createdAt?: string;
};

function hoursBetween(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return (b - a) / 3_600_000;
}

type ItMetrics = {
  emailPending: ItReqRich[];
  emailCompleted: ItReqRich[];
  assets: AssetRich[];
  idCards: CandidateIdCardQueueItem[];
  pendingCount: number;
  completedCount: number;
  resolutionRate: number;
  avgEmailHours: number | null;
  avgIdCardHours: number | null;
  assetsAssigned: number;
  assetsReturned: number;
  utilisation: number;
  idPending: number;
  idReady: number;
  idDone: number;
  joinersAwaiting: number;
  overdueRequests: number;
  overdueIdCards: number;
  score: number;
  band: HealthBand;
  highlights: string[];
  recommendation: string;
};

function deriveItOps(data: DashboardData, nowMs: number): ItMetrics {
  const emailPending = (data.itPending ?? []) as unknown as ItReqRich[];
  const emailCompleted = (data.itCompleted ?? []) as unknown as ItReqRich[];
  const assets = (data.assets ?? []) as unknown as AssetRich[];
  const idCards = data.idCards ?? [];

  const pendingCount = emailPending.length;
  const completedCount = emailCompleted.length;
  const resolutionRate = percent(completedCount, pendingCount + completedCount);

  const emailHours = emailCompleted.map((r) => hoursBetween(r.createdAt, r.completedAt)).filter((h): h is number => h != null);
  const avgEmailHours = emailHours.length ? Math.round(emailHours.reduce((a, b) => a + b, 0) / emailHours.length) : null;
  const idHours = idCards.filter((c) => c.status === "done").map((c) => hoursBetween(c.submittedAt, c.itCompletedAt)).filter((h): h is number => h != null);
  const avgIdCardHours = idHours.length ? Math.round(idHours.reduce((a, b) => a + b, 0) / idHours.length) : null;

  const assetsAssigned = assets.filter((a) => a.status === "assigned").length;
  const assetsReturned = assets.filter((a) => a.status === "returned").length;
  const utilisation = percent(assetsAssigned, assetsAssigned + assetsReturned);

  const idPending = idCards.filter((c) => c.status !== "done").length;
  const idReady = idCards.filter((c) => c.status === "ready").length;
  const idDone = idCards.filter((c) => c.status === "done").length;
  const joinersAwaiting = idPending + pendingCount;

  const overdueRequests = emailPending.filter((r) => r.createdAt && nowMs - new Date(r.createdAt).getTime() > 3 * DAY_MS).length;
  const overdueIdCards = idCards.filter((c) => c.status !== "done" && c.submittedAt && nowMs - new Date(c.submittedAt).getTime() > 3 * DAY_MS).length;

  const backlogScore = Math.max(10, 100 - Math.min(90, (joinersAwaiting + overdueRequests * 2) * 4));
  const score = Math.max(0, Math.min(100, Math.round(0.45 * resolutionRate + 0.35 * backlogScore + 0.2 * utilisation)));
  const band = healthBand(score);

  const highlights: string[] = [];
  highlights.push(`${resolutionRate}% of email requests completed (${completedCount}/${pendingCount + completedCount}).`);
  if (avgEmailHours != null) highlights.push(`Avg email setup takes ${avgEmailHours}h.`);
  if (idPending > 0) highlights.push(`${idPending} ID card${idPending === 1 ? "" : "s"} pending in the queue.`);
  if (overdueRequests + overdueIdCards > 0) highlights.push(`${overdueRequests + overdueIdCards} request${overdueRequests + overdueIdCards === 1 ? "" : "s"} open beyond 3 days.`);
  highlights.push(`${assetsAssigned} assets in use · ${utilisation}% utilisation.`);

  const recommendation = overdueRequests + overdueIdCards > 0
    ? `Clear ${overdueRequests + overdueIdCards} overdue setup task${overdueRequests + overdueIdCards === 1 ? "" : "s"} to unblock joiners.`
    : joinersAwaiting > 0
      ? `Complete IT setup for ${joinersAwaiting} waiting joiner${joinersAwaiting === 1 ? "" : "s"}.`
      : "IT queues are clear — review idle/returned assets for redeployment.";

  return {
    emailPending, emailCompleted, assets, idCards,
    pendingCount, completedCount, resolutionRate, avgEmailHours, avgIdCardHours,
    assetsAssigned, assetsReturned, utilisation, idPending, idReady, idDone,
    joinersAwaiting, overdueRequests, overdueIdCards,
    score, band, highlights: highlights.slice(0, 5), recommendation,
  };
}

// ─── Header + KPIs ────────────────────────────────────────────────────────────

function ItServiceHeader({ m }: { m: ItMetrics }) {
  const stats = [
    { label: "Resolution", value: `${m.resolutionRate}%`, sub: "email requests" },
    { label: "Avg setup", value: m.avgEmailHours != null ? `${m.avgEmailHours}h` : "—", sub: "per request" },
    { label: "Utilisation", value: `${m.utilisation}%`, sub: `${m.assetsAssigned} assigned` },
    { label: "Awaiting", value: m.joinersAwaiting, sub: "joiners in setup" },
  ];
  return (
    <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={CARD_STYLE}>
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(ellipse at 12% 0%, ${m.band.dot}22 0%, transparent 55%)` }} />
      <div className="relative grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.55)" }}>
            <span aria-hidden>{m.band.emoji}</span> IT Service Health Score
          </p>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-5xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{m.score}</span>
            <span className="pb-1 text-lg font-medium" style={{ color: "rgba(197,203,232,0.4)" }}>/ 100</span>
          </div>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${m.band.dot}1f`, color: m.band.dot }}>{m.band.label}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/dashboard/it-requests"><Button size="sm" className="rounded-xl text-xs">IT requests <ArrowRight className="ml-1 h-3.5 w-3.5" /></Button></Link>
            {m.overdueRequests + m.overdueIdCards > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300">
                <AlertTriangle className="h-3.5 w-3.5" /> {m.overdueRequests + m.overdueIdCards} overdue
              </span>
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="truncate text-[10px] uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.45)" }}>{s.label}</p>
                <p className="mt-1 text-xl font-bold" style={{ color: "#C5CBE8" }}>{s.value}</p>
                <p className="truncate text-[10px]" style={{ color: "rgba(197,203,232,0.4)" }}>{s.sub}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" /> AI Operations Summary</p>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {m.highlights.map((h) => <li key={h} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}><span className="text-primary">•</span><span className="min-w-0">{h}</span></li>)}
            </ul>
            <p className="mt-2.5 border-t border-white/10 pt-2.5 text-xs" style={{ color: "rgba(197,203,232,0.78)" }}><span className="font-semibold text-primary">Recommendation:</span> {m.recommendation}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function ItKpiRow({ m }: { m: ItMetrics }) {
  const kpis: Array<{ label: string; value: string | number; sub: string; icon: IconType; tone: Tone; href: string }> = [
    { label: "Active Requests", value: m.pendingCount, sub: "email setup pending", icon: Mail, tone: m.pendingCount ? "warning" : "success", href: "/dashboard/it-requests" },
    { label: "Resolution Rate", value: `${m.resolutionRate}%`, sub: `${m.completedCount} completed`, icon: CheckCircle2, tone: m.resolutionRate >= 80 ? "success" : "warning", href: "/dashboard/it-requests" },
    { label: "Avg Resolution", value: m.avgEmailHours != null ? `${m.avgEmailHours}h` : "—", sub: "email setup time", icon: Clock3, tone: "default", href: "/dashboard/it-requests" },
    { label: "Assets Assigned", value: m.assetsAssigned, sub: `${m.utilisation}% utilisation`, icon: Laptop, tone: "success", href: "/dashboard/it/assets" },
    { label: "Assets Returned", value: m.assetsReturned, sub: "awaiting redeploy", icon: Laptop, tone: m.assetsReturned ? "warning" : "default", href: "/dashboard/it/assets" },
    { label: "ID Cards Pending", value: m.idPending, sub: `${m.idDone} created`, icon: CreditCard, tone: m.idPending ? "warning" : "success", href: "/dashboard/it/id-cards" },
    { label: "Joiners Awaiting IT", value: m.joinersAwaiting, sub: "email + ID pending", icon: Users, tone: m.joinersAwaiting ? "warning" : "success", href: "/dashboard/it-requests" },
    { label: "Overdue (>3d)", value: m.overdueRequests + m.overdueIdCards, sub: "past 3 days", icon: AlertTriangle, tone: m.overdueRequests + m.overdueIdCards ? "danger" : "success", href: "/dashboard/it-requests" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map((k) => {
        const Icon = k.icon;
        return (
          <Link key={k.label} href={k.href} className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30" style={CARD_STYLE}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}>{k.label}</p>
                <p className="mt-1.5 text-2xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{k.value}</p>
              </div>
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[k.tone])}><Icon className="h-4 w-4" /></div>
            </div>
            <p className="mt-2 truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{k.sub}</p>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Operations health ────────────────────────────────────────────────────────

function ItOperationsHealth({ m }: { m: ItMetrics }) {
  const readyToDistribute = m.idCards.filter((c) => c.status === "ready").length;
  const items: Array<{ label: string; value: number; overdue: number; icon: IconType; href: string }> = [
    { label: "Email Accounts Pending", value: m.pendingCount, overdue: m.overdueRequests, icon: Mail, href: "/dashboard/it-requests" },
    { label: "ID Cards Pending", value: m.idPending, overdue: m.overdueIdCards, icon: CreditCard, href: "/dashboard/it/id-cards" },
    { label: "ID Cards Ready to Issue", value: readyToDistribute, overdue: 0, icon: CheckCircle2, href: "/dashboard/it/id-cards" },
    { label: "Asset Returns", value: m.assetsReturned, overdue: 0, icon: Laptop, href: "/dashboard/it/assets" },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((it) => {
        const Icon = it.icon;
        const status = it.overdue > 0 ? { label: `${it.overdue} overdue`, color: "#ef4444" } : it.value > 0 ? { label: "In progress", color: "#f59e0b" } : { label: "Clear", color: "#22c55e" };
        return (
          <Link key={it.label} href={it.href} className="min-w-0 rounded-2xl p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30" style={CARD_STYLE}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary"><Icon className="h-4 w-4" /></div>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: `${status.color}22`, color: status.color }}>{status.label}</span>
            </div>
            <p className="mt-2.5 text-2xl font-bold" style={{ color: "#C5CBE8" }}>{it.value}</p>
            <p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.5)" }}>{it.label}</p>
            <div className="mt-2 h-1.5 rounded-full" style={{ background: "rgba(144,141,206,0.14)" }}>
              <div className="h-full rounded-full" style={{ width: `${it.value ? Math.min(100, it.value * 8) : 3}%`, background: status.color }} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}

// ─── Request pipeline + demand trend ─────────────────────────────────────────

function ItRequestPipeline({ m }: { m: ItMetrics }) {
  const raised = m.pendingCount + m.completedCount + m.idCards.length;
  const stages = [
    { label: "Raised", value: raised },
    { label: "In Progress", value: m.pendingCount + m.idPending - m.idReady },
    { label: "Ready / Awaiting", value: m.idReady + m.pendingCount },
    { label: "Completed", value: m.completedCount + m.idDone },
  ];
  const max = Math.max(...stages.map((s) => s.value), 1);
  return (
    <Panel title="IT Request Pipeline" subtitle="Where onboarding IT work sits" icon={Activity} action={{ label: "IT requests", href: "/dashboard/it-requests" }}>
      <div className="space-y-2.5">
        {stages.map((s, i) => (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: "rgba(197,203,232,0.65)" }}>{s.label}</span>
              <span className="font-semibold" style={{ color: "#C5CBE8" }}>{Math.max(0, s.value)}</span>
            </div>
            <div className="mx-auto h-3 rounded-full" style={{ width: `${Math.max(20, (Math.max(0, s.value) / max) * 100)}%`, background: CHART_COLORS[i % CHART_COLORS.length], opacity: 0.85 }} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ItDemandTrend({ m, nowMs }: { m: ItMetrics; nowMs: number }) {
  const slots = monthSlots(nowMs);
  const inMonth = (iso: string | undefined | null, key: string) => Boolean(iso) && String(iso).slice(0, 7) === key;
  const data = slots.map((s) => ({
    month: s.label,
    Email: [...m.emailPending, ...m.emailCompleted].filter((r) => inMonth(r.createdAt, s.key)).length,
    "ID Cards": m.idCards.filter((c) => inMonth(c.submittedAt, s.key)).length,
    Assets: m.assets.filter((a) => inMonth(a.assignedAt ?? a.createdAt, s.key)).length,
  }));
  const empty = data.every((d) => d.Email === 0 && d["ID Cards"] === 0 && d.Assets === 0);
  const series = [{ key: "Email", color: "#38BDF8" }, { key: "ID Cards", color: "#ED00ED" }, { key: "Assets", color: "#22c55e" }];
  return (
    <Panel title="Monthly IT Demand" subtitle="Email, ID cards, and asset activity · last 6 months" icon={TrendingUp}>
      {empty ? (
        <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No IT activity recorded in the last six months.</p>
      ) : (
        <ResponsiveContainer width="100%" height={230}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              {series.map((s) => <linearGradient key={s.key} id={`it-${s.key.replace(/\s/g, "")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={s.color} stopOpacity={0.28} /><stop offset="95%" stopColor={s.color} stopOpacity={0} /></linearGradient>)}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            {series.map((s) => <Area key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} fill={`url(#it-${s.key.replace(/\s/g, "")})`} dot={false} />)}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ─── Workload distribution + resolution time ─────────────────────────────────

function ItWorkloadDistribution({ m }: { m: ItMetrics }) {
  const typeGroups = new Map<string, number>();
  m.assets.forEach((a) => { const k = a.assetType ? formatLabel(a.assetType) : "Other"; typeGroups.set(k, (typeGroups.get(k) ?? 0) + 1); });
  const rows: BarRow[] = [
    { label: "Email Accounts", value: m.pendingCount + m.completedCount, href: "/dashboard/it-requests" },
    { label: "ID Cards", value: m.idCards.length, href: "/dashboard/it/id-cards" },
    ...[...typeGroups.entries()].map(([label, value]) => ({ label, value, href: "/dashboard/it/assets" })),
  ].sort((a, b) => b.value - a.value);
  return (
    <Panel title="Workload by Area" subtitle="IT requests and assets by type" icon={BarChart3} action={{ label: "Assets", href: "/dashboard/it/assets" }}>
      <HBarList rows={rows} maxRows={8} />
    </Panel>
  );
}

function ItResolutionTime({ m }: { m: ItMetrics }) {
  const rows = [
    { label: "Email Setup", value: m.avgEmailHours ?? 0, fill: "#38BDF8" },
    { label: "ID Card", value: m.avgIdCardHours ?? 0, fill: "#ED00ED" },
  ];
  const max = Math.max(...rows.map((r) => r.value), 1);
  const has = rows.some((r) => r.value > 0);
  return (
    <Panel title="Average Resolution Time" subtitle="Hours from request to completion" icon={Clock3} action={{ label: "IT requests", href: "/dashboard/it-requests" }}>
      {!has ? (
        <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>Not enough completed requests to measure resolution time.</p>
      ) : (
        <div className="space-y-4 pt-2">
          {rows.map((r) => (
            <div key={r.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: "rgba(197,203,232,0.65)" }}>{r.label}</span>
                <span className="font-semibold" style={{ color: "#C5CBE8" }}>{r.value}h</span>
              </div>
              <div className="h-2.5 rounded-full" style={{ background: "rgba(144,141,206,0.14)" }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(3, (r.value / max) * 100)}%`, background: r.fill }} />
              </div>
            </div>
          ))}
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>Measured from request/submission timestamps.</p>
        </div>
      )}
    </Panel>
  );
}

// ─── Asset inventory (stacked) + utilisation (gauge) ─────────────────────────

function AssetInventory({ m }: { m: ItMetrics }) {
  const map = new Map<string, { type: string; Assigned: number; Returned: number }>();
  m.assets.forEach((a) => {
    const key = a.assetType ? formatLabel(a.assetType) : "Other";
    const row = map.get(key) ?? { type: key, Assigned: 0, Returned: 0 };
    if (a.status === "returned") row.Returned += 1; else row.Assigned += 1;
    map.set(key, row);
  });
  const chart = [...map.values()].sort((a, b) => (b.Assigned + b.Returned) - (a.Assigned + a.Returned)).slice(0, 6);
  return (
    <Panel title="Asset Inventory" subtitle={`${m.assets.length} asset records by type`} icon={Laptop} action={{ label: "Inventory", href: "/dashboard/it/assets" }}>
      {chart.length === 0 ? (
        <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No asset records yet.</p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(200, chart.length * 42)}>
          <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }} barSize={16}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <YAxis type="category" dataKey="type" width={110} tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            <Bar dataKey="Assigned" stackId="a" fill="#22c55e" />
            <Bar dataKey="Returned" stackId="a" fill="#f59e0b" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

function AssetUtilisation({ m }: { m: ItMetrics }) {
  const value = m.utilisation;
  const gaugeData = [{ name: "Assigned", value, fill: value >= 80 ? "#ef4444" : value >= 50 ? "#22c55e" : "#f59e0b" }, { name: "Free", value: 100 - value, fill: "rgba(144,141,206,0.15)" }];
  return (
    <Panel title="Asset Utilisation" subtitle="Share of assets currently in use" icon={Gauge} action={{ label: "Inventory", href: "/dashboard/it/assets" }}>
      <div className="flex flex-col items-center">
        <div className="relative h-32 w-56">
          <PieChart width={224} height={128}>
            <Pie data={gaugeData} cx={112} cy={112} startAngle={180} endAngle={0} innerRadius={70} outerRadius={104} dataKey="value" strokeWidth={0}>
              {gaugeData.map((g, i) => <Cell key={i} fill={g.fill} />)}
            </Pie>
          </PieChart>
          <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
            <span className="text-3xl font-bold" style={{ color: "#C5CBE8" }}>{value}%</span>
            <span className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>in use</span>
          </div>
        </div>
        <div className="mt-2 grid w-full grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5 text-center">
            <p className="text-lg font-bold text-emerald-400">{m.assetsAssigned}</p>
            <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Assigned</p>
          </div>
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-2.5 text-center">
            <p className="text-lg font-bold text-amber-400">{m.assetsReturned}</p>
            <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Returned</p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ─── Onboarding readiness timeline ────────────────────────────────────────────

function OnboardingReadiness({ m }: { m: ItMetrics }) {
  const total = m.pendingCount + m.completedCount;
  const idTotal = m.idCards.length;
  const stages = [
    { label: "Email Requested", done: total, pending: 0 },
    { label: "Email Created", done: m.completedCount, pending: m.pendingCount },
    { label: "ID Submitted", done: idTotal, pending: 0 },
    { label: "ID Ready", done: m.idReady + m.idDone, pending: Math.max(0, m.idPending - m.idReady) },
    { label: "ID Card Issued", done: m.idDone, pending: m.idPending },
  ];
  return (
    <Panel title="Onboarding Readiness Tracker" subtitle="IT setup progress for joiners · email + ID card pipeline" icon={CheckCircle2} action={{ label: "ID card queue", href: "/dashboard/it/id-cards" }}>
      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-stretch gap-1.5">
          {stages.map((s, i) => (
            <div key={s.label} className="flex items-center gap-1.5">
              <div className="flex w-[128px] shrink-0 flex-col rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <span className="truncate text-[11px] font-medium" style={{ color: "rgba(197,203,232,0.6)" }}>{s.label}</span>
                <span className="mt-1.5 text-xl font-bold leading-none text-emerald-400">{s.done}</span>
                <span className={cn("mt-1 text-[11px] font-medium", s.pending > 0 ? "text-amber-400" : "text-emerald-400")}>{s.pending > 0 ? `${s.pending} pending` : "clear"}</span>
              </div>
              {i < stages.length - 1 && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

// ─── Joiner readiness matrix (role × ID card) ────────────────────────────────

function JoinerReadinessMatrix({ m }: { m: ItMetrics }) {
  const deptMap = new Map<string, { dept: string; total: number; done: number; ready: number }>();
  m.idCards.forEach((c) => {
    const key = c.designation?.trim() || "Unassigned";
    const row = deptMap.get(key) ?? { dept: key, total: 0, done: 0, ready: 0 };
    row.total += 1;
    if (c.status === "done") row.done += 1; else if (c.status === "ready") row.ready += 1;
    deptMap.set(key, row);
  });
  const rows = [...deptMap.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  const cell = (pct: number) => pct >= 80 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444";
  return (
    <Panel title="Joiner Readiness by Role" subtitle="ID-card completion per role" icon={ShieldCheck} action={{ label: "ID card queue", href: "/dashboard/it/id-cards" }}>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No joiners in the ID-card queue.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const donePct = r.total ? Math.round((r.done / r.total) * 100) : 0;
            const readyPct = r.total ? Math.round(((r.done + r.ready) / r.total) * 100) : 0;
            return (
              <div key={r.dept} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-xs" style={{ color: "rgba(197,203,232,0.65)" }}>{r.dept}</span>
                <div className="flex flex-1 items-center gap-1.5">
                  <div className="flex-1 rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold" style={{ background: `${cell(readyPct)}22`, color: cell(readyPct) }}>{readyPct}% ready</div>
                  <div className="flex-1 rounded-lg px-2 py-1.5 text-center text-[11px] font-semibold" style={{ background: `${cell(donePct)}22`, color: cell(donePct) }}>{donePct}% issued</div>
                  <span className="w-10 shrink-0 text-right text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{r.total}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Pending request aging ────────────────────────────────────────────────────

function PendingAging({ m, nowMs }: { m: ItMetrics; nowMs: number }) {
  type Row = { type: string; who: string; days: number; href: string };
  const rows: Row[] = [];
  m.emailPending.forEach((r) => { if (r.createdAt) rows.push({ type: "Email Account", who: r.candidateName ?? "—", days: Math.floor((nowMs - new Date(r.createdAt).getTime()) / DAY_MS), href: "/dashboard/it-requests" }); });
  m.idCards.filter((c) => c.status !== "done").forEach((c) => { if (c.submittedAt) rows.push({ type: "ID Card", who: c.name ?? c.candidateName ?? "—", days: Math.floor((nowMs - new Date(c.submittedAt).getTime()) / DAY_MS), href: "/dashboard/it/id-cards" }); });
  rows.sort((a, b) => b.days - a.days);
  const bucketOf = (d: number) => d < 1 ? "Today" : d <= 3 ? "1–3 days" : d <= 7 ? "4–7 days" : ">7 days";
  const buckets = ["Today", "1–3 days", "4–7 days", ">7 days"];
  const counts = buckets.map((b) => rows.filter((r) => bucketOf(r.days) === b).length);
  return (
    <Panel title="Pending Request Aging" subtitle="Open IT setup tasks by age · overdue in red" icon={Clock3} action={{ label: "IT requests", href: "/dashboard/it-requests" }}>
      <div className="mb-3 grid grid-cols-4 gap-2">
        {buckets.map((b, i) => (
          <div key={b} className={cn("rounded-xl border p-2.5 text-center", i >= 2 ? "border-red-500/20 bg-red-500/[0.06]" : "border-white/10 bg-white/[0.03]")}>
            <p className={cn("text-lg font-bold", i >= 2 ? "text-red-400" : "")} style={i >= 2 ? undefined : { color: "#C5CBE8" }}>{counts[i]}</p>
            <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>{b}</p>
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No pending IT requests.</p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {rows.slice(0, 12).map((r, i) => {
            const overdue = r.days > 3;
            return (
              <Link key={i} href={r.href} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 transition-colors hover:border-primary/30">
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", overdue ? "bg-red-500/15 text-red-300" : "bg-sky-500/15 text-sky-300")}>{r.type}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{r.who}</span>
                <span className={cn("shrink-0 text-xs font-semibold", overdue ? "text-red-400" : "")} style={overdue ? undefined : { color: "rgba(197,203,232,0.6)" }}>{r.days === 0 ? "today" : `${r.days}d`}</span>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Asset treemap (CSS) + automation opportunity ────────────────────────────

function AssetTreemap({ m }: { m: ItMetrics }) {
  const map = new Map<string, { type: string; total: number; assigned: number }>();
  m.assets.forEach((a) => {
    const key = a.assetType ? formatLabel(a.assetType) : "Other";
    const row = map.get(key) ?? { type: key, total: 0, assigned: 0 };
    row.total += 1;
    if (a.status === "assigned") row.assigned += 1;
    map.set(key, row);
  });
  const tiles = [...map.values()].sort((a, b) => b.total - a.total).slice(0, 8);
  const grand = tiles.reduce((t, x) => t + x.total, 0) || 1;
  return (
    <Panel title="Asset Mix" subtitle="Blocks sized by volume · shade by utilisation" icon={Laptop} action={{ label: "Inventory", href: "/dashboard/it/assets" }}>
      {tiles.length === 0 ? (
        <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No asset records yet.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {tiles.map((t) => {
            const util = t.total ? Math.round((t.assigned / t.total) * 100) : 0;
            const basis = Math.max(22, Math.round((t.total / grand) * 100));
            return (
              <Link key={t.type} href="/dashboard/it/assets" className="flex min-h-[72px] min-w-[96px] flex-col justify-between rounded-xl border border-white/10 p-2.5 transition-transform hover:-translate-y-0.5" style={{ flex: `1 1 ${basis}%`, background: `rgba(34,197,94,${0.08 + (util / 100) * 0.28})` }}>
                <span className="truncate text-[11px] font-medium" style={{ color: "#C5CBE8" }}>{t.type}</span>
                <div>
                  <span className="text-xl font-bold" style={{ color: "#C5CBE8" }}>{t.total}</span>
                  <span className="ml-1 text-[10px]" style={{ color: "rgba(197,203,232,0.5)" }}>{util}% used</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function AutomationOpportunity({ m }: { m: ItMetrics }) {
  // Estimated manual effort per task type (labelled as estimates — not measured).
  const tasks = [
    { label: "Email Creation", volume: m.pendingCount + m.completedCount, mins: 15 },
    { label: "ID Card Generation", volume: m.idCards.length, mins: 20 },
    { label: "Asset Assignment", volume: m.assetsAssigned, mins: 10 },
  ].filter((t) => t.volume > 0);
  const totalHours = Math.round(tasks.reduce((h, t) => h + (t.volume * t.mins) / 60, 0));
  const automatable = Math.round(totalHours * 0.6);
  return (
    <Panel title="Automation Opportunity" subtitle="Estimated effort that could be automated" icon={Zap}>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-primary/20 bg-primary/[0.06] p-3 text-center">
          <p className="text-2xl font-bold text-primary">~{automatable}h</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Automatable / period</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
          <p className="text-2xl font-bold" style={{ color: "#C5CBE8" }}>60%</p>
          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>of ~{totalHours}h manual effort</p>
        </div>
      </div>
      <div className="space-y-1.5">
        {tasks.map((t) => (
          <div key={t.label} className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
            <span style={{ color: "rgba(197,203,232,0.65)" }}>{t.label}</span>
            <span className="font-semibold" style={{ color: "#C5CBE8" }}>{t.volume} × {t.mins}m</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>Effort per task is an estimate, not measured.</p>
    </Panel>
  );
}

// ─── AI insights + critical alerts + quick actions ───────────────────────────

function AiOpsInsights({ m }: { m: ItMetrics }) {
  const insights: Array<{ text: string; icon: IconType; href: string; cta: string }> = [];
  if (m.overdueRequests + m.overdueIdCards > 0) insights.push({ text: `${m.overdueRequests + m.overdueIdCards} IT setup task${m.overdueRequests + m.overdueIdCards === 1 ? "" : "s"} open beyond 3 days.`, icon: AlertTriangle, href: "/dashboard/it-requests", cta: "Clear" });
  if (m.idReady > 0) insights.push({ text: `${m.idReady} ID card${m.idReady === 1 ? "" : "s"} ready to issue.`, icon: CreditCard, href: "/dashboard/it/id-cards", cta: "Issue" });
  if (m.assetsReturned > 0) insights.push({ text: `${m.assetsReturned} returned asset${m.assetsReturned === 1 ? "" : "s"} available for redeployment.`, icon: Laptop, href: "/dashboard/it/assets", cta: "Redeploy" });
  if (m.avgEmailHours != null) insights.push({ text: `Email setup averages ${m.avgEmailHours}h — automation could cut this.`, icon: Zap, href: "/dashboard/it-requests", cta: "Review" });
  if (insights.length === 0) insights.push({ text: "IT queues are clear — inventory and onboarding are on track.", icon: CheckCircle2, href: "/dashboard/it/assets", cta: "Open" });
  return (
    <Panel title="AI Operations Insights" subtitle="Recommendations from live IT data" icon={Sparkles}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {insights.slice(0, 4).map((x) => {
          const Icon = x.icon;
          return (
            <Link key={x.text} href={x.href} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{x.text}</p>
                <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">{x.cta} <ArrowRight className="h-3 w-3" /></span>
              </div>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

function ItCriticalAlerts({ m, nowMs }: { m: ItMetrics; nowMs: number }) {
  type Alert = { label: string; value: number; priority: "High" | "Medium"; href: string; icon: IconType };
  const alerts: Alert[] = [];
  const overdueEmail = m.emailPending.filter((r) => r.createdAt && nowMs - new Date(r.createdAt).getTime() > 3 * DAY_MS).length;
  if (overdueEmail > 0) alerts.push({ label: "Email setups overdue (>3d)", value: overdueEmail, priority: "High", href: "/dashboard/it-requests", icon: Mail });
  if (m.overdueIdCards > 0) alerts.push({ label: "ID cards overdue (>3d)", value: m.overdueIdCards, priority: "High", href: "/dashboard/it/id-cards", icon: CreditCard });
  if (m.idReady > 0) alerts.push({ label: "ID cards ready, not issued", value: m.idReady, priority: "Medium", href: "/dashboard/it/id-cards", icon: CheckCircle2 });
  if (m.pendingCount > 0) alerts.push({ label: "Joiners waiting for email", value: m.pendingCount, priority: "Medium", href: "/dashboard/it-requests", icon: Users });
  if (m.assetsReturned > 0) alerts.push({ label: "Returned assets to collect", value: m.assetsReturned, priority: "Medium", href: "/dashboard/it/assets", icon: Laptop });
  alerts.sort((a, b) => (a.priority === b.priority ? b.value - a.value : a.priority === "High" ? -1 : 1));
  return (
    <Panel title="Critical Alerts" subtitle="Actionable IT items, most urgent first" icon={AlertTriangle}>
      {alerts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>No critical IT alerts.</p></div>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {alerts.map((a) => {
            const Icon = a.icon;
            const high = a.priority === "High";
            return (
              <Link key={a.label} href={a.href} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", high ? "bg-red-500/15 text-red-400" : "bg-amber-500/15 text-amber-400")}><Icon className="h-4 w-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{a.label}</p>
                  <span className={cn("text-[10px] font-semibold", high ? "text-red-300" : "text-amber-300")}>{a.priority}</span>
                </div>
                <span className="shrink-0 text-lg font-bold text-primary">{a.value}</span>
              </Link>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

function ItQuickActions() {
  const actions: Array<{ label: string; href: string; icon: IconType }> = [
    { label: "Create Email", href: "/dashboard/it-requests", icon: Mail },
    { label: "Assign Asset", href: "/dashboard/it/assets", icon: Laptop },
    { label: "Generate ID Card", href: "/dashboard/it/id-cards", icon: CreditCard },
    { label: "Register Asset", href: "/dashboard/it/assets", icon: Laptop },
    { label: "Return Asset", href: "/dashboard/it/assets", icon: ArrowRight },
    { label: "Raise IT Ticket", href: "/dashboard/it-requests", icon: FileText },
    { label: "ID Card Queue", href: "/dashboard/it/id-cards", icon: CreditCard },
    { label: "IT Requests", href: "/dashboard/it-requests", icon: BarChart3 },
  ];
  return (
    <Panel title="Quick Actions" subtitle="Common IT service tasks">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.label} href={a.href}>
              <Button variant="outline" className="h-11 w-full justify-start rounded-xl text-xs"><Icon className="mr-2 h-4 w-4 text-primary" /> {a.label}</Button>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

function ItOperationsView({ data, module }: { data: DashboardData; module: ModuleView }) {
  void module;
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const m = useMemo(() => (nowMs == null ? null : deriveItOps(data, nowMs)), [data, nowMs]);
  if (nowMs == null || m == null) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  return (
    <>
      <ItServiceHeader m={m} />
      <ItKpiRow m={m} />
      <ItOperationsHealth m={m} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)] xl:items-start">
        <ItRequestPipeline m={m} />
        <ItDemandTrend m={m} nowMs={nowMs} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <ItWorkloadDistribution m={m} />
        <ItResolutionTime m={m} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <AssetInventory m={m} />
        <AssetUtilisation m={m} />
      </div>
      <OnboardingReadiness m={m} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <JoinerReadinessMatrix m={m} />
        <PendingAging m={m} nowMs={nowMs} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <AssetTreemap m={m} />
        <AutomationOpportunity m={m} />
      </div>
      <AiOpsInsights m={m} />
      <ItCriticalAlerts m={m} nowMs={nowMs} />
      <ItQuickActions />
    </>
  );
}

// ─── Finance dashboard ──────────────────────────────────────────────────────

// ─── Finance · Executive Financial Control Center ───────────────────────────
//
// Decision-support view over the finance-scoped data: reimbursements (rich —
// amount, currency, category, department, project, receipt + manager/finance/
// paid timestamps), dinner requests (counts/timing — no cost is stored) and
// bank-verification (penny-drop status — no department/location field). There
// is NO stored FX rate, so INR and USD are always shown separately, never
// merged (matching the brief's own data rule). Geographic spend, cost centres
// and dinner cost are omitted because the data does not exist.

type Reimb = {
  status?: string | null;
  statusLabel?: string | null;
  expenseAmount?: number | null;
  currency?: string | null;
  category?: string | null;
  department?: string | null;
  projectName?: string | null;
  employeeName?: string | null;
  employeeCode?: string | null;
  managerName?: string | null;
  receiptFileUrl?: string | null;
  missingFields?: string[];
  submittedAt?: string | null;
  createdAt?: string | null;
  managerReviewedAt?: string | null;
  financeReviewedAt?: string | null;
  paidAt?: string | null;
};
type Dinner = { status?: string | null; requesterName?: string | null; projectName?: string | null; teamMemberCount?: number | null; submittedAt?: string | null; reviewedAt?: string | null; dinnerDate?: string | null };
type Bank = { status?: string; name?: string; isHdfc?: boolean; hasBankDetails?: boolean; validatedAt?: string | null };

type Cur = "INR" | "USD" | "both";

const isPaidStatus = (s: string) => PAID_REIMBURSEMENT_STATUSES.has(s);
const isPendingStatus = (s: string) => PENDING_REIMBURSEMENT_STATUSES.has(s);
const isRejected = (s: string) => /reject/i.test(s);
const isReturned = (s: string) => /return/i.test(s);
const amt = (r: Reimb) => Number(r.expenseAmount ?? 0);
const curOf = (r: Reimb) => (String(r.currency ?? "INR").toUpperCase() === "USD" ? "USD" : "INR");
const hasReceipt = (r: Reimb) => Boolean(r.receiptFileUrl) && !(r.missingFields ?? []).some((f) => /receipt/i.test(f));
const daysBetween = (a?: string | null, b?: string | null): number | null => {
  if (!a || !b) return null;
  const x = new Date(a).getTime(); const y = new Date(b).getTime();
  return Number.isFinite(x) && Number.isFinite(y) && y >= x ? (y - x) / DAY_MS : null;
};

function fmtFin(n: number, cur: "INR" | "USD" = "INR"): string {
  const sym = cur === "USD" ? "$" : "₹";
  const a = Math.abs(n);
  if (cur === "USD") { if (a >= 1e6) return `${sym}${(n / 1e6).toFixed(2)}M`; if (a >= 1e3) return `${sym}${(n / 1e3).toFixed(1)}K`; return `${sym}${Math.round(n).toLocaleString("en-US")}`; }
  if (a >= 1e7) return `${sym}${(n / 1e7).toFixed(2)}Cr`;
  if (a >= 1e5) return `${sym}${(n / 1e5).toFixed(2)}L`;
  if (a >= 1e3) return `${sym}${(n / 1e3).toFixed(1)}K`;
  return `${sym}${Math.round(n).toLocaleString("en-IN")}`;
}

const SLA_APPROVAL_DAYS = 3;

type FinMetrics = {
  claims: Reimb[];
  dinners: Dinner[];
  bank: Bank[];
  cur: "INR" | "USD";
  total: number;
  pendingAmt: number;
  paidAmt: number;
  submittedAmt: number;
  avgClaim: number;
  monthSpend: number;
  pendingCount: number;
  missingReceipts: number;
  avgApprovalDays: number | null;
  avgPaymentDays: number | null;
  slaBreachPct: number;
  bankTotal: number;
  bankVerified: number;
  bankPct: number;
  dinnerPending: number;
  score: number;
  band: HealthBand;
  blockers: string[];
  summary: string[];
};

function deriveFinance(data: DashboardData, cur: "INR" | "USD", nowMs: number): FinMetrics {
  const all = (data.reimbursements ?? []) as unknown as Reimb[];
  const claims = all.filter((r) => curOf(r) === cur);
  const dinners = (data.dinners ?? []) as unknown as Dinner[];
  const bank = (data.bankVerification ?? []) as unknown as Bank[];

  const pendingAmt = claims.filter((r) => isPendingStatus(String(r.status ?? ""))).reduce((s, r) => s + amt(r), 0);
  const paidAmt = claims.filter((r) => isPaidStatus(String(r.status ?? ""))).reduce((s, r) => s + amt(r), 0);
  const submittedAmt = claims.reduce((s, r) => s + amt(r), 0);
  const avgClaim = claims.length ? Math.round(submittedAmt / claims.length) : 0;

  const d = new Date(nowMs); const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthSpend = claims.filter((r) => String(r.submittedAt ?? r.createdAt ?? "").slice(0, 7) === monthKey).reduce((s, r) => s + amt(r), 0);

  const pendingCount = claims.filter((r) => isPendingStatus(String(r.status ?? ""))).length;
  const missingReceipts = claims.filter((r) => !hasReceipt(r)).length;

  const approvalTimes = claims.map((r) => daysBetween(r.submittedAt ?? r.createdAt, r.financeReviewedAt)).filter((x): x is number => x != null);
  const avgApprovalDays = approvalTimes.length ? Math.round((approvalTimes.reduce((a, b) => a + b, 0) / approvalTimes.length) * 10) / 10 : null;
  const paymentTimes = claims.map((r) => daysBetween(r.financeReviewedAt, r.paidAt)).filter((x): x is number => x != null);
  const avgPaymentDays = paymentTimes.length ? Math.round((paymentTimes.reduce((a, b) => a + b, 0) / paymentTimes.length) * 10) / 10 : null;
  const slaBreachPct = approvalTimes.length ? Math.round((approvalTimes.filter((t) => t > SLA_APPROVAL_DAYS).length / approvalTimes.length) * 100) : 0;

  const bankTotal = bank.length;
  const bankVerified = bank.filter((b) => b.status === "validated").length;
  const bankPct = bankTotal ? Math.round((bankVerified / bankTotal) * 100) : 100;
  const dinnerPending = dinners.filter((x) => /pending/i.test(String(x.status ?? ""))).length;

  const backlogScore = Math.max(10, 100 - Math.min(90, pendingCount * 4));
  const receiptScore = claims.length ? Math.round((1 - missingReceipts / claims.length) * 100) : 100;
  const score = Math.max(0, Math.min(100, Math.round(0.3 * backlogScore + 0.25 * bankPct + 0.2 * receiptScore + 0.25 * (100 - slaBreachPct))));
  const band = healthBand(score);

  const blockers: string[] = [];
  if (bankTotal - bankVerified > 0) blockers.push(`${bankTotal - bankVerified} accounts missing bank verification`);
  if (pendingAmt > 0) blockers.push(`${fmtFin(pendingAmt, cur)} pending approval`);
  if (avgApprovalDays != null) blockers.push(`Average approval delay ${avgApprovalDays} days`);
  if (missingReceipts > 0) blockers.push(`${missingReceipts} claims missing receipts`);

  const summary: string[] = [];
  summary.push(`${fmtFin(paidAmt, cur)} reimbursed · ${fmtFin(pendingAmt, cur)} pending approval.`);
  summary.push(`${claims.length} ${cur} claims · avg ${fmtFin(avgClaim, cur)} each.`);
  if (avgApprovalDays != null) summary.push(`Claims approved in ${avgApprovalDays} days on average · ${slaBreachPct}% breach the ${SLA_APPROVAL_DAYS}-day SLA.`);
  summary.push(`Bank verification completion at ${bankPct}%${bankPct < 30 ? " — creating onboarding delays" : ""}.`);

  return { claims, dinners, bank, cur, total: claims.length, pendingAmt, paidAmt, submittedAmt, avgClaim, monthSpend, pendingCount, missingReceipts, avgApprovalDays, avgPaymentDays, slaBreachPct, bankTotal, bankVerified, bankPct, dinnerPending, score, band, blockers: blockers.slice(0, 4), summary: summary.slice(0, 4) };
}

// ─── Header (health + summary + currency toggle) ─────────────────────────────

function FinanceHeader({ m, cur, onCur }: { m: FinMetrics; cur: Cur; onCur: (c: Cur) => void }) {
  return (
    <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={CARD_STYLE}>
      <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: `radial-gradient(ellipse at 12% 0%, ${m.band.dot}22 0%, transparent 55%)` }} />
      <div className="relative grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)] lg:items-center">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.55)" }}><span aria-hidden>{m.band.emoji}</span> Finance Health Score</p>
          <div className="mt-2 flex items-end gap-2"><span className="text-5xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{m.score}</span><span className="pb-1 text-lg font-medium" style={{ color: "rgba(197,203,232,0.4)" }}>/ 100</span></div>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: `${m.band.dot}1f`, color: m.band.dot }}>{m.band.label}</p>
          <div className="mt-3 flex gap-1.5">
            {(["INR", "USD", "both"] as Cur[]).map((c) => (
              <button key={c} onClick={() => onCur(c)} className={cn("rounded-full border px-3 py-1 text-[11px] font-medium transition-colors", cur === c ? "border-primary bg-primary/15 text-primary" : "border-white/10 text-muted-foreground hover:border-primary/30")}>{c === "both" ? "Both" : c}</button>
            ))}
          </div>
        </div>
        <div className="min-w-0 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.06] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-400"><AlertTriangle className="h-3.5 w-3.5" /> Top Blockers</p>
            <ul className="space-y-1.5">{m.blockers.map((b) => <li key={b} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}><span className="text-amber-400">•</span><span className="min-w-0">{b}</span></li>)}</ul>
          </div>
          <div className="rounded-xl border border-primary/20 bg-primary/[0.07] p-3.5">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary"><Sparkles className="h-3.5 w-3.5" /> Finance Summary</p>
            <ul className="space-y-1.5">{m.summary.map((s) => <li key={s} className="flex gap-1.5 text-xs" style={{ color: "rgba(197,203,232,0.72)" }}><span className="text-primary">•</span><span className="min-w-0">{s}</span></li>)}</ul>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── KPIs ─────────────────────────────────────────────────────────────────────

function FinanceKpis({ m, data, nowMs }: { m: FinMetrics; data: DashboardData; nowMs: number }) {
  const slots = monthSlots(nowMs);
  const spark = slots.map((s) => m.claims.filter((r) => String(r.submittedAt ?? r.createdAt ?? "").slice(0, 7) === s.key).reduce((a, r) => a + amt(r), 0));
  const c = m.cur;
  const kpis: Array<{ label: string; value: string; sub: string; icon: IconType; tone: Tone; dot: string; spark?: number[] }> = [
    { label: "Total Claims", value: `${m.total}`, sub: `${m.pendingCount} pending`, icon: ReceiptText, tone: "default", dot: "#ED00ED", spark: slots.map((s) => m.claims.filter((r) => String(r.submittedAt ?? r.createdAt ?? "").slice(0, 7) === s.key).length) },
    { label: "Pending Approval", value: fmtFin(m.pendingAmt, c), sub: "awaiting decision", icon: Clock3, tone: m.pendingAmt > 0 ? "warning" : "success", dot: m.pendingAmt > 0 ? "#f59e0b" : "#22c55e" },
    { label: "Paid Amount", value: fmtFin(m.paidAmt, c), sub: "settled", icon: CheckCircle2, tone: "success", dot: "#22c55e" },
    { label: "Avg Claim Value", value: fmtFin(m.avgClaim, c), sub: "per claim", icon: Scale, tone: "default", dot: "#908DCE" },
    { label: "This Month Spend", value: fmtFin(m.monthSpend, c), sub: "submitted this month", icon: TrendingUp, tone: "default", dot: "#38BDF8", spark },
    { label: "Avg Approval Time", value: m.avgApprovalDays != null ? `${m.avgApprovalDays}d` : "—", sub: `${m.slaBreachPct}% breach SLA`, icon: Gauge, tone: m.slaBreachPct > 25 ? "danger" : "success", dot: m.slaBreachPct > 25 ? "#ef4444" : "#22c55e" },
    { label: "Bank Verification", value: `${m.bankPct}%`, sub: `${m.bankTotal - m.bankVerified} pending`, icon: Landmark, tone: m.bankPct >= 60 ? "success" : "warning", dot: m.bankPct >= 60 ? "#22c55e" : "#f59e0b" },
    { label: "Missing Receipts", value: `${m.missingReceipts}`, sub: "claims to chase", icon: FileText, tone: m.missingReceipts ? "warning" : "success", dot: m.missingReceipts ? "#f59e0b" : "#22c55e" },
  ];
  void data;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {kpis.map((k) => {
        const Icon = k.icon;
        return (
          <div key={k.label} className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl p-4" style={CARD_STYLE}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.52)" }}><span className="h-1.5 w-1.5 rounded-full" style={{ background: k.dot }} />{k.label}</p>
                <p className="mt-1.5 text-2xl font-bold leading-none" style={{ color: "#C5CBE8" }}>{k.value}</p>
              </div>
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", TONE_CLASS[k.tone])}><Icon className="h-4 w-4" /></div>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2">
              <p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{k.sub}</p>
              {k.spark && <div className="h-6 w-16 shrink-0"><Sparkline points={k.spark} color={k.dot} /></div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Approval funnel / cash flow ──────────────────────────────────────────────

function ApprovalFunnel({ m }: { m: FinMetrics }) {
  const submitted = m.claims.length;
  const mgr = m.claims.filter((r) => r.managerReviewedAt).length;
  const fin = m.claims.filter((r) => r.financeReviewedAt).length;
  const paid = m.claims.filter((r) => r.paidAt).length;
  const stages = [
    { label: "Submitted", value: submitted, amount: m.submittedAmt },
    { label: "Manager Approved", value: mgr, amount: m.claims.filter((r) => r.managerReviewedAt).reduce((s, r) => s + amt(r), 0) },
    { label: "Finance Approved", value: fin, amount: m.claims.filter((r) => r.financeReviewedAt).reduce((s, r) => s + amt(r), 0) },
    { label: "Paid", value: paid, amount: m.paidAmt },
  ];
  const max = Math.max(...stages.map((s) => s.value), 1);
  const drops = stages.map((s, i) => (i === 0 ? 0 : stages[i - 1].value > 0 ? Math.round(((stages[i - 1].value - s.value) / stages[i - 1].value) * 100) : 0));
  const bottleneck = drops.indexOf(Math.max(...drops.slice(1), 0));
  return (
    <Panel title="Approval Funnel / Cash Flow" subtitle="Claims from submission to payment · bottleneck flagged" icon={Activity} action={{ label: "Reimbursements", href: "/dashboard/reimbursements" }}>
      <div className="space-y-2.5">
        {stages.map((s, i) => (
          <div key={s.label} className="space-y-1">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="flex items-center gap-1.5" style={{ color: "rgba(197,203,232,0.65)" }}>{s.label}{i === bottleneck && drops[i] > 0 && <span className="rounded-full bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-red-300">bottleneck −{drops[i]}%</span>}</span>
              <span className="shrink-0 font-semibold" style={{ color: "#C5CBE8" }}>{s.value} <span className="font-normal" style={{ color: "rgba(197,203,232,0.42)" }}>· {fmtFin(s.amount, m.cur)}</span></span>
            </div>
            <div className="mx-auto h-3 rounded-full" style={{ width: `${Math.max(16, (s.value / max) * 100)}%`, background: i === bottleneck && drops[i] > 0 ? "#ef4444" : CHART_COLORS[i % CHART_COLORS.length], opacity: 0.85 }} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ─── Monthly trend + forecast ────────────────────────────────────────────────

function SpendTrend({ m, nowMs }: { m: FinMetrics; nowMs: number }) {
  const slots = monthSlots(nowMs);
  const base = slots.map((s) => ({ month: s.label, Spend: m.claims.filter((r) => String(r.submittedAt ?? r.createdAt ?? "").slice(0, 7) === s.key).reduce((a, r) => a + amt(r), 0) }));
  const avg = base.length ? base.reduce((a, r) => a + r.Spend, 0) / base.length : 0;
  const data = [...base.map((r) => ({ ...r, Average: Math.round(avg) })), ...(base.length ? [{ month: "next", Spend: undefined as number | undefined, Average: undefined as number | undefined, Forecast: Math.round(avg) }] : [])];
  const empty = base.every((r) => r.Spend === 0);
  return (
    <Panel title="Monthly Spend Trend" subtitle={`${m.cur} reimbursement spend · 6-month average + forecast`} icon={TrendingUp}>
      {empty ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No spend recorded in the last six months.</p> : (
        <ResponsiveContainer width="100%" height={230}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -12, bottom: 0 }}>
            <defs><linearGradient id="finSpend" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#38BDF8" stopOpacity={0.3} /><stop offset="95%" stopColor="#38BDF8" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "#C5CBE8" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtFin(v as number, m.cur)} />
            <Tooltip {...CHART_TOOLTIP_STYLE} formatter={(v) => fmtFin(v as number, m.cur)} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            <Area type="monotone" dataKey="Spend" stroke="#38BDF8" strokeWidth={2} fill="url(#finSpend)" connectNulls dot={false} />
            <Line type="monotone" dataKey="Average" stroke="#908DCE" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls />
            <Line type="monotone" dataKey="Forecast" stroke="#22c55e" strokeWidth={2} dot={{ r: 3, fill: "#22c55e" }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ─── Spend by department + category ──────────────────────────────────────────

function SpendByDepartment({ m }: { m: FinMetrics }) {
  const map = new Map<string, number>();
  m.claims.forEach((r) => { const k = r.department?.trim() || "Unassigned"; map.set(k, (map.get(k) ?? 0) + amt(r)); });
  const rows: BarRow[] = [...map.entries()].map(([label, value]) => ({ label, value: Math.round(value), detail: fmtFin(value, m.cur), href: "/dashboard/reimbursements" })).sort((a, b) => b.value - a.value).slice(0, 8);
  return (
    <Panel title="Spend by Department" subtitle={`${m.cur} reimbursement spend`} icon={BarChart3} action={{ label: "Reimbursements", href: "/dashboard/reimbursements" }}>
      {rows.length === 0 ? <p className="py-8 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No department spend yet.</p> : <HBarList rows={rows} maxRows={8} />}
    </Panel>
  );
}

function SpendByCategory({ m }: { m: FinMetrics }) {
  const map = new Map<string, number>();
  m.claims.forEach((r) => { const k = r.category ? formatLabel(r.category) : "Uncategorised"; map.set(k, (map.get(k) ?? 0) + amt(r)); });
  const slices: DonutSlice[] = [...map.entries()].map(([name, value], i) => ({ name, value: Math.round(value), fill: CHART_COLORS[i % CHART_COLORS.length] })).sort((a, b) => b.value - a.value).slice(0, 7);
  return (
    <DonutPanel title="Spend by Category" subtitle={`${m.cur} spend`} slices={slices} centerLabel={m.cur} action={{ label: "Reimbursements", href: "/dashboard/reimbursements" }} />
  );
}

// ─── Currency analysis (never merged) ────────────────────────────────────────

function CurrencyAnalysis({ data }: { data: DashboardData }) {
  const all = (data.reimbursements ?? []) as unknown as Reimb[];
  const g = (cur: "INR" | "USD") => { const rows = all.filter((r) => curOf(r) === cur); return { count: rows.length, total: rows.reduce((s, r) => s + amt(r), 0), pending: rows.filter((r) => isPendingStatus(String(r.status ?? ""))).reduce((s, r) => s + amt(r), 0) }; };
  const inr = g("INR"); const usd = g("USD"); const totalCount = inr.count + usd.count || 1;
  return (
    <Panel title="Currency Analysis" subtitle="INR & USD tracked separately — no FX conversion applied" icon={Scale}>
      <div className="grid grid-cols-2 gap-3">
        {[{ cur: "INR" as const, v: inr, color: "#22c55e" }, { cur: "USD" as const, v: usd, color: "#38BDF8" }].map(({ cur, v, color }) => (
          <div key={cur} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}><span className="h-2 w-2 rounded-full" style={{ background: color }} />{cur}</span><span className="text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{Math.round((v.count / totalCount) * 100)}%</span></div>
            <p className="mt-2 text-xl font-bold" style={{ color: "#C5CBE8" }}>{fmtFin(v.total, cur)}</p>
            <p className="mt-0.5 text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{v.count} claims · {fmtFin(v.pending, cur)} pending</p>
            <div className="mt-2 h-1.5 rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}><div className="h-full rounded-full" style={{ width: `${Math.max(3, (v.count / totalCount) * 100)}%`, background: color }} /></div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>No exchange rate is configured, so INR and USD totals are never merged.</p>
    </Panel>
  );
}

// ─── Reimbursement analytics (stacked by month) ──────────────────────────────

function ReimbursementAnalytics({ data, nowMs }: { data: DashboardData; nowMs: number }) {
  const all = (data.reimbursements ?? []) as unknown as Reimb[];
  const slots = monthSlots(nowMs);
  const bucket = (r: Reimb) => { const s = String(r.status ?? ""); return isPaidStatus(s) ? "Paid" : isRejected(s) ? "Rejected" : isReturned(s) ? "Returned" : isPendingStatus(s) ? "Pending" : "Other"; };
  const keys = ["Paid", "Pending", "Returned", "Rejected"] as const;
  const colors: Record<string, string> = { Paid: "#22c55e", Pending: "#f59e0b", Returned: "#908DCE", Rejected: "#ef4444" };
  const rows = slots.map((sl) => {
    const row: Record<string, string | number> = { month: sl.label };
    keys.forEach((k) => { row[k] = 0; });
    all.filter((r) => String(r.submittedAt ?? r.createdAt ?? "").slice(0, 7) === sl.key).forEach((r) => { const b = bucket(r); if (keys.includes(b as typeof keys[number])) row[b] = Number(row[b] ?? 0) + 1; });
    return row;
  });
  const empty = rows.every((r) => keys.every((k) => Number(r[k]) === 0));
  return (
    <Panel title="Reimbursement Analytics" subtitle="Claim outcomes by month" icon={ReceiptText} action={{ label: "Reimbursements", href: "/dashboard/reimbursements" }}>
      {empty ? <p className="py-10 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No claim history yet.</p> : (
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={rows} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} barSize={22}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(144,141,206,0.10)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#C5CBE8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip {...CHART_TOOLTIP_STYLE} />
            <Legend wrapperStyle={{ fontSize: 11, color: "rgba(197,203,232,0.60)" }} />
            {keys.map((k, i) => <Bar key={k} dataKey={k} stackId="a" fill={colors[k]} radius={i === keys.length - 1 ? [3, 3, 0, 0] : undefined} />)}
          </BarChart>
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

// ─── SLA gauges + employee insights ──────────────────────────────────────────

function ProcessingSla({ m }: { m: FinMetrics }) {
  const deptTimes = new Map<string, { sum: number; n: number }>();
  m.claims.forEach((r) => { const t = daysBetween(r.submittedAt ?? r.createdAt, r.financeReviewedAt); if (t == null) return; const k = r.department?.trim() || "Unassigned"; const c = deptTimes.get(k) ?? { sum: 0, n: 0 }; c.sum += t; c.n += 1; deptTimes.set(k, c); });
  const deptAvg = [...deptTimes.entries()].map(([dept, v]) => ({ dept, avg: Math.round((v.sum / v.n) * 10) / 10 })).sort((a, b) => a.avg - b.avg);
  const fastest = deptAvg[0]; const slowest = deptAvg[deptAvg.length - 1];
  const cards = [
    { label: "Avg Approval", value: m.avgApprovalDays != null ? `${m.avgApprovalDays}d` : "—", tone: (m.avgApprovalDays ?? 0) > SLA_APPROVAL_DAYS ? "#f59e0b" : "#22c55e" },
    { label: "Avg Payment", value: m.avgPaymentDays != null ? `${m.avgPaymentDays}d` : "—", tone: "#38BDF8" },
    { label: "SLA Breach", value: `${m.slaBreachPct}%`, tone: m.slaBreachPct > 25 ? "#ef4444" : "#22c55e" },
  ];
  return (
    <Panel title="Processing SLA" subtitle={`Approval within ${SLA_APPROVAL_DAYS} days`} icon={Gauge} action={{ label: "Reimbursements", href: "/dashboard/reimbursements" }}>
      <div className="grid grid-cols-3 gap-2">
        {cards.map((c) => <div key={c.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center"><p className="text-2xl font-bold" style={{ color: c.tone }}>{c.value}</p><p className="mt-1 text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>{c.label}</p></div>)}
      </div>
      {deptAvg.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.05] p-2.5"><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Fastest team</p><p className="font-semibold text-emerald-400">{fastest.dept} · {fastest.avg}d</p></div>
          <div className="rounded-lg border border-amber-500/15 bg-amber-500/[0.05] p-2.5"><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Slowest team</p><p className="font-semibold text-amber-400">{slowest.dept} · {slowest.avg}d</p></div>
        </div>
      )}
    </Panel>
  );
}

function EmployeeSpending({ m }: { m: FinMetrics }) {
  const map = new Map<string, { name: string; dept: string; total: number; count: number }>();
  m.claims.forEach((r) => { const key = r.employeeCode || r.employeeName || "—"; const c = map.get(key) ?? { name: r.employeeName ?? "—", dept: r.department ?? "—", total: 0, count: 0 }; c.total += amt(r); c.count += 1; map.set(key, c); });
  const rows = [...map.values()].sort((a, b) => b.total - a.total).slice(0, 6);
  return (
    <Panel title="Employee Spending Insights" subtitle="Top claimants by total value" icon={Users} action={{ label: "Reimbursements", href: "/dashboard/reimbursements" }}>
      {rows.length === 0 ? <p className="py-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>No claims yet.</p> : (
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={r.name + i} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold" style={{ background: i === 0 ? "rgba(237,0,237,0.15)" : "rgba(144,141,206,0.1)", color: i === 0 ? "#ED00ED" : "rgba(197,203,232,0.7)" }}>{i + 1}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium" style={{ color: "#C5CBE8" }}>{r.name}</p><p className="truncate text-[11px]" style={{ color: "rgba(197,203,232,0.45)" }}>{r.dept} · {r.count} claims · avg {fmtFin(r.total / r.count, m.cur)}</p></div>
              <span className="shrink-0 text-sm font-bold text-primary">{fmtFin(r.total, m.cur)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ─── Bank verification + dinner intelligence ─────────────────────────────────

function BankAnalytics({ data }: { data: DashboardData }) {
  const bank = (data.bankVerification ?? []) as unknown as Bank[];
  const total = bank.length || 1;
  const verified = bank.filter((b) => b.status === "validated").length;
  const pending = bank.filter((b) => b.status === "pending").length;
  const failed = bank.filter((b) => b.status === "failed").length;
  const missing = bank.filter((b) => b.status === "missing_details").length;
  const hdfc = bank.filter((b) => b.isHdfc).length;
  const rows = [{ label: "Verified", value: verified, color: "#22c55e" }, { label: "Pending", value: pending, color: "#f59e0b" }, { label: "Failed", value: failed, color: "#ef4444" }, { label: "Missing Details", value: missing, color: "#908DCE" }];
  return (
    <Panel title="Bank Verification Analytics" subtitle={`${bank.length} accounts · penny-drop completion`} icon={Landmark} action={{ label: "Open", href: "/dashboard/bank-verification" }}>
      <div className="mb-3 space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-xs"><span style={{ color: "rgba(197,203,232,0.65)" }}>{r.label}</span><span className="font-semibold" style={{ color: "#C5CBE8" }}>{r.value} <span className="font-normal" style={{ color: "rgba(197,203,232,0.42)" }}>({Math.round((r.value / total) * 100)}%)</span></span></div>
            <div className="h-1.5 w-full rounded-full" style={{ background: "rgba(144,141,206,0.12)" }}><div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.value / total) * 100)}%`, background: r.color }} /></div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
        <span style={{ color: "rgba(197,203,232,0.6)" }}>HDFC accounts (instant penny-drop)</span><span className="font-semibold" style={{ color: "#C5CBE8" }}>{hdfc} / {bank.length}</span>
      </div>
    </Panel>
  );
}

function DinnerIntelligence({ data }: { data: DashboardData }) {
  const dinners = (data.dinners ?? []) as unknown as Dinner[];
  const pending = dinners.filter((d) => /pending/i.test(String(d.status ?? ""))).length;
  const completed = dinners.filter((d) => /complet/i.test(String(d.status ?? ""))).length;
  const times = dinners.map((d) => daysBetween(d.submittedAt, d.reviewedAt)).filter((x): x is number => x != null);
  const avgApproval = times.length ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10 : null;
  const byReq = new Map<string, number>();
  dinners.forEach((d) => { const k = d.requesterName ?? "—"; byReq.set(k, (byReq.get(k) ?? 0) + 1); });
  const top = [...byReq.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 4);
  return (
    <Panel title="Dinner Request Intelligence" subtitle="Volume & approval timing (cost is not tracked)" icon={UtensilsCrossed} action={{ label: "Review", href: "/dashboard/dinner-requests" }}>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5"><p className="text-lg font-bold" style={{ color: "#C5CBE8" }}>{dinners.length}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Total</p></div>
        <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-2.5"><p className="text-lg font-bold text-amber-400">{pending}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Pending</p></div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5"><p className="text-lg font-bold" style={{ color: "#C5CBE8" }}>{avgApproval != null ? `${avgApproval}d` : "—"}</p><p className="text-[10px]" style={{ color: "rgba(197,203,232,0.45)" }}>Avg approval</p></div>
      </div>
      {top.length > 0 && (<><p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.45)" }}>Top requesters</p><div className="space-y-1.5">{top.map((t) => <div key={t.name} className="flex items-center justify-between text-xs"><span className="truncate" style={{ color: "rgba(197,203,232,0.65)" }}>{t.name}</span><span className="font-semibold" style={{ color: "#C5CBE8" }}>{t.count}</span></div>)}</div></>)}
      <p className="mt-2 text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>{completed} completed · dinner cost is not captured in the system.</p>
    </Panel>
  );
}

// ─── Financial risk + AI insights + priority ─────────────────────────────────

function FinancialRisk({ m, nowMs }: { m: FinMetrics; nowMs: number }) {
  const highValuePending = m.claims.filter((r) => isPendingStatus(String(r.status ?? "")) && amt(r) >= 50000);
  const oldClaims = m.claims.filter((r) => isPendingStatus(String(r.status ?? "")) && r.submittedAt && (nowMs - new Date(r.submittedAt).getTime()) / DAY_MS > 7);
  const missingR = m.claims.filter((r) => !hasReceipt(r) && isPendingStatus(String(r.status ?? "")));
  // Possible duplicates: same employee + same amount submitted within 3 days.
  const dupes = new Set<number>();
  m.claims.forEach((a, i) => m.claims.forEach((b, j) => { if (i < j && a.employeeCode && a.employeeCode === b.employeeCode && amt(a) > 0 && amt(a) === amt(b)) { const d = daysBetween(a.submittedAt, b.submittedAt) ?? daysBetween(b.submittedAt, a.submittedAt); if (d != null && d <= 3) { dupes.add(i); dupes.add(j); } } }));
  const items = [
    { label: `Pending over ₹50K`, value: highValuePending.length, sev: "High", href: "/dashboard/reimbursements" },
    { label: `Claims older than 7 days`, value: oldClaims.length, sev: "High", href: "/dashboard/reimbursements" },
    { label: `Pending with missing receipts`, value: missingR.length, sev: "Medium", href: "/dashboard/reimbursements" },
    { label: `Possible duplicate claims`, value: dupes.size, sev: "Medium", href: "/dashboard/reimbursements" },
  ].filter((x) => x.value > 0);
  const cls: Record<string, string> = { High: "bg-red-500/15 text-red-300", Medium: "bg-amber-500/15 text-amber-300" };
  return (
    <Panel title="Financial Risk Panel" subtitle="Exposure that needs review" icon={AlertTriangle}>
      {items.length === 0 ? <div className="flex flex-col items-center gap-2 py-8"><CheckCircle2 className="h-8 w-8 text-emerald-400" /><p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>No elevated financial risk.</p></div> : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {items.map((x) => (
            <Link key={x.label} href={x.href} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", cls[x.sev])}>{x.sev}</span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{x.label}</span>
              <span className="shrink-0 text-lg font-bold text-primary">{x.value}</span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function FinancePriority({ m }: { m: FinMetrics }) {
  const items = [
    { label: "Pending finance approval", value: fmtFin(m.pendingAmt, m.cur), sev: m.pendingAmt > 100000 ? "High" : "Medium", href: "/dashboard/reimbursements" },
    { label: "Bank verifications pending", value: `${m.bankTotal - m.bankVerified}`, sev: m.bankTotal - m.bankVerified > 100 ? "High" : "Medium", href: "/dashboard/bank-verification" },
    { label: "Claims missing receipts", value: `${m.missingReceipts}`, sev: "Medium", href: "/dashboard/reimbursements" },
    { label: "SLA compliance", value: `${100 - m.slaBreachPct}%`, sev: m.slaBreachPct > 25 ? "High" : "Low", href: "/dashboard/reimbursements" },
    { label: "Dinner approvals pending", value: `${m.dinnerPending}`, sev: m.dinnerPending ? "Medium" : "Low", href: "/dashboard/dinner-requests" },
  ];
  const dot: Record<string, string> = { High: "🔴", Medium: "🟠", Low: "🟢" };
  return (
    <Panel title="Priority Action Center" subtitle="Ranked by financial impact" icon={Clock3}>
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((x) => (
          <Link key={x.label} href={x.href} className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
            <span aria-hidden>{dot[x.sev]}</span>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>{x.label}</p></div>
            <span className="shrink-0 text-sm font-bold text-primary">{x.value}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

function FinanceAiInsights({ m, data }: { m: FinMetrics; data: DashboardData }) {
  const deptMap = new Map<string, number>();
  m.claims.forEach((r) => { const k = r.department?.trim() || "Unassigned"; deptMap.set(k, (deptMap.get(k) ?? 0) + amt(r)); });
  const topDept = [...deptMap.entries()].sort((a, b) => b[1] - a[1])[0];
  const insights: Array<{ text: string; icon: IconType; href: string }> = [];
  if (topDept && m.submittedAmt > 0) insights.push({ text: `${topDept[0]} accounts for ${Math.round((topDept[1] / m.submittedAmt) * 100)}% of ${m.cur} reimbursement spend.`, icon: BarChart3, href: "/dashboard/reimbursements" });
  if (m.avgApprovalDays != null) insights.push({ text: `Claims are approved in ${m.avgApprovalDays} days on average; ${m.slaBreachPct}% breach the ${SLA_APPROVAL_DAYS}-day SLA.`, icon: Gauge, href: "/dashboard/reimbursements" });
  if (m.bankPct < 60) insights.push({ text: `Bank verification is only ${m.bankPct}% complete — this delays new-joiner payouts.`, icon: Landmark, href: "/dashboard/bank-verification" });
  const usd = ((data.reimbursements ?? []) as unknown as Reimb[]).filter((r) => curOf(r) === "USD");
  if (usd.length) insights.push({ text: `${usd.length} USD claims are tracked separately — apply an FX rate before combining with INR.`, icon: Scale, href: "/dashboard/reimbursements" });
  if (insights.length === 0) insights.push({ text: "Finance operations are healthy — no notable anomalies this period.", icon: CheckCircle2, href: "/dashboard/reimbursements" });
  return (
    <Panel title="AI Financial Insights" subtitle="Patterns and recommendations from live finance data" icon={Sparkles}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {insights.slice(0, 4).map((x) => { const Icon = x.icon; return (
          <Link key={x.text} href={x.href} className="flex min-w-0 items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-primary/30">
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="min-w-0 flex-1 text-xs leading-5" style={{ color: "rgba(197,203,232,0.72)" }}>{x.text}</p>
          </Link>
        ); })}
      </div>
    </Panel>
  );
}

function FinanceView({ data, module }: { data: DashboardData; module: ModuleView }) {
  void module;
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setNowMs(Date.now()), 0); return () => window.clearTimeout(t); }, []);
  const [cur, setCur] = useState<Cur>("INR");
  const activeCur: "INR" | "USD" = cur === "USD" ? "USD" : "INR";
  const m = useMemo(() => (nowMs == null ? null : deriveFinance(data, activeCur, nowMs)), [data, activeCur, nowMs]);

  if (nowMs == null || m == null) {
    return <div className="flex min-h-[40vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>;
  }
  return (
    <>
      <FinanceHeader m={m} cur={cur} onCur={setCur} />
      <FinanceKpis m={m} data={data} nowMs={nowMs} />
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <ApprovalFunnel m={m} />
        <SpendTrend m={m} nowMs={nowMs} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <SpendByDepartment m={m} />
        <SpendByCategory m={m} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
        <CurrencyAnalysis data={data} />
        <ReimbursementAnalytics data={data} nowMs={nowMs} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <ProcessingSla m={m} />
        <EmployeeSpending m={m} />
      </div>
      <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
        <BankAnalytics data={data} />
        <DinnerIntelligence data={data} />
      </div>
      <FinancialRisk m={m} nowMs={nowMs} />
      <FinanceAiInsights m={m} data={data} />
      <FinancePriority m={m} />
    </>
  );
}

// ─── Shell ──────────────────────────────────────────────────────────────────

function DashRangeChips({ value, onChange }: { value: DashRange; onChange: (range: DashRange) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(DASH_RANGE_LABELS) as DashRange[]).map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            value === range
              ? "border-primary bg-primary/15 text-primary"
              : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-primary/30 hover:text-foreground"
          )}
        >
          {DASH_RANGE_LABELS[range]}
        </button>
      ))}
    </div>
  );
}

export function ModuleDashboard({ scope }: { scope: ModuleDashboardScope }) {
  const [range, setRange] = useState<DashRange>("all");
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["module-dashboard", scope, range],
    queryFn: () => loadDashboardData(scope, range),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const modules = useMemo(() => buildModuleViews(data ?? {}), [data]);
  const selectedModule = modules.find((module) => module.scope === scope);
  const title = SCOPE_LABELS[scope];
  const ranged = range !== "all";

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-sm text-destructive">
        Unable to load dashboard data.
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden animate-fade-in">
      <div
        className="relative overflow-hidden rounded-2xl px-5 py-5 sm:px-6"
        style={{
          background: "linear-gradient(135deg, rgba(237,0,237,0.10) 0%, rgba(19,18,44,0.95) 50%, rgba(8,8,16,0.98) 100%)",
          border: "1px solid rgba(144,141,206,0.18)",
        }}
      >
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(ellipse at 80% 20%, rgba(144,141,206,0.3) 0%, transparent 60%)" }} />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <BarChart3 className="h-6 w-6 shrink-0 text-primary" />
              <h1 className="text-2xl font-bold" style={{ color: "#C5CBE8" }}>{title}</h1>
              {scope !== "all" && (
                <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 text-[10px] text-primary">
                  Domain view
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm" style={{ color: "rgba(197,203,232,0.50)" }}>
              {SCOPE_DESCRIPTIONS[scope]}
              {ranged && <span className="text-primary"> · Hiring metrics scoped to the last {range === "7d" ? "7 days" : range === "30d" ? "30 days" : "quarter"}</span>}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <DashRangeChips value={range} onChange={setRange} />
            <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => void refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <TrendingUp className="mr-1.5 h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {scope === "all" ? (
        <MasterView data={data ?? {}} modules={modules} />
      ) : selectedModule ? (
        scope === "talent" ? (
          <TalentView data={data ?? {}} module={selectedModule} />
        ) : scope === "lifecycle" ? (
          <LifecycleView data={data ?? {}} module={selectedModule} />
        ) : scope === "performance" ? (
          <PerformanceView data={data ?? {}} module={selectedModule} />
        ) : scope === "it-operations" ? (
          <ItOperationsView data={data ?? {}} module={selectedModule} />
        ) : (
          <FinanceView data={data ?? {}} module={selectedModule} />
        )
      ) : (
        <div className="rounded-2xl border border-border p-6 text-sm text-muted-foreground">Unknown dashboard scope.</div>
      )}
    </div>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import type { ElementType, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  FileCheck,
  FileBadge2,
  FileText,
  Loader2,
  Star,
  Upload,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmployeeDashboard } from "@/lib/queries";
import { useAuth } from "@/lib/auth-context";
import { attendanceApi, employeesApi, leaveApi, roleModulesApi, skillsApi } from "@/lib/api";
import { attendanceTodayDateInput } from "@/lib/attendance-dates";
import { cn, formatDate, formatLabel } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

function SkillChips({
  skills,
  projectName,
}: {
  skills: Array<{ skill: string; label: string; rating: number }>;
  projectName?: string | null;
}) {
  const visibleSkills = skills.slice(0, 4);
  return (
    <div className="mt-4 min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "rgba(197,203,232,0.46)" }}>
        <Star className="h-3.5 w-3.5" style={{ color: "#908DCE" }} /> Skills
      </p>
      <div className="mt-2 flex min-w-0 flex-wrap gap-2 lg:flex-nowrap lg:overflow-x-auto lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
        {visibleSkills.length ? visibleSkills.map((entry) => (
          <span
            key={entry.skill}
            className="flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium"
            style={{
              background: "rgba(144,141,206,0.07)",
              borderColor: "rgba(144,141,206,0.18)",
              color: "#C5CBE8",
            }}
          >
            <span className="truncate">{entry.label}</span>
            <span className="flex shrink-0 items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((star) => (
                <Star
                  key={star}
                  className={cn(
                    "h-3 w-3",
                    star <= entry.rating ? "fill-amber-400 text-amber-400" : "fill-transparent text-muted-foreground/40"
                  )}
                />
              ))}
            </span>
          </span>
        )) : (
          <span className="rounded-lg border border-dashed border-white/15 px-2.5 py-1.5 text-xs" style={{ color: "rgba(197,203,232,0.58)" }}>
            Skills not tagged yet
          </span>
        )}
        {skills.length > 4 && (
          <span className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs" style={{ color: "rgba(197,203,232,0.58)" }}>
            +{skills.length - 4} more
          </span>
        )}
      </div>
      {projectName && (
        <p className="mt-2 text-xs" style={{ color: "rgba(197,203,232,0.50)" }}>
          Allocated to <span className="font-medium" style={{ color: "#C5CBE8" }}>{projectName}</span>
        </p>
      )}
    </div>
  );
}

type EmployeeTone = "default" | "success" | "warning" | "info";

const employeeToneStyles: Record<EmployeeTone, { bg: string; border: string; text: string; accent: string }> = {
  default: {
    bg: "rgba(144,141,206,0.07)",
    border: "rgba(144,141,206,0.18)",
    text: "rgba(197,203,232,0.82)",
    accent: "#908DCE",
  },
  success: {
    bg: "rgba(16,185,129,0.08)",
    border: "rgba(16,185,129,0.22)",
    text: "rgba(167,243,208,0.92)",
    accent: "#10b981",
  },
  warning: {
    bg: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.24)",
    text: "rgba(252,211,77,0.92)",
    accent: "#f59e0b",
  },
  info: {
    bg: "rgba(14,165,233,0.08)",
    border: "rgba(14,165,233,0.22)",
    text: "rgba(186,230,253,0.92)",
    accent: "#0ea5e9",
  },
};

function StatusPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: EmployeeTone;
}) {
  const colors = employeeToneStyles[tone];
  return (
    <div
      className="min-w-0 rounded-lg px-3 py-2"
      style={{ background: colors.bg, border: `1px solid ${colors.border}` }}
    >
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(197,203,232,0.44)" }}>
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold leading-tight" style={{ color: colors.text }}>
        {value}
      </p>
    </div>
  );
}

function EmployeeSectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4 min-w-0">
      <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>{title}</h2>
      {subtitle && <p className="mt-1 text-xs leading-5" style={{ color: "rgba(197,203,232,0.50)" }}>{subtitle}</p>}
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "default",
  progress,
  href,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ElementType;
  tone?: EmployeeTone;
  progress?: number;
  href?: string;
}) {
  const colors = employeeToneStyles[tone];
  const body = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: "rgba(197,203,232,0.46)" }}>
            {label}
          </p>
          <p className="mt-2 break-words text-2xl font-semibold leading-tight" style={{ color: "#C5CBE8" }}>
            {value}
          </p>
        </div>
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: colors.bg, color: colors.accent }}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 min-h-[2.5rem] text-xs leading-5" style={{ color: "rgba(197,203,232,0.52)" }}>
        {detail}
      </p>
      {typeof progress === "number" && (
        <div className="mt-3 h-1.5 rounded-full" style={{ background: "rgba(144,141,206,0.14)" }}>
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, progress))}%`, background: colors.accent }}
          />
        </div>
      )}
      {href && (
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium" style={{ color: "#ED00ED" }}>
          Open <ArrowRight className="h-3.5 w-3.5" />
        </span>
      )}
    </>
  );

  const className = "group flex min-h-[148px] min-w-0 flex-col rounded-xl border p-5 transition-colors hover:border-[rgba(237,0,237,0.32)]";
  const style = { background: "rgba(255,255,255,0.025)", borderColor: "rgba(144,141,206,0.14)" };

  if (href) {
    return (
      <Link href={href} className={className} style={style}>
        {body}
      </Link>
    );
  }

  return (
    <div className={className} style={style}>
      {body}
    </div>
  );
}

function QuickActionLink({
  href,
  label,
  detail,
  icon: Icon,
}: {
  href: string;
  label: string;
  detail: string;
  icon: ElementType;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 items-start gap-3 rounded-lg border p-3 transition-colors hover:border-[rgba(237,0,237,0.34)]"
      style={{ background: "rgba(255,255,255,0.025)", borderColor: "rgba(144,141,206,0.14)" }}
    >
      <span
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: "rgba(144,141,206,0.08)", color: "#908DCE" }}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold" style={{ color: "#C5CBE8" }}>{label}</span>
        <span className="mt-0.5 block text-xs leading-5" style={{ color: "rgba(197,203,232,0.52)" }}>{detail}</span>
      </span>
      <ChevronRight className="mt-2 h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" style={{ color: "rgba(197,203,232,0.42)" }} />
    </Link>
  );
}

function InsightPanel({
  title,
  subtitle,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  actionHref?: string;
  actionLabel?: string;
  children: ReactNode;
}) {
  return (
    <section
      className="flex h-full min-w-0 flex-col rounded-2xl p-4 sm:p-5"
      style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)" }}
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>{title}</h2>
          {subtitle && <p className="mt-1 text-xs leading-5" style={{ color: "rgba(197,203,232,0.50)" }}>{subtitle}</p>}
        </div>
        {actionHref && actionLabel && (
          <Link href={actionHref} className="shrink-0">
            <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs">
              {actionLabel}
            </Button>
          </Link>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

function isActionableNextAction(action?: string | null): action is string {
  return Boolean(action && !/\bcompleted?\b/i.test(action));
}

const journeyStatusStyles: Record<string, string> = {
  completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  pending: "border-border bg-muted/20 text-muted-foreground",
  warning: "border-amber-500/25 bg-amber-500/10 text-amber-300",
};

const EMPLOYEE_DETAIL_FORM_PATH = "/dashboard/employee/selection-form";
const DOCUMENT_STEP_BY_TYPE: Record<string, string> = {
  resume: "employment",
  photo: "employment",
  education_10th: "education",
  education_12th: "education",
  highest_qualification: "education",
  aadhaar: "identity",
  pan: "identity",
  cancelled_cheque: "bank",
  permanent_address_proof: "address",
  current_address_proof: "address",
};

function employeeDetailFormHref(step?: string, edit = false): string {
  const params = new URLSearchParams();
  if (step) params.set("step", step);
  if (edit) params.set("edit", "1");
  const query = params.toString();
  return query ? `${EMPLOYEE_DETAIL_FORM_PATH}?${query}` : EMPLOYEE_DETAIL_FORM_PATH;
}

export default function EmployeeDashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { data: dashboard, isLoading, isError } = useEmployeeDashboard();
  const profilePhotoEndpoint = dashboard?.employee?.profilePhotoEndpoint ?? null;
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);

  const completedJourneyStages = useMemo(
    () => dashboard?.profileJourney.filter((s) => s.status === "completed").length ?? 0,
    [dashboard?.profileJourney],
  );

  useEffect(() => {
    let isActive = true;
    let objectUrl: string | null = null;

    if (!profilePhotoEndpoint) return undefined;

    employeesApi.getBlobFromEndpoint(profilePhotoEndpoint)
      .then((blob) => {
        if (!isActive) return;
        objectUrl = URL.createObjectURL(blob);
        setProfilePhotoUrl(objectUrl);
      })
      .catch(() => {
        if (isActive) setProfilePhotoUrl(null);
      });

    return () => {
      isActive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profilePhotoEndpoint]);

  useEffect(() => {
    if (isLoading || !dashboard) return;
    if (dashboard.selectionForm.status !== "submitted") {
      router.replace("/dashboard/employee/selection-form");
    }
  }, [dashboard, isLoading, router]);

  const todayDate = useMemo(() => attendanceTodayDateInput(), []);
  const dashboardReadyForWork = Boolean(dashboard?.employee?.id && dashboard?.selectionForm.status === "submitted");
  const myModulesQuery = useQuery({
    queryKey: ["employee-dashboard", "my-modules", user?.id],
    queryFn: () => roleModulesApi.myModules(),
    enabled: Boolean(user),
    staleTime: 60_000,
  });
  const enabledModules = myModulesQuery.data?.enabled ?? [];
  const moduleAccessLoaded = !user || myModulesQuery.isSuccess;
  const canReadAttendance = Boolean(
    moduleAccessLoaded && user?.permissions?.includes("attendance:read") && enabledModules.includes("attendance"),
  );
  const canReadLeave = Boolean(
    moduleAccessLoaded && user?.permissions?.includes("leave:read") && enabledModules.includes("leave"),
  );
  const attendanceSummaryQuery = useQuery({
    queryKey: ["employee-dashboard", "attendance-summary", todayDate],
    queryFn: () => attendanceApi.mySummary({ from: todayDate, to: todayDate }),
    enabled: dashboardReadyForWork && canReadAttendance,
    staleTime: 30_000,
  });
  const leaveBalancesQuery = useQuery({
    queryKey: ["employee-dashboard", "leave-balances"],
    queryFn: () => leaveApi.getGreytHRBalances(),
    enabled: dashboardReadyForWork && canReadLeave,
    staleTime: 60_000,
  });
  const leaveRequestsQuery = useQuery({
    queryKey: ["employee-dashboard", "leave-requests"],
    queryFn: () => leaveApi.myRequests(),
    enabled: dashboardReadyForWork && canReadLeave,
    staleTime: 60_000,
  });
  const skillsQuery = useQuery({
    queryKey: ["employee-dashboard", "my-skills"],
    queryFn: () => skillsApi.mySkills(),
    enabled: dashboardReadyForWork,
    staleTime: 60_000,
  });

  // Nudge a newly-onboarded employee to finish their profile - shown once per
  // browser session while onboarding (documents / next required action) is pending.
  const [showProfileReminder, setShowProfileReminder] = useState(false);
  useEffect(() => {
    if (isLoading || !dashboard) return;
    if (dashboard.selectionForm.status !== "submitted") return;
    const incomplete =
      isActionableNextAction(dashboard.nextRequiredAction) ||
      (dashboard.documentCompletionStatus?.missing?.length ?? 0) > 0;
    if (!incomplete) return;
    const key = `profile-reminder:${dashboard.employee?.employeeCode ?? "me"}`;
    if (typeof window !== "undefined" && window.sessionStorage.getItem(key)) return;
    if (typeof window !== "undefined") window.sessionStorage.setItem(key, "1");
    const timer = window.setTimeout(() => setShowProfileReminder(true), 0);
    return () => window.clearTimeout(timer);
  }, [dashboard, isLoading]);

  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-44 rounded-[2rem]" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
        </div>
        <Skeleton className="h-56 rounded-2xl" />
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-destructive" />
        <p className="mt-4 text-base font-semibold">Employee dashboard could not be loaded.</p>
        <p className="mt-1 text-sm text-muted-foreground">Please refresh and try again.</p>
      </div>
    );
  }

  if (dashboard.selectionForm.status !== "submitted") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="text-sm">Opening Employee Detail Form...</p>
        </div>
      </div>
    );
  }

  const employee = dashboard.employee;
  const nextAction = dashboard.nextRequiredAction;
  const actionableNextAction = isActionableNextAction(nextAction) ? nextAction : null;
  const latestContract = dashboard.contracts[0];
  const documentProgress = dashboard.documentCompletionStatus.total
    ? Math.round((dashboard.documentCompletionStatus.completed / dashboard.documentCompletionStatus.total) * 100)
    : 0;
  const documentsComplete = dashboard.missingDocuments.length === 0;
  const onboardingComplete = !actionableNextAction && dashboard.profileCompletionPercentage >= 100;
  const contractSigned = latestContract?.status === "signed";
  const contractLabel = latestContract ? formatLabel(latestContract.status ?? "pending") : "Not issued";
  const pendingComplianceForms = dashboard.complianceForms.filter((form) => {
    const status = (form.status ?? "").toLowerCase();
    return status !== "submitted" && status !== "completed" && status !== "signed";
  }).length;
  const hasComplianceForms = dashboard.complianceForms.length > 0;
  const complianceLabel = hasComplianceForms
    ? pendingComplianceForms > 0
      ? `${pendingComplianceForms} pending`
      : "Complete"
    : "Not assigned";
  const complianceTone: EmployeeTone = !hasComplianceForms
    ? "default"
    : pendingComplianceForms > 0
      ? "warning"
      : "success";
  const complianceDetail = !hasComplianceForms
    ? "No compliance forms are assigned."
    : pendingComplianceForms > 0
      ? "Some compliance forms still need attention."
      : "Assigned compliance forms are complete.";
  const completedStepLabel = `${completedJourneyStages}/${dashboard.profileJourney.length || completedJourneyStages}`;
  const attendanceSummary = attendanceSummaryQuery.data;
  const attendanceDayStatusLabel = !canReadAttendance
    ? "Not enabled"
    : attendanceSummaryQuery.isLoading
    ? "Loading"
    : attendanceSummaryQuery.isError
      ? "Unavailable"
      : (attendanceSummary?.present ?? 0) > 0
        ? "Present"
        : (attendanceSummary?.halfDay ?? 0) > 0
          ? "Present"
          : "Absent";
  const attendanceDayTone: EmployeeTone = attendanceDayStatusLabel === "Present"
    ? "success"
    : attendanceDayStatusLabel === "Absent"
      ? "warning"
      : "default";
  const leaveBalances = leaveBalancesQuery.data?.balances ?? [];
  const leaveSyncedAt = leaveBalancesQuery.data?.syncedAt ?? null;
  const leaveRequests = leaveRequestsQuery.data ?? [];
  const leaveAvailableDays = leaveBalances.reduce((sum, balance) => sum + Number(balance.balance || 0), 0);
  const visibleLeaveBalances = leaveBalances;
  const pendingLeaveRequests = leaveRequests.filter((request) =>
    ["pending", "pending_manager", "manager_approved", "pending_hr"].includes((request.status ?? "").toLowerCase()),
  ).length;
  const skillEntries = skillsQuery.data?.skills ?? [];
  const projectName = skillsQuery.data?.project?.name ?? null;
  const firstMissingDocument = dashboard.documents.find((document) => document.missing);
  const documentSummaryHref = firstMissingDocument
    ? employeeDetailFormHref(DOCUMENT_STEP_BY_TYPE[firstMissingDocument.type], true)
    : "/dashboard/employee/documents";
  const complianceSummaryHref = "/dashboard/employee/compliance";
  const firstOpenJourneyStage = dashboard.profileJourney.find((stage) => stage.status !== "completed");
  const quickActions = [
    {
      label: actionableNextAction ? "Continue onboarding" : "Update profile details",
      detail: actionableNextAction ? `Next step: ${actionableNextAction}` : "Keep employee, bank, family, and ID details current.",
      icon: ClipboardCheck,
      href: employeeDetailFormHref(undefined, Boolean(actionableNextAction)),
    },
    ...(canReadAttendance
      ? [{
          label: "View attendance",
          detail: attendanceSummaryQuery.isLoading ? "Loading today's attendance..." : `Today: ${attendanceDayStatusLabel}.`,
          icon: Clock3,
          href: "/dashboard/employee/attendance",
        }]
      : []),
    ...(canReadLeave
      ? [{
          label: "Apply for leave",
          detail: leaveBalancesQuery.isLoading ? "Loading leave balance..." : `${leaveAvailableDays} day(s) available, ${pendingLeaveRequests} request(s) pending.`,
          icon: CalendarDays,
          href: "/dashboard/employee/leave",
        }]
      : []),
    {
      label: "Refer a candidate",
      detail: `${dashboard.referralActivity.length} referral(s) currently tracked.`,
      icon: Users,
      href: "/dashboard/employee/referrals",
    },
  ];

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <Dialog open={showProfileReminder} onOpenChange={setShowProfileReminder}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Complete your profile</DialogTitle>
            <DialogDescription>
              Welcome aboard! Please complete your profile and onboarding steps as soon as
              possible{actionableNextAction ? <> - next up: <strong>{actionableNextAction}</strong>.</> : "."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setShowProfileReminder(false)}>
              Later
            </Button>
            <Link href="/dashboard/employee/documents" onClick={() => setShowProfileReminder(false)}>
              <Button className="w-full">Complete now</Button>
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <section
        className="employee-dashboard-hero relative overflow-hidden rounded-2xl p-5 sm:p-6"
        style={{
          background: "rgba(18,19,32,0.88)",
          border: "1px solid rgba(144,141,206,0.16)",
          boxShadow: "0 16px 42px rgba(0,0,0,0.22)",
        }}
      >
        <div aria-hidden="true" className="employee-dashboard-hero-grid pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="employee-dashboard-hero-signal pointer-events-none absolute inset-0" />
        <div className="relative z-10 flex flex-col gap-5 xl:flex-row xl:items-stretch xl:justify-between">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
            {profilePhotoUrl ? (
              <img
                src={profilePhotoUrl}
                alt="Profile photo"
                onError={() => setProfilePhotoUrl(null)}
                className="h-16 w-16 rounded-xl object-cover border shrink-0"
                style={{ borderColor: "rgba(144,141,206,0.24)" }}
              />
            ) : (
              <div
                className="flex h-16 w-16 items-center justify-center rounded-xl shrink-0 text-xl font-bold"
                style={{ background: "rgba(144,141,206,0.10)", border: "1px solid rgba(144,141,206,0.22)", color: "#908DCE" }}
              >
                {(employee?.fullName || user?.name || "E").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(197,203,232,0.46)" }}>
                Employee workspace
              </p>
              <h1
                className="mt-2 break-words text-2xl font-semibold tracking-tight sm:text-3xl"
                style={{ color: "#C5CBE8" }}
              >
                {employee?.fullName || user?.name || "Employee"}
              </h1>
              <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
                {employee?.employeeCode && (
                  <Badge variant="outline" className="border-white/15 bg-white/5 text-[#C5CBE8] font-mono">
                    {employee.employeeCode}
                  </Badge>
                )}
                {employee?.designation && (
                  <Badge variant="outline" className="border-white/15 bg-white/5 text-[#C5CBE8]">
                    {employee.designation}
                  </Badge>
                )}
                {employee?.department && (
                  <Badge variant="outline" className="border-white/15 bg-white/5 text-[#C5CBE8]">
                    {employee.department}
                  </Badge>
                )}
                {employee?.dateOfJoining && (
                  <Badge variant="outline" className="border-white/15 bg-white/5 text-[#C5CBE8]">
                    Joined {new Date(employee.dateOfJoining).toLocaleDateString()}
                  </Badge>
                )}
                <Badge variant="outline" className="max-w-full break-all border-white/15 bg-white/5 text-[#C5CBE8]">
                  {employee?.etharaEmail || user?.email}
                </Badge>
              </div>
              {actionableNextAction && (
                <p className="mt-3 flex items-start gap-1.5 text-sm" style={{ color: "rgba(245,158,11,0.85)" }}>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-words">Next required action: {actionableNextAction}</span>
                </p>
              )}
              {skillsQuery.isLoading ? (
                <div className="mt-4 h-8 w-56 animate-pulse rounded-lg bg-white/5" />
              ) : (
                <SkillChips skills={skillEntries} projectName={projectName} />
              )}
            </div>
          </div>

          <div className="w-full min-w-0 space-y-2 xl:flex xl:max-w-xl xl:flex-col xl:justify-between xl:space-y-0">
            <div className="grid min-w-0 gap-2 sm:grid-cols-3">
              <StatusPill label="Status" value={employee?.isActive === false ? "Inactive" : "Active"} tone={employee?.isActive === false ? "warning" : "success"} />
              <StatusPill label="Onboarding" value={onboardingComplete ? "Complete" : "Action needed"} tone={onboardingComplete ? "success" : "warning"} />
              <StatusPill label="Contract" value={contractLabel} tone={contractSigned ? "success" : "default"} />
            </div>
            <div className="grid min-w-0 gap-2 sm:grid-cols-3">
              <div className="sm:col-start-3">
                <StatusPill label="Attendance" value={attendanceDayStatusLabel} tone={attendanceDayTone} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {!employee?.id && (
        <Card className="border-amber-500/25 bg-amber-500/10 shadow-sm">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 h-5 w-5 text-amber-300 shrink-0" />
            <p className="text-sm text-amber-100/90">
              Your employee profile is still being provisioned by HR. Documents, compliance, and contracts will unlock once your record is fully linked.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid items-stretch gap-4">
        <InsightPanel
          title="Leave balance"
          subtitle={leaveSyncedAt ? `Synced from greytHR · updated ${formatDate(leaveSyncedAt)}` : "Available balance by leave type."}
        >
          {canReadLeave ? (
            <>
              {leaveBalancesQuery.isLoading ? (
                <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {[1, 2, 3].map((item) => (
                    <div key={item} className="h-24 min-w-[210px] animate-pulse rounded-xl bg-white/5" />
                  ))}
                </div>
              ) : visibleLeaveBalances.length ? (
                <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {visibleLeaveBalances.map((balance) => (
                    <div
                      key={balance.code}
                      className="min-w-[160px] rounded-xl border px-3 py-3 sm:min-w-[180px]"
                      style={{ background: "rgba(255,255,255,0.025)", borderColor: "rgba(144,141,206,0.14)" }}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: "rgba(197,203,232,0.44)" }}>
                          {balance.type}
                        </p>
                        <span
                          className="shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-semibold"
                          style={{ background: "rgba(144,141,206,0.14)", color: "rgba(197,203,232,0.6)" }}
                        >
                          {balance.code}
                        </span>
                      </div>
                      <p className="mt-1 text-xl font-semibold" style={{ color: "#C5CBE8" }}>{balance.balance}</p>
                      <p className="mt-0.5 text-xs" style={{ color: "rgba(197,203,232,0.52)" }}>
                        day{balance.balance === 1 ? "" : "s"} available
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  No leave balances are assigned yet.
                </div>
              )}
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border/70 p-5 text-sm text-muted-foreground">
              Leave access is not enabled for this account. Once HR enables leave permissions, balances and pending requests will appear here.
            </div>
          )}
        </InsightPanel>
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section
          className="flex h-full min-w-0 flex-col rounded-2xl p-4 sm:p-5"
          style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)" }}
        >
          <EmployeeSectionHeader
            title="Workspace summary"
            subtitle={`Journey steps ${completedStepLabel} complete. Documents, contract, compliance, and referrals are shown once here.`}
          />
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <SummaryMetric
              label="Documents"
              value={`${dashboard.documentCompletionStatus.completed}/${dashboard.documentCompletionStatus.total}`}
              detail={documentsComplete ? "All required documents are uploaded." : `${dashboard.missingDocuments.length} required document(s) missing.`}
              icon={Upload}
              tone={documentsComplete ? "success" : "warning"}
              progress={documentProgress}
              href={documentSummaryHref}
            />
            <SummaryMetric
              label="Contract"
              value={contractLabel}
              detail={latestContract ? "Current employment contract status." : "No employment contract has been issued yet."}
              icon={FileCheck}
              tone={contractSigned ? "success" : "default"}
              href="/dashboard/employee/contracts"
            />
            <SummaryMetric
              label="Compliance"
              value={complianceLabel}
              detail={complianceDetail}
              icon={FileBadge2}
              tone={complianceTone}
              href={complianceSummaryHref}
            />
            <SummaryMetric
              label="Referrals"
              value={dashboard.referralActivity.length}
              detail={dashboard.referralActivity.length ? "Referred candidates currently tracked." : "No referred candidates yet."}
              icon={Users}
              tone="info"
              href="/dashboard/employee/referrals"
            />
          </div>
        </section>

        <section
          className="flex h-full min-w-0 flex-col rounded-2xl p-4 sm:p-5"
          style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)" }}
        >
          <EmployeeSectionHeader title="Quick actions" subtitle="Common employee tasks in one place." />
          <div className="grid gap-2">
            {quickActions.map((action) => (
              <QuickActionLink key={action.href} {...action} />
            ))}
          </div>
        </section>
      </div>

      <section
        className="min-w-0 rounded-2xl p-4 sm:p-5"
        style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)" }}
      >
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Document summary</h2>
            <p className="mt-1 text-xs" style={{ color: "rgba(197,203,232,0.50)" }}>
              {dashboard.documentCompletionStatus.completed} completed, {dashboard.documentCompletionStatus.missing.length} missing
            </p>
          </div>
          <Link href="/dashboard/employee/documents">
            <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs">
              Review documents
            </Button>
          </Link>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {dashboard.documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/70 p-5 text-sm text-muted-foreground">
              No employee documents are recorded yet.
            </div>
          ) : (
            dashboard.documents.map((document) => (
              <div key={document.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-muted/15 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="break-words text-sm font-medium">{document.label}</p>
                  <p className="break-words text-xs text-muted-foreground">
                    {document.missing
                      ? "Missing"
                      : document.fileName
                        ? document.fileName
                        : "Uploaded"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit capitalize",
                      document.missing
                        ? journeyStatusStyles.pending
                        : journeyStatusStyles.completed,
                    )}
                  >
                    {document.missing ? "Missing" : "Completed"}
                  </Badge>
                  {document.missing && (
                    <Link href={employeeDetailFormHref(DOCUMENT_STEP_BY_TYPE[document.type], true)}>
                      <Button variant="ghost" size="sm" className="h-7 rounded-full px-2 text-xs">
                        Complete
                      </Button>
                    </Link>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <InsightPanel
          title="Onboarding checklist"
          subtitle={firstOpenJourneyStage ? `Next open item: ${firstOpenJourneyStage.title}` : "All required employee steps are complete."}
        >
          <div className="grid gap-2">
            {dashboard.profileJourney.map((stage) => {
              const complete = stage.status === "completed";
              return (
                <div
                  key={stage.key}
                  className="flex min-w-0 items-start gap-3 rounded-xl border px-4 py-3"
                  style={{ background: "rgba(255,255,255,0.025)", borderColor: "rgba(144,141,206,0.14)" }}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                      complete ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300",
                    )}
                  >
                    {complete ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium" style={{ color: "#C5CBE8" }}>{stage.title}</p>
                    <p className="mt-0.5 break-words text-xs" style={{ color: "rgba(197,203,232,0.52)" }}>{stage.description}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("w-fit shrink-0 capitalize", journeyStatusStyles[stage.status] ?? journeyStatusStyles.pending)}
                  >
                    {formatLabel(stage.status)}
                  </Badge>
                </div>
              );
            })}
          </div>
        </InsightPanel>

        <InsightPanel
          title="Contract and compliance"
          subtitle="Current signing status and statutory form health."
          actionHref={pendingComplianceForms ? "/dashboard/employee/compliance" : latestContract ? "/dashboard/employee/contracts" : undefined}
          actionLabel={pendingComplianceForms ? "Open compliance" : latestContract ? "Open contract" : undefined}
        >
          <div className="space-y-3">
            <div
              className="flex min-w-0 items-start gap-3 rounded-xl border px-4 py-3"
              style={{ background: "rgba(255,255,255,0.025)", borderColor: "rgba(144,141,206,0.14)" }}
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-300">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold" style={{ color: "#C5CBE8" }}>
                  {latestContract?.title ?? "No contract issued"}
                </p>
                <p className="mt-1 text-xs" style={{ color: "rgba(197,203,232,0.52)" }}>
                  {latestContract
                    ? `Status: ${contractLabel}${latestContract.completedAt ? `, completed ${formatDate(latestContract.completedAt)}` : ""}`
                    : "Contract details will appear here once HR issues one."}
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn("w-fit shrink-0 capitalize", contractSigned ? journeyStatusStyles.completed : journeyStatusStyles.pending)}
              >
                {contractLabel}
              </Badge>
            </div>

            <div className="grid gap-2">
              {dashboard.complianceForms.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  No compliance forms are assigned.
                </div>
              ) : (
                dashboard.complianceForms.slice(0, 4).map((form) => {
                  const done = ["submitted", "completed", "signed"].includes((form.status ?? "").toLowerCase());
                  return (
                    <div
                      key={form.id}
                      className="flex min-w-0 flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                      style={{ background: "rgba(255,255,255,0.025)", borderColor: "rgba(144,141,206,0.14)" }}
                    >
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium" style={{ color: "#C5CBE8" }}>{form.formTitle}</p>
                        <p className="mt-0.5 text-xs" style={{ color: "rgba(197,203,232,0.52)" }}>
                          {form.signedAt ? `Signed ${formatDate(form.signedAt)}` : formatLabel(form.status)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("w-fit shrink-0 capitalize", done ? journeyStatusStyles.completed : journeyStatusStyles.warning)}
                      >
                        {done ? "Complete" : formatLabel(form.status)}
                      </Badge>
                    </div>
                  );
                })
              )}
              {dashboard.complianceForms.length > 4 && (
                <p className="text-xs text-muted-foreground">
                  +{dashboard.complianceForms.length - 4} more compliance form(s)
                </p>
              )}
            </div>
          </div>
        </InsightPanel>
      </div>

    </div>
  );
}

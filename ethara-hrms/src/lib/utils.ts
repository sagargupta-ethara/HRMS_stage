import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Role, CandidateStage, User } from "@/types";
import { hasHydratedOnClient } from "@/lib/hydration-state";

export const APP_TIME_ZONE = "Asia/Kolkata";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function parseDateValue(date: string | Date): Date | null {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function formatStableDate(date: string | Date): string {
  const parsed = parseDateValue(date);
  if (!parsed) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(parsed);
}

export function formatCurrentDateLabel(options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-IN", {
    ...options,
    timeZone: APP_TIME_ZONE,
  }).format(new Date());
}

export function formatDate(date: string | Date): string {
  const parsed = parseDateValue(date);
  if (!parsed) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(parsed);
}

export function formatDateTime(date: string | Date): string {
  const parsed = parseDateValue(date);
  if (!parsed) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
    timeZoneName: "short",
  }).format(parsed);
}

export function timeAgo(date: string | Date): string {
  const d = parseDateValue(date);
  if (!d) return "—";
  if (!hasHydratedOnClient()) return formatStableDate(d);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export function getTodayDateInputMin(): string | undefined {
  if (!hasHydratedOnClient()) return undefined;
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  leadership: "Leadership",
  hr: "HR",
  ta: "Talent Acquisition",
  employee: "Employee",
  vendor: "Vendor",
  employee_referrer: "Employee Referrer",
  evaluator: "Evaluator",
  it_team: "IT Team",
  compliance: "Compliance",
  candidate: "Candidate",
  manager: "Manager",
  office_admin: "Office Admin",
  pl_tpm: "PL / TPM",
};

export const ROLE_COLORS: Record<Role, string> = {
  super_admin: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  admin: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  leadership: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  hr: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  ta: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/20",
  employee: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
  vendor: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
  employee_referrer: "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20",
  evaluator: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20",
  it_team: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
  compliance: "bg-lime-500/10 text-lime-600 dark:text-lime-400 border-lime-500/20",
  candidate: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
  manager: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
  office_admin: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
  pl_tpm: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
};

export function canAccessSettings(role: Role): boolean {
  return role === "admin" || role === "super_admin" || role === "leadership" || role === "hr" || role === "it_team";
}

export type RoleCarrier = Pick<User, "role" | "roles">;

export function getAssignedRoles(user?: RoleCarrier | null): Role[] {
  if (!user) return [];
  const roles: Role[] = [];
  if (user.role) roles.push(user.role);
  for (const role of user.roles ?? []) {
    if (!roles.includes(role)) roles.push(role);
  }
  return roles;
}

export function hasAssignedRole(user: RoleCarrier | null | undefined, roles: readonly Role[]): boolean {
  const allowed = new Set<Role>(roles);
  return getAssignedRoles(user).some((role) => allowed.has(role));
}

export function canAccessSettingsForUser(user?: RoleCarrier | null): boolean {
  return hasAssignedRole(user, ["admin", "super_admin", "leadership", "hr", "it_team"]);
}

export const STAGE_LABELS: Record<CandidateStage, string> = {
  new_application: "New Application",
  source_tagged: "Source Tagged",
  resume_uploaded: "Resume Uploaded",
  resume_screening_pending: "Screening Pending",
  resume_shortlisted: "Shortlisted",
  resume_rejected: "Rejected",
  evaluation_assigned: "Evaluation",
  evaluation_in_progress: "Evaluation",
  evaluation_passed: "Evaluation",
  evaluation_failed: "Evaluation Failed",
  selection_form_sent: "Selection Form Sent",
  selection_form_submitted: "Selection Form Submitted",
  selection_form_validated: "Selection Form Validated",
  contract_sent: "Contract Sent",
  contract_signed: "Contract Signed",
  induction_completed: "Induction Completed",
  it_email_created: "IT Email Created",
  welcome_mail_sent: "Welcome Mail Sent",
  statutory_forms_sent: "Statutory Forms Sent",
  statutory_forms_submitted: "Statutory Forms Submitted",
  compliance_verified: "Compliance Verified",
  onboarding_completed: "Onboarding Completed",
};

export const STAGE_COLORS: Record<string, string> = {
  new_application: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  source_tagged: "bg-sky-100 text-sky-700 dark:bg-sky-900 dark:text-sky-300",
  resume_uploaded: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  resume_screening_pending: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  resume_shortlisted: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  resume_rejected: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  evaluation_assigned: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  evaluation_in_progress: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  evaluation_passed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  evaluation_failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  selection_form_sent: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300",
  selection_form_submitted: "bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300",
  selection_form_validated: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  contract_sent: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  contract_signed: "bg-lime-100 text-lime-700 dark:bg-lime-900 dark:text-lime-300",
  induction_completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
  it_email_created: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  welcome_mail_sent: "bg-pink-100 text-pink-700 dark:bg-pink-900 dark:text-pink-300",
  statutory_forms_sent: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900 dark:text-fuchsia-300",
  statutory_forms_submitted: "bg-violet-100 text-violet-700 dark:bg-violet-900 dark:text-violet-300",
  compliance_verified: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  onboarding_completed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300",
};

export const STAGE_ACCENTS: Record<string, string> = {
  new_application: "bg-slate-500",
  source_tagged: "bg-sky-500",
  resume_uploaded: "bg-blue-500",
  resume_screening_pending: "bg-amber-500",
  resume_shortlisted: "bg-emerald-500",
  resume_rejected: "bg-red-500",
  evaluation_assigned: "bg-violet-500",
  evaluation_in_progress: "bg-purple-500",
  evaluation_passed: "bg-green-500",
  evaluation_failed: "bg-red-500",
  selection_form_sent: "bg-indigo-500",
  selection_form_submitted: "bg-teal-500",
  selection_form_validated: "bg-cyan-500",
  contract_sent: "bg-orange-500",
  contract_signed: "bg-lime-500",
  induction_completed: "bg-emerald-500",
  it_email_created: "bg-blue-500",
  welcome_mail_sent: "bg-pink-500",
  statutory_forms_sent: "bg-fuchsia-500",
  statutory_forms_submitted: "bg-violet-500",
  compliance_verified: "bg-green-500",
  onboarding_completed: "bg-emerald-500",
};

type ModuleTone = {
  dot: string;
  text: string;
  border: string;
  background: string;
};

export const MODULE_COLORS: Record<string, ModuleTone> = {
  dashboard: { dot: "bg-slate-500", text: "text-slate-600 dark:text-slate-300", border: "border-slate-500/25", background: "bg-slate-500/10" },
  applications: { dot: "bg-blue-500", text: "text-blue-600 dark:text-blue-300", border: "border-blue-500/25", background: "bg-blue-500/10" },
  candidates: { dot: "bg-cyan-500", text: "text-cyan-600 dark:text-cyan-300", border: "border-cyan-500/25", background: "bg-cyan-500/10" },
  employees: { dot: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-300", border: "border-emerald-500/25", background: "bg-emerald-500/10" },
  positions: { dot: "bg-orange-500", text: "text-orange-600 dark:text-orange-300", border: "border-orange-500/25", background: "bg-orange-500/10" },
  screening: { dot: "bg-amber-500", text: "text-amber-600 dark:text-amber-300", border: "border-amber-500/25", background: "bg-amber-500/10" },
  assessment_platform: { dot: "bg-violet-500", text: "text-violet-600 dark:text-violet-300", border: "border-violet-500/25", background: "bg-violet-500/10" },
  evaluations: { dot: "bg-purple-500", text: "text-purple-600 dark:text-purple-300", border: "border-purple-500/25", background: "bg-purple-500/10" },
  selection_forms: { dot: "bg-teal-500", text: "text-teal-600 dark:text-teal-300", border: "border-teal-500/25", background: "bg-teal-500/10" },
  contracts: { dot: "bg-lime-500", text: "text-lime-600 dark:text-lime-300", border: "border-lime-500/25", background: "bg-lime-500/10" },
  vendors: { dot: "bg-rose-500", text: "text-rose-600 dark:text-rose-300", border: "border-rose-500/25", background: "bg-rose-500/10" },
  colleges: { dot: "bg-fuchsia-500", text: "text-fuchsia-600 dark:text-fuchsia-300", border: "border-fuchsia-500/25", background: "bg-fuchsia-500/10" },
  documents: { dot: "bg-sky-500", text: "text-sky-600 dark:text-sky-300", border: "border-sky-500/25", background: "bg-sky-500/10" },
  compliance: { dot: "bg-green-500", text: "text-green-600 dark:text-green-300", border: "border-green-500/25", background: "bg-green-500/10" },
  attendance: { dot: "bg-indigo-500", text: "text-indigo-600 dark:text-indigo-300", border: "border-indigo-500/25", background: "bg-indigo-500/10" },
  resource_segregation: { dot: "bg-cyan-600", text: "text-cyan-700 dark:text-cyan-300", border: "border-cyan-600/25", background: "bg-cyan-600/10" },
  leave: { dot: "bg-emerald-600", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-600/25", background: "bg-emerald-600/10" },
  manager_mapping: { dot: "bg-violet-600", text: "text-violet-700 dark:text-violet-300", border: "border-violet-600/25", background: "bg-violet-600/10" },
  pms: { dot: "bg-yellow-500", text: "text-yellow-700 dark:text-yellow-300", border: "border-yellow-500/25", background: "bg-yellow-500/10" },
  it_assets: { dot: "bg-blue-600", text: "text-blue-700 dark:text-blue-300", border: "border-blue-600/25", background: "bg-blue-600/10" },
  it_requests: { dot: "bg-sky-600", text: "text-sky-700 dark:text-sky-300", border: "border-sky-600/25", background: "bg-sky-600/10" },
  reimbursements: { dot: "bg-pink-500", text: "text-pink-600 dark:text-pink-300", border: "border-pink-500/25", background: "bg-pink-500/10" },
  dinner_requests: { dot: "bg-orange-600", text: "text-orange-700 dark:text-orange-300", border: "border-orange-600/25", background: "bg-orange-600/10" },
  reports: { dot: "bg-indigo-600", text: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-600/25", background: "bg-indigo-600/10" },
  separation: { dot: "bg-stone-500", text: "text-stone-600 dark:text-stone-300", border: "border-stone-500/25", background: "bg-stone-500/10" },
  users: { dot: "bg-slate-600", text: "text-slate-700 dark:text-slate-300", border: "border-slate-600/25", background: "bg-slate-600/10" },
  settings: { dot: "bg-zinc-500", text: "text-zinc-600 dark:text-zinc-300", border: "border-zinc-500/25", background: "bg-zinc-500/10" },
};

export function moduleColorForKey(key?: string | null): ModuleTone {
  return (key && MODULE_COLORS[key]) || {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    border: "border-border",
    background: "bg-muted/30",
  };
}

export const SOURCE_LABELS: Record<string, string> = {
  vendor: "Vendor",
  lateral_hiring: "Lateral Hiring",
  internal_hiring: "Internal Hiring",
  employee_referral: "Employee Referral",
  direct_application: "Direct Registration",
  direct_registration: "Direct Registration",
  campus_hire: "Campus Hire",
};

export const GENERAL_LABELS: Record<string, string> = {
  resume_screening_pending: "Resume Screening Pending",
  employee_referral: "Employee Referral",
  assessment_level_1: "Assessment",
  assessment_level_2: "Assessment",
  lateral_hiring: "Lateral Hiring",
  direct_application: "Direct Application",
  direct_registration: "Direct Registration",
  campus_hire: "Campus Hire",
  new_application: "New Application",
  source_tagged: "Source Tagged",
  resume_uploaded: "Resume Uploaded",
  resume_shortlisted: "Shortlisted",
  resume_rejected: "Rejected",
  evaluation_assigned: "Evaluation",
  evaluation_in_progress: "Evaluation",
  evaluation_passed: "Evaluation",
  evaluation_failed: "Evaluation Failed",
  selection_form_sent: "Selection Form Sent",
  selection_form_submitted: "Selection Form Submitted",
  selection_form_validated: "Selection Form Validated",
  contract_sent: "Contract Sent",
  contract_signed: "Contract Signed",
  induction_completed: "Induction Completed",
  it_email_created: "IT Email Created",
  welcome_mail_sent: "Welcome Mail Sent",
  statutory_forms_sent: "Statutory Forms Sent",
  statutory_forms_submitted: "Statutory Forms Submitted",
  compliance_verified: "Compliance Verified",
  onboarding_completed: "Onboarding Completed",
  strongly_recommended: "Strongly Recommended",
  passed: "Passed",
  failed: "Failed",
  rejected: "Rejected",
  active: "Active",
  inactive: "Inactive",
  pending: "Pending",
  in_progress: "In Progress",
  completed: "Completed",
  submitted: "Submitted",
  shortlisted: "Shortlisted",
  vendor: "Vendor",
  manager_approved: "Manager Approved",
  on_hold: "On Hold",
  draft: "Draft",
  pending_leadership_approval: "Pending Leadership Approval",
  posted: "Posted",
  sent: "Sent",
  viewed: "Viewed",
  signed: "Signed",
  expired: "Expired",
  verified: "Verified",
  uploaded: "Uploaded",
  pending_verification: "Pending Verification",
  needs_correction: "Needs Correction",
  waiting_on_requester: "Waiting On Requester",
  waiting_on_internal: "Waiting On Internal",
  first_response: "First Response",
  no_further_pi_required: "No Further PI Required",
  pending_send: "Pending Send",
  status_changed: "Status Changed",
  not_started: "Not Started",
  fresher: "Fresher",
  experienced: "Experienced",
  female: "Female",
  male: "Male",
  non_binary: "Non-Binary",
  prefer_not_to_say: "Prefer Not To Say",
  resignation: "Resignation",
  termination: "Termination",
  casual: "Casual Leave",
  sick: "Sick Leave",
  earned: "Earned Leave",
  maternity: "Maternity Leave",
  paternity: "Paternity Leave",
  unpaid: "Unpaid Leave",
  compensatory: "Compensatory Leave",
};

export function formatLabel(value: string): string {
  if (!value) return "";
  if (GENERAL_LABELS[value]) return GENERAL_LABELS[value];
  if (STAGE_LABELS[value as CandidateStage]) return STAGE_LABELS[value as CandidateStage];
  if (SOURCE_LABELS[value]) return SOURCE_LABELS[value];
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function generateCandidateCode(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `ETH-${timestamp}-${random}`;
}

export function getDefaultRouteForRole(role: Role): string {
  if (role === "candidate") return "/portal/dashboard";
  if (role === "admin" || role === "super_admin" || role === "leadership") return "/dashboard/admin";
  if (role === "ta") return "/dashboard/ta";
  if (role === "employee") return "/dashboard/employee";
  if (role === "employee_referrer") return "/dashboard/employee";
  if (role === "it_team") return "/dashboard/it";
  if (role === "compliance") return "/dashboard/compliance";
  if (role === "office_admin") return "/dashboard/office-admin";
  if (role === "pl_tpm") return "/dashboard/dinner-requests";
  if (role === "manager") return "/dashboard/manager";
  if (role === "hr") return "/dashboard/hr";
  if (role === "evaluator") return "/dashboard/evaluator";
  if (role === "vendor") return "/dashboard/vendor";
  return `/dashboard/${(role as string).replace(/_/g, "-")}`;
}

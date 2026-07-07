"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { cn, getAssignedRoles, hasAssignedRole, moduleColorForKey } from "@/lib/utils";
import type { Role } from "@/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertTriangle,
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  CreditCard,
  FileCheck,
  FileText,
  FolderKanban,
  GraduationCap,
  History,
  Landmark,
  LayoutDashboard,
  Laptop,
  LogOut,
  Mail,
  MonitorSmartphone,
  ReceiptText,
  Scale,
  ScrollText,
  Search,
  Settings,
  Shield,
  Star,
  Upload,
  UserCheck,
  UserCog,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { roleModulesApi } from "@/lib/api";

interface NavItem {
  label: string;
  href?: string;
  icon: React.ElementType;
  roles?: Role[];
  module?: string;
  badge?: string;
  disabled?: boolean;
}

interface NavSection {
  id: string;
  label: string;
  icon: React.ElementType;
  roles?: Role[];
  items: NavItem[];
}

// The sidebar follows the currently active role. Users with multiple roles can switch
// roles from the top bar; rendering every assigned role here makes the menu repetitive
// and prevents the sidebar from feeling role-specific.
type RenderSection = NavSection & { renderKey: string };

const FULL_ACCESS_ROLES: Role[] = ["super_admin", "admin", "leadership"];
const RECRUITMENT_ROLES: Role[] = ["super_admin", "admin", "leadership", "hr", "ta"];
const STAFF_DIRECTORY_ROLES: Role[] = [
  "super_admin",
  "admin",
  "leadership",
  "hr",
  "ta",
  "it_team",
  "compliance",
  "office_admin",
];
const SETTINGS_ROLES: Role[] = ["super_admin", "admin", "leadership", "hr", "it_team"];
const EVERYONE_ROLES: Role[] = [
  "super_admin",
  "admin",
  "leadership",
  "hr",
  "ta",
  "employee",
  "vendor",
  "employee_referrer",
  "evaluator",
  "it_team",
  "compliance",
  "candidate",
  "manager",
  "office_admin",
  "pl_tpm",
];

// Map a nav href to a module key (most specific match first) so the sidebar can hide
// modules an admin has disabled for the role. Items with no module are display-only.
const HREF_MODULE_RULES: [string, string][] = [
  ["/module-overview", "dashboard"],
  ["/employee-evaluation", "employee_evaluation"],
  ["/assessment-platform/question-bank", "assessment_platform"],
  ["/assessment-platform/grading", "assessment_platform"],
  ["/assessment-platform", "assessment_platform"],
  ["/employee/selection-form", "selection_forms"],
  ["/employee/attendance", "attendance"],
  ["/employee/leave", "leave"],
  ["/employee/contracts", "contracts"],
  ["/employee/compliance", "compliance"],
  ["/employee/documents", "documents"],
  ["/employee/separation", "separation"],
  ["/employee/referrals", "candidates"],
  ["/manager/team", "employees"],
  ["/manager/leaves", "leave"],
  ["/it/id-cards", "it_requests"],
  ["/it/assets", "it_assets"],
  ["/it-requests", "it_requests"],
  ["/hr/pms", "pms"],
  ["/applications", "applications"],
  ["/candidates", "candidates"],
  ["/employees", "employees"],
  ["/screening", "screening"],
  ["/selection-forms", "selection_forms"],
  ["/signed-contracts", "contracts"],
  ["/contracts", "contracts"],
  ["/manager-mapping", "manager_mapping"],
  ["/attendance", "attendance"],
  ["/resource-segregation", "resource_segregation"],
  ["/projects", "projects"],
  ["/skills", "skill_tags"],
  ["/leave", "leave"],
  ["/reimbursements", "reimbursements"],
  ["/dinner-requests", "dinner_requests"],
  ["/bank-verification", "bank_verification"],
  ["/compliance", "compliance"],
  ["/separation", "separation"],
  ["/reports", "reports"],
  ["/escalations", "reports"],
  ["/logs", "settings"],
  ["/audit-logs", "settings"],
  ["/config/positions", "positions"],
  ["/positions", "positions"],
  ["/config/vendors", "vendors"],
  ["/config/colleges", "colleges"],
  ["/config/departments-designations", "employees"],
  ["/config/users", "users"],
  ["/config/role-modules", "users"],
  ["/config/settings", "settings"],
  ["/documents", "documents"],
  ["/admin", "dashboard"],
  ["/hr", "dashboard"],
  ["/ta", "dashboard"],
  ["/it", "dashboard"],
  ["/manager", "dashboard"],
  ["/office-admin", "dashboard"],
  ["/vendor", "dashboard"],
  ["/evaluator", "dashboard"],
  ["/employee", "dashboard"],
];

function hrefToModule(href: string): string | null {
  for (const [match, mod] of HREF_MODULE_RULES) if (href.includes(match)) return mod;
  return null;
}

function roleAllowed(role: Role, roles?: Role[]) {
  return !roles || roles.includes(role);
}

function dashboardHrefForRole(role: Role) {
  const base = "/dashboard";
  if (role === "candidate") return "/portal/dashboard";
  if (role === "employee" || role === "employee_referrer") return `${base}/employee`;
  if (role === "manager") return `${base}/manager`;
  if (role === "office_admin") return `${base}/office-admin`;
  if (role === "pl_tpm") return `${base}/projects`;
  if (role === "it_team") return `${base}/it`;
  if (role === "compliance") return `${base}/compliance`;
  if (role === "vendor") return `${base}/vendor`;
  if (role === "evaluator") return `${base}/evaluator`;
  if (role === "ta") return `${base}/ta`;
  if (role === "hr") return `${base}/hr`;
  return `${base}/admin`;
}

function scopedHref(role: Role, staffHref: string, selfHref: string) {
  return role === "employee" || role === "employee_referrer" ? selfHref : staffHref;
}

function getNavigationSections(role: Role): NavSection[] {
  const base = "/dashboard";
  const positionsHref = role === "ta" ? `${base}/positions` : `${base}/config/positions`;
  const attendanceHref =
    role === "employee" ||
    role === "employee_referrer" ||
    role === "manager" ||
    role === "it_team" ||
    role === "compliance" ||
    role === "ta"
      ? `${base}/employee/attendance`
      : `${base}/attendance`;
  const leaveHref =
    role === "employee" || role === "employee_referrer"
      ? `${base}/employee/leave`
      : role === "manager"
        ? `${base}/manager/leaves`
        : `${base}/leave`;
  const complianceHref = scopedHref(role, `${base}/compliance`, `${base}/employee/compliance`);
  const contractHref = scopedHref(role, `${base}/contracts`, `${base}/employee/contracts`);

  return [
    {
      id: "workspace",
      label: "Workspace",
      icon: LayoutDashboard,
      items: [
        { label: "Main Dashboard", href: `${base}/module-overview`, icon: BarChart3, roles: [...FULL_ACCESS_ROLES, "hr"], module: "dashboard" },
        {
          label: role === "candidate" || role === "employee" || role === "employee_referrer" ? "My Dashboard" : "Dashboard",
          href: dashboardHrefForRole(role),
          icon: LayoutDashboard,
          roles: EVERYONE_ROLES,
          module: "dashboard",
        },
        { label: "Resume Database", href: `${base}/applications`, icon: FileText, roles: RECRUITMENT_ROLES, module: "applications" },
        { label: role === "vendor" ? "My Candidates" : "Candidates", href: `${base}/candidates`, icon: Users, roles: [...RECRUITMENT_ROLES, "vendor", "it_team", "compliance", "office_admin"], module: "candidates" },
        { label: "Employees", href: `${base}/employees`, icon: UserCheck, roles: STAFF_DIRECTORY_ROLES, module: "employees" },
        { label: "My Profile", href: "/portal/profile", icon: UserCheck, roles: ["candidate"], module: "dashboard" },
      ],
    },
    {
      id: "talent",
      label: "Talent Acquisition & Recruitment",
      icon: Briefcase,
      roles: [...RECRUITMENT_ROLES, "vendor", "evaluator"],
      items: [
        { label: "Talent Dashboard", href: `${base}/module-overview/talent`, icon: BarChart3, roles: [...RECRUITMENT_ROLES, "vendor", "evaluator"], module: "dashboard" },
        { label: "Positions / Job Posts", href: positionsHref, icon: Briefcase, roles: [...RECRUITMENT_ROLES], module: "positions" },
        { label: "Resume Screening", href: `${base}/screening`, icon: Search, roles: RECRUITMENT_ROLES, module: "screening" },
        { label: "Assessment Platform", href: `${base}/assessment-platform`, icon: ClipboardCheck, roles: [...RECRUITMENT_ROLES, "evaluator"], module: "assessment_platform" },
        { label: "Assessment Grading", href: `${base}/assessment-platform/grading`, icon: FileCheck, roles: ["evaluator"], module: "assessment_platform" },
        { label: "Evaluations", href: `${base}/evaluations`, icon: ClipboardCheck, roles: [...RECRUITMENT_ROLES, "evaluator"], module: "evaluations" },
        { label: "Completed Evaluations", href: `${base}/evaluations/completed`, icon: FileCheck, roles: ["evaluator"], module: "evaluations" },
        { label: "Selection Forms", href: `${base}/selection-forms`, icon: FileText, roles: RECRUITMENT_ROLES, module: "selection_forms" },
        { label: "Contracts", href: contractHref, icon: FileCheck, roles: RECRUITMENT_ROLES, module: "contracts" },
        { label: "Signed Contracts", href: `${base}/signed-contracts`, icon: ScrollText, roles: RECRUITMENT_ROLES, module: "contracts" },
        { label: "Vendors", href: `${base}/config/vendors`, icon: Building2, roles: RECRUITMENT_ROLES, module: "vendors" },
        { label: "Colleges", href: `${base}/config/colleges`, icon: GraduationCap, roles: RECRUITMENT_ROLES, module: "colleges" },
        { label: "Submit Candidate", href: `${base}/candidates/new`, icon: UserCheck, roles: ["vendor"], module: "candidates" },
      ],
    },
    {
      id: "candidate-portal",
      label: "Candidate Portal",
      icon: ClipboardCheck,
      roles: ["candidate"],
      items: [
        { label: "My Application", href: "/portal/application", icon: FileText, roles: ["candidate"], module: "documents" },
        { label: "My Assessments", href: "/portal/my-assessments", icon: ClipboardCheck, roles: ["candidate"], module: "assessment_platform" },
        { label: "Selection Form", href: "/portal/selection-form", icon: FileText, roles: ["candidate"], module: "selection_forms" },
        { label: "Contract", href: "/portal/contract", icon: FileCheck, roles: ["candidate"], module: "contracts" },
        { label: "Compliance", href: "/portal/compliance", icon: Scale, roles: ["candidate"], module: "compliance" },
        { label: "ID Card Details", href: "/portal/id-card", icon: CreditCard, roles: ["candidate"], module: "documents" },
        { label: "Open Roles", href: "/careers", icon: Briefcase, roles: ["candidate"] },
      ],
    },
    {
      id: "employee-lifecycle",
      label: "Employee Lifecycle",
      icon: UserCheck,
      items: [
        { label: "Lifecycle Dashboard", href: `${base}/module-overview/lifecycle`, icon: BarChart3, roles: [...FULL_ACCESS_ROLES, "hr", "ta", "manager", "it_team", "compliance", "office_admin"], module: "dashboard" },
        { label: "Employee Directory", href: `${base}/employees`, icon: UserCheck, roles: STAFF_DIRECTORY_ROLES, module: "employees" },
        { label: "Employee Detail Form", href: `${base}/employee/selection-form`, icon: FileText, roles: ["employee", "employee_referrer"], module: "selection_forms" },
        { label: "Documents", href: scopedHref(role, `${base}/documents`, `${base}/employee/documents`), icon: Upload, roles: ["hr", "ta", "compliance", "employee", "employee_referrer"], module: "documents" },
        { label: "Contracts", href: contractHref, icon: FileCheck, roles: ["employee", "employee_referrer"], module: "contracts" },
        { label: "Attendance", href: attendanceHref, icon: Clock3, roles: [...FULL_ACCESS_ROLES, "hr", "ta", "employee", "employee_referrer", "manager", "it_team", "compliance"], module: "attendance" },
        { label: "Leave Management", href: leaveHref, icon: CalendarDays, roles: [...FULL_ACCESS_ROLES, "hr", "ta", "employee", "employee_referrer", "manager"], module: "leave" },
        { label: "Compliance", href: complianceHref, icon: Scale, roles: [...FULL_ACCESS_ROLES, "hr", "ta", "employee", "employee_referrer", "compliance"], module: "compliance" },
        { label: "Manager Mapping", href: `${base}/manager-mapping`, icon: UserCog, roles: RECRUITMENT_ROLES, module: "manager_mapping" },
        { label: "My Team", href: `${base}/manager/team`, icon: Users, roles: ["manager"], module: "employees" },
        // Referrals are self-service (/employees/me/referrals) and never module-gated at the
        // API, so no module key — a saved role config must not hide the entry point.
        { label: "Employee Referrals", href: `${base}/employee/referrals`, icon: Users, roles: ["employee", "employee_referrer"] },
      ],
    },
    {
      id: "performance",
      label: "Performance & Development",
      icon: Star,
      roles: [...FULL_ACCESS_ROLES, "hr", "evaluator"],
      items: [
        { label: "Performance Dashboard", href: `${base}/module-overview/performance`, icon: BarChart3, roles: [...FULL_ACCESS_ROLES, "hr", "evaluator"], module: "dashboard" },
        { label: "Employee Evaluation", href: `${base}/employee-evaluation`, icon: Star, roles: [...FULL_ACCESS_ROLES, "hr", "evaluator"], module: "employee_evaluation" },
      ],
    },
    {
      id: "it-operations",
      label: "IT Operations & Support",
      icon: Laptop,
      roles: [...FULL_ACCESS_ROLES, "hr", "ta", "it_team", "employee", "employee_referrer", "manager", "office_admin", "vendor", "evaluator", "compliance"],
      items: [
        { label: "IT Operations Dashboard", href: `${base}/module-overview/it-operations`, icon: BarChart3, roles: [...FULL_ACCESS_ROLES, "hr", "ta", "it_team", "office_admin", "compliance"], module: "dashboard" },
        { label: "IT Dashboard", href: `${base}/it`, icon: MonitorSmartphone, roles: ["it_team"], module: "dashboard" },
        { label: "IT Assets Allocation", href: `${base}/it/assets`, icon: Laptop, roles: [...FULL_ACCESS_ROLES, "it_team"], module: "it_assets" },
        { label: "IT Requests", href: `${base}/it-requests`, icon: Mail, roles: [...FULL_ACCESS_ROLES, "hr", "ta", "it_team"], module: "it_requests" },
        { label: "ID Cards", href: `${base}/it/id-cards`, icon: CreditCard, roles: ["it_team"], module: "it_requests" },
      ],
    },
    {
      id: "project-governance",
      label: "Project Governance",
      icon: Landmark,
      roles: [...FULL_ACCESS_ROLES, "hr", "manager", "office_admin", "pl_tpm"],
      items: [
        { label: "Governance Dashboard", href: `${base}/projects`, icon: BarChart3, roles: [...FULL_ACCESS_ROLES, "hr", "manager", "office_admin", "pl_tpm"], module: "projects" },
        { label: "Project Master", href: `${base}/projects/master`, icon: FolderKanban, roles: [...FULL_ACCESS_ROLES, "hr", "manager", "office_admin", "pl_tpm"], module: "projects" },
        { label: "Budgets & Approvals", href: `${base}/projects/budgets`, icon: ReceiptText, roles: [...FULL_ACCESS_ROLES, "hr", "manager", "pl_tpm"], module: "projects" },
        { label: "Leadership View", href: `${base}/projects/leadership`, icon: Star, roles: [...FULL_ACCESS_ROLES, "hr"], module: "projects" },
        { label: "Settings", href: `${base}/projects/settings`, icon: Settings, roles: FULL_ACCESS_ROLES, module: "projects" },
      ],
    },
    {
      id: "finance",
      label: "Finance",
      icon: ReceiptText,
      roles: [...FULL_ACCESS_ROLES, "hr", "ta", "employee", "employee_referrer", "manager", "office_admin", "evaluator", "it_team", "compliance"],
      items: [
        { label: "Finance Dashboard", href: `${base}/module-overview/finance`, icon: BarChart3, roles: [...FULL_ACCESS_ROLES, "hr", "manager", "office_admin", "pl_tpm"], module: "dashboard" },
        { label: "Reimbursement Requests", href: `${base}/reimbursements`, icon: ReceiptText, roles: [...FULL_ACCESS_ROLES, "hr", "ta", "employee", "employee_referrer", "manager", "office_admin", "evaluator", "it_team", "compliance"], module: "reimbursements" },
        { label: "Dinner Requests", href: `${base}/dinner-requests`, icon: UtensilsCrossed, roles: [...FULL_ACCESS_ROLES, "hr", "manager", "office_admin", "pl_tpm"], module: "dinner_requests" },
        { label: "Penny Drop / Bank Verification", href: `${base}/bank-verification`, icon: Landmark, roles: [...FULL_ACCESS_ROLES, "hr", "office_admin"], module: "bank_verification" },
      ],
    },
    {
      id: "administration",
      label: "Administration & Configuration",
      icon: Settings,
      roles: SETTINGS_ROLES,
      items: [
        { label: "Departments & Designations", href: `${base}/config/departments-designations`, icon: Building2, roles: SETTINGS_ROLES, module: "employees" },
        { label: "Users & Roles", href: `${base}/config/users`, icon: Shield, roles: [...FULL_ACCESS_ROLES], module: "users" },
        { label: "Module Access", href: `${base}/config/role-modules`, icon: UserCog, roles: [...FULL_ACCESS_ROLES], module: "users" },
        { label: "Assessment Configuration", href: `${base}/assessment-platform/question-bank`, icon: ClipboardCheck, roles: [...FULL_ACCESS_ROLES, "hr"], module: "assessment_platform" },
        { label: "Settings", href: `${base}/config/settings`, icon: Settings, roles: SETTINGS_ROLES, module: "settings" },
      ],
    },
    {
      id: "analytics",
      label: "Analytics & Reporting",
      icon: BarChart3,
      roles: [...FULL_ACCESS_ROLES, "hr"],
      items: [
        { label: "Audit & Activity Logs", href: `${base}/logs`, icon: History, roles: [...FULL_ACCESS_ROLES], module: "settings" },
        { label: "Escalations", href: `${base}/escalations`, icon: AlertTriangle, roles: [...FULL_ACCESS_ROLES], module: "reports" },
      ],
    },
  ];
}

function filterSectionsByRole(sections: NavSection[], role: Role) {
  return sections
    .filter((section) => roleAllowed(role, section.roles))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => roleAllowed(role, item.roles)),
    }))
    .filter((section) => section.items.length > 0);
}

function filterSectionsByModules(
  sections: NavSection[],
  enabledModules: string[] | undefined,
  isFullAccess: boolean,
) {
  if (isFullAccess || !enabledModules) return sections;
  const enabled = new Set(enabledModules);
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (item.disabled) return true;
        const moduleKey = item.module ?? (item.href ? hrefToModule(item.href) : null);
        return !moduleKey || enabled.has(moduleKey);
      }),
    }))
    .filter((section) => section.items.length > 0);
}

function dedupeLinkedItems(sections: NavSection[]) {
  const seen = new Set<string>();
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.href) return true;
        if (seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      }),
    }))
    .filter((section) => section.items.length > 0);
}

function isActiveNavItem(pathname: string, item: NavItem, linkedItems: NavItem[]) {
  if (!item.href || item.disabled) return false;
  const href = item.href;
  const isExactMatch = pathname === href;
  const isPrefixMatch = pathname.startsWith(`${href}/`);
  const hasMoreSpecificSibling = linkedItems.some(
    (other) =>
      other.href &&
      other.href !== href &&
      (pathname === other.href || pathname.startsWith(`${other.href}/`)) &&
      other.href.startsWith(href),
  );
  return isExactMatch || (isPrefixMatch && !hasMoreSpecificSibling);
}

export function AppSidebar({
  mobileOpen = false,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const collapsed = false;
  // Accordion: at most one section open. null = "not chosen yet" (falls back to the active
  // section); "" = user explicitly collapsed everything.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const assignedRoles = useMemo(() => getAssignedRoles(user), [user]);
  const activeRole = user?.role;
  const isFullAccess = hasAssignedRole(user, FULL_ACCESS_ROLES);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileOpen]);

  // Close the mobile drawer whenever the route changes (i.e. after a nav tap).
  useEffect(() => {
    onMobileClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const { data: myModules } = useQuery({
    queryKey: ["my-modules", user?.id, assignedRoles.join("|")],
    queryFn: () => roleModulesApi.myModules(),
    enabled: !!user && !isFullAccess,
    staleTime: 60_000,
  });

  const { topItem, sections } = useMemo<{ topItem: NavItem | null; sections: RenderSection[] }>(() => {
    if (!activeRole) return { topItem: null, sections: [] };
    const roleSections = filterSectionsByRole(getNavigationSections(activeRole), activeRole);
    const moduleSections = filterSectionsByModules(roleSections, myModules?.enabled, isFullAccess);
    const built = dedupeLinkedItems(moduleSections).map((section, index) => ({
      ...section,
      renderKey: `${activeRole}-${section.id}-${index}`,
    }));
    // "Main Dashboard" (module-overview) renders as a standalone entry above the
    // grouped sections, so pull it out of whichever section it lives in.
    const topHref = "/dashboard/module-overview";
    const top = built.flatMap((s) => s.items).find((it) => it.href === topHref) ?? null;
    const grouped = top
      ? built
          .map((s) => ({ ...s, items: s.items.filter((it) => it.href !== topHref) }))
          .filter((s) => s.items.length > 0)
      : built;
    return { topItem: top, sections: grouped };
  }, [activeRole, isFullAccess, myModules?.enabled]);

  if (!user) return null;

  const linkedItems = [...(topItem ? [topItem] : []), ...sections.flatMap((section) => section.items)].filter(
    (item) => item.href,
  );
  // The block containing the current route.
  const activeRenderKey =
    sections.find((section) =>
      section.items.some((item) => isActiveNavItem(pathname, item, linkedItems)),
    )?.renderKey ?? null;
  // Until the user picks a section, show the active one open; "" means they collapsed all.
  const effectiveOpenKey = openKey ?? activeRenderKey;
  const showEmployeeWikiLink = activeRole === "employee" || activeRole === "employee_referrer";

  const toggleSection = (key: string) => {
    setOpenKey((current) => {
      const resolved = current ?? activeRenderKey;
      return resolved === key ? "" : key;
    });
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isActiveNavItem(pathname, item, linkedItems);
    const moduleKey = item.module ?? (item.href ? hrefToModule(item.href) : null);
    const moduleTone = moduleColorForKey(moduleKey);
    const content = (
      <>
        {isActive && (
          <span
            className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full"
            style={{ background: "linear-gradient(180deg, #ED00ED 0%, #908DCE 100%)" }}
          />
        )}
        <Icon
          className="h-4 w-4 shrink-0 transition-colors duration-200"
          style={isActive ? { color: "#ED00ED", filter: "drop-shadow(0 0 6px rgba(237,0,237,0.45))" } : {}}
        />
        {!collapsed && (
          <>
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full ring-1 ring-white/10",
                moduleTone.dot,
                isActive && "ring-white/30",
              )}
            />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.badge && (
              <span className="shrink-0 rounded-full border border-[rgba(144,141,206,0.2)] px-1.5 py-0.5 text-[9px] font-semibold text-[rgba(197,203,232,0.55)]">
                {item.badge}
              </span>
            )}
          </>
        )}
      </>
    );

    const className = cn(
      "group relative flex min-h-9 items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200",
      collapsed && "justify-center px-2",
      item.disabled
        ? "cursor-not-allowed text-[rgba(197,203,232,0.32)]"
        : isActive
          ? "text-white"
          : "text-[rgba(197,203,232,0.58)] hover:bg-[rgba(144,141,206,0.08)] hover:text-[#C5CBE8]",
    );
    const activeStyle = isActive
      ? {
          background: "linear-gradient(135deg, rgba(237,0,237,0.18) 0%, rgba(144,141,206,0.12) 100%)",
          border: "1px solid rgba(237,0,237,0.24)",
          boxShadow: "0 0 16px rgba(237,0,237,0.10), inset 0 1px 0 rgba(255,255,255,0.06)",
        }
      : {
          border: "1px solid transparent",
        };

    const itemEl =
      item.href && !item.disabled ? (
        <Link key={item.href} href={item.href} className={className} style={activeStyle}>
          {content}
        </Link>
      ) : (
        <div key={item.label} className={className} style={activeStyle} aria-disabled="true">
          {content}
        </div>
      );

    if (collapsed) {
      return (
        <Tooltip key={item.href ?? item.label}>
          <TooltipTrigger render={itemEl} />
          <TooltipContent side="right" className="glass border-[rgba(144,141,206,0.25)] text-[#C5CBE8]">
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }
    return itemEl;
  };

  return (
    <>
      {/* Mobile-only backdrop behind the slide-in drawer */}
      <div
        aria-hidden
        onClick={onMobileClose}
        className={cn(
          "fixed inset-0 z-[39] bg-black/60 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <aside
        className={cn(
          // z-40: above the topbar (z-30) and page content, but BELOW the modal/
          // dialog/preview layer (z-50) so document previews and dialogs cover the
          // sidebar cleanly instead of having the sidebar bleed over them.
          "fixed left-0 top-0 z-40 flex h-screen flex-col transition-transform duration-300 ease-in-out lg:transition-all",
          "border-r",
          "w-[284px] max-w-[86vw]",
          collapsed ? "lg:w-[68px]" : "lg:w-[284px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "lg:translate-x-0",
        )}
        style={{
          background: "var(--sidebar)",
          borderColor: "var(--sidebar-border)",
          backdropFilter: "blur(28px) saturate(1.6)",
          WebkitBackdropFilter: "blur(28px) saturate(1.6)",
        }}
      >
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-[rgba(144,141,206,0.14)] px-4",
            collapsed ? "justify-center" : "gap-2",
          )}
        >
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close menu"
            className="order-last ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-[rgba(197,203,232,0.6)] transition-colors hover:bg-[rgba(144,141,206,0.1)] hover:text-[#C5CBE8] lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
          {collapsed ? (
            <div
              className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white"
              style={{ background: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)" }}
            >
              <span
                className="absolute inset-0 rounded-xl"
                style={{ boxShadow: "0 0 18px rgba(237,0,237,0.6), 0 0 36px rgba(237,0,237,0.2)" }}
              />
              <span className="relative z-10 font-extrabold tracking-tight">E</span>
            </div>
          ) : (
            <div className="animate-fade-in">
              <Image
                src="/logo.png"
                alt="Ethara.AI"
                width={120}
                height={34}
                className="object-contain"
                style={{ width: "auto", height: "auto" }}
                priority
              />
            </div>
          )}
        </div>

        <ScrollArea className="min-h-0 flex-1 py-3">
          <nav className="space-y-2 px-2">
            {topItem && <div className="space-y-1">{renderNavItem(topItem)}</div>}
            {sections.map((section) => {
              const SectionIcon = section.icon;
              const isActiveSection = section.renderKey === activeRenderKey;
              const isOpen = effectiveOpenKey === section.renderKey;

              return (
                <div key={section.renderKey} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleSection(section.renderKey)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
                      isActiveSection
                        ? "text-[#F5F3FF]"
                        : "text-[rgba(197,203,232,0.48)] hover:bg-[rgba(144,141,206,0.06)] hover:text-[#C5CBE8]",
                      collapsed && "justify-center px-2",
                    )}
                    aria-expanded={isOpen}
                  >
                    <SectionIcon className="h-4 w-4 shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="min-w-0 flex-1 text-[11px] font-semibold leading-4">
                          {section.label}
                        </span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 transition-transform",
                            isOpen && "rotate-180",
                          )}
                        />
                      </>
                    )}
                  </button>
                  {isOpen && (
                    <div className={cn("space-y-1", !collapsed && "pl-2")}>
                      {section.items.map(renderNavItem)}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </ScrollArea>

        <div className="shrink-0 space-y-1 border-t border-[rgba(144,141,206,0.14)] p-2">
          {showEmployeeWikiLink && (
            <a
              href="/employee-wiki/dashboard"
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                "text-[rgba(197,203,232,0.62)] hover:bg-[rgba(144,141,206,0.10)] hover:text-[#C5CBE8]",
                collapsed && "justify-center px-2",
              )}
            >
              <BookOpen className="h-4 w-4 shrink-0" />
              {!collapsed && <span>Wiki</span>}
            </a>
          )}
          <button
            onClick={async () => {
              await logout();
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
              "text-[rgba(197,203,232,0.45)] hover:bg-red-400/10 hover:text-red-400",
              collapsed && "justify-center px-2",
            )}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Sign Out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

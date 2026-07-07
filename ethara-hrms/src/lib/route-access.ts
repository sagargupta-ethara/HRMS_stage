import type { Role } from "@/types";

// Client-side route guard for the /dashboard/* tree.
//
// The sidebar (components/layout/app-sidebar.tsx) already renders menus for the
// *currently active* role only — users with multiple roles switch roles from the
// top bar. This module applies the same "follow the active role" rule to the
// routes themselves so that editing the URL (e.g. swapping `/dashboard/employee`
// for `/dashboard/hr`) can't load another role's dashboard shell without first
// switching into that role. The backend is still the real authorization boundary
// for data; this only stops the wrong page shell from rendering.
//
// The role sets below intentionally mirror the sidebar's role groupings. Keep
// them in sync when a module's audience changes.

const FULL_ACCESS: Role[] = ["super_admin", "admin", "leadership"];
const RECRUITMENT: Role[] = [...FULL_ACCESS, "hr", "ta"];
const STAFF_DIRECTORY: Role[] = [...FULL_ACCESS, "hr", "ta", "it_team", "compliance", "office_admin"];
const SETTINGS_ROLES: Role[] = [...FULL_ACCESS, "hr", "it_team"];
const EMPLOYEE_SELF: Role[] = ["employee", "employee_referrer"];

// Prefix → roles allowed to open it (with its sub-paths). The most specific
// (longest) matching prefix wins, so ordering here does not matter. A path with
// no matching rule is allowed (fail-open) — new/utility routes stay reachable and
// the backend still gates their data.
const ROUTE_ACCESS_RULES: [string, Role[]][] = [
  // Role landing dashboards
  ["/dashboard/admin", FULL_ACCESS],
  ["/dashboard/hr", [...FULL_ACCESS, "hr"]],
  ["/dashboard/ta", [...FULL_ACCESS, "ta"]],
  ["/dashboard/it", [...FULL_ACCESS, "it_team"]],
  ["/dashboard/it-requests", [...FULL_ACCESS, "hr", "ta", "it_team"]],
  ["/dashboard/manager", [...FULL_ACCESS, "manager"]],
  ["/dashboard/manager-mapping", RECRUITMENT],
  ["/dashboard/office-admin", [...FULL_ACCESS, "office_admin"]],
  ["/dashboard/evaluator", [...FULL_ACCESS, "evaluator"]],
  ["/dashboard/vendor", [...FULL_ACCESS, "vendor"]],

  // Employee self-service. Attendance is viewable by a wider staff audience
  // (matches the sidebar's attendanceHref scoping), so it gets its own rule.
  ["/dashboard/employee/attendance", [...FULL_ACCESS, "hr", "ta", "manager", "it_team", "compliance", ...EMPLOYEE_SELF]],
  ["/dashboard/employee", [...FULL_ACCESS, ...EMPLOYEE_SELF]],

  // Talent acquisition & recruitment
  ["/dashboard/applications", RECRUITMENT],
  ["/dashboard/candidates", [...RECRUITMENT, "vendor", "it_team", "compliance", "office_admin"]],
  ["/dashboard/employees", STAFF_DIRECTORY],
  ["/dashboard/screening", RECRUITMENT],
  ["/dashboard/assessment-platform/grading", [...RECRUITMENT, "evaluator"]],
  ["/dashboard/assessment-platform/question-bank", [...FULL_ACCESS, "hr"]],
  ["/dashboard/assessment-platform", [...RECRUITMENT, "evaluator"]],
  ["/dashboard/evaluations", [...RECRUITMENT, "evaluator"]],
  ["/dashboard/selection-forms", RECRUITMENT],
  ["/dashboard/signed-contracts", RECRUITMENT],
  ["/dashboard/contracts", RECRUITMENT],
  ["/dashboard/positions", RECRUITMENT],

  // Shared employee-lifecycle staff views
  ["/dashboard/documents", [...FULL_ACCESS, "hr", "ta", "compliance"]],
  ["/dashboard/attendance", [...FULL_ACCESS, "hr"]],
  ["/dashboard/skills", [...FULL_ACCESS, "hr", "ta", "manager"]],
  ["/dashboard/employee-evaluation", [...FULL_ACCESS, "hr", "evaluator"]],
  ["/dashboard/leave", [...FULL_ACCESS, "hr", "ta"]],
  ["/dashboard/compliance", [...FULL_ACCESS, "hr", "ta", "compliance"]],

  // Finance
  ["/dashboard/reimbursements", [...FULL_ACCESS, "hr", "ta", "manager", "office_admin", "evaluator", "it_team", "compliance", ...EMPLOYEE_SELF]],
  ["/dashboard/dinner-requests", [...FULL_ACCESS, "hr", "manager", "office_admin", "pl_tpm"]],
  ["/dashboard/bank-verification", [...FULL_ACCESS, "hr", "office_admin"]],

  // Project governance
  ["/dashboard/projects/budgets", [...FULL_ACCESS, "hr", "manager", "pl_tpm"]],
  ["/dashboard/projects/leadership", [...FULL_ACCESS, "hr"]],
  ["/dashboard/projects/settings", FULL_ACCESS],
  ["/dashboard/projects", [...FULL_ACCESS, "hr", "manager", "office_admin", "pl_tpm"]],

  // Administration & configuration
  ["/dashboard/config/users", FULL_ACCESS],
  ["/dashboard/config/role-modules", FULL_ACCESS],
  ["/dashboard/config/departments-designations", SETTINGS_ROLES],
  ["/dashboard/config/settings", SETTINGS_ROLES],
  ["/dashboard/config/positions", RECRUITMENT],
  ["/dashboard/config/vendors", RECRUITMENT],
  ["/dashboard/config/colleges", RECRUITMENT],
  ["/dashboard/config", SETTINGS_ROLES],

  // Analytics & reporting
  ["/dashboard/reports", [...FULL_ACCESS, "hr"]],
  ["/dashboard/logs", FULL_ACCESS],
  ["/dashboard/audit-logs", FULL_ACCESS],
  ["/dashboard/escalations", FULL_ACCESS],

  // Staff separation console (employees use /dashboard/employee/separation instead)
  ["/dashboard/separation", [...FULL_ACCESS, "hr", "ta", "manager"]],

  // Cross-module overview dashboards. The base ("Main Dashboard") is admin/HR only;
  // each scope mirrors its sidebar section so a role can't open an overview its menu
  // never offers (e.g. a vendor opening the finance overview).
  ["/dashboard/module-overview/talent", [...RECRUITMENT, "vendor", "evaluator"]],
  ["/dashboard/module-overview/lifecycle", [...FULL_ACCESS, "hr", "ta", "manager", "it_team", "compliance", "office_admin"]],
  ["/dashboard/module-overview/performance", [...FULL_ACCESS, "hr", "evaluator"]],
  ["/dashboard/module-overview/it-operations", [...FULL_ACCESS, "hr", "ta", "it_team", "office_admin", "compliance"]],
  ["/dashboard/module-overview/finance", [...FULL_ACCESS, "hr", "manager", "office_admin", "pl_tpm"]],
  ["/dashboard/module-overview", [...FULL_ACCESS, "hr"]],
  ["/dashboard/resource-segregation", [...FULL_ACCESS, "hr", "ta"]],
];

function matchingRule(pathname: string): Role[] | null {
  let best: Role[] | null = null;
  let bestLen = -1;
  for (const [prefix, roles] of ROUTE_ACCESS_RULES) {
    const isMatch = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (isMatch && prefix.length > bestLen) {
      best = roles;
      bestLen = prefix.length;
    }
  }
  return best;
}

// Whether the given (active) role may open the dashboard path. Paths with no rule
// are allowed so utility/detail routes are never blocked by omission.
export function canActiveRoleAccessDashboardPath(role: Role, pathname: string): boolean {
  const allowed = matchingRule(pathname);
  if (!allowed) return true;
  return allowed.includes(role);
}

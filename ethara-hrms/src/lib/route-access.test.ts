import { describe, it, expect } from "vitest";
import { canActiveRoleAccessDashboardPath } from "./route-access";
import { getDefaultRouteForRole } from "./utils";
import type { Role } from "@/types";

describe("canActiveRoleAccessDashboardPath", () => {
  it("blocks an employee from opening another role's landing dashboard", () => {
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/hr")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/admin")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/ta")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/candidates")).toBe(false);
  });

  it("allows the matching role into its own dashboard", () => {
    expect(canActiveRoleAccessDashboardPath("hr", "/dashboard/hr")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("hr", "/dashboard/hr/pms")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/employee")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/employee/selection-form")).toBe(true);
  });

  it("lets full-access roles open any dashboard", () => {
    for (const role of ["super_admin", "admin", "leadership"] as Role[]) {
      expect(canActiveRoleAccessDashboardPath(role, "/dashboard/hr")).toBe(true);
      expect(canActiveRoleAccessDashboardPath(role, "/dashboard/employee")).toBe(true);
      expect(canActiveRoleAccessDashboardPath(role, "/dashboard/config/users")).toBe(true);
    }
  });

  it("never redirects a role away from its own default route (no redirect loop)", () => {
    const roles: Role[] = [
      "super_admin", "admin", "leadership", "hr", "ta", "employee",
      "employee_referrer", "evaluator", "it_team", "compliance",
      "manager", "office_admin", "pl_tpm", "vendor",
    ];
    for (const role of roles) {
      const home = getDefaultRouteForRole(role);
      if (!home.startsWith("/dashboard")) continue; // candidate lives under /portal
      expect(canActiveRoleAccessDashboardPath(role, home)).toBe(true);
    }
  });

  it("matches on segment boundaries, not substrings", () => {
    // it_team owns /dashboard/it/* but /dashboard/it-requests is a separate rule.
    expect(canActiveRoleAccessDashboardPath("it_team", "/dashboard/it/assets")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("it_team", "/dashboard/it-requests")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("evaluator", "/dashboard/it-requests")).toBe(false);
  });

  it("scopes employee sub-routes correctly", () => {
    // Attendance is viewable by wider staff; the employee dashboard root is not.
    expect(canActiveRoleAccessDashboardPath("ta", "/dashboard/employee/attendance")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("manager", "/dashboard/employee/attendance")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("ta", "/dashboard/employee")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("hr", "/dashboard/employee/leave")).toBe(false);
  });

  it("gates the staff separation console (was fail-open)", () => {
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/separation")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("office_admin", "/dashboard/separation")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("evaluator", "/dashboard/separation")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("hr", "/dashboard/separation")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("manager", "/dashboard/separation")).toBe(true);
    // Employee self-service separation stays reachable for employees.
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/employee/separation")).toBe(true);
  });

  it("scopes module-overview per sub-dashboard, not one broad rule", () => {
    expect(canActiveRoleAccessDashboardPath("vendor", "/dashboard/module-overview/talent")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("vendor", "/dashboard/module-overview/finance")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("evaluator", "/dashboard/module-overview/lifecycle")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("pl_tpm", "/dashboard/module-overview/finance")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("ta", "/dashboard/module-overview")).toBe(false);
    expect(canActiveRoleAccessDashboardPath("hr", "/dashboard/module-overview")).toBe(true);
  });

  it("fails open for routes with no explicit rule", () => {
    expect(canActiveRoleAccessDashboardPath("employee", "/dashboard/notifications")).toBe(true);
    expect(canActiveRoleAccessDashboardPath("vendor", "/dashboard/some-future-page")).toBe(true);
  });
});

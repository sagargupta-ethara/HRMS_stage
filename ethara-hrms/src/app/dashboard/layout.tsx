"use client";

import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { useEmployeeDashboard } from "@/lib/queries";
import { getDefaultRouteForRole, hasAssignedRole } from "@/lib/utils";
import { canActiveRoleAccessDashboardPath } from "@/lib/route-access";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const prevAuthenticated = useRef(true);
  const passwordChangeRequired = Boolean(user?.mustChangePassword);
  const isCandidateRole = user?.role === "candidate";
  const isEmployeeUser = hasAssignedRole(user, ["employee", "employee_referrer"]);
  const hasStaffRole = hasAssignedRole(user, [
    "super_admin",
    "admin",
    "leadership",
    "hr",
    "ta",
    "manager",
    "it_team",
    "compliance",
    "office_admin",
    "pl_tpm",
  ]);
  const {
    data: employeeDashboard,
    isLoading: employeeDashboardLoading,
  } = useEmployeeDashboard({
    enabled: Boolean(user && isEmployeeUser && !passwordChangeRequired),
  });
  const employeeDetailFormSubmitted = employeeDashboard?.selectionForm?.status === "submitted";
  const employeeOnboardingLocked = Boolean(
    isEmployeeUser
    && !hasStaffRole
    && !passwordChangeRequired
    && (employeeDashboardLoading || !employeeDashboard || !employeeDetailFormSubmitted),
  );

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      if (prevAuthenticated.current) {
        // Was authenticated, now not → logout transition
        setLoggingOut(true);
        const t = setTimeout(() => router.push("/login"), 350);
        return () => clearTimeout(t);
      }
      router.push("/login");
    }
    if (isAuthenticated) prevAuthenticated.current = true;
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && isCandidateRole) {
      router.replace(getDefaultRouteForRole("candidate"));
    }
  }, [isLoading, isAuthenticated, isCandidateRole, router]);

  // Follow the active role for routes too: editing the URL to another role's
  // dashboard (e.g. /dashboard/hr while signed in as an employee) redirects back
  // to the active role's home instead of rendering the wrong shell. Switching
  // roles from the top bar is what unlocks that role's pages.
  const activeRole = user?.role;
  const routeBlockedForRole = Boolean(
    user
    && activeRole
    && !isCandidateRole
    && !passwordChangeRequired
    && !canActiveRoleAccessDashboardPath(activeRole, pathname),
  );

  useEffect(() => {
    if (isLoading || !isAuthenticated || !activeRole) return;
    if (isCandidateRole || passwordChangeRequired) return;
    if (canActiveRoleAccessDashboardPath(activeRole, pathname)) return;
    router.replace(getDefaultRouteForRole(activeRole));
  }, [isLoading, isAuthenticated, activeRole, isCandidateRole, passwordChangeRequired, pathname, router]);

  useEffect(() => {
    if (!isEmployeeUser || hasStaffRole || passwordChangeRequired || !employeeDashboard) return;
    if (employeeDashboard.selectionForm.status === "submitted") return;
    if (pathname === "/dashboard/employee/selection-form") return;
    router.replace("/dashboard/employee/selection-form");
  }, [employeeDashboard, hasStaffRole, isEmployeeUser, passwordChangeRequired, pathname, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-5">
          <div className="relative h-12 w-12">
            <div
              className="absolute inset-0 rounded-full animate-spin"
              style={{
                background: "conic-gradient(from 0deg, #ED00ED, #908DCE, transparent)",
                padding: "2px",
              }}
            />
            <div className="absolute inset-[2px] rounded-full bg-background" />
            <div
              className="absolute inset-[5px] rounded-full"
              style={{ background: "linear-gradient(135deg, rgba(237,0,237,0.2), rgba(144,141,206,0.2))" }}
            />
          </div>
          <p
            className="text-sm font-medium animate-pulse"
            style={{ color: "rgba(144,141,206,0.7)" }}
          >
            Loading Ethara HRMS...
          </p>
        </div>
      </div>
    );
  }

  if (!user && !loggingOut) return null;

  if (isCandidateRole || routeBlockedForRole) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-10 w-10 rounded-full animate-spin" style={{ background: "conic-gradient(from 0deg, #ED00ED, #908DCE, transparent)", padding: "2px" }}>
          <div className="h-full w-full rounded-full bg-background" />
        </div>
      </div>
    );
  }

  if (loggingOut) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center bg-background z-50"
        style={{ animation: "fadeIn 0.15s ease both" }}
      >
        <div className="flex flex-col items-center gap-4" style={{ animation: "fadeIn 0.2s ease both" }}>
          <div className="h-10 w-10 rounded-full animate-spin" style={{ background: "conic-gradient(from 0deg, #ED00ED, #908DCE, transparent)", padding: "2px" }}>
            <div className="h-full w-full rounded-full bg-background" />
          </div>
          <p className="text-sm font-medium" style={{ color: "rgba(144,141,206,0.7)" }}>Signing out…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-hidden bg-background">
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at 15% 15%, rgba(237,0,237,0.05) 0%, transparent 50%),
            radial-gradient(ellipse at 85% 85%, rgba(144,141,206,0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, rgba(124,111,205,0.02) 0%, transparent 70%)
          `,
        }}
      />
      {!passwordChangeRequired && !employeeOnboardingLocked && (
        <AppSidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      )}
      <div className={`relative z-10 flex h-dvh min-w-0 flex-col overflow-hidden transition-all duration-300 ${passwordChangeRequired || employeeOnboardingLocked ? "" : "lg:pl-[284px]"}`}>
        {!employeeOnboardingLocked && (
          <Topbar onMenuClick={() => { if (!passwordChangeRequired) setMobileNavOpen(true); }} />
        )}
        <main className="min-h-0 min-w-0 max-w-full flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-3 sm:p-6">
          {passwordChangeRequired ? (
            <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-card/70 p-6 text-center shadow-sm">
              <p className="text-base font-semibold">Password change required</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Update your temporary password to unlock the dashboard modules.
              </p>
            </div>
          ) : (
            <PageTransition>{children}</PageTransition>
          )}
        </main>
      </div>
    </div>
  );
}

"use client";

import { useAuth } from "@/lib/auth-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { PageTransition } from "@/components/layout/page-transition";
import { getDefaultRouteForRole } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

const CAMPUS_ASSESSMENT_ROUTE = "/portal/my-assessments";
const CAMPUS_COMPLETE_ROUTE = "/candidate/complete-registration";

function isCampusAssessmentPath(pathname: string | null): boolean {
  return pathname === CAMPUS_ASSESSMENT_ROUTE || pathname?.startsWith(`${CAMPUS_ASSESSMENT_ROUTE}/`) === true;
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, profile, isLoading, isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Campus-drive registrants are locked to the assessment-only view until they pass
  // and complete the full registration (backend sets profile.campusLock).
  const campusLock = profile?.type === "candidate" && profile.campusLock === true;
  const campusReadyToComplete = campusLock && profile?.campusAssessmentPassed === true;
  const campusNextRoute = profile?.type === "candidate" ? profile.campusNextRoute : null;

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/login");
      return;
    }
    if (!isLoading && user && user.role !== "candidate") {
      router.replace(getDefaultRouteForRole(user.role));
      return;
    }
    if (!isLoading && campusReadyToComplete) {
      router.replace(campusNextRoute ?? CAMPUS_COMPLETE_ROUTE);
      return;
    }
    // Keep locked campus candidates pinned to the assessment page until they pass.
    if (!isLoading && campusLock && !isCampusAssessmentPath(pathname)) {
      router.replace(CAMPUS_ASSESSMENT_ROUTE);
    }
  }, [
    isLoading,
    isAuthenticated,
    router,
    user,
    campusLock,
    campusReadyToComplete,
    campusNextRoute,
    pathname,
  ]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground animate-pulse">Loading Candidate Portal...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  if (campusReadyToComplete) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-10 w-10 border-3 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  // Bare, assessment-only shell for campus registrants: no sidebar, no nav modules —
  // just the brand, a sign-out, and the assessment itself.
  if (campusLock) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">Ethara.AI</span>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">{user.name ?? user.email}</span>
            <Button variant="ghost" size="sm" onClick={() => logout()}>
              <LogOut className="size-4" /> Sign out
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-3xl p-6">
          {isCampusAssessmentPath(pathname) ? children : null}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppSidebar mobileOpen={mobileNavOpen} onMobileClose={() => setMobileNavOpen(false)} />
      <div className="lg:pl-[260px] transition-all duration-300">
        <Topbar onMenuClick={() => setMobileNavOpen(true)} />
        <main className="p-6">
          {isCampusAssessmentPath(pathname) ? children : <PageTransition>{children}</PageTransition>}
        </main>
      </div>
    </div>
  );
}

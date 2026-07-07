import { describe, expect, it, vi } from "vitest";

import {
  canAccessSettings,
  cn,
  formatDate,
  formatDateTime,
  formatLabel,
  generateCandidateCode,
  getDefaultRouteForRole,
  getInitials,
  getTodayDateInputMin,
  timeAgo,
} from "./utils";
import { markClientHydrated } from "./hydration-state";

describe("utils", () => {
  it("merges Tailwind classes with later conflicting classes winning", () => {
    expect(cn("px-2 text-sm", "px-4", false && "hidden")).toBe("text-sm px-4");
  });

  it("formats dates in the application timezone and handles invalid values", () => {
    expect(formatDate("2026-06-07T00:00:00.000Z")).toContain("07 Jun 2026");
    expect(formatDateTime("2026-06-07T09:15:00.000Z")).toContain("07 Jun 2026");
    expect(formatDate("not-a-date")).toBe("—");
  });

  it("keeps current-date inputs undefined before hydration and IST after hydration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T20:00:00.000Z"));

    expect(getTodayDateInputMin()).toBeUndefined();
    markClientHydrated();
    expect(getTodayDateInputMin()).toBe("2026-06-07");

    vi.useRealTimers();
  });

  it("uses stable date output before hydration and relative text after hydration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T10:00:00.000Z"));

    expect(timeAgo("2026-06-07T09:59:30.000Z")).toBe("just now");
    expect(timeAgo("2026-06-07T09:20:00.000Z")).toBe("40m ago");
    expect(timeAgo("2026-06-07T07:00:00.000Z")).toBe("3h ago");
    expect(timeAgo("2026-06-04T07:00:00.000Z")).toBe("3d ago");

    vi.useRealTimers();
  });

  it("returns business labels and sensible fallbacks", () => {
    expect(formatLabel("compliance_verified")).toBe("Compliance Verified");
    expect(formatLabel("direct_registration")).toBe("Direct Registration");
    expect(formatLabel("custom-status_value")).toBe("Custom Status Value");
  });

  it("maps roles to the correct landing routes and settings access", () => {
    expect(getDefaultRouteForRole("candidate")).toBe("/portal/dashboard");
    expect(getDefaultRouteForRole("employee")).toBe("/dashboard/employee");
    expect(getDefaultRouteForRole("compliance")).toBe("/dashboard/compliance");
    expect(getDefaultRouteForRole("it_team")).toBe("/dashboard/it");
    expect(canAccessSettings("hr")).toBe(true);
    expect(canAccessSettings("candidate")).toBe(false);
  });

  it("builds compact initials and candidate codes", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_781_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);

    expect(getInitials("Aarav Sharma")).toBe("AS");
    expect(generateCandidateCode()).toMatch(/^ETH-[A-Z0-9]+-[A-Z0-9]{3}$/);
  });
});

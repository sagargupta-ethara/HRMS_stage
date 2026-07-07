"use client";

import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, LogIn, Mail } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { employeesApi } from "@/lib/api";
import { cn, getDefaultRouteForRole } from "@/lib/utils";
import { safeNextPath } from "@/lib/export";
import type { Role } from "@/types";

const BAD_REQUEST_RETRY_DELAY_MS = 1800;

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthPageShell loadingMessage="Loading sign in..." />}>
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, isLoading, user, profile } = useAuth();
  const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState("");
  const [unverifiedEmail, setUnverifiedEmail] = useState("");
  const hasRedirectedRef = useRef(false);

  // Only accept same-site absolute paths for the post-login redirect to prevent
  // open-redirect attacks (e.g. ?next=//evil.com).
  const redirectTarget = safeNextPath(searchParams.get("next"));

  const resolveRedirectTarget = useCallback(async (role: Role) => {
    if (redirectTarget) return redirectTarget;
    if (role === "candidate" && profile?.type === "candidate" && profile.campusLock) {
      return profile.campusNextRoute ?? (
        profile.campusAssessmentPassed ? "/candidate/complete-registration" : "/portal/my-assessments"
      );
    }
    if (role === "employee" || role === "employee_referrer") {
      try {
        const detailForm = await employeesApi.getSelectionForm();
        return detailForm.status === "submitted"
          ? "/dashboard/employee"
          : "/dashboard/employee/selection-form";
      } catch {
        return "/dashboard/employee/selection-form";
      }
    }
    return getDefaultRouteForRole(role);
  }, [profile, redirectTarget]);

  const redirectAfterLogin = useCallback((role: Role) => {
    if (hasRedirectedRef.current) return;
    hasRedirectedRef.current = true;
    setRedirecting(true);
    void resolveRedirectTarget(role).then((target) => router.replace(target));
  }, [resolveRedirectTarget, router]);

  useEffect(() => {
    if (!isLoading && isAuthenticated && user) {
      redirectAfterLogin(user.role);
    }
  }, [isLoading, isAuthenticated, user, redirectAfterLogin]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) { setError("Email is required"); return; }
    if (!password) { setError("Password is required"); return; }

    setSubmitting(true);
    setError("");
    setUnverifiedEmail("");
    try {
      try {
        await login(normalizedEmail, password);
      } catch (err) {
        const apiError = err as {
          response?: { status?: number; data?: { detail?: string } };
        };
        const detail = apiError.response?.data?.detail ?? "";
        const isGenericBadRequest =
          apiError.response?.status === 400 &&
          (!detail || detail.toLowerCase().includes("bad request"));

        if (!isGenericBadRequest) throw err;

        setError("Server is getting ready. Retrying sign in...");
        await wait(BAD_REQUEST_RETRY_DELAY_MS);
        setError("");
        await login(normalizedEmail, password);
      }
    } catch (err) {
      const apiError = err as {
        response?: { status?: number; data?: { detail?: string } };
        code?: string;
        message?: string;
      };
      const detail = apiError.response?.data?.detail ?? "";
      const httpStatus = apiError.response?.status;

      if (httpStatus === 403 && detail === "EMAIL_NOT_VERIFIED") {
        setUnverifiedEmail(normalizedEmail);
        setError("");
      } else if (!apiError.response || apiError.code === "ERR_NETWORK") {
        setError("Cannot connect to the server. Make sure the backend is running and try again.");
      } else if (httpStatus === 401) {
        setError("Incorrect email or password. Please try again.");
      } else if (httpStatus === 429) {
        setError("Too many login attempts. Please wait a minute and try again.");
      } else if (httpStatus && httpStatus >= 500) {
        setError("Server error. Please restart the backend and try again.");
      } else if (httpStatus === 400 && (!detail || detail.toLowerCase().includes("bad request"))) {
        setError("Server is still getting ready. Please wait a few seconds and try again.");
      } else {
        setError(detail || "Unable to sign in. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (redirecting) {
    return (
      <div
        className="fixed inset-0 flex items-center justify-center z-50"
        style={{
          background: "var(--background)",
          animation: "fadeIn 0.15s ease both",
        }}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className="h-10 w-10 rounded-full animate-spin"
            style={{
              background: "conic-gradient(from 0deg, #ED00ED, #908DCE, transparent)",
              padding: "2px",
            }}
          >
            <div className="h-full w-full rounded-full" style={{ background: "var(--background)" }} />
          </div>
          <p className="text-sm font-medium animate-pulse" style={{ color: "rgba(144,141,206,0.7)" }}>
            Signing you in…
          </p>
        </div>
      </div>
    );
  }

  return (
    <AuthPageShell>
      <>
        <section
          className="relative hidden items-center justify-center overflow-hidden lg:flex"
          style={{ background: "#0A0B12", borderRight: "1px solid rgba(144,141,206,0.12)" }}
        >
          <div
            className="absolute inset-0"
            style={{
              background: "linear-gradient(150deg, rgba(10,11,18,1) 0%, rgba(13,14,24,0.98) 52%, rgba(8,8,14,1) 100%), radial-gradient(ellipse at 50% 45%, rgba(144,141,206,0.10) 0%, transparent 52%), radial-gradient(ellipse at 18% 72%, rgba(237,0,237,0.055) 0%, transparent 42%)",
              animation: "professionalGlowDrift 18s ease-in-out infinite",
            }}
          />
          <div
            className="careers-grid-pan absolute inset-0 opacity-[0.034]"
            style={{
              backgroundImage: "linear-gradient(rgba(144,141,206,1) 1px, transparent 1px), linear-gradient(90deg, rgba(144,141,206,1) 1px, transparent 1px)",
              backgroundSize: "72px 72px",
            }}
          />
          <div className="login-signal-plane absolute inset-0" />
          <div
            className="absolute left-0 top-1/2 h-px w-[80%]"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(237,0,237,0.20), rgba(144,141,206,0.18), transparent)",
              animation: "accentLineSweep 16s ease-in-out infinite",
            }}
          />
          <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(197,203,232,0.22), transparent)" }} />
          <div className="relative z-10 flex h-full w-full items-center justify-center p-12 xl:p-14">
            <Link
              href="/careers"
              aria-label="Back to careers page"
              className="login-brand-stage login-brand-link flex w-full max-w-[520px] items-center justify-center gap-5 rounded-lg sm:gap-6"
              onContextMenu={(event) => event.preventDefault()}
            >
              {/* Distinct URL from the careers hero mark so this gets its own SVG
                  animation timeline and actually draws here — same-URL <img> SVGs
                  share one timeline in Chrome, so it would otherwise show the
                  already-finished state instead of drawing. */}
              <Image
                src="/ethara-mark-animation.svg?ctx=signin"
                alt="Ethara.AI logo"
                width={150}
                height={148}
                priority
                unoptimized
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                className="brand-animation-asset login-hero-mark h-auto w-[28%] max-w-[150px] shrink-0"
              />
              <span className="login-wordmark-text text-5xl font-semibold tracking-tight text-white xl:text-6xl">
                Ethara<span style={{ color: "#ED00ED" }}>.AI</span>
              </span>
            </Link>
          </div>
        </section>

        <section
          className="relative flex items-center justify-center overflow-hidden px-5 py-10 sm:px-6"
          style={{ background: "linear-gradient(180deg, #0A0B12 0%, #0D0E17 100%)" }}
        >
          <div
            className="pointer-events-none absolute inset-0 lg:hidden"
            style={{
              background: "radial-gradient(ellipse at 20% 18%, rgba(237,0,237,0.18) 0%, transparent 40%), radial-gradient(ellipse at 85% 74%, rgba(144,141,206,0.14) 0%, transparent 44%)",
              animation: "professionalGlowDrift 10s ease-in-out infinite",
            }}
          />
          <div
            className="pointer-events-none absolute left-0 top-[24%] h-px w-[92%] lg:hidden"
            style={{
              background: "linear-gradient(90deg, transparent, rgba(237,0,237,0.55), rgba(144,141,206,0.34), transparent)",
              animation: "accentLineSweep 7s ease-in-out infinite",
            }}
          />
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.035] lg:hidden"
            style={{
              backgroundImage: "linear-gradient(rgba(144,141,206,1) 1px, transparent 1px), linear-gradient(90deg, rgba(144,141,206,1) 1px, transparent 1px)",
              backgroundSize: "56px 56px",
            }}
          />

          <div className="relative z-10 w-full max-w-md">
            <div className="mb-5 flex justify-center lg:hidden">
              <div className="h-1 w-20 rounded-full gradient-neon" />
            </div>

            <div
              className="rounded-lg p-6 shadow-[0_18px_48px_rgba(0,0,0,0.32)] sm:p-8"
              style={{
                background: "rgba(23,24,39,0.86)",
                border: "1px solid rgba(144,141,206,0.16)",
                backdropFilter: "blur(18px)",
              }}
            >
              <div className="mb-6 flex items-center justify-between gap-4">
                <h2
                  className="text-2xl font-semibold tracking-normal"
                  style={{ color: "#ECEFFD" }}
                >
                  Sign in
                </h2>
                <Link href="/careers" aria-label="Go to careers page" className="inline-flex shrink-0 transition-opacity hover:opacity-80 lg:hidden">
                  <Image src="/logo.png" alt="Ethara.AI" width={108} height={32} className="object-contain" style={{ width: "auto", height: "auto" }} priority />
                </Link>
              </div>

            {unverifiedEmail && (
              <div
                className="mb-5 rounded-lg p-4"
                style={{
                  background: "rgba(251,191,36,0.08)",
                  border: "1px solid rgba(251,191,36,0.25)",
                }}
              >
                <div className="flex items-start gap-3">
                  <Mail className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "#fbbf24" }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: "#fbbf24" }}>Email not verified</p>
                    <p className="mt-1 text-xs" style={{ color: "rgba(251,191,36,0.65)" }}>
                      Your account is pending email verification. Please check your inbox for a 6-digit code.
                    </p>
                    <Link
                      href={
                        unverifiedEmail.endsWith("@ethara.ai")
                          ? `/employee/verify-email?email=${encodeURIComponent(unverifiedEmail)}`
                          : `/candidate/verify-email?email=${encodeURIComponent(unverifiedEmail)}${redirectTarget ? `&next=${encodeURIComponent(redirectTarget)}` : ""}`
                      }
                      className="mt-2 inline-block text-xs font-medium underline-offset-2 hover:underline"
                      style={{ color: "#ED00ED" }}
                    >
                      Verify email →
                    </Link>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="email" className="block text-sm font-medium" style={{ color: "rgba(197,203,232,0.75)" }}>
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); setUnverifiedEmail(""); }}
                  className="h-11 w-full rounded-lg px-4 text-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/25"
                  style={{
                    background: "rgba(10,11,18,0.60)",
                    border: "1px solid rgba(144,141,206,0.20)",
                    color: "#C5CBE8",
                  }}
                  autoComplete="email"
                  disabled={submitting}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-medium" style={{ color: "rgba(197,203,232,0.75)" }}>
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(""); }}
                    className="h-11 w-full rounded-lg px-4 pr-11 text-sm transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary/25"
                    style={{
                      background: "rgba(10,11,18,0.60)",
                      border: "1px solid rgba(144,141,206,0.20)",
                      color: "#C5CBE8",
                    }}
                    autoComplete="current-password"
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: "rgba(197,203,232,0.40)" }}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex justify-end">
                  <Link
                    href="/forgot-password"
                    className="text-xs transition-colors"
                    style={{ color: "rgba(237,0,237,0.78)" }}
                  >
                    Forgot password?
                  </Link>
                </div>
              </div>

              {error && (
                <p
                  className="text-sm font-medium rounded-lg px-3 py-2"
                  style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.22)", color: "#f87171" }}
                >
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="h-11 w-full rounded-lg text-sm font-semibold text-white transition-all duration-200 disabled:opacity-60"
                style={{
                  ...(submitting
                    ? { backgroundColor: "rgba(237,0,237,0.48)" }
                    : { backgroundImage: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)", backgroundSize: "160% 160%" }),
                  animation: submitting ? "none" : "brandGradientMove 9s ease infinite",
                  boxShadow: submitting ? "none" : "0 10px 22px rgba(0,0,0,0.22)",
                }}
              >
                {submitting ? "Signing in..." : (
                  <span className="flex items-center justify-center gap-2">
                    <LogIn className="h-4 w-4" />
                    Sign in
                  </span>
                )}
              </button>
            </form>

            <div
              className="mt-7 space-y-3 pt-5 text-sm"
              style={{
                borderTop: "1px solid rgba(144,141,206,0.14)",
                color: "rgba(197,203,232,0.50)",
              }}
            >
              <p>
                <Link
                  href={`/register${redirectTarget ? `?next=${encodeURIComponent(redirectTarget)}` : ""}`}
                  className="font-medium transition-colors"
                  style={{ color: "#ED00ED" }}
                >
                  Register to the portal
                </Link>
              </p>
              <Link
                href="/careers"
                className="inline-flex items-center gap-2 text-xs font-medium transition-colors"
                style={{ color: "rgba(197,203,232,0.62)" }}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to careers
              </Link>
            </div>
            </div>
          </div>
        </section>
      </>
    </AuthPageShell>
  );
}

function AuthPageShell({
  children,
  loadingMessage,
}: {
  children?: ReactNode;
  loadingMessage?: string;
}) {
  return (
    <main className="min-h-screen animate-fade-in" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      <div className={cn("grid min-h-screen", children && "lg:grid-cols-[0.95fr_1.05fr]")}>
        {children || (
          <div
            className="flex min-h-screen items-center justify-center lg:col-span-2"
            style={{ background: "#0A0B12" }}
          >
            <div className="flex flex-col items-center gap-5">
              <div className="relative h-11 w-11">
                <div
                  className="absolute inset-0 rounded-full animate-spin"
                  style={{
                    background: "conic-gradient(from 0deg, #ED00ED, #908DCE, transparent)",
                    padding: "2px",
                  }}
                />
                <div
                  className="absolute inset-[2px] rounded-full"
                  style={{ background: "#0A0B12" }}
                />
              </div>
              <p className="text-sm animate-pulse" style={{ color: "rgba(144,141,206,0.6)" }}>
                {loadingMessage}
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

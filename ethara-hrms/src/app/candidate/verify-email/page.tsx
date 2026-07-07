"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Mail, RefreshCw, ShieldCheck } from "lucide-react";

import { authApi } from "@/lib/api";
import { setAccessToken } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { safeNextPath } from "@/lib/export";

const RESEND_COOLDOWN_SECONDS = 60;
const OTP_LENGTH = 6;

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<VerifyShell loadingMessage="Loading verification..." />}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshUser } = useAuth();

  const emailParam = searchParams.get("email") ?? "";
  // Only honour a validated same-site path; otherwise fall back to the portal
  // dashboard. Prevents open-redirect via ?next=//evil.com after verification.
  const redirectTarget = safeNextPath(searchParams.get("next")) ?? "/portal/dashboard";

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState("");
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const startCooldown = useCallback(() => {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    inputRefs.current[0]?.focus();
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  const otpValue = otp.join("");

  const handleOtpChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned && value) return;

    const next = [...otp];

    if (cleaned.length > 1) {
      const digits = cleaned.slice(0, OTP_LENGTH - index);
      digits.split("").forEach((d, i) => {
        if (index + i < OTP_LENGTH) next[index + i] = d;
      });
      setOtp(next);
      const focusIndex = Math.min(index + digits.length, OTP_LENGTH - 1);
      inputRefs.current[focusIndex]?.focus();
      return;
    }

    next[index] = cleaned;
    setOtp(next);
    setError("");

    if (cleaned && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      if (!otp[index] && index > 0) {
        const next = [...otp];
        next[index - 1] = "";
        setOtp(next);
        inputRefs.current[index - 1]?.focus();
      } else {
        const next = [...otp];
        next[index] = "";
        setOtp(next);
      }
    }
    if (e.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) inputRefs.current[index + 1]?.focus();
  };

  const handleVerify = async () => {
    if (otpValue.length < OTP_LENGTH) {
      setError(`Please enter the full ${OTP_LENGTH}-digit code`);
      return;
    }
    if (!emailParam) {
      setError("Email address is missing. Please go back and try again.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const result = await authApi.confirmEmailVerificationPublic(emailParam, otpValue);
      if (result.accessToken) {
        setAccessToken(result.accessToken);
      }
      await refreshUser();
      setSuccess(true);
      setTimeout(() => router.replace(redirectTarget), 1500);
    } catch (err) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      const detail = apiError.response?.data?.detail ?? "";
      if (detail.toLowerCase().includes("expired")) {
        setError("This code has expired. Please request a new one below.");
      } else if (detail.toLowerCase().includes("invalid")) {
        setError("Incorrect code. Please check and try again.");
      } else {
        setError(detail || "Verification failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || !emailParam) return;
    setResending(true);
    setResendMessage("");
    setError("");
    try {
      const result = await authApi.requestEmailVerificationPublic(emailParam);
      setResendMessage(result.message || "Verification code resent. Check your inbox.");
      startCooldown();
    } catch (err) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      setError(apiError.response?.data?.detail || "Unable to send a new verification code. Please contact support if this continues.");
    } finally {
      setResending(false);
    }
  };

  if (success) {
    return (
      <VerifyShell>
        <div className="mx-auto max-w-md">
          <div
            className="rounded-2xl p-10 text-center"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(34,197,94,0.30)",
              boxShadow: "0 0 40px rgba(34,197,94,0.08)",
            }}
          >
            <div
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
              style={{
                background: "rgba(34,197,94,0.12)",
                border: "1px solid rgba(34,197,94,0.30)",
                boxShadow: "0 0 24px rgba(34,197,94,0.20)",
              }}
            >
              <CheckCircle2 className="h-8 w-8" style={{ color: "#22c55e" }} />
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-white">Email Verified!</h2>
            <p className="mt-2 text-sm" style={{ color: "rgba(197,203,232,0.60)" }}>
              Your account is active. Redirecting to your portal...
            </p>
          </div>
        </div>
      </VerifyShell>
    );
  }

  return (
    <VerifyShell>
      <div className="mx-auto max-w-md">
        <Link
          href={`/login${redirectTarget !== "/portal/dashboard" ? `?next=${encodeURIComponent(redirectTarget)}` : ""}`}
          className="mb-8 inline-flex items-center gap-2 text-sm transition-colors"
          style={{ color: "#908DCE" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#908DCE"; }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        <div
          className="rounded-2xl p-8"
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(144,141,206,0.18)",
            backdropFilter: "blur(20px)",
          }}
        >
          <div className="mb-8 flex flex-col items-center text-center">
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{
                background: "rgba(237,0,237,0.10)",
                border: "1px solid rgba(237,0,237,0.28)",
                boxShadow: "0 0 20px rgba(237,0,237,0.15)",
              }}
            >
              <Mail className="h-7 w-7" style={{ color: "#ED00ED" }} />
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-white">Verify your email</h1>
            <p className="mt-2 text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>
              We sent a {OTP_LENGTH}-digit code to
            </p>
            {emailParam && (
              <p className="mt-1 text-sm font-semibold" style={{ color: "#908DCE" }}>{emailParam}</p>
            )}
            <p className="mt-2 text-xs" style={{ color: "rgba(197,203,232,0.35)" }}>
              Check your inbox and spam folder. Code expires in 10 minutes.
            </p>
          </div>

          <div className="mb-6">
            <div className="flex items-center justify-center gap-3">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => { inputRefs.current[index] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={OTP_LENGTH}
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(index, e)}
                  onPaste={(e) => {
                    e.preventDefault();
                    const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
                    handleOtpChange(index, pasted);
                  }}
                  disabled={submitting}
                  className="focus:outline-none transition-all duration-200"
                  style={{
                    height: "3.5rem",
                    width: "3rem",
                    borderRadius: "0.75rem",
                    border: digit
                      ? "1px solid rgba(237,0,237,0.55)"
                      : "1px solid rgba(144,141,206,0.22)",
                    background: digit
                      ? "rgba(237,0,237,0.06)"
                      : "rgba(144,141,206,0.07)",
                    color: "#C5CBE8",
                    textAlign: "center",
                    fontSize: "1.25rem",
                    fontWeight: 600,
                    boxShadow: digit ? "0 0 12px rgba(237,0,237,0.12)" : "none",
                    opacity: submitting ? 0.5 : 1,
                  }}
                />
              ))}
            </div>

            {error && (
              <p
                className="mt-3 text-center text-sm rounded-lg px-3 py-2"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.22)",
                  color: "#f87171",
                }}
              >
                {error}
              </p>
            )}
          </div>

          <button
            onClick={handleVerify}
            disabled={submitting || otpValue.length < OTP_LENGTH}
            className="h-12 w-full rounded-xl text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
            style={{
              background: submitting || otpValue.length < OTP_LENGTH
                ? "rgba(237,0,237,0.35)"
                : "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
              boxShadow: submitting || otpValue.length < OTP_LENGTH
                ? "none"
                : "0 0 24px rgba(237,0,237,0.35), 0 4px 16px rgba(237,0,237,0.15)",
            }}
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Verify & Activate Account
              </span>
            )}
          </button>

          <div className="mt-6 flex flex-col items-center gap-2 text-center">
            {resendMessage && (
              <p className="text-sm" style={{ color: "rgba(144,141,206,0.80)" }}>{resendMessage}</p>
            )}
            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || resending}
              className="flex items-center gap-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{ color: cooldown > 0 ? "rgba(197,203,232,0.35)" : "#908DCE" }}
              onMouseEnter={(e) => {
                if (cooldown === 0 && !resending) e.currentTarget.style.color = "#ED00ED";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = cooldown > 0 ? "rgba(197,203,232,0.35)" : "#908DCE";
              }}
            >
              {resending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {cooldown > 0
                ? `Resend OTP in ${cooldown}s`
                : resending
                  ? "Sending..."
                  : "Resend verification code"}
            </button>
          </div>
        </div>
      </div>
    </VerifyShell>
  );
}

function VerifyShell({
  children,
  loadingMessage,
}: {
  children?: React.ReactNode;
  loadingMessage?: string;
}) {
  return (
    <main className="min-h-screen px-6 py-12 animate-fade-in" style={{ background: "var(--background)", color: "var(--foreground)" }}>
      {children || (
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="relative h-10 w-10">
              <div
                className="absolute inset-0 rounded-full animate-spin"
                style={{
                  background: "conic-gradient(from 0deg, #ED00ED, #908DCE, transparent)",
                  padding: "2px",
                }}
              />
              <div className="absolute inset-[2px] rounded-full" style={{ background: "#0B0B12" }} />
            </div>
            <p className="text-sm animate-pulse" style={{ color: "rgba(144,141,206,0.6)" }}>
              {loadingMessage}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, Mail, ShieldCheck } from "lucide-react";
import { authApi } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-errors";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [requested, setRequested] = useState(false);
  const [done, setDone] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleSendCode = async () => {
    if (!email.trim()) { setError("Email is required"); return; }
    setIsSending(true);
    setError("");
    setMessage("");
    try {
      const response = await authApi.requestPasswordReset(email);
      setRequested(true);
      setMessage(response.message || "Verification code sent to your email.");
    } catch {
      setError("Unable to send verification code right now.");
    } finally {
      setIsSending(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email.trim() || !code.trim()) { setError("Email and verification code are required"); return; }
    if (newPassword.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (newPassword !== confirmPassword) { setError("Passwords do not match"); return; }
    setIsResetting(true);
    setError("");
    setMessage("");
    try {
      const response = await authApi.confirmPasswordReset(email, code, newPassword);
      setMessage(response.message || "Password reset successful.");
      setDone(true);
    } catch (err: unknown) {
      setError(
        apiErrorMessage(err, "Invalid verification code. Please request a fresh OTP and try again."),
      );
    } finally {
      setIsResetting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: "rgba(144,141,206,0.07)",
    border: "1px solid rgba(144,141,206,0.22)",
    color: "#C5CBE8",
    outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  };

  return (
    <main
      className="min-h-screen flex items-center justify-center px-6 py-10 animate-fade-in"
      style={{ background: "var(--background)", color: "var(--foreground)" }}
    >
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Link href="/careers" aria-label="Ethara.AI careers" className="inline-flex transition-opacity hover:opacity-80">
            <Image
              src="/logo.png"
              alt="Ethara.AI"
              width={128}
              height={36}
              priority
              className="object-contain"
              style={{ width: "auto", height: "auto" }}
            />
          </Link>
        </div>
        <Link
          href="/login"
          className="mb-8 inline-flex items-center gap-2 text-sm transition-colors"
          style={{ color: "#908DCE" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#908DCE"; }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sign in
        </Link>

        {done ? (
          <div
            className="rounded-2xl p-8 text-center space-y-4"
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(34,197,94,0.30)",
              boxShadow: "0 0 32px rgba(34,197,94,0.08)",
            }}
          >
            <div
              className="flex h-14 w-14 items-center justify-center rounded-full mx-auto"
              style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.30)" }}
            >
              <CheckCircle2 className="h-7 w-7" style={{ color: "#22c55e" }} />
            </div>
            <h2 className="text-xl font-semibold text-white">Password reset!</h2>
            <p className="text-sm" style={{ color: "rgba(197,203,232,0.60)" }}>
              {message || "Your password has been reset. You can now sign in with your new password."}
            </p>
            <Link href="/login">
              <button
                className="mt-2 h-11 w-full rounded-xl text-sm font-semibold text-white transition-all duration-200"
                style={{
                  background: "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
                  boxShadow: "0 0 20px rgba(237,0,237,0.35)",
                }}
              >
                Sign in now
              </button>
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold tracking-tight text-white">
                Forgot password
              </h1>
              <p className="mt-2 text-sm" style={{ color: "rgba(197,203,232,0.65)" }}>
                Request a one-time code and set a new password for your account.
              </p>
            </div>

            <div
              className="rounded-2xl p-6 space-y-5"
              style={{
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(144,141,206,0.18)",
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="space-y-1.5">
                <label className="block text-sm font-medium" style={{ color: "rgba(197,203,232,0.75)" }}>
                  Email
                </label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(""); }}
                  className="h-12 w-full rounded-xl px-4 text-sm focus:outline-none"
                  style={inputStyle}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "rgba(237,0,237,0.55)";
                    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(237,0,237,0.12)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "rgba(144,141,206,0.22)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                  disabled={requested}
                  autoComplete="email"
                />
              </div>

              {!requested && (
                <button
                  onClick={handleSendCode}
                  disabled={isSending}
                  className="h-11 w-full rounded-xl text-sm font-semibold text-white transition-all duration-200 disabled:opacity-60"
                  style={{
                    background: isSending ? "rgba(237,0,237,0.40)" : "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)",
                    boxShadow: isSending ? "none" : "0 0 20px rgba(237,0,237,0.30)",
                  }}
                >
                  {isSending ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Sending code…
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Mail className="h-4 w-4" /> Send verification code
                    </span>
                  )}
                </button>
              )}

              {message && !done && (
                <p className="text-sm flex items-center gap-1.5" style={{ color: "rgba(134,239,172,0.85)" }}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> {message}
                </p>
              )}

              {requested && (
                <>
                  <div
                    className="rounded-xl px-4 py-3 text-xs"
                    style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.18)", color: "rgba(197,203,232,0.60)" }}
                  >
                    <div className="flex items-start gap-2">
                      <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <div className="min-w-0 space-y-1">
                        <p>A code was sent to</p>
                        <p className="break-all font-semibold" style={{ color: "#908DCE" }}>{email}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium" style={{ color: "rgba(197,203,232,0.75)" }}>
                      Verification code
                    </label>
                    <input
                      type="text"
                      placeholder="Enter 6-digit OTP"
                      value={code}
                      onChange={(e) => { setCode(e.target.value); setError(""); }}
                      className="h-12 w-full rounded-xl px-4 text-sm font-mono focus:outline-none"
                      style={inputStyle}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "rgba(237,0,237,0.55)";
                        e.currentTarget.style.boxShadow = "0 0 0 3px rgba(237,0,237,0.12)";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = "rgba(144,141,206,0.22)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium" style={{ color: "rgba(197,203,232,0.75)" }}>
                        New password
                      </label>
                      <div className="relative">
                        <input
                          type={showNewPassword ? "text" : "password"}
                          placeholder="At least 8 characters"
                          value={newPassword}
                          onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                          className="h-12 w-full rounded-xl px-4 pr-11 text-sm focus:outline-none"
                          style={inputStyle}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = "rgba(237,0,237,0.55)";
                            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(237,0,237,0.12)";
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = "rgba(144,141,206,0.22)";
                            e.currentTarget.style.boxShadow = "none";
                          }}
                        />
                        <button
                          type="button"
                          aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
                          style={{ color: "rgba(197,203,232,0.65)" }}
                          onClick={() => setShowNewPassword((value) => !value)}
                        >
                          {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium" style={{ color: "rgba(197,203,232,0.75)" }}>
                        Confirm new password
                      </label>
                      <div className="relative">
                        <input
                          type={showConfirmPassword ? "text" : "password"}
                          placeholder="Repeat your password"
                          value={confirmPassword}
                          onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                          className="h-12 w-full rounded-xl px-4 pr-11 text-sm focus:outline-none"
                          style={inputStyle}
                          onFocus={(e) => {
                            e.currentTarget.style.borderColor = "rgba(237,0,237,0.55)";
                            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(237,0,237,0.12)";
                          }}
                          onBlur={(e) => {
                            e.currentTarget.style.borderColor = "rgba(144,141,206,0.22)";
                            e.currentTarget.style.boxShadow = "none";
                          }}
                        />
                        <button
                          type="button"
                          aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                          className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg transition-colors hover:bg-white/5"
                          style={{ color: "rgba(197,203,232,0.65)" }}
                          onClick={() => setShowConfirmPassword((value) => !value)}
                        >
                          {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleResetPassword}
                    disabled={isResetting}
                    className="h-11 w-full rounded-xl text-sm font-semibold text-white transition-all duration-200 disabled:opacity-60"
                    style={{
                      background: isResetting ? "rgba(144,141,206,0.35)" : "linear-gradient(135deg, #908DCE 0%, #ED00ED 100%)",
                      boxShadow: isResetting ? "none" : "0 0 20px rgba(144,141,206,0.35)",
                    }}
                  >
                    {isResetting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Resetting…
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <ShieldCheck className="h-4 w-4" /> Reset password
                      </span>
                    )}
                  </button>
                </>
              )}

              {error && (
                <p
                  className="text-sm rounded-lg px-3 py-2"
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

            <p className="mt-6 text-center text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
              Remember your password?{" "}
              <Link href="/login" className="transition-colors" style={{ color: "#ED00ED" }}>
                Sign in
              </Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}

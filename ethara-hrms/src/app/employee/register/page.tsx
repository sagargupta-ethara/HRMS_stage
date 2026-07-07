"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2,
  Eye, EyeOff, Loader2, UploadCloud, XCircle, X,
} from "lucide-react";
import { employeesApi } from "@/lib/api";
import apiClient from "@/lib/api-client";
import {
  EMPLOYEE_DEPARTMENT_OPTIONS,
  EMPLOYEE_DESIGNATION_OPTIONS,
  EMPLOYEE_GENDER_OPTIONS,
  formatDropdownOptionLabel,
  mergeEmployeeReferenceOptions,
  resolveEmployeeGenderLabel,
  resolveEmployeeReferenceLabel,
} from "@/lib/employee-profile-options";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";

const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const ALLOWED_AADHAAR_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
type OcrStatus = "idle" | "extracting" | "passed" | "partial" | "needs_review" | "failed";
type AadhaarOcrResult = {
  aadhaarNumber?: string | null;
  dateOfBirth?: string | null;
  cardHolderName?: string | null;
  ocrStatus?: string;
  message?: string;
};

function formatAadhaarDisplay(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 12) return raw;
  return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`;
}

function validateAadhaarFile(file: File): string | null {
  if (!ALLOWED_AADHAAR_TYPES.has(file.type))
    return "Aadhaar card must be a PDF, JPG, PNG, or WEBP";
  if (file.size > MAX_FILE_BYTES) return "Aadhaar file must be under 10 MB";
  if (file.size === 0) return "Aadhaar file appears to be empty";
  return null;
}

function FieldError({
  field,
  touched,
  fieldErrors,
}: {
  field: string;
  touched: Record<string, boolean>;
  fieldErrors: Record<string, string>;
}) {
  return touched[field] && fieldErrors[field] ? (
    <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "#f87171" }}>
      <AlertCircle className="h-3 w-3 shrink-0" /> {fieldErrors[field]}
    </p>
  ) : null;
}

function validateField(key: string, value: string, extra?: { password?: string }): string {
  switch (key) {
    case "fullName":
      if (!value.trim()) return "Full name is required";
      if (value.trim().length < 2) return "Name must be at least 2 characters";
      return "";
    case "etharaEmail":
      if (!value.trim()) return "Ethara email is required";
      if (!value.trim().toLowerCase().endsWith("@ethara.ai"))
        return "Must be a valid @ethara.ai company email";
      if (!/^[^\s@]+@ethara\.ai$/.test(value.trim().toLowerCase()))
        return "Invalid email format";
      return "";
    case "personalEmail":
      if (!value.trim()) return "Personal email is required (for records only)";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return "Invalid email format";
      return "";
    case "employeeCode":
      if (!value.trim()) return "Employee code is required";
      return "";
    case "phone":
      if (!value.trim()) return "Phone number is required";
      if (!/^\d{10}$/.test(value.replace(/\s/g, "")))
        return "Phone number must be exactly 10 digits";
      return "";
    case "password":
      if (!value) return "Password is required";
      if (value.length < 8) return "Password must be at least 8 characters";
      if (!/[A-Z]/.test(value)) return "Must include at least one uppercase letter";
      if (!/[0-9]/.test(value)) return "Must include at least one number";
      return "";
    case "confirmPassword":
      if (!value) return "Please confirm your password";
      if (value !== (extra?.password ?? "")) return "Passwords do not match";
      return "";
    case "department":
      if (!value.trim()) return "Department is required";
      return "";
    case "designation":
      if (!value.trim()) return "Designation is required";
      return "";
    case "aadhaarNumber":
      if (!value.trim()) return "Aadhaar number is required";
      if (!/^\d{12}$/.test(value.replace(/\s/g, ""))) return "Aadhaar must be exactly 12 digits";
      return "";
    default:
      return "";
  }
}

export default function EmployeeRegisterPage() {
  return (
    <Suspense fallback={<Shell loadingMessage="Loading employee registration..." />}>
      <EmployeeRegisterContent />
    </Suspense>
  );
}

function EmployeeRegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next");

  void nextPath;

  const [form, setForm] = useState({
    fullName: "",
    etharaEmail: "",
    personalEmail: "",
    employeeCode: "",
    phone: "",
    department: "",
    designation: "",
    gender: "",
    password: "",
    aadhaarNumber: "",
    dateOfBirth: "",
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resume, setResume] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState("");
  const [aadhaarFile, setAadhaarFile] = useState<File | null>(null);
  const [aadhaarOcrStatus, setAadhaarOcrStatus] = useState<OcrStatus>("idle");
  const [aadhaarOcrMessage, setAadhaarOcrMessage] = useState("");
  const [aadhaarExtracted, setAadhaarExtracted] = useState<{
    number: string | null;
    dob: string | null;
    name: string | null;
  } | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalError, setGlobalError] = useState("");
  const [success, setSuccess] = useState(false);
  const [departmentOptions, setDepartmentOptions] = useState<string[]>(() =>
    mergeEmployeeReferenceOptions(null, EMPLOYEE_DEPARTMENT_OPTIONS)
  );
  const [designationOptions, setDesignationOptions] = useState<string[]>(() =>
    mergeEmployeeReferenceOptions(null, EMPLOYEE_DESIGNATION_OPTIONS)
  );
  const [referenceOptionsLoading, setReferenceOptionsLoading] = useState(false);

  // OTP verification step
  const [otpStep, setOtpStep] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [otpResending, setOtpResending] = useState(false);
  const [otpResendMessage, setOtpResendMessage] = useState("");

  const loadReferenceOptions = useCallback(async () => {
    setReferenceOptionsLoading(true);
    try {
      const options = await employeesApi.referenceOptions();
      setDepartmentOptions(mergeEmployeeReferenceOptions(options.departments, EMPLOYEE_DEPARTMENT_OPTIONS));
      setDesignationOptions(mergeEmployeeReferenceOptions(options.designations, EMPLOYEE_DESIGNATION_OPTIONS));
    } catch {
      // Keep static defaults if the public reference endpoint is unavailable.
    } finally {
      setReferenceOptionsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void loadReferenceOptions();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [loadReferenceOptions]);

  const refreshReferenceOptions = () => {
    if (!referenceOptionsLoading) void loadReferenceOptions();
  };

  const update = (key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setGlobalError("");
    if (touched[key]) {
      setFieldErrors((prev) => ({
        ...prev,
        [key]: validateField(key, value, {}),
      }));
    }
  };

  const touch = (key: string, value?: string) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const v = value ?? (form as Record<string, string>)[key] ?? "";
    setFieldErrors((prev) => ({
      ...prev,
      [key]: validateField(key, v, key === "confirmPassword" ? { password: form.password } : {}),
    }));
  };

  const touchConfirm = (val: string) => {
    setTouched((prev) => ({ ...prev, confirmPassword: true }));
    setFieldErrors((prev) => ({
      ...prev,
      confirmPassword: validateField("confirmPassword", val, { password: form.password }),
    }));
  };

  const checkEmailDuplicate = async (value: string) => {
    touch("etharaEmail", value);
    if (!value.trim()) return;
    try {
      const res = await apiClient.get(`/employees/check-duplicate?email=${encodeURIComponent(value.trim().toLowerCase())}`);
      void res;
    } catch (err: unknown) {
      const apiErr = err as { response?: { status?: number } };
      if (apiErr?.response?.status === 409) {
        setFieldErrors((prev) => ({ ...prev, etharaEmail: "An account with this email already exists." }));
      }
    }
  };

  const checkCodeDuplicate = async (value: string) => {
    touch("employeeCode", value);
    if (!value.trim()) return;
    try {
      const res = await apiClient.get(`/employees/check-duplicate?code=${encodeURIComponent(value.trim())}`);
      void res;
    } catch (err: unknown) {
      const apiErr = err as { response?: { status?: number } };
      if (apiErr?.response?.status === 409) {
        setFieldErrors((prev) => ({ ...prev, employeeCode: "An employee with this employee code already exists." }));
      }
    }
  };

  const handleResumeChange = (file: File | null) => {
    setResume(file);
    setResumeError("");
    if (!file) return;
    if (!ALLOWED_RESUME_TYPES.has(file.type)) {
      setResumeError("Resume must be a PDF or Word document (.pdf, .doc, .docx)");
      return;
    }
    if (file.size > MAX_FILE_BYTES) { setResumeError("Resume must be under 10 MB"); return; }
    if (file.size === 0) { setResumeError("Resume appears to be empty"); return; }
  };

  const handleAadhaarUpload = async (file: File | null) => {
    setAadhaarFile(file);
    setAadhaarOcrMessage("");
    setAadhaarExtracted(null);
    setGlobalError("");
    if (!file) { setAadhaarOcrStatus("idle"); return; }

    const fileErr = validateAadhaarFile(file);
    if (fileErr) {
      setAadhaarOcrStatus("failed");
      setAadhaarOcrMessage(fileErr);
      setGlobalError("Please upload a valid Aadhaar card image or PDF.");
      return;
    }

    const payload = new FormData();
    payload.append("aadhaarCard", file);
    setAadhaarOcrStatus("extracting");

    // Retry up to 2 times on transient network errors (ECONNRESET, socket hang-up)
    let rawEmployee: AadhaarOcrResult | undefined;
    let lastEmpError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        rawEmployee = await employeesApi.extractAadhaar(payload) as AadhaarOcrResult;
        break;
      } catch (err: unknown) {
        lastEmpError = err;
        const isNetwork = !((err as { response?: unknown })?.response);
        if (!isNetwork || attempt === 2) { lastEmpError = err; break; }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        payload.delete("aadhaarCard");
        payload.append("aadhaarCard", file);
      }
    }
    try {
      if (!rawEmployee) throw lastEmpError;
      const result = rawEmployee as AadhaarOcrResult;
      const extractedNum = (result.aadhaarNumber ?? "").replace(/\D/g, "");
      const extractedDob = result.dateOfBirth ?? "";
      const extractedName = result.cardHolderName ?? "";
      const status = result.ocrStatus ?? "needs_review";

      setAadhaarExtracted({
        number: extractedNum || null,
        dob: extractedDob || null,
        name: extractedName || null,
      });

      if (status === "extracted" && extractedNum) {
        setAadhaarOcrStatus("passed");
        setForm((prev) => ({
          ...prev,
          aadhaarNumber: extractedNum,
          dateOfBirth: extractedDob || prev.dateOfBirth,
        }));
        setFieldErrors((prev) => ({ ...prev, aadhaarNumber: validateField("aadhaarNumber", extractedNum, {}) }));
        setAadhaarOcrMessage(result.message || "Aadhaar details extracted successfully.");
      } else if (status === "partial" || (extractedDob || extractedName)) {
        setAadhaarOcrStatus("partial");
        setForm((prev) => ({
          ...prev,
          aadhaarNumber: extractedNum || prev.aadhaarNumber,
          dateOfBirth: extractedDob || prev.dateOfBirth,
        }));
        if (extractedNum) {
          setFieldErrors((prev) => ({ ...prev, aadhaarNumber: validateField("aadhaarNumber", extractedNum, {}) }));
        }
        setAadhaarOcrMessage("Partial Aadhaar details were extracted. Please review and complete the missing fields below.");
      } else {
        setAadhaarOcrStatus("needs_review");
        setAadhaarOcrMessage("Aadhaar document uploaded. Please review the details below or upload an unmasked, clearer front-side image.");
      }
    } catch {
      setAadhaarOcrStatus("needs_review");
      setAadhaarExtracted(null);
      setAadhaarOcrMessage(
        "Aadhaar OCR is taking longer than expected. The document has been saved; please review the fields below or upload an unmasked Aadhaar card again."
      );
    }
  };

  const aadhaarNumValid = /^\d{12}$/.test(form.aadhaarNumber.replace(/\s/g, ""));
  const aadhaarReady =
    (aadhaarOcrStatus === "passed" || aadhaarOcrStatus === "partial" || aadhaarOcrStatus === "needs_review") &&
    aadhaarNumValid;

  const allValid = () => {
    const requiredKeys: Array<keyof typeof form> = [
      "fullName", "etharaEmail", "personalEmail", "employeeCode",
      "phone", "department", "designation", "gender", "password", "aadhaarNumber",
    ];
    const errs: Record<string, string> = {};
    for (const k of requiredKeys) {
      errs[k] = validateField(k, form[k]);
    }
    errs.confirmPassword = validateField("confirmPassword", confirmPassword, { password: form.password });
    setFieldErrors((prev) => ({ ...prev, ...errs }));
    const allTouched: Record<string, boolean> = {};
    [...requiredKeys, "confirmPassword"].forEach((k) => { allTouched[k] = true; });
    setTouched((prev) => ({ ...prev, ...allTouched }));
    return !Object.values(errs).some(Boolean);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allValid()) {
      setGlobalError("Please fix the highlighted errors before submitting.");
      return;
    }
    if (!aadhaarFile) {
      setGlobalError("Aadhaar card upload is required.");
      return;
    }
    if (!aadhaarReady) {
      setGlobalError("Invalid Documents — Aadhaar verification did not pass. Please upload a valid Aadhaar card.");
      return;
    }

    const payload = new FormData();
    payload.append("fullName", form.fullName);
    payload.append("etharaEmail", form.etharaEmail.trim().toLowerCase());
    payload.append("personalEmail", form.personalEmail.trim().toLowerCase());
    payload.append("employeeCode", form.employeeCode.trim());
    payload.append("phone", form.phone.replace(/\s/g, ""));
    payload.append("department", form.department.trim());
    payload.append("designation", form.designation.trim());
    payload.append("gender", form.gender);
    payload.append("password", form.password);
    payload.append("aadhaarNumber", form.aadhaarNumber.replace(/\s/g, ""));
    if (form.dateOfBirth) payload.append("dateOfBirth", form.dateOfBirth);
    payload.append("aadhaarCard", aadhaarFile);
    if (resume) payload.append("resume", resume);

    setIsSubmitting(true);
    setGlobalError("");
    try {
      const result = await employeesApi.register(payload);
      if (result?.requiresVerification) {
        const email = result.email || form.etharaEmail.trim().toLowerCase();
        setOtpEmail(email);
        setOtpStep(true);
      } else {
        setSuccess(true);
        setTimeout(() => router.push("/login"), 2500);
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      const detail = apiErr?.response?.data?.detail || "Registration failed. Please try again.";
      setGlobalError(detail);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpCode.trim().length !== 6) {
      setOtpError("Please enter the 6-digit verification code.");
      return;
    }
    setOtpSubmitting(true);
    setOtpError("");
    try {
      await employeesApi.verifyEmail({ email: otpEmail, code: otpCode.trim() });
      setSuccess(true);
      setTimeout(() => router.push("/login"), 2500);
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      const detail = apiErr?.response?.data?.detail || "Verification failed. Please check your code and try again.";
      setOtpError(detail);
    } finally {
      setOtpSubmitting(false);
    }
  };

  const handleOtpResend = async () => {
    setOtpResending(true);
    setOtpResendMessage("");
    setOtpError("");
    try {
      await employeesApi.resendVerification({ email: otpEmail });
      setOtpResendMessage("A new verification code has been sent to your email.");
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      const detail = apiErr?.response?.data?.detail || "Failed to resend code. Please try again.";
      setOtpError(detail);
    } finally {
      setOtpResending(false);
    }
  };

  if (otpStep && !success) {
    return (
      <Shell>
        <div className="mx-auto max-w-md w-full space-y-6">
          <div className="text-center space-y-3">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full mx-auto"
              style={{
                background: "rgba(144,141,206,0.12)",
                border: "1px solid rgba(144,141,206,0.30)",
                boxShadow: "0 0 24px rgba(144,141,206,0.18)",
              }}
            >
              <CheckCircle2 className="h-8 w-8" style={{ color: "#908DCE" }} />
            </div>
            <h2 className="text-2xl font-semibold text-white">Verify your email</h2>
            <p className="text-sm" style={{ color: "rgba(197,203,232,0.60)" }}>
              Please check your email and enter the 6-digit verification code
            </p>
            <p className="text-sm font-medium" style={{ color: "#908DCE" }}>{otpEmail}</p>
          </div>

          <form
            onSubmit={handleOtpSubmit}
            noValidate
            className="rounded-lg p-6 space-y-5"
            style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.18)", boxShadow: "0 18px 42px rgba(0,0,0,0.18)" }}
          >
            <div className="space-y-1.5">
              <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Verification Code</Label>
              <input
                className="h-12 w-full rounded-xl px-3 text-center text-lg font-mono tracking-[0.4em] focus:outline-none"
                style={{
                  background: "rgba(144,141,206,0.07)",
                  border: `1px solid ${otpError ? "rgba(239,68,68,0.60)" : "rgba(144,141,206,0.20)"}`,
                  color: "#C5CBE8",
                }}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setOtpError("");
                }}
                placeholder="000000"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
              />
              {otpError && (
                <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: "#f87171" }}>
                  <XCircle className="h-3 w-3 shrink-0" /> {otpError}
                </p>
              )}
            </div>

            {otpResendMessage && (
              <div
                className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
                style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.22)", color: "rgba(134,239,172,0.90)" }}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" /> {otpResendMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={otpSubmitting || otpCode.length !== 6}
              className="h-10 w-full rounded-xl text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
              style={{
                background: otpSubmitting || otpCode.length !== 6 ? "rgba(144,141,206,0.35)" : "linear-gradient(135deg, #908DCE 0%, #ED00ED 100%)",
                boxShadow: otpSubmitting || otpCode.length !== 6 ? "none" : "0 10px 24px rgba(144,141,206,0.22)",
              }}
            >
              {otpSubmitting ? (
                <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Verifying...</span>
              ) : "Verify Email"}
            </button>

            <p className="text-center text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
              Didn&apos;t receive a code?{" "}
              <button
                type="button"
                disabled={otpResending}
                onClick={handleOtpResend}
                className="transition-colors"
                style={{ color: "#908DCE" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#908DCE"; }}
              >
                {otpResending ? "Resending..." : "Resend code"}
              </button>
            </p>
          </form>
        </div>
      </Shell>
    );
  }

  if (success) {
    return (
      <Shell>
        <div className="mx-auto max-w-md text-center space-y-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full mx-auto"
            style={{
              background: "rgba(34,197,94,0.12)",
              border: "1px solid rgba(34,197,94,0.30)",
              boxShadow: "0 0 24px rgba(34,197,94,0.20)",
            }}
          >
            <CheckCircle2 className="h-8 w-8" style={{ color: "#22c55e" }} />
          </div>
          <h2 className="text-2xl font-semibold text-white">Registration complete</h2>
          <p className="text-sm" style={{ color: "rgba(197,203,232,0.60)" }}>
            Your employee account has been created. You can now log in using your Ethara.AI email and password.
            Redirecting to login…
          </p>
        </div>
      </Shell>
    );
  }

  const inputStyle = (field: string): React.CSSProperties => ({
    background: touched[field] && fieldErrors[field] ? "rgba(239,68,68,0.05)" : "rgba(144,141,206,0.07)",
    border: `1px solid ${touched[field] && fieldErrors[field] ? "rgba(239,68,68,0.60)" : "rgba(144,141,206,0.20)"}`,
    color: "#C5CBE8",
    outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  });

  const ocrStatusColor = {
    idle: "rgba(144,141,206,0.07)",
    extracting: "rgba(144,141,206,0.10)",
    passed: "rgba(34,197,94,0.06)",
    partial: "rgba(245,158,11,0.06)",
    needs_review: "rgba(245,158,11,0.06)",
    failed: "rgba(239,68,68,0.06)",
  }[aadhaarOcrStatus] ?? "rgba(144,141,206,0.07)";

  const ocrBorderColor = {
    idle: "rgba(144,141,206,0.20)",
    extracting: "rgba(144,141,206,0.35)",
    passed: "rgba(34,197,94,0.30)",
    partial: "rgba(245,158,11,0.30)",
    needs_review: "rgba(245,158,11,0.30)",
    failed: "rgba(239,68,68,0.30)",
  }[aadhaarOcrStatus] ?? "rgba(144,141,206,0.20)";

  const ocrIconColor = {
    idle: "#908DCE",
    extracting: "#908DCE",
    passed: "#22c55e",
    partial: "#f59e0b",
    needs_review: "#f59e0b",
    failed: "#ef4444",
  }[aadhaarOcrStatus] ?? "#908DCE";

  const ocrMessageColor = {
    idle: "rgba(197,203,232,0.40)",
    extracting: "rgba(197,203,232,0.50)",
    passed: "rgba(134,239,172,0.80)",
    partial: "rgba(252,211,77,0.80)",
    needs_review: "rgba(252,211,77,0.80)",
    failed: "rgba(252,165,165,0.80)",
  }[aadhaarOcrStatus] ?? "rgba(197,203,232,0.40)";

  return (
    <Shell>
      <div className="mx-auto max-w-5xl w-full">
        <Link
          href="/register"
          className="mb-8 inline-flex items-center gap-2 text-sm transition-colors"
          style={{ color: "#908DCE" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#908DCE"; }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to registration options
        </Link>

        <div className="mb-8">
          <div className="mb-4 flex items-center gap-3">
            <Image src="/logo.png" alt="Ethara.AI" width={120} height={34} className="h-auto w-[120px] object-contain" priority />
            <span
              className="hidden h-px w-12 sm:block"
              style={{ background: "linear-gradient(90deg, rgba(144,141,206,0.70), transparent)" }}
            />
            <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: "rgba(144,141,206,0.70)" }}>
              Employee Portal
            </p>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Create employee account</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6" style={{ color: "rgba(197,203,232,0.62)" }}>
            Set up your employee profile with your company email, employee code, and identity details.
          </p>
          <div
            className="mt-5 rounded-lg px-4 py-3 text-sm flex items-start gap-2"
            style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.22)", color: "rgba(197,203,232,0.65)" }}
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "#908DCE" }} />
            <span>
              Use your @ethara.ai company email. Access may require email verification.
            </span>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="space-y-8 mt-2"
        >
          <div
            className="rounded-lg p-5 sm:p-6"
            style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)", boxShadow: "0 18px 42px rgba(0,0,0,0.18)" }}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold shrink-0" style={{ background: "rgba(144,141,206,0.15)", color: "#908DCE", border: "1px solid rgba(144,141,206,0.25)" }}>1</span>
              <p className="text-sm font-semibold" style={{ color: "rgba(197,203,232,0.80)" }}>Personal details</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Full Name *</Label>
                <input className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none" style={inputStyle("fullName")} value={form.fullName} onChange={(e) => update("fullName", e.target.value)} onBlur={() => touch("fullName")} placeholder="Your full name" />
                <FieldError field="fullName" touched={touched} fieldErrors={fieldErrors} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Gender *</Label>
                <Select value={form.gender} onValueChange={(v) => update("gender", v ?? "")}>
                  <SelectTrigger className="h-10 w-full rounded-xl px-3 text-sm" style={inputStyle("gender")}>
                    <SelectValue placeholder="Select gender">
                      {(value) => resolveEmployeeGenderLabel(value as string) || "Select gender"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {EMPLOYEE_GENDER_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError field="gender" touched={touched} fieldErrors={fieldErrors} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Phone Number *</Label>
                <input className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none" style={inputStyle("phone")} value={form.phone} onChange={(e) => update("phone", e.target.value.replace(/\D/g, "").slice(0, 10))} onBlur={() => touch("phone")} placeholder="9876543210" maxLength={10} />
                <FieldError field="phone" touched={touched} fieldErrors={fieldErrors} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>
                  Personal Email *{" "}
                  <span className="text-xs font-normal" style={{ color: "rgba(197,203,232,0.62)" }}>(for records only)</span>
                </Label>
                <input type="email" className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none" style={inputStyle("personalEmail")} value={form.personalEmail} onChange={(e) => update("personalEmail", e.target.value)} onBlur={() => touch("personalEmail")} placeholder="personal@gmail.com" />
                <FieldError field="personalEmail" touched={touched} fieldErrors={fieldErrors} />
              </div>
            </div>
          </div>

          <div
            className="rounded-lg p-5 sm:p-6"
            style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)", boxShadow: "0 18px 42px rgba(0,0,0,0.18)" }}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold shrink-0" style={{ background: "rgba(144,141,206,0.15)", color: "#908DCE", border: "1px solid rgba(144,141,206,0.25)" }}>2</span>
              <p className="text-sm font-semibold" style={{ color: "rgba(197,203,232,0.80)" }}>Employment details</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Ethara Email *</Label>
                <input type="email" className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none" style={inputStyle("etharaEmail")} value={form.etharaEmail} onChange={(e) => update("etharaEmail", e.target.value)} onBlur={() => { void checkEmailDuplicate(form.etharaEmail); }} placeholder="you@ethara.ai" autoComplete="email" />
                <FieldError field="etharaEmail" touched={touched} fieldErrors={fieldErrors} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Employee Code *</Label>
                <input className="h-10 w-full rounded-xl px-3 text-sm font-mono focus:outline-none" style={inputStyle("employeeCode")} value={form.employeeCode} onChange={(e) => update("employeeCode", e.target.value.toUpperCase().replace(/\s+/g, ""))} onBlur={() => { void checkCodeDuplicate(form.employeeCode); }} placeholder="GRP1234" />
                <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.62)" }}>Format: GRPXXXX — no spaces.</p>
                <FieldError field="employeeCode" touched={touched} fieldErrors={fieldErrors} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Department *</Label>
                <Select
                  value={form.department}
                  onValueChange={(v) => update("department", v ?? "")}
                  onOpenChange={(open) => {
                    if (open) refreshReferenceOptions();
                  }}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl px-3 text-sm" style={inputStyle("department")}>
                    <SelectValue placeholder="Select department">
                      {(value) => resolveEmployeeReferenceLabel(value as string) || "Select department"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {referenceOptionsLoading && (
                      <SelectItem value="__loading_departments__" disabled>
                        Loading latest departments...
                      </SelectItem>
                    )}
                    {departmentOptions.map((department) => (
                      <SelectItem key={department} value={department}>
                        {formatDropdownOptionLabel(department)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError field="department" touched={touched} fieldErrors={fieldErrors} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Designation *</Label>
                <Select
                  value={form.designation}
                  onValueChange={(v) => update("designation", v ?? "")}
                  onOpenChange={(open) => {
                    if (open) refreshReferenceOptions();
                  }}
                >
                  <SelectTrigger className="h-10 w-full rounded-xl px-3 text-sm" style={inputStyle("designation")}>
                    <SelectValue placeholder="Select designation">
                      {(value) => resolveEmployeeReferenceLabel(value as string) || "Select designation"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" alignItemWithTrigger={false}>
                    {referenceOptionsLoading && (
                      <SelectItem value="__loading_designations__" disabled>
                        Loading latest designations...
                      </SelectItem>
                    )}
                    {designationOptions.map((designation) => (
                      <SelectItem key={designation} value={designation}>
                        {formatDropdownOptionLabel(designation)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError field="designation" touched={touched} fieldErrors={fieldErrors} />
              </div>
            </div>
          </div>

          <div
            className="rounded-lg p-5 sm:p-6"
            style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)", boxShadow: "0 18px 42px rgba(0,0,0,0.18)" }}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold shrink-0" style={{ background: "rgba(144,141,206,0.15)", color: "#908DCE", border: "1px solid rgba(144,141,206,0.25)" }}>3</span>
              <p className="text-sm font-semibold" style={{ color: "rgba(197,203,232,0.80)" }}>Aadhaar verification</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Aadhaar Number *</Label>
                <input
                  className="h-10 w-full rounded-xl px-3 text-sm font-mono focus:outline-none"
                  style={inputStyle("aadhaarNumber")}
                  value={form.aadhaarNumber}
                  onChange={(e) => update("aadhaarNumber", e.target.value.replace(/\D/g, "").slice(0, 12))}
                  onBlur={() => touch("aadhaarNumber")}
                  placeholder="12-digit Aadhaar number"
                  maxLength={12}
                />
                <FieldError field="aadhaarNumber" touched={touched} fieldErrors={fieldErrors} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>
                  Date of Birth{" "}
                  <span className="text-xs font-normal" style={{ color: "rgba(197,203,232,0.62)" }}>(from Aadhaar)</span>
                </Label>
                <DatePicker
                  className="h-10 w-full rounded-xl px-3 text-sm"
                  style={inputStyle("dateOfBirth")}
                  value={form.dateOfBirth}
                  onChange={(v) => update("dateOfBirth", v)}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>

              <div className="md:col-span-2 space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>
                  Aadhaar Card Upload *{" "}
                  <span className="text-xs font-normal" style={{ color: "rgba(197,203,232,0.62)" }}>
                    PDF, JPG, PNG — max 10 MB
                  </span>
                </Label>
                <div
                  className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm"
                  style={{
                    background: "rgba(245,158,11,0.08)",
                    border: "1px solid rgba(245,158,11,0.22)",
                    color: "rgba(252,211,77,0.90)",
                  }}
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#f59e0b" }} />
                  <span>
                    Upload original, unmasked Aadhaar. Masked cards are not accepted.
                  </span>
                </div>
                <label
                  className="flex h-10 w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm transition-all duration-200"
                  style={{ background: ocrStatusColor, border: `1px solid ${ocrBorderColor}`, color: "rgba(197,203,232,0.60)" }}
                >
                  {aadhaarOcrStatus === "extracting" ? (
                    <Loader2 className="h-4 w-4 animate-spin shrink-0" style={{ color: ocrIconColor }} />
                  ) : aadhaarOcrStatus === "passed" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: ocrIconColor }} />
                  ) : (
                    <UploadCloud className="h-4 w-4 shrink-0" style={{ color: ocrIconColor }} />
                  )}
                  <span className="min-w-0 flex-1 truncate">
                    {aadhaarFile ? aadhaarFile.name : "Click to upload Aadhaar card"}
                  </span>
                  {aadhaarFile && aadhaarOcrStatus !== "extracting" && (
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.preventDefault();
                        setAadhaarFile(null);
                        setAadhaarOcrStatus("idle");
                        setAadhaarOcrMessage("");
                        setAadhaarExtracted(null);
                      }}
                      className="shrink-0"
                      style={{ color: "rgba(197,203,232,0.40)" }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <input
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => { void handleAadhaarUpload(e.target.files?.[0] ?? null); }}
                  />
                </label>
                {aadhaarOcrMessage && (
                  <p className="text-xs flex items-center gap-1" style={{ color: ocrMessageColor }}>
                    {aadhaarOcrStatus === "passed" && <CheckCircle2 className="h-3 w-3 shrink-0" />}
                    {(aadhaarOcrStatus === "partial" || aadhaarOcrStatus === "needs_review") && <AlertCircle className="h-3 w-3 shrink-0" />}
                    {aadhaarOcrStatus === "failed" && <AlertCircle className="h-3 w-3 shrink-0" />}
                    {aadhaarOcrMessage}
                  </p>
                )}
              </div>
            </div>

            {aadhaarExtracted && (aadhaarOcrStatus === "passed" || aadhaarOcrStatus === "partial") && (
              <div
                className="mt-3 rounded-xl p-4 space-y-3"
                style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.18)" }}
              >
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.70)" }}>
                  {aadhaarOcrStatus === "passed" ? "Extracted from Aadhaar" : "Partially extracted — complete missing fields"}
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg p-3" style={{ background: "rgba(144,141,206,0.08)", border: "1px solid rgba(144,141,206,0.15)" }}>
                    <p className="mb-1 text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>Aadhaar Number</p>
                    {aadhaarExtracted.number ? (
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-sm font-semibold" style={{ color: "#C5CBE8" }}>
                          {formatAadhaarDisplay(aadhaarExtracted.number)}
                        </p>
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full shrink-0" style={{ background: "rgba(34,197,94,0.15)" }}><Check className="h-2.5 w-2.5" style={{ color: "#86efac" }} /></span>
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: "rgba(252,211,77,0.80)" }}>Enter below ↓</p>
                    )}
                  </div>
                  <div className="rounded-lg p-3" style={{ background: "rgba(144,141,206,0.08)", border: "1px solid rgba(144,141,206,0.15)" }}>
                    <p className="mb-1 text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>Date of Birth</p>
                    {aadhaarExtracted.dob ? (
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>
                          {new Date(aadhaarExtracted.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                        </p>
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full shrink-0" style={{ background: "rgba(34,197,94,0.15)" }}><Check className="h-2.5 w-2.5" style={{ color: "#86efac" }} /></span>
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: "rgba(252,211,77,0.80)" }}>Enter below ↓</p>
                    )}
                  </div>
                  <div className="rounded-lg p-3" style={{ background: "rgba(144,141,206,0.08)", border: "1px solid rgba(144,141,206,0.15)" }}>
                    <p className="mb-1 text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>Name on Card</p>
                    {aadhaarExtracted.name ? (
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold" style={{ color: "#C5CBE8" }}>{aadhaarExtracted.name}</p>
                        <span className="inline-flex items-center justify-center h-4 w-4 rounded-full shrink-0" style={{ background: "rgba(34,197,94,0.15)" }}><Check className="h-2.5 w-2.5" style={{ color: "#86efac" }} /></span>
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>Not detected</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {aadhaarOcrStatus !== "idle" && aadhaarOcrStatus !== "extracting" && (
              <div
                className="mt-3 flex items-start gap-2 rounded-xl px-4 py-3 text-sm"
                style={
                  aadhaarOcrStatus === "passed"
                    ? { background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.22)", color: "rgba(134,239,172,0.90)" }
                    : aadhaarOcrStatus === "partial" || aadhaarOcrStatus === "needs_review"
                    ? { background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", color: "rgba(252,211,77,0.90)" }
                    : { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "rgba(252,165,165,0.90)" }
                }
              >
                {aadhaarOcrStatus === "passed"
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#22c55e" }} />
                  : <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: (aadhaarOcrStatus === "partial" || aadhaarOcrStatus === "needs_review") ? "#f59e0b" : "#ef4444" }} />
                }
                <span>
                  {aadhaarOcrStatus === "passed"
                    ? "Aadhaar verified. You may proceed with registration."
                    : aadhaarOcrStatus === "partial"
                    ? "Partial read — enter your 12-digit Aadhaar number below to continue."
                    : aadhaarOcrStatus === "needs_review"
                    ? aadhaarOcrMessage || "Aadhaar document uploaded. Please review the details below or upload an unmasked, clearer front-side image."
                    : "Invalid document — please upload a valid unmasked Aadhaar card (JPG, PNG, PDF, or WEBP)."}
                </span>
              </div>
            )}
          </div>

          <div
            className="rounded-lg p-5 sm:p-6"
            style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)", boxShadow: "0 18px 42px rgba(0,0,0,0.18)" }}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold shrink-0" style={{ background: "rgba(144,141,206,0.15)", color: "#908DCE", border: "1px solid rgba(144,141,206,0.25)" }}>4</span>
              <p className="text-sm font-semibold" style={{ color: "rgba(197,203,232,0.80)" }}>Account security</p>
            </div>
            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Create Password *</Label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className="h-10 w-full rounded-xl px-3 pr-11 text-sm focus:outline-none"
                    style={inputStyle("password")}
                    value={form.password}
                    onChange={(e) => update("password", e.target.value)}
                    onBlur={() => touch("password")}
                    placeholder="Min. 8 chars, 1 uppercase, 1 number"
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: "rgba(197,203,232,0.40)" }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#ED00ED"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "rgba(197,203,232,0.40)"; }}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <FieldError field="password" touched={touched} fieldErrors={fieldErrors} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>Confirm Password *</Label>
                <input
                  type={showPassword ? "text" : "password"}
                  className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none"
                  style={inputStyle("confirmPassword")}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setGlobalError("");
                    if (touched.confirmPassword) {
                      setFieldErrors((prev) => ({
                        ...prev,
                        confirmPassword: validateField("confirmPassword", e.target.value, { password: form.password }),
                      }));
                    }
                  }}
                  onBlur={() => touchConfirm(confirmPassword)}
                  minLength={8}
                  placeholder="Repeat your password"
                />
                <FieldError field="confirmPassword" touched={touched} fieldErrors={fieldErrors} />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>
              Resume{" "}
              <span className="text-xs font-normal" style={{ color: "rgba(197,203,232,0.62)" }}>
                (optional — stored in records, not screened)
              </span>
            </Label>
            <label
              className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-xl px-3 text-sm transition-all duration-200"
              style={
                resume
                  ? { background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.30)", color: "#22c55e" }
                  : resumeError
                  ? { background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.30)", color: "rgba(197,203,232,0.60)" }
                  : { background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.20)", color: "rgba(197,203,232,0.60)" }
              }
            >
              {resume ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <UploadCloud className="h-4 w-4 shrink-0" style={{ color: "#908DCE" }} />}
              <span className="min-w-0 flex-1 truncate" title={resume?.name || undefined}>
                {resume ? resume.name : "Click to upload resume (PDF, DOC, DOCX)"}
              </span>
              <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => handleResumeChange(e.target.files?.[0] ?? null)} />
            </label>
            {resumeError && (
              <p className="text-xs flex items-center gap-1" style={{ color: "#f87171" }}>
                <AlertCircle className="h-3 w-3" /> {resumeError}
              </p>
            )}
          </div>

          {globalError && (
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "#f87171" }}
            >
              <XCircle className="h-4 w-4 shrink-0" /> {globalError}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
              Already have an account?{" "}
              <Link href="/login" className="transition-colors" style={{ color: "#908DCE" }}>Sign in</Link>
            </p>
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-10 rounded-xl px-6 text-sm font-semibold text-white transition-all duration-200 active:scale-[0.98] disabled:opacity-60"
              style={{
                background: isSubmitting ? "rgba(144,141,206,0.35)" : "linear-gradient(135deg, #908DCE 0%, #ED00ED 100%)",
                boxShadow: isSubmitting ? "none" : "0 10px 24px rgba(144,141,206,0.22)",
              }}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Registering...</span>
              ) : "Create employee account"}
            </button>
          </div>
        </form>
      </div>
    </Shell>
  );
}

function Shell({ children, loadingMessage }: { children?: React.ReactNode; loadingMessage?: string }) {
  return (
    <main
      className="min-h-screen relative animate-fade-in"
      style={{ background: "#080810", color: "var(--foreground)" }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(145deg, rgba(144,141,206,0.10) 0%, transparent 34%), linear-gradient(315deg, rgba(237,0,237,0.07) 0%, transparent 42%)",
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none opacity-[0.045]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(197,203,232,0.9) 1px, transparent 1px), linear-gradient(90deg, rgba(197,203,232,0.9) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="relative z-10 px-5 py-8 sm:px-6 sm:py-10">
        {children ?? (
          <div className="flex min-h-[70vh] items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <div className="h-8 w-8 rounded-full animate-spin" style={{ border: "2px solid rgba(144,141,206,0.20)", borderTop: "2px solid #908DCE" }} />
              <p className="text-sm animate-pulse" style={{ color: "rgba(144,141,206,0.6)" }}>{loadingMessage}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

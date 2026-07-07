"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Children, isValidElement, Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Briefcase, Check, CheckCircle2, AlertTriangle, Eye, EyeOff, Loader2, UploadCloud, XCircle, GraduationCap } from "lucide-react";
import { candidatesApi, campusApi, collegesApi, positionsApi } from "@/lib/api";
import { safeNextPath } from "@/lib/export";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";

type Lookup = { id: string; name?: string; title?: string; department?: string };
type OcrStatus = "idle" | "extracting" | "passed" | "partial" | "needs_review" | "failed";
type FileStatus = "idle" | "passed" | "failed";
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

function isoDateFromParts(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2030 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function normalizeAadhaarDob(value?: string | null): string | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;

  const digitized = raw
    .replace(/[Oo]/g, "0")
    .replace(/[Il|]/g, "1")
    .replace(/[Ss]/g, "5")
    .replace(/[Bb]/g, "8")
    .replace(/[Zz]/g, "2");

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(digitized);
  if (iso) return isoDateFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const ymd = digitized.match(/\b(\d{4})[\/. \t-]+(\d{1,2})[\/. \t-]+(\d{1,2})\b/);
  if (ymd) return isoDateFromParts(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const dmy = digitized.match(/\b(\d{1,2})[\/. \t-]+(\d{1,2})[\/. \t-]+(\d{4})\b/);
  if (dmy) return isoDateFromParts(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return isoDateFromParts(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
}

function formatAadhaarDobDisplay(value: string): string {
  const iso = normalizeAadhaarDob(value);
  if (!iso) return "Enter below";
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function CampusBanner() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { campusApi.config().then((c) => setEnabled(c.enabled)).catch(() => {}); }, []);
  if (!enabled) return null;
  return (
    <Link
      href="/candidate/campus-register"
      className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 text-sm"
      style={{ borderColor: "rgba(237,0,237,0.25)", background: "rgba(237,0,237,0.08)" }}
    >
      <span className="flex items-center gap-2" style={{ color: "#C5CBE8" }}>
        <GraduationCap className="h-4 w-4" /> Here for a campus drive? Register the quick way.
      </span>
      <span className="font-medium" style={{ color: "#ED00ED" }}>Campus registration →</span>
    </Link>
  );
}

function isDocumentSubmissionError(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("document") ||
    normalized.includes("ocr") ||
    normalized.includes("resume upload") ||
    normalized.includes("unsupported file type") ||
    normalized.includes("verification failed")
  );
}

const ALLOWED_RESUME_TYPES = new Set([
  "application/pdf",
]);
const ALLOWED_AADHAAR_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function validateResumeFile(file: File): string | null {
  if (!ALLOWED_RESUME_TYPES.has(file.type))
    return "Resume must be a PDF document (.pdf)";
  if (file.size > MAX_FILE_BYTES) return "Resume must be under 10 MB";
  if (file.size === 0) return "Resume file appears to be empty";
  return null;
}

function validateAadhaarFile(file: File): string | null {
  if (!ALLOWED_AADHAAR_TYPES.has(file.type))
    return "Aadhaar card must be a PDF, JPG, PNG, or WEBP";
  if (file.size > MAX_FILE_BYTES) return "Aadhaar file must be under 10 MB";
  if (file.size === 0) return "Aadhaar file appears to be empty";
  return null;
}

export default function CandidateRegisterPage() {
  return (
    <Suspense fallback={<RegisterPageShell loadingMessage="Loading candidate registration..." />}>
      <CandidateRegisterPageContent />
    </Suspense>
  );
}

function validateField(
  key: string,
  value: string,
  extra?: { password?: string; confirmPassword?: string; experienceType?: string },
): string {
  switch (key) {
    case "fullName":
      if (!value.trim()) return "Full name is required";
      if (value.trim().length < 2) return "Name must be at least 2 characters";
      return "";
    case "personalEmail":
      if (!value.trim()) return "Email is required";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) return "Invalid email format";
      return "";
    case "phone":
      if (!value.trim()) return "Phone number is required";
      if (!/^\d{10}$/.test(value.replace(/\s/g, ""))) return "Phone number must be exactly 10 digits";
      return "";
    case "password":
      if (!value) return "Password is required";
      if (value.length < 8) return "Password must be at least 8 characters";
      if (!/[A-Z]/.test(value)) return "Password must include at least one uppercase letter";
      if (!/[0-9]/.test(value)) return "Password must include at least one number";
      return "";
    case "confirmPassword":
      if (!value) return "Please confirm your password";
      if (value !== (extra?.password ?? "")) return "Passwords do not match";
      return "";
    case "gender":
      if (!value) return "Please select your gender";
      return "";
    case "experienceYears":
      if (extra?.experienceType !== "experienced") return "";
      if (!value.trim()) return "Experience years is required";
      if (!/^\d+$/.test(value.trim())) return "Experience years must be a whole number";
      if (Number(value.trim()) < 1) return "Experience years must be at least 1";
      return "";
    case "aadhaarNumber":
      if (!value.trim()) return "Aadhaar number is required";
      if (!/^\d{12}$/.test(value.replace(/\s/g, ""))) return "Aadhaar must be exactly 12 digits";
      return "";
    default:
      return "";
  }
}

function CandidateRegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useAuth();
  const selectedPositionId = searchParams.get("positionId");
  // Validate the `next` param as a same-site path only (rejects //host, /\host,
  // scheme-bearing values) to prevent an open redirect after registration.
  const redirectTarget = safeNextPath(searchParams.get("next")) ?? "/portal/dashboard";
  const [colleges, setColleges] = useState<Lookup[]>([]);
  const [isLoadingColleges, setIsLoadingColleges] = useState(true);
  const [selectedPosition, setSelectedPosition] = useState<Lookup | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [resumeStatus, setResumeStatus] = useState<FileStatus>("idle");
  const [resumeError, setResumeError] = useState("");
  const [aadhaarCard, setAadhaarCard] = useState<File | null>(null);
  const [aadhaarOcrStatus, setAadhaarOcrStatus] = useState<OcrStatus>("idle");
  const [aadhaarOcrMessage, setAadhaarOcrMessage] = useState("");
  const [aadhaarExtracted, setAadhaarExtracted] = useState<{
    number: string | null;
    dob: string | null;
    name: string | null;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    fullName: "",
    gender: "",
    experienceType: "fresher",
    experienceYears: "",
    personalEmail: "",
    phone: "",
    password: "",
    aadhaarNumber: "",
    dateOfBirth: "",
    positionId: selectedPositionId || "",
    collegeId: "",
  });

  useEffect(() => {
    const loadColleges = async () => {
      try {
        const data = await collegesApi.publicList();
        setColleges(data);
        setForm((prev) => ({ ...prev, collegeId: prev.collegeId || "" }));
      } catch {
        setError("Unable to load registration data. Please try again.");
      } finally {
        setIsLoadingColleges(false);
      }
    };

    void loadColleges();
  }, []);

  useEffect(() => {
    if (!selectedPositionId) return;
    positionsApi
      .publicGet(selectedPositionId)
      .then((data) => {
        setSelectedPosition(data);
        setForm((prev) => ({ ...prev, positionId: data.id }));
      })
      .catch(() => {
        setSelectedPosition(null);
      });
  }, [selectedPositionId]);

  const update = (key: keyof typeof form, value: string) => {
    const nextExperienceType = key === "experienceType" ? value : form.experienceType;
    const nextExperienceYears =
      key === "experienceYears"
        ? value
        : key === "experienceType" && value !== "experienced"
          ? ""
          : form.experienceYears;

    setForm((prev) => ({
      ...prev,
      [key]: value,
      ...(key === "experienceType" && value !== "experienced" ? { experienceYears: "" } : {}),
    }));
    setError("");
    if (touched[key]) {
      const err = validateField(key, value, {
        password: key === "password" ? value : form.password,
        confirmPassword,
        experienceType: nextExperienceType,
      });
      setFieldErrors((prev) => ({ ...prev, [key]: err }));
    }
    if (key === "experienceType" || touched.experienceYears || key === "experienceYears") {
      const err = validateField("experienceYears", nextExperienceYears, {
        experienceType: nextExperienceType,
      });
      setFieldErrors((prev) => ({ ...prev, experienceYears: err }));
    }
  };

  const touch = (key: string, value?: string) => {
    setTouched((prev) => ({ ...prev, [key]: true }));
    const fieldValue = value ?? (form as Record<string, string>)[key] ?? "";
    const extra = {
      password: form.password,
      confirmPassword,
      experienceType: form.experienceType,
    };
    const err = validateField(key, fieldValue, extra);
    setFieldErrors((prev) => ({ ...prev, [key]: err }));
  };

  const touchConfirm = (val: string) => {
    setTouched((prev) => ({ ...prev, confirmPassword: true }));
    const err = validateField("confirmPassword", val, { password: form.password });
    setFieldErrors((prev) => ({ ...prev, confirmPassword: err }));
  };

  const handleResumeChange = (file: File | null) => {
    setResume(file);
    setResumeError("");
    if (!file) { setResumeStatus("idle"); return; }
    const err = validateResumeFile(file);
    if (err) {
      setResumeStatus("failed");
      setResumeError(err);
      setError("Invalid Documents");
    } else {
      setResumeStatus("passed");
    }
  };

  const handleAadhaarUpload = async (file: File | null) => {
    setAadhaarCard(file);
    setAadhaarOcrMessage("");
    setAadhaarExtracted(null);
    setError("");
    if (!file) { setAadhaarOcrStatus("idle"); return; }

    const fileErr = validateAadhaarFile(file);
    if (fileErr) {
      setAadhaarOcrStatus("failed");
      setAadhaarOcrMessage(fileErr);
      setError("Please upload a valid Aadhaar card image or PDF.");
      return;
    }

    const payload = new FormData();
    payload.append("aadhaarCard", file);
    setAadhaarOcrStatus("extracting");

    // Retry up to 2 times on transient network errors (ECONNRESET, socket hang-up)
    let raw: AadhaarOcrResult | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        raw = await candidatesApi.extractAadhaar(payload) as AadhaarOcrResult;
        break;
      } catch (err: unknown) {
        lastError = err;
        const isNetwork = !((err as { response?: unknown })?.response);
        if (!isNetwork || attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        payload.delete("aadhaarCard");
        payload.append("aadhaarCard", file);
      }
    }
    try {
      if (!raw) throw lastError;
      const result = raw;
      const extractedNum = result.aadhaarNumber?.replace(/\D/g, "") || null;
      const extractedDob = normalizeAadhaarDob(result.dateOfBirth);
      const extractedName = result.cardHolderName || null;
      const status = result.ocrStatus ?? "needs_review";

      setAadhaarExtracted({ number: extractedNum, dob: extractedDob, name: extractedName });

      if (status === "extracted" && extractedNum) {
        setAadhaarOcrStatus("passed");
        setForm((prev) => ({
          ...prev,
          aadhaarNumber: extractedNum,
          dateOfBirth: extractedDob || prev.dateOfBirth,
        }));
        // Clear any stale "must be 12 digits" error left over from manual typing.
        setFieldErrors((prev) => ({ ...prev, aadhaarNumber: validateField("aadhaarNumber", extractedNum, {}) }));
        setAadhaarOcrMessage(result.message || "Aadhaar number extracted and verified successfully.");
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
  const experienceYearsValid = !validateField("experienceYears", form.experienceYears, {
    experienceType: form.experienceType,
  });
  const aadhaarReady = (
    aadhaarOcrStatus === "passed" ||
    aadhaarOcrStatus === "partial" ||
    aadhaarOcrStatus === "needs_review"
  ) && aadhaarNumValid;

  const canSubmit =
    aadhaarReady &&
    !!aadhaarCard &&
    resumeStatus === "passed" &&
    experienceYearsValid &&
    form.password.length >= 8 &&
    form.password === confirmPassword &&
    !isSubmitting;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.fullName.trim()) { setError("Full name is required"); return; }
    if (!form.gender) { setError("Gender is required"); return; }
    if (!form.personalEmail.trim()) { setError("Personal email ID is required"); return; }
    if (!form.phone.trim()) { setError("Phone number is required"); return; }
    const experienceYearsError = validateField("experienceYears", form.experienceYears, {
      experienceType: form.experienceType,
    });
    if (experienceYearsError) {
      setTouched((prev) => ({ ...prev, experienceYears: true }));
      setFieldErrors((prev) => ({ ...prev, experienceYears: experienceYearsError }));
      setError(experienceYearsError);
      return;
    }
    if (form.password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (form.password !== confirmPassword) { setError("Passwords do not match"); return; }
    if (!resume) { setError("Resume upload is required"); return; }
    if (resumeStatus !== "passed") { setError("Invalid Documents"); return; }
    if (!aadhaarCard) { setError("Aadhaar card upload is required"); return; }
    if (aadhaarOcrStatus === "idle" || aadhaarOcrStatus === "extracting" || aadhaarOcrStatus === "failed") {
      setError("Please upload a valid Aadhaar card before submitting.");
      return;
    }
    if (!aadhaarNumValid) {
      setError("Aadhaar number must be exactly 12 digits.");
      return;
    }

    const payload = new FormData();
    Object.entries(form).forEach(([key, value]) => {
      if (key === "experienceYears" && (form.experienceType !== "experienced" || !value.trim())) {
        return;
      }
      payload.append(key, value);
    });
    payload.set("aadhaarNumber", form.aadhaarNumber.replace(/\s/g, ""));
    payload.append("resume", resume);
    payload.append("aadhaarCard", aadhaarCard);

    setIsSubmitting(true);
    setError("");
    try {
      await candidatesApi.register(payload);
      setSuccess("Registration successful. Please verify your email.");
      const verifyUrl =
        `/candidate/verify-email?email=${encodeURIComponent(form.personalEmail)}` +
        (redirectTarget !== "/portal/dashboard"
          ? `&next=${encodeURIComponent(redirectTarget)}`
          : "");
      setTimeout(() => router.push(verifyUrl), 900);
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      const detail = apiError.response?.data?.detail || "";
      setError(
        isDocumentSubmissionError(detail)
          ? "Invalid Documents"
          : detail || "Unable to submit registration. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RegisterPageShell>
      <div className="mx-auto max-w-5xl">
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

        <CampusBanner />

        <div className="mb-8">
          <div className="mb-4 flex items-center gap-3">
            <Image src="/logo.png" alt="Ethara.AI" width={120} height={34} className="h-auto w-[120px] object-contain" priority />
            <span
              className="hidden h-px w-12 sm:block"
              style={{ background: "linear-gradient(90deg, rgba(237,0,237,0.60), transparent)" }}
            />
          </div>
          <p
            className="text-xs font-semibold uppercase tracking-[0.28em]"
            style={{ color: "rgba(237,0,237,0.65)" }}
          >
            Candidate Portal
          </p>
          <h1
            className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl"
            style={{ color: "#ffffff" }}
          >
            Create candidate profile
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6" style={{ color: "rgba(197,203,232,0.62)" }}>
            Set up your profile for applications, document verification, and hiring updates.
          </p>
        </div>

        {selectedPosition && (
          <div
            className="mb-6 rounded-lg p-4"
            style={{
              background: "rgba(237,0,237,0.06)",
              border: "1px solid rgba(237,0,237,0.22)",
            }}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  background: "rgba(237,0,237,0.12)",
                  border: "1px solid rgba(237,0,237,0.25)",
                }}
              >
                <Briefcase className="h-5 w-5" style={{ color: "#ED00ED" }} />
              </div>
              <div>
                <p
                  className="text-xs uppercase tracking-[0.22em]"
                  style={{ color: "rgba(237,0,237,0.65)" }}
                >
                  Selected role
                </p>
                <h2 className="mt-1 text-lg font-semibold text-white">{selectedPosition.title}</h2>
                <p className="mt-1 text-sm" style={{ color: "rgba(197,203,232,0.65)" }}>
                  {selectedPosition.department}
                </p>
              </div>
            </div>
          </div>
        )}

        <form
          onSubmit={submit}
          noValidate
          className="space-y-4"
        >
          <div
            className="rounded-lg p-5 sm:p-6"
            style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)", boxShadow: "0 18px 42px rgba(0,0,0,0.18)" }}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold shrink-0" style={{ background: "rgba(237,0,237,0.12)", color: "#ED00ED", border: "1px solid rgba(237,0,237,0.22)" }}>1</span>
              <p className="text-sm font-semibold" style={{ color: "rgba(197,203,232,0.80)" }}>Personal details</p>
            </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full name" error={touched.fullName ? fieldErrors.fullName : ""}>
              <ThemedInput
                value={form.fullName}
                onChange={(e) => update("fullName", e.target.value)}
                onBlur={() => touch("fullName")}
                placeholder="Your full name"
                hasError={!!(touched.fullName && fieldErrors.fullName)}
              />
            </Field>
            <Field label="Gender" error={touched.gender ? fieldErrors.gender : ""}>
              <ThemedSelect
                value={form.gender}
                onChange={(e) => update("gender", e.target.value)}
                onBlur={() => touch("gender")}
                hasError={!!(touched.gender && fieldErrors.gender)}
              >
                <option value="">Select gender</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="non_binary">Non-binary</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </ThemedSelect>
            </Field>
            <Field label="Experience">
              <ThemedSelect
                value={form.experienceType}
                onChange={(e) => update("experienceType", e.target.value)}
              >
                <option value="fresher">Fresher</option>
                <option value="experienced">Experienced</option>
              </ThemedSelect>
            </Field>
            <Field
              label="Experience years"
              error={touched.experienceYears ? fieldErrors.experienceYears : ""}
              hint={form.experienceType === "experienced" ? "Enter your total full years of experience" : "Required only for experienced candidates"}
            >
              <ThemedInput
                value={form.experienceYears}
                onChange={(e) => update("experienceYears", e.target.value.replace(/\D/g, "").slice(0, 2))}
                onBlur={() => touch("experienceYears")}
                placeholder={form.experienceType === "experienced" ? "e.g. 3" : "Only for experienced candidates"}
                disabled={form.experienceType !== "experienced"}
                hasError={!!(touched.experienceYears && fieldErrors.experienceYears)}
              />
            </Field>
            <Field label="Personal email ID" error={touched.personalEmail ? fieldErrors.personalEmail : ""}>
              <ThemedInput
                type="email"
                value={form.personalEmail}
                onChange={(e) => update("personalEmail", e.target.value)}
                onBlur={() => touch("personalEmail")}
                placeholder="you@example.com"
                hasError={!!(touched.personalEmail && fieldErrors.personalEmail)}
              />
            </Field>
            <Field label="Phone number" error={touched.phone ? fieldErrors.phone : ""}>
              <ThemedInput
                value={form.phone}
                onChange={(e) => update("phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                onBlur={() => touch("phone")}
                placeholder="9876543210"
                maxLength={10}
                hasError={!!(touched.phone && fieldErrors.phone)}
              />
            </Field>
          </div>
          </div>

          <div
            className="rounded-lg p-5 sm:p-6"
            style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)", boxShadow: "0 18px 42px rgba(0,0,0,0.18)" }}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold shrink-0" style={{ background: "rgba(237,0,237,0.12)", color: "#ED00ED", border: "1px solid rgba(237,0,237,0.22)" }}>2</span>
              <p className="text-sm font-semibold" style={{ color: "rgba(197,203,232,0.80)" }}>Account security</p>
            </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Create password"
              error={touched.password ? fieldErrors.password : ""}
              hint="Min. 8 chars, 1 uppercase, 1 number"
            >
              <div className="relative">
                <ThemedInput
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  onBlur={() => touch("password")}
                  minLength={8}
                  className="pr-11"
                  placeholder="Min. 8 characters"
                  hasError={!!(touched.password && fieldErrors.password)}
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
            </Field>
            <Field label="Confirm password" error={touched.confirmPassword ? fieldErrors.confirmPassword : ""}>
              <ThemedInput
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError("");
                  if (touched.confirmPassword) {
                    const err = validateField("confirmPassword", e.target.value, { password: form.password });
                    setFieldErrors((prev) => ({ ...prev, confirmPassword: err }));
                  }
                }}
                onBlur={() => touchConfirm(confirmPassword)}
                minLength={8}
                placeholder="Repeat password"
                hasError={!!(touched.confirmPassword && fieldErrors.confirmPassword)}
              />
            </Field>
          </div>
          </div>

          <div
            className="rounded-lg p-5 sm:p-6"
            style={{ background: "rgba(18,19,32,0.82)", border: "1px solid rgba(144,141,206,0.16)", boxShadow: "0 18px 42px rgba(0,0,0,0.18)" }}
          >
            <div className="flex items-center gap-3 mb-5">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold shrink-0" style={{ background: "rgba(237,0,237,0.12)", color: "#ED00ED", border: "1px solid rgba(237,0,237,0.22)" }}>3</span>
              <p className="text-sm font-semibold" style={{ color: "rgba(197,203,232,0.80)" }}>Documents and verification</p>
            </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={`Aadhaar number${aadhaarOcrStatus === "passed" ? " (auto-filled)" : ""}`}
              error={touched.aadhaarNumber ? fieldErrors.aadhaarNumber : ""}
              hint={
                aadhaarOcrStatus === "partial" || aadhaarOcrStatus === "needs_review"
                  ? "Enter your 12-digit Aadhaar number exactly as printed on the card"
                  : undefined
              }
            >
              <ThemedInput
                value={form.aadhaarNumber}
                onChange={(e) => update("aadhaarNumber", e.target.value.replace(/\D/g, ""))}
                onBlur={(e) => {
                  touch("aadhaarNumber", e.target.value.replace(/\D/g, ""));
                }}
                maxLength={12}
                placeholder="12-digit Aadhaar number"
                hasError={!!(touched.aadhaarNumber && fieldErrors.aadhaarNumber)}
              />
              {aadhaarExtracted?.number && form.aadhaarNumber && form.aadhaarNumber !== aadhaarExtracted.number && (
                <p className="mt-1 text-xs flex items-center gap-1" style={{ color: "rgba(252,211,77,0.90)" }}>
                  <AlertTriangle className="h-3 w-3" />
                  OCR read <span className="font-mono font-semibold">{formatAadhaarDisplay(aadhaarExtracted.number)}</span> — make sure it matches your card
                </p>
              )}
              {form.aadhaarNumber.length === 12 && (
                <p className="mt-1 text-xs" style={{ color: "rgba(134,239,172,0.70)" }}>
                  {formatAadhaarDisplay(form.aadhaarNumber)}
                </p>
              )}
            </Field>
            <Field
              label={`Date of birth${aadhaarExtracted?.dob ? " (auto-filled from Aadhaar)" : " (as on Aadhaar)"}`}
            >
              <ThemedInput
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => update("dateOfBirth", e.target.value)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </Field>
            <Field label="College">
              <ThemedSelect
                value={form.collegeId}
                onChange={(e) => update("collegeId", e.target.value)}
                disabled={isLoadingColleges || colleges.length === 0}
              >
                <option value="" disabled>
                  {isLoadingColleges ? "Loading colleges..." : colleges.length === 0 ? "No colleges available" : "Select college"}
                </option>
                {colleges.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </ThemedSelect>
            </Field>

            <DocumentUploadField
              label="Resume"
              file={resume}
              onChange={handleResumeChange}
              accept=".pdf"
              required
              status={resumeStatus === "passed" ? "passed" : resumeStatus === "failed" ? "failed" : "idle"}
              helperText={resumeError || "PDF document, max 10 MB"}
            />

            <div className="md:col-span-2">
              <div
                className="mb-3 flex items-start gap-2 rounded-xl px-4 py-3 text-sm"
                style={{
                  background: "rgba(245,158,11,0.08)",
                  border: "1px solid rgba(245,158,11,0.22)",
                  color: "rgba(252,211,77,0.90)",
                }}
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "#f59e0b" }} />
                <span>
                  Upload original, unmasked Aadhaar. Masked cards are not accepted.
                </span>
              </div>
              <DocumentUploadField
                label="Aadhaar card"
                file={aadhaarCard}
                onChange={handleAadhaarUpload}
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                required
                status={
                  aadhaarOcrStatus === "passed" ? "passed" :
                  aadhaarOcrStatus === "partial" ? "partial" :
                  aadhaarOcrStatus === "needs_review" ? "needs_review" :
                  aadhaarOcrStatus === "failed" ? "failed" :
                  aadhaarOcrStatus === "extracting" ? "extracting" : "idle"
                }
                helperText={
                  aadhaarOcrStatus === "extracting" ? "Reading your Aadhaar card..." :
                  aadhaarOcrStatus === "passed" ? "Aadhaar number extracted successfully." :
                  aadhaarOcrStatus === "partial" ? "Partial read — please complete your Aadhaar details below." :
                  aadhaarOcrStatus === "needs_review" ? "Could not read automatically. Use an unmasked Aadhaar card and enter details manually if needed." :
                  aadhaarOcrStatus === "failed" ? "File format not supported. Use JPG, PNG, WEBP, or PDF." :
                  "Upload a clear, unmasked front-side photo or PDF of your Aadhaar card (max 10 MB)."
                }
              />
            </div>
          </div>

          {aadhaarExtracted && (aadhaarOcrStatus === "passed" || aadhaarOcrStatus === "partial") && (
            <div
              className="mt-3 rounded-xl p-4 space-y-3"
              style={{ background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.18)" }}
            >
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(237,0,237,0.75)" }}>
                {aadhaarOcrStatus === "passed" ? "Extracted from Aadhaar" : "Partially extracted — complete missing fields"}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg p-3" style={{ background: "rgba(144,141,206,0.08)", border: "1px solid rgba(144,141,206,0.15)" }}>
                  <p className="text-xs mb-1" style={{ color: "rgba(197,203,232,0.62)" }}>Aadhaar Number</p>
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
                  <p className="text-xs mb-1" style={{ color: "rgba(197,203,232,0.62)" }}>Date of Birth</p>
                  {aadhaarExtracted.dob ? (
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>
                        {formatAadhaarDobDisplay(aadhaarExtracted.dob)}
                      </p>
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full shrink-0" style={{ background: "rgba(34,197,94,0.15)" }}><Check className="h-2.5 w-2.5" style={{ color: "#86efac" }} /></span>
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: "rgba(252,211,77,0.80)" }}>Enter below ↓</p>
                  )}
                </div>
                <div className="rounded-lg p-3" style={{ background: "rgba(144,141,206,0.08)", border: "1px solid rgba(144,141,206,0.15)" }}>
                  <p className="text-xs mb-1" style={{ color: "rgba(197,203,232,0.62)" }}>Name on Card</p>
                  {aadhaarExtracted.name ? (
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate" style={{ color: "#C5CBE8" }}>{aadhaarExtracted.name}</p>
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
              className="mt-4 flex items-start gap-2 rounded-xl p-3 text-sm"
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
                : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: aadhaarOcrStatus === "failed" ? "#ef4444" : "#f59e0b" }} />
              }
              <span>{aadhaarOcrMessage}</span>
            </div>
          )}

          {error && (
            <p className="mt-5 flex items-center gap-2 text-sm font-semibold" style={{ color: "#f87171" }}>
              <XCircle className="h-4 w-4" />
              {error}
            </p>
          )}
          {success && (
            <p className="mt-5 text-sm font-medium" style={{ color: "#86efac" }}>
              {success}
            </p>
          )}

          <div className="mt-5 flex items-center justify-between">
            <p className="text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>
              {!canSubmit && !success && (
              aadhaarOcrStatus === "idle"
                ? "Upload your Aadhaar card to continue."
                : !aadhaarNumValid
                ? "Enter your complete 12-digit Aadhaar number to continue."
                : resumeStatus !== "passed"
                ? "Upload your resume to continue."
                : form.password.length < 8
                ? "Set a password of at least 8 characters."
                : form.password !== confirmPassword
                ? "Confirm your password."
                : "Complete all required fields to register."
            )}
            </p>
            <Button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg text-white font-semibold transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: canSubmit
                  ? "linear-gradient(135deg, #ED00ED 0%, #908DCE 100%)"
                  : "rgba(144,141,206,0.20)",
                boxShadow: canSubmit ? "0 10px 24px rgba(237,0,237,0.20)" : "none",
              }}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating...
                </span>
              ) : "Create profile"}
            </Button>
          </div>
          </div>
        </form>
      </div>
    </RegisterPageShell>
  );
}

function RegisterPageShell({
  children,
  loadingMessage,
}: {
  children?: ReactNode;
  loadingMessage?: string;
}) {
  return (
    <main
      className="min-h-screen relative animate-fade-in"
      style={{ background: "#080810", color: "var(--foreground)" }}
    >
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(145deg, rgba(237,0,237,0.10) 0%, transparent 34%), linear-gradient(315deg, rgba(144,141,206,0.08) 0%, transparent 42%)",
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
        {children || (
          <div className="flex min-h-[70vh] items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin" style={{ color: "#908DCE" }} />
              <p className="text-sm" style={{ color: "rgba(197,203,232,0.60)" }}>{loadingMessage}</p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Field({
  label,
  children,
  error,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs flex items-center gap-1" style={{ color: "#f87171" }}>
          <AlertTriangle className="h-3 w-3 shrink-0" /> {error}
        </p>
      ) : hint ? (
        <p className="text-xs" style={{ color: "rgba(197,203,232,0.62)" }}>{hint}</p>
      ) : null}
    </div>
  );
}

function ThemedInput({
  className,
  hasError,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { hasError?: boolean }) {
  const [focused, setFocused] = useState(false);

  // Date inputs use the custom calendar picker instead of the native browser
  // date dialog. The onChange({ target: { value } }) contract is preserved.
  if (props.type === "date") {
    return (
      <DatePicker
        value={typeof props.value === "string" ? props.value : ""}
        onChange={(v) =>
          props.onChange?.({ target: { value: v, name: props.name } } as unknown as React.ChangeEvent<HTMLInputElement>)
        }
        min={typeof props.min === "string" ? props.min : undefined}
        max={typeof props.max === "string" ? props.max : undefined}
        disabled={props.disabled}
        id={props.id}
        name={props.name}
        aria-invalid={hasError}
        className={className}
      />
    );
  }

  const borderColor = hasError
    ? "rgba(239,68,68,0.60)"
    : focused
    ? "rgba(237,0,237,0.55)"
    : "rgba(144,141,206,0.20)";
  const shadow = hasError
    ? "0 0 0 3px rgba(239,68,68,0.12)"
    : focused
    ? "0 0 0 3px rgba(237,0,237,0.12), 0 0 12px rgba(237,0,237,0.08)"
    : "none";

  return (
    <Input
      {...props}
      onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
      className={className}
      style={{
        background: hasError ? "rgba(239,68,68,0.05)" : "rgba(144,141,206,0.07)",
        border: `1px solid ${borderColor}`,
        color: "#C5CBE8",
        boxShadow: shadow,
        outline: "none",
        transition: "border-color 0.2s ease, box-shadow 0.2s ease",
      }}
    />
  );
}

function ThemedSelect({
  className,
  children,
  hasError,
  value,
  onChange,
  onBlur,
  disabled,
  name,
}: React.SelectHTMLAttributes<HTMLSelectElement> & { hasError?: boolean }) {
  // Render the themed custom Select instead of the native <select>. The
  // existing <option> children are mapped to Select items and the
  // onChange({ target: { value } }) contract is preserved, so the call sites
  // that wire this up to form state need no changes.
  let placeholder: ReactNode = "Select…";
  const items: { value: string; label: ReactNode; disabled?: boolean }[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const p = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    const v = p.value == null ? "" : String(p.value);
    if (v === "") {
      if (p.children) placeholder = p.children;
      return;
    }
    items.push({ value: v, label: p.children, disabled: p.disabled });
  });

  const borderColor = hasError ? "rgba(239,68,68,0.60)" : "rgba(144,141,206,0.20)";
  const displayLabelFor = (selectedValue: unknown): ReactNode => {
    const selected = selectedValue == null ? "" : String(selectedValue);
    return items.find((it) => it.value === selected)?.label ?? placeholder;
  };

  return (
    <Select
      value={value == null ? "" : String(value)}
      onValueChange={(v) =>
        onChange?.({ target: { value: v, name } } as unknown as React.ChangeEvent<HTMLSelectElement>)
      }
      disabled={disabled}
    >
      <SelectTrigger
        aria-invalid={hasError || undefined}
        onBlur={onBlur ? (event) => onBlur(event as unknown as React.FocusEvent<HTMLSelectElement>) : undefined}
        className={`h-10 w-full rounded-md px-3 text-sm ${className ?? ""}`}
        style={{
          background: hasError ? "rgba(239,68,68,0.05)" : "rgba(144,141,206,0.07)",
          border: `1px solid ${borderColor}`,
          color: "#C5CBE8",
        }}
      >
        <SelectValue placeholder={placeholder}>{displayLabelFor}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {items.map((it) => (
          <SelectItem key={it.value} value={it.value} disabled={it.disabled}>
            {it.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

type UploadStatus = "idle" | "passed" | "partial" | "needs_review" | "failed" | "extracting";

function DocumentUploadField({
  label,
  file,
  onChange,
  required,
  accept,
  helperText,
  status,
}: {
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  required?: boolean;
  accept?: string;
  helperText?: string;
  status: UploadStatus;
}) {
  const borderStyle =
    status === "passed"
      ? { background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.30)" }
      : status === "partial" || status === "needs_review"
      ? { background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.30)" }
      : status === "failed"
      ? { background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.30)" }
      : { background: "rgba(144,141,206,0.07)", border: "1px solid rgba(144,141,206,0.20)" };

  const iconColor =
    status === "passed" ? "#22c55e" :
    status === "partial" || status === "needs_review" ? "#f59e0b" :
    status === "failed" ? "#ef4444" :
    "#908DCE";

  const helperColor =
    status === "passed" ? "rgba(134,239,172,0.80)" :
    status === "partial" || status === "needs_review" ? "rgba(252,211,77,0.80)" :
    status === "failed" ? "rgba(252,165,165,0.80)" :
    "rgba(197,203,232,0.40)";

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium" style={{ color: "#C5CBE8" }}>
        {label}
        {required && <span className="ml-1" style={{ color: "#ED00ED" }}>*</span>}
      </Label>
      <label
        className="flex h-10 w-full min-w-0 cursor-pointer items-center gap-2 rounded-md px-3 text-sm transition-all duration-200"
        style={{
          ...borderStyle,
          color: "rgba(197,203,232,0.60)",
        }}
        onMouseEnter={(e) => {
          if (status === "idle") {
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(237,0,237,0.40)";
          }
        }}
        onMouseLeave={(e) => {
          if (status === "idle") {
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(144,141,206,0.20)";
          }
        }}
      >
        {status === "extracting"
          ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: iconColor }} />
          : status === "passed"
          ? <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color: iconColor }} />
          : status === "partial" || status === "needs_review"
          ? <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: iconColor }} />
          : status === "failed"
          ? <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: iconColor }} />
          : <UploadCloud className="h-4 w-4 shrink-0" style={{ color: iconColor }} />}
        <span className="min-w-0 flex-1 truncate" title={file?.name || undefined}>
          {file?.name || "Choose file"}
        </span>
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onChange(e.target.files?.[0] || null)}
        />
      </label>
      {helperText && (
        <p className="text-xs" style={{ color: helperColor }}>
          {helperText}
        </p>
      )}
    </div>
  );
}

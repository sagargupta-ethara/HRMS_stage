"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { candidatesApi, campusApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Loader2, Upload, CheckCircle2 } from "lucide-react";

type OcrStatus = "idle" | "extracting" | "passed" | "partial" | "needs_review" | "failed";
type AadhaarOcrResult = {
  aadhaarNumber?: string | null;
  dateOfBirth?: string | null;
  cardHolderName?: string | null;
  ocrStatus?: string;
  message?: string;
};

const ALLOWED_AADHAAR_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_RESUME_TYPES = new Set(["application/pdf"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function errMsg(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Something went wrong";
}

function validateAadhaarFile(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const validExt = ext && ["pdf", "jpg", "jpeg", "png", "webp"].includes(ext);
  if (file.type && !ALLOWED_AADHAAR_TYPES.has(file.type) && !validExt) {
    return "Aadhaar card must be a PDF, JPG, PNG, or WEBP.";
  }
  if (!file.type && !validExt) return "Aadhaar card must be a PDF, JPG, PNG, or WEBP.";
  if (file.size > MAX_FILE_BYTES) return "Aadhaar file must be under 10 MB.";
  if (file.size === 0) return "Aadhaar file appears to be empty.";
  return null;
}

function validateResumeFile(file: File): string | null {
  if (!ALLOWED_RESUME_TYPES.has(file.type)) return "Resume must be a PDF document.";
  if (file.size > MAX_FILE_BYTES) return "Resume file must be under 10 MB.";
  if (file.size === 0) return "Resume file appears to be empty.";
  return null;
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

export default function CompleteRegistrationPage() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated, refreshUser } = useAuth();
  const [gender, setGender] = useState("");
  const [expType, setExpType] = useState("fresher");
  const [expYears, setExpYears] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [dob, setDob] = useState("");
  const [aadhaarCard, setAadhaarCard] = useState<File | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [aadhaarOcrStatus, setAadhaarOcrStatus] = useState<OcrStatus>("idle");
  const [aadhaarOcrMessage, setAadhaarOcrMessage] = useState("");
  const [aadhaarExtracted, setAadhaarExtracted] = useState<{
    number: string | null;
    dob: string | null;
    name: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push("/login");
  }, [isLoading, isAuthenticated, router]);

  const handleAadhaarUpload = async (file: File | null) => {
    setAadhaarCard(file);
    setAadhaarOcrMessage("");
    setAadhaarExtracted(null);
    if (!file) {
      setAadhaarOcrStatus("idle");
      return;
    }

    const fileError = validateAadhaarFile(file);
    if (fileError) {
      setAadhaarOcrStatus("failed");
      setAadhaarOcrMessage(fileError);
      return;
    }

    const payload = new FormData();
    payload.append("aadhaarCard", file);
    setAadhaarOcrStatus("extracting");

    let raw: AadhaarOcrResult | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        raw = await candidatesApi.extractAadhaar(payload) as AadhaarOcrResult;
        break;
      } catch (e) {
        const isNetwork = !((e as { response?: unknown })?.response);
        if (!isNetwork || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        payload.delete("aadhaarCard");
        payload.append("aadhaarCard", file);
      }
    }

    if (!raw) {
      setAadhaarOcrStatus("needs_review");
      setAadhaarOcrMessage(
        "Aadhaar OCR is taking longer than expected. The document has been saved; please review the fields below or upload an unmasked Aadhaar card again.",
      );
      return;
    }

    const extractedNum = raw.aadhaarNumber?.replace(/\D/g, "") || null;
    const extractedDob = normalizeAadhaarDob(raw.dateOfBirth);
    const extractedName = raw.cardHolderName || null;
    const status = raw.ocrStatus ?? "needs_review";
    setAadhaarExtracted({ number: extractedNum, dob: extractedDob, name: extractedName });

    if (extractedNum) setAadhaar(extractedNum);
    if (extractedDob) setDob(extractedDob);

    if (status === "extracted" && extractedNum) {
      setAadhaarOcrStatus("passed");
      setAadhaarOcrMessage(raw.message || "Aadhaar number extracted successfully.");
    } else if (status === "partial" || extractedNum || extractedDob || extractedName) {
      setAadhaarOcrStatus("partial");
      setAadhaarOcrMessage("Partial Aadhaar details were extracted. Please review and complete the missing fields below.");
    } else {
      setAadhaarOcrStatus("needs_review");
      setAadhaarOcrMessage("Aadhaar document uploaded. Please review the details below or upload an unmasked, clearer front-side image.");
    }
  };

  const handleResumeUpload = (file: File | null) => {
    if (!file) {
      setResume(null);
      return;
    }
    const fileError = validateResumeFile(file);
    if (fileError) {
      setResume(null);
      toast.error(fileError);
      return;
    }
    setResume(file);
  };

  const submit = async () => {
    if (!gender || !/^\d{12}$/.test(aadhaar.trim()) || !aadhaarCard || !resume) {
      toast.error("Fill all fields, a 12-digit Aadhaar, and upload both documents.");
      return;
    }
    if (expType === "experienced" && !expYears) {
      toast.error("Enter your years of experience.");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("gender", gender);
      fd.append("experienceType", expType);
      if (expYears) fd.append("experienceYears", expYears);
      fd.append("aadhaarNumber", aadhaar.trim());
      if (dob) fd.append("dateOfBirth", dob);
      fd.append("aadhaarCard", aadhaarCard);
      fd.append("resume", resume);
      await campusApi.complete(fd);
      // Full registration done → campusLock clears server-side; refresh the cached
      // profile so the full portal (sidebar + modules) unlocks.
      await refreshUser().catch(() => {});
      setDone(true);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (isLoading || !user) return <div className="flex min-h-screen items-center justify-center"><Loader2 className="size-6 animate-spin" /></div>;

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md text-center">
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <CheckCircle2 className="size-12 text-green-600" />
            <h2 className="text-lg font-semibold">Registration complete</h2>
            <p className="text-sm text-muted-foreground">Thanks! Your profile is now in the hiring process.</p>
            <Button onClick={() => router.push("/portal/dashboard")} className="mt-2">Go to my portal</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Complete your registration</CardTitle>
          <p className="text-sm text-muted-foreground">You cleared the assessment — finish your profile to continue.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-muted/40 p-3 text-sm">
            <p><span className="text-muted-foreground">Name:</span> {user.name}</p>
            <p><span className="text-muted-foreground">Email:</span> {user.email}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Gender</Label>
              <Select value={gender} onValueChange={(v) => setGender(v ?? "")}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                  <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Date of birth (optional)</Label>
              <DatePicker value={dob} onChange={setDob} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Experience</Label>
              <Select value={expType} onValueChange={(v) => setExpType(v ?? "fresher")}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fresher">Fresher</SelectItem>
                  <SelectItem value="experienced">Experienced</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {expType === "experienced" && (
              <div className="space-y-1">
                <Label>Years of experience</Label>
                <Input type="number" min={0} value={expYears} onChange={(e) => setExpYears(e.target.value)} />
              </div>
            )}
          </div>

          <div className="space-y-1">
            <Label>Aadhaar number</Label>
            <Input
              value={aadhaar}
              onChange={(e) => setAadhaar(e.target.value.replace(/\D/g, "").slice(0, 12))}
              placeholder="12-digit Aadhaar"
              maxLength={12}
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>
              Upload original, unmasked Aadhaar. Masked cards are not accepted.
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FileField label="Aadhaar card" file={aadhaarCard} onPick={handleAadhaarUpload} accept=".pdf,.jpg,.jpeg,.png,.webp" />
            <FileField label="Resume (PDF)" file={resume} onPick={handleResumeUpload} accept=".pdf" />
          </div>

          {aadhaarOcrStatus !== "idle" && (
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                {aadhaarOcrStatus === "extracting" ? (
                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                ) : aadhaarOcrStatus === "passed" ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
                ) : (
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
                )}
                <div className="space-y-1">
                  <p className="font-medium">
                    {aadhaarOcrStatus === "extracting" ? "Reading Aadhaar card..." : aadhaarOcrMessage}
                  </p>
                  {aadhaarExtracted && (aadhaarExtracted.number || aadhaarExtracted.dob || aadhaarExtracted.name) && (
                    <p className="text-xs text-muted-foreground">
                      {aadhaarExtracted.number ? `Number ending ${aadhaarExtracted.number.slice(-4)}` : "Number not detected"}
                      {aadhaarExtracted.dob ? ` · DOB ${aadhaarExtracted.dob}` : ""}
                      {aadhaarExtracted.name ? ` · ${aadhaarExtracted.name}` : ""}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          <Button className="w-full" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Submit registration
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function FileField({
  label, file, onPick, accept,
}: { label: string; file: File | null; onPick: (f: File | null) => void | Promise<void>; accept: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-input px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted/40">
        <Upload className="size-4 shrink-0" />
        <span className="truncate">{file ? file.name : "Choose file"}</span>
        <input type="file" accept={accept} className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </label>
    </div>
  );
}

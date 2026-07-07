"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn, hasAssignedRole } from "@/lib/utils";
import { ArrowLeft, Upload, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { usePositions, useColleges, useVendors } from "@/lib/queries";
import { candidatesApi, collegesApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

const sourceTypes = [
  { value: "direct_application", label: "Direct Application" },
  { value: "vendor", label: "Vendor Submission" },
  { value: "employee_referral", label: "Employee Referral" },
  { value: "internal_hiring", label: "Internal Hiring" },
  { value: "lateral_hiring", label: "Lateral Hiring" },
];

const ALLOWED_AADHAAR_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_AADHAAR_BYTES = 10 * 1024 * 1024;

function validateAadhaarFile(file: File): string | null {
  if (!ALLOWED_AADHAAR_TYPES.has(file.type))
    return "Only an Aadhaar card image or PDF is accepted (JPG, PNG, WEBP, PDF).";
  if (file.size > MAX_AADHAAR_BYTES) return "Aadhaar file must be under 10 MB.";
  if (file.size === 0) return "Aadhaar file appears to be empty.";
  return null;
}

type AadhaarOcrResult = {
  aadhaarNumber?: string | null;
  dateOfBirth?: string | null;
  cardHolderName?: string | null;
  ocrStatus?: string;
  message?: string;
};

// "idle"      → nothing uploaded yet
// "extracting"→ OCR in progress
// "passed"    → a valid 12-digit Aadhaar number was read; submission allowed
// "rejected"  → file isn't a readable Aadhaar; submission blocked
type AadhaarOcrStatus = "idle" | "extracting" | "passed" | "rejected";

export default function NewCandidatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromReferrer = searchParams.get("from") === "referrer";
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data: positionsData } = usePositions();
  const { data: vendorsData } = useVendors();
  const isReferrer = hasAssignedRole(user, ["employee_referrer", "employee"]) || fromReferrer;
  const isVendor = hasAssignedRole(user, ["vendor"]);
  const { data: collegesData } = useColleges({ enabled: !isVendor });
  const { data: publicCollegesData } = useQuery({
    queryKey: ["public-colleges"],
    queryFn: collegesApi.publicList,
    staleTime: 300_000,
    enabled: isVendor,
  });

  const positions: { id: string; title: string; department: string }[] =
    Array.isArray(positionsData) ? positionsData : positionsData?.data ?? [];
  const collegesSource = isVendor ? publicCollegesData : collegesData;
  const colleges: { id: string; name: string }[] =
    Array.isArray(collegesSource) ? collegesSource : collegesSource?.data ?? [];
  const vendors: { id: string; name: string }[] =
    Array.isArray(vendorsData) ? vendorsData : vendorsData?.data ?? [];
  const backHref = isReferrer ? "/dashboard/employee" : isVendor ? "/dashboard/vendor" : "/dashboard/candidates";

  const [formData, setFormData] = useState({
    positionId: "",
    fullName: "",
    personalEmail: "",
    phone: "",
    aadhaar: "",
    collegeId: "",
    sourceType: isVendor ? "vendor" : isReferrer ? "employee_referral" : "internal_hiring",
    vendorId: "",
    referrerEmail: isReferrer && user?.email ? user.email : "",
  });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [aadhaarFile, setAadhaarFile] = useState<File | null>(null);
  const [aadhaarOcrStatus, setAadhaarOcrStatus] = useState<AadhaarOcrStatus>("idle");
  const [aadhaarOcrMessage, setAadhaarOcrMessage] = useState("");
  const [aadhaarExtracted, setAadhaarExtracted] = useState<{
    number: string | null;
    dob: string | null;
    name: string | null;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateFound, setDuplicateFound] = useState(false);
  const [step, setStep] = useState(1);
  const effectiveSourceType = isVendor ? "vendor" : isReferrer ? "employee_referral" : formData.sourceType;
  const effectiveReferrerEmail = isReferrer && user?.email ? user.email : formData.referrerEmail;
  const selectedPosition = positions.find((position) => position.id === formData.positionId);
  const selectedCollege = colleges.find((college) => college.id === formData.collegeId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resumeFile) {
      toast.error("Resume is required.");
      return;
    }
    if (!aadhaarFile || aadhaarOcrStatus !== "passed") {
      toast.error("A valid Aadhaar card is required. Upload a clear image so it can be verified.");
      setStep(3);
      return;
    }

    setIsSubmitting(true);
    try {
      if (effectiveSourceType === "vendor" && !isVendor && !formData.vendorId) {
        toast.error("Please select the vendor for this submission.");
        setIsSubmitting(false);
        return;
      }
      if (formData.aadhaar && formData.aadhaar.length === 12) {
        const checkResult = await candidatesApi.checkAadhaar(formData.aadhaar);
        if (checkResult.exists) {
          setDuplicateFound(true);
          toast.error("Duplicate candidate detected! A candidate with this Aadhaar already exists.");
          setIsSubmitting(false);
          return;
        }
      }

      const payload: Record<string, unknown> = {
        fullName: formData.fullName,
        personalEmail: formData.personalEmail,
        phone: formData.phone,
        sourceType: effectiveSourceType,
        positionId: formData.positionId || undefined,
        collegeId: formData.collegeId || undefined,
      };
      if (formData.aadhaar.length === 12) {
        payload.aadhaarLast4 = formData.aadhaar.slice(-4);
        payload.aadhaarNumber = formData.aadhaar;
      }
      if (effectiveSourceType === "vendor" && formData.vendorId) {
        payload.vendorId = formData.vendorId;
      }
      if (effectiveSourceType === "employee_referral" && effectiveReferrerEmail) {
        payload.sourceId = effectiveReferrerEmail.trim().toLowerCase();
      }

      const candidate = await candidatesApi.create(payload);

      try {
        await candidatesApi.uploadResume(candidate.id, resumeFile);
      } catch {
        toast.warning("Candidate created but resume upload failed. You can re-upload from the candidate profile.");
      }

      if (aadhaarFile) {
        try {
          await candidatesApi.uploadAadhaarDoc(candidate.id, aadhaarFile);
        } catch { }
      }

      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["reports", "summary"] });

      toast.success(`Candidate ${formData.fullName} added and portal credentials emailed.`);
      if (isReferrer) {
        router.push("/dashboard/employee");
      } else if (isVendor) {
        router.push("/dashboard/vendor");
      } else {
        router.push(`/dashboard/candidates?tab=${effectiveSourceType}`);
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { detail?: string; message?: string } } })?.response?.data?.detail ||
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        "Failed to add candidate. Please try again.";
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("already")) {
        setDuplicateFound(true);
      }
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    if (duplicateFound) setDuplicateFound(false);
  };

  // Runs OCR on the uploaded Aadhaar. Only a clearly-read, 12-digit Aadhaar is
  // accepted — anything else (wrong document, blurry image, no number found) is
  // rejected with a clear message and blocks submission.
  const handleAadhaarUpload = async (file: File | null) => {
    setAadhaarFile(file);
    setAadhaarOcrMessage("");
    setAadhaarExtracted(null);
    if (duplicateFound) setDuplicateFound(false);
    if (!file) {
      setAadhaarOcrStatus("idle");
      updateField("aadhaar", "");
      return;
    }

    const fileErr = validateAadhaarFile(file);
    if (fileErr) {
      setAadhaarOcrStatus("rejected");
      setAadhaarOcrMessage(fileErr);
      return;
    }

    setAadhaarOcrStatus("extracting");
    const payload = new FormData();
    payload.append("aadhaarCard", file);

    // Retry a couple of times on transient network errors (socket hang-ups).
    let raw: AadhaarOcrResult | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        raw = (await candidatesApi.extractAadhaar(payload)) as AadhaarOcrResult;
        break;
      } catch (err: unknown) {
        const isNetwork = !(err as { response?: unknown })?.response;
        if (!isNetwork || attempt === 2) break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        payload.delete("aadhaarCard");
        payload.append("aadhaarCard", file);
      }
    }

    if (!raw) {
      setAadhaarOcrStatus("rejected");
      setAadhaarOcrMessage("Could not read the document. Please upload a clearer, unmasked image of the Aadhaar card.");
      return;
    }

    const extractedNum = raw.aadhaarNumber?.replace(/\D/g, "") || "";
    setAadhaarExtracted({
      number: extractedNum || null,
      dob: raw.dateOfBirth || null,
      name: raw.cardHolderName || null,
    });
    if (raw.ocrStatus === "extracted" && extractedNum.length === 12) {
      setAadhaarOcrStatus("passed");
      updateField("aadhaar", extractedNum);
      setAadhaarOcrMessage(raw.message || "Aadhaar verified — number extracted successfully.");
    } else {
      setAadhaarOcrStatus("rejected");
      updateField("aadhaar", "");
      setAadhaarOcrMessage(
        "No Aadhaar number could be read from this document. Please upload a clearer, well-lit image of a valid unmasked Aadhaar card."
      );
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={backHref}>
          <Button variant="ghost" size="icon" className="rounded-xl h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {isReferrer ? "Refer a Candidate" : isVendor ? "Submit Candidate" : "New Candidate Application"}
          </h1>
          <p className="text-muted-foreground">
            {isReferrer
              ? "Submit a referral to the hiring pipeline"
              : isVendor
                ? "Submit a candidate who will be automatically tagged to your vendor account"
                : "Register a new candidate into the hiring pipeline"}
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2">
        {[
          { num: 1, label: "Position & Source" },
          { num: 2, label: "Personal Info" },
          { num: 3, label: "Documents" },
        ].map((s, i) => (
          <div key={s.num} className="flex items-center gap-2 flex-1">
            <div className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shrink-0 transition-colors",
              step >= s.num ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
              {step > s.num ? <CheckCircle2 className="h-4 w-4" /> : s.num}
            </div>
            <span className={cn("text-xs font-medium hidden sm:block", step >= s.num ? "text-foreground" : "text-muted-foreground")}>
              {s.label}
            </span>
            {i < 2 && <div className={cn("flex-1 h-0.5 rounded-full mx-2", step > s.num ? "bg-primary" : "bg-muted")} />}
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        {/* Step 1: Position & Source */}
        {step === 1 && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Position & Source</CardTitle>
              <CardDescription>Select the position and candidate source</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Position *</Label>
                <Select value={formData.positionId} onValueChange={(v) => updateField("positionId", v ?? "")}>
                  <SelectTrigger className="rounded-xl h-11 w-full min-w-0">
                    <SelectValue className="min-w-0 truncate" placeholder="Select the position">
                      {(value) => {
                        if (!value) return "Select the position";
                        if (!selectedPosition) return String(value);
                        return selectedPosition.department
                          ? `${selectedPosition.title} · ${selectedPosition.department}`
                          : selectedPosition.title;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-full max-w-none">
                    {positions.map((p) => (
                      <SelectItem
                        key={p.id}
                        value={p.id}
                        label={p.department ? `${p.title} · ${p.department}` : p.title}
                      >
                        <span className="font-medium">{p.title}</span>
                        <span className="text-muted-foreground ml-2">— {p.department}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Source Type *</Label>
                <Select
                  value={effectiveSourceType}
                  onValueChange={(v) => updateField("sourceType", v ?? "direct_application")}
                  disabled={isReferrer || isVendor}
                >
                  <SelectTrigger className="rounded-xl h-11 w-full">
                    <SelectValue placeholder="Select source type">
                      {sourceTypes.find((s) => s.value === effectiveSourceType)?.label ?? "Select source type"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-full max-w-none">
                    {sourceTypes.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isVendor ? (
                  <p className="text-xs text-muted-foreground">
                    Source type is pre-set to Vendor Submission and will be linked to your vendor account automatically.
                  </p>
                ) : isReferrer ? (
                  <p className="text-xs text-muted-foreground">Source type is pre-set to Employee Referral.</p>
                ) : null}
              </div>

              {effectiveSourceType === "vendor" && !isVendor && (
                <div className="space-y-2 animate-slide-up">
                  <Label className="text-sm font-medium">Vendor *</Label>
                  <Select value={formData.vendorId} onValueChange={(v) => updateField("vendorId", v ?? "")}>
                    <SelectTrigger className="rounded-xl h-11 w-full">
                      <SelectValue placeholder="Select the vendor" />
                    </SelectTrigger>
                    <SelectContent className="w-full max-w-none">
                      {vendors.map((vendor) => (
                        <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {formData.sourceType === "employee_referral" && (
                <div className="space-y-2 animate-slide-up">
                  <Label className="text-sm font-medium">Referrer Email *</Label>
                  <Input
                    type="email"
                    placeholder="referrer@ethara.com"
                    value={formData.referrerEmail}
                    onChange={(e) => updateField("referrerEmail", e.target.value)}
                    className="rounded-xl h-11"
                    readOnly={isReferrer}
                    disabled={isReferrer}
                  />
                  {isReferrer && (
                    <p className="text-xs text-muted-foreground">Auto-filled from your account.</p>
                  )}
                </div>
              )}

              <div className="flex justify-end pt-2">
                <Button type="button" onClick={() => setStep(2)} disabled={!formData.positionId} className="rounded-xl">
                  Next Step →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Personal Info */}
        {step === 2 && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Personal Information</CardTitle>
              <CardDescription>Basic candidate details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Full Name *</Label>
                  <Input
                    placeholder="Enter full name"
                    value={formData.fullName}
                    onChange={(e) => updateField("fullName", e.target.value)}
                    className="rounded-xl h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Personal Email *</Label>
                  <Input
                    type="email"
                    placeholder="name@example.com"
                    value={formData.personalEmail}
                    onChange={(e) => updateField("personalEmail", e.target.value)}
                    className="rounded-xl h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Phone Number *</Label>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder="10-digit mobile number"
                    value={formData.phone}
                    onChange={(e) => updateField("phone", e.target.value.replace(/\D/g, "").slice(0, 10))}
                    className="rounded-xl h-11"
                    maxLength={10}
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Aadhaar Number</Label>
                  <Input
                    placeholder="Auto-filled from Aadhaar card"
                    value={formData.aadhaar ? formData.aadhaar.replace(/(\d{4})(?=\d)/g, "$1 ") : ""}
                    readOnly
                    className="rounded-xl h-11"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Verified by OCR from the Aadhaar card you upload in the Documents step. Stored securely (hashed).
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">College</Label>
                <Select value={formData.collegeId} onValueChange={(v) => updateField("collegeId", v ?? "")}>
                  <SelectTrigger className="rounded-xl h-11 w-full">
                    <SelectValue placeholder="Select college (optional)">
                      {(value) => {
                        if (!value) return "Select college (optional)";
                        if (!selectedCollege) return String(value);
                        return selectedCollege.name;
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="w-full max-w-none">
                    {colleges.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {duplicateFound && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 animate-scale-in">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-destructive">Duplicate Candidate Detected!</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        A candidate with this email or Aadhaar number already exists in the system.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-2">
                <Button type="button" variant="outline" onClick={() => setStep(1)} className="rounded-xl">← Back</Button>
                <Button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={!formData.fullName || !formData.personalEmail || !formData.phone}
                  className="rounded-xl"
                >
                  Next Step →
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Documents */}
        {step === 3 && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Document Upload</CardTitle>
              <CardDescription>Upload resume and Aadhaar card</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Resume Upload */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Resume / CV *</Label>
                <label className={cn(
                  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors",
                  resumeFile ? "border-success/50 bg-success/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
                )}>
                  <input type="file" className="hidden" accept=".pdf,.doc,.docx" onChange={(e) => setResumeFile(e.target.files?.[0] || null)} />
                  {resumeFile ? (
                    <div className="flex w-full max-w-md min-w-0 items-center justify-center gap-3">
                      <CheckCircle2 className="h-8 w-8 shrink-0 text-success" />
                      <div className="min-w-0 text-left">
                        <p className="truncate text-sm font-semibold" title={resumeFile.name}>{resumeFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(resumeFile.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm font-medium">Drop your resume here or click to browse</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF, DOC, DOCX • Max 10 MB</p>
                    </>
                  )}
                </label>
              </div>

              {/* Aadhaar Upload — required, OCR-verified */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Aadhaar Card *</Label>
                <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Upload original, unmasked Aadhaar. Masked cards are not accepted.
                  </span>
                </div>
                <label className={cn(
                  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 cursor-pointer transition-colors",
                  aadhaarOcrStatus === "passed" ? "border-success/50 bg-success/5"
                    : aadhaarOcrStatus === "rejected" ? "border-destructive/50 bg-destructive/5"
                    : "border-border hover:border-primary/50 hover:bg-muted/30"
                )}>
                  <input
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    disabled={aadhaarOcrStatus === "extracting"}
                    onChange={(e) => handleAadhaarUpload(e.target.files?.[0] || null)}
                  />
                  {aadhaarOcrStatus === "extracting" ? (
                    <div className="flex w-full max-w-md min-w-0 items-center justify-center gap-3">
                      <Loader2 className="h-8 w-8 shrink-0 animate-spin text-primary" />
                      <div className="min-w-0 text-left">
                        <p className="text-sm font-semibold">Reading Aadhaar card…</p>
                        <p className="text-xs text-muted-foreground">Verifying the document with OCR</p>
                      </div>
                    </div>
                  ) : aadhaarFile && aadhaarOcrStatus === "passed" ? (
                    <div className="flex w-full max-w-md min-w-0 items-center justify-center gap-3">
                      <CheckCircle2 className="h-8 w-8 shrink-0 text-success" />
                      <div className="min-w-0 text-left">
                        <p className="truncate text-sm font-semibold" title={aadhaarFile.name}>{aadhaarFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(aadhaarFile.size / 1024).toFixed(1)} KB • verified</p>
                      </div>
                    </div>
                  ) : aadhaarFile && aadhaarOcrStatus === "rejected" ? (
                    <div className="flex w-full max-w-md min-w-0 items-center justify-center gap-3">
                      <AlertCircle className="h-8 w-8 shrink-0 text-destructive" />
                      <div className="min-w-0 text-left">
                        <p className="truncate text-sm font-semibold" title={aadhaarFile.name}>{aadhaarFile.name}</p>
                        <p className="text-xs text-muted-foreground">Tap to upload a clearer image</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <FileText className="h-8 w-8 text-muted-foreground mb-2" />
                      <p className="text-sm font-medium">Upload Aadhaar card image or PDF</p>
                      <p className="text-xs text-muted-foreground mt-1">Unmasked PDF, JPG, PNG, WEBP • Max 10 MB</p>
                    </>
                  )}
                </label>
                {aadhaarOcrMessage && (
                  <p className={cn(
                    "text-xs",
                    aadhaarOcrStatus === "passed" ? "text-success"
                      : aadhaarOcrStatus === "rejected" ? "text-destructive"
                      : "text-muted-foreground"
                  )}>
                    {aadhaarOcrMessage}
                  </p>
                )}
                {aadhaarExtracted && aadhaarOcrStatus === "passed" && (
                  <div className="mt-2 rounded-xl border bg-muted/30 p-4 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Extracted from Aadhaar
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-lg border bg-background/60 p-3 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Aadhaar Number</p>
                        {aadhaarExtracted.number ? (
                          <p className="font-mono text-sm font-semibold truncate">
                            {aadhaarExtracted.number.replace(/(\d{4})(?=\d)/g, "$1 ")}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not detected</p>
                        )}
                      </div>
                      <div className="rounded-lg border bg-background/60 p-3 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Date of Birth</p>
                        {aadhaarExtracted.dob ? (
                          <p className="text-sm font-semibold truncate">
                            {new Date(aadhaarExtracted.dob).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not detected</p>
                        )}
                      </div>
                      <div className="rounded-lg border bg-background/60 p-3 min-w-0">
                        <p className="text-xs text-muted-foreground mb-1">Name on Card</p>
                        {aadhaarExtracted.name ? (
                          <p className="text-sm font-semibold truncate" title={aadhaarExtracted.name}>{aadhaarExtracted.name}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">Not detected</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              <div className="flex justify-between">
                <Button type="button" variant="outline" onClick={() => setStep(2)} className="rounded-xl">← Back</Button>
                <Button type="submit" disabled={isSubmitting || !resumeFile || aadhaarOcrStatus !== "passed"} className="rounded-xl min-w-32">
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting...
                    </div>
                  ) : "Submit Application"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </form>
    </div>
  );
}

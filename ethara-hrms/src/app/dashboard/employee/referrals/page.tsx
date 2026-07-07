"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, UploadCloud, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { employeesApi } from "@/lib/api";
import { useEmployeeDashboard } from "@/lib/queries";
import { cn, formatLabel, timeAgo } from "@/lib/utils";

const stageStyles: Record<string, string> = {
  new_application: "border-border text-muted-foreground",
  resume_screening_pending: "border-amber-500/25 text-amber-300",
  resume_shortlisted: "border-emerald-500/25 text-emerald-300",
  evaluation_passed: "border-emerald-500/25 text-emerald-300",
  onboarding_completed: "border-emerald-500/25 text-emerald-300",
  resume_rejected: "border-red-500/25 text-red-300",
  evaluation_failed: "border-red-500/25 text-red-300",
};

const RESUME_ACCEPT = ".pdf,.doc,.docx";
const RESUME_EXTENSIONS = [".pdf", ".doc", ".docx"];
const MAX_RESUME_SIZE_BYTES = 10 * 1024 * 1024;

export default function EmployeeReferralsPage() {
  const qc = useQueryClient();
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const { data: dashboard, isLoading, isError } = useEmployeeDashboard();

  const [form, setForm] = useState({
    fullName: "",
    personalEmail: "",
    phone: "",
    linkedinUrl: "",
    portfolioUrl: "",
    githubUrl: "",
  });
  const [phoneError, setPhoneError] = useState("");
  const [nameError, setNameError] = useState("");
  const [emailError, setEmailError] = useState("");
  const [linkedinError, setLinkedinError] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const PHONE_REGEX = /^[6-9]\d{9}$/;

  const clearResume = () => {
    setResumeFile(null);
    if (resumeInputRef.current) resumeInputRef.current.value = "";
  };

  const handleResumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      clearResume();
      setResumeError("Candidate resume is required.");
      return;
    }
    const extension = file.name.includes(".")
      ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
      : "";
    if (!RESUME_EXTENSIONS.includes(extension)) {
      clearResume();
      setResumeError("Upload a PDF, DOC, or DOCX resume.");
      return;
    }
    if (file.size > MAX_RESUME_SIZE_BYTES) {
      clearResume();
      setResumeError("Resume must be 10 MB or smaller.");
      return;
    }
    setResumeFile(file);
    setResumeError("");
  };

  const handleSubmit = async () => {
    let hasError = false;
    const selectedResume = resumeFile;

    if (!form.fullName.trim()) {
      setNameError("Candidate name is required.");
      hasError = true;
    } else {
      setNameError("");
    }

    if (!form.personalEmail.trim()) {
      setEmailError("Email is required.");
      hasError = true;
    } else {
      setEmailError("");
    }

    if (!form.phone.trim()) {
      setPhoneError("Enter a valid 10-digit mobile number");
      hasError = true;
    } else if (!PHONE_REGEX.test(form.phone)) {
      setPhoneError("Enter a valid 10-digit mobile number");
      hasError = true;
    } else {
      setPhoneError("");
    }

    if (!form.linkedinUrl.trim()) {
      setLinkedinError("LinkedIn profile is required.");
      hasError = true;
    } else {
      setLinkedinError("");
    }

    if (!selectedResume) {
      setResumeError("Candidate resume is required.");
      hasError = true;
    } else {
      setResumeError("");
    }

    if (hasError) {
      if (!form.fullName.trim() || !form.personalEmail.trim()) {
        toast.error("Candidate name, email, and phone are required.");
      } else if (!form.linkedinUrl.trim()) {
        toast.error("LinkedIn profile is required.");
      } else if (!selectedResume) {
        toast.error("Candidate resume is required.");
      } else {
        toast.error("Please enter a valid 10-digit mobile number.");
      }
      return;
    }
    if (!selectedResume) return;

    setSubmitting(true);
    try {
      await employeesApi.createReferral({
        fullName: form.fullName.trim(),
        personalEmail: form.personalEmail.trim().toLowerCase(),
        phone: form.phone.trim(),
        linkedinUrl: form.linkedinUrl.trim(),
        resume: selectedResume,
        portfolioUrl: form.portfolioUrl.trim() || null,
        githubUrl: form.githubUrl.trim() || null,
      });
      toast.success("Referral added to the Resume Database.");
      setForm({ fullName: "", personalEmail: "", phone: "", linkedinUrl: "", portfolioUrl: "", githubUrl: "" });
      clearResume();
      setNameError("");
      setEmailError("");
      setPhoneError("");
      setLinkedinError("");
      setResumeError("");
      await qc.invalidateQueries({ queryKey: ["employees", "me", "dashboard"] });
    } catch (err) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Could not create the referral.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-3 text-sm font-medium">Could not load referral data.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <Users className="h-6 w-6 text-primary" />
          Employee Referrals
        </h1>
        <p className="text-muted-foreground">
          Refer candidates, track their progress, and keep everything linked to your record.
        </p>
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Refer a Candidate</CardTitle>
          <CardDescription>
            Referrals go straight to the <strong>Resume Database</strong> for Admin and HR to review.
            No account is created for the candidate.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Candidate Name *
              </Label>
              <Input
                placeholder="Full name"
                className="rounded-2xl"
                value={form.fullName}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, fullName: e.target.value }));
                  if (e.target.value.trim()) setNameError("");
                }}
              />
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Personal Email *
              </Label>
              <Input
                type="email"
                placeholder="candidate@example.com"
                className="rounded-2xl"
                value={form.personalEmail}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, personalEmail: e.target.value }));
                  if (e.target.value.trim()) setEmailError("");
                }}
              />
              {emailError && (
                <p className="text-xs text-destructive">{emailError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Phone *
              </Label>
              <Input
                type="tel"
                inputMode="numeric"
                placeholder="10-digit mobile number"
                className="rounded-2xl"
                value={form.phone}
                maxLength={10}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setForm((prev) => ({ ...prev, phone: val }));
                  if (/^[6-9]\d{9}$/.test(val)) setPhoneError("");
                }}
              />
              {phoneError && (
                <p className="text-xs text-destructive">{phoneError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                LinkedIn Profile *
              </Label>
              <Input
                placeholder="LinkedIn profile URL"
                className="rounded-2xl"
                value={form.linkedinUrl}
                onChange={(e) => {
                  setForm((prev) => ({ ...prev, linkedinUrl: e.target.value }));
                  if (e.target.value.trim()) setLinkedinError("");
                }}
              />
              {linkedinError && (
                <p className="text-xs text-destructive">{linkedinError}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Portfolio URL
              </Label>
              <Input
                placeholder="Portfolio URL (optional)"
                className="rounded-2xl"
                value={form.portfolioUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, portfolioUrl: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                GitHub Profile
              </Label>
              <Input
                placeholder="GitHub profile (optional)"
                className="rounded-2xl"
                value={form.githubUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, githubUrl: e.target.value }))}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Candidate Resume *
            </Label>
            <label
              className={cn(
                "flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-5 text-center transition-colors",
                resumeFile
                  ? "border-emerald-500/35 bg-emerald-500/5"
                  : resumeError
                    ? "border-destructive/60 bg-destructive/5"
                    : "border-border bg-muted/15 hover:border-primary/50 hover:bg-muted/30",
              )}
            >
              {resumeFile ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : (
                <UploadCloud className="h-5 w-5 text-primary" />
              )}
              <span className="mt-2 max-w-full truncate text-sm font-medium" title={resumeFile?.name}>
                {resumeFile ? resumeFile.name : "Upload candidate resume"}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">PDF, DOC, DOCX up to 10 MB</span>
              <input
                ref={resumeInputRef}
                type="file"
                accept={RESUME_ACCEPT}
                className="sr-only"
                onChange={handleResumeChange}
              />
            </label>
            {resumeError && (
              <p className="text-xs text-destructive">{resumeError}</p>
            )}
          </div>
          <div className="flex items-center justify-end">
            <Button
              className="w-full rounded-full sm:w-auto"
              onClick={() => void handleSubmit()}
              disabled={submitting || !resumeFile}
            >
              {submitting
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…</>
                : <><ArrowRight className="mr-2 h-4 w-4" /> Refer Candidate</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">My Referred Candidates</CardTitle>
            <span className="text-xs text-muted-foreground">
              {dashboard.referralActivity.length} total
            </span>
          </div>
          <CardDescription>
            All candidates you have referred. Status updates live from the hiring pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {dashboard.referralActivity.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
              No referrals yet. Use the form above to refer your first candidate.
            </div>
          ) : (
            <div className="space-y-3">
              {dashboard.referralActivity.map((ref) => (
                <div
                  key={ref.candidateId}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-border/70 bg-muted/15 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="break-words text-sm font-semibold">{ref.candidateName}</p>
                    <p className="break-words text-xs text-muted-foreground">
                      {ref.positionTitle || "Role not assigned yet"}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">{ref.currentStatus}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    <Badge
                      variant="outline"
                      className={cn(
                        "capitalize text-[10px]",
                        stageStyles[ref.currentStage] ?? "border-border text-muted-foreground",
                      )}
                    >
                      {formatLabel(ref.currentStage)}
                    </Badge>
                    {ref.createdAt && (
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(ref.createdAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

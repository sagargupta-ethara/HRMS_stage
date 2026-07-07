"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, MailCheck, ShieldAlert, UserCircle2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resolveEmployeeGenderLabel } from "@/lib/employee-profile-options";
import { authApi, candidatesApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { formatDate } from "@/lib/utils";
import type { CandidatePortalOverview } from "@/types";


type ProfileFormState = {
  fullName: string;
  phone: string;
  gender: string;
  experienceType: string;
  currentCompany: string;
  currentCTC: string;
  expectedCTC: string;
  noticePeriod: string;
  dateOfBirth: string;
};


export default function CandidateProfilePage() {
  const { user, refreshUser } = useAuth();
  const [overview, setOverview] = useState<CandidatePortalOverview | null>(null);
  const [form, setForm] = useState<ProfileFormState>({
    fullName: "",
    phone: "",
    gender: "",
    experienceType: "",
    currentCompany: "",
    currentCTC: "",
    expectedCTC: "",
    noticePeriod: "",
    dateOfBirth: "",
  });
  const [verificationCode, setVerificationCode] = useState("");
  const [developmentCode, setDevelopmentCode] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  const applyProfileData = (data: CandidatePortalOverview) => {
    setOverview(data);
    const candidate = data.currentApplication;
    setForm({
      fullName: candidate?.fullName || "",
      phone: candidate?.phone || "",
      gender: candidate?.gender || "",
      experienceType: candidate?.experienceType || "",
      currentCompany: candidate?.currentCompany || "",
      currentCTC: candidate?.currentCTC ? String(candidate.currentCTC) : "",
      expectedCTC: candidate?.expectedCTC ? String(candidate.expectedCTC) : "",
      noticePeriod: candidate?.noticePeriod ? String(candidate.noticePeriod) : "",
      dateOfBirth: candidate?.dateOfBirth ? candidate.dateOfBirth.slice(0, 10) : "",
    });
  };

  const loadProfile = async () => {
    const data = await candidatesApi.me();
    applyProfileData(data);
  };

  useEffect(() => {
    let cancelled = false;

    const hydrateProfile = async () => {
      try {
        const data = await candidatesApi.me();
        if (cancelled) return;
        applyProfileData(data);
      } catch {
        if (!cancelled) {
          toast.error("Unable to load your candidate profile.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void hydrateProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (key: keyof ProfileFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await candidatesApi.updateMyProfile({
        fullName: form.fullName,
        phone: form.phone,
        gender: form.gender || null,
        experienceType: form.experienceType || null,
        currentCompany: form.currentCompany || null,
        currentCTC: form.currentCTC ? Number(form.currentCTC) : null,
        expectedCTC: form.expectedCTC ? Number(form.expectedCTC) : null,
        noticePeriod: form.noticePeriod ? Number(form.noticePeriod) : null,
        dateOfBirth: form.dateOfBirth || null,
      });
      await Promise.all([loadProfile(), refreshUser()]);
      toast.success("Profile updated successfully.");
    } catch {
      toast.error("Unable to update your profile right now.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendVerificationCode = async () => {
    setIsSendingCode(true);
    try {
      const response = await authApi.requestEmailVerification();
      setDevelopmentCode(response.developmentCode || "");
      toast.success(response.message || "Verification code sent.");
    } catch {
      toast.error("Unable to send verification code right now.");
    } finally {
      setIsSendingCode(false);
    }
  };

  const handleVerifyEmail = async () => {
    if (!verificationCode.trim()) {
      toast.error("Enter the verification code first.");
      return;
    }
    setIsVerifying(true);
    try {
      await authApi.confirmEmailVerification(verificationCode.trim());
      setVerificationCode("");
      setDevelopmentCode("");
      await Promise.all([loadProfile(), refreshUser()]);
      toast.success("Email verified successfully.");
    } catch {
      toast.error("Invalid or expired verification code.");
    } finally {
      setIsVerifying(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-center text-sm text-muted-foreground shadow-sm sm:p-8">
        <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />
        Loading your profile...
      </div>
    );
  }

  const currentApplication = overview?.currentApplication;

  return (
    <div className="w-full max-w-full overflow-x-hidden px-1 space-y-4 animate-fade-in sm:px-0">
      <div className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Candidate account</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">My profile</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Keep your contact details and application profile up to date.
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <Badge variant={overview?.emailVerified ? "success" : "warning"} className="max-w-full">
              {overview?.emailVerified ? "Email verified" : "Verification pending"}
            </Badge>
            {currentApplication?.candidateCode && (
              <Badge variant="outline" className="max-w-full rounded-full break-all">
                {currentApplication.candidateCode}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:gap-6">
        <Card className="overflow-hidden rounded-xl border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Personal details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 p-4 sm:p-6 md:grid-cols-2">
            <Field label="Full name">
              <Input value={form.fullName} onChange={(event) => updateField("fullName", event.target.value)} />
            </Field>
            <Field label="Phone">
              <Input value={form.phone} onChange={(event) => updateField("phone", event.target.value)} />
            </Field>
            <Field label="Gender">
              <Select value={form.gender} onValueChange={(value) => updateField("gender", value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select gender">
                    {(value) => resolveEmployeeGenderLabel(value as string) || "Select gender"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="non_binary">Non-binary</SelectItem>
                  <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Experience type">
              <Select value={form.experienceType} onValueChange={(value) => updateField("experienceType", value ?? "")}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select experience type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fresher">Fresher</SelectItem>
                  <SelectItem value="experienced">Experienced</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Current company">
              <Input value={form.currentCompany} onChange={(event) => updateField("currentCompany", event.target.value)} />
            </Field>
            <Field label="Date of birth">
              <DatePicker value={form.dateOfBirth} onChange={(value) => updateField("dateOfBirth", value)} max={new Date().toISOString().slice(0, 10)} />
            </Field>
            <Field label="Current CTC">
              <Input value={form.currentCTC} onChange={(event) => updateField("currentCTC", event.target.value)} />
            </Field>
            <Field label="Expected CTC">
              <Input value={form.expectedCTC} onChange={(event) => updateField("expectedCTC", event.target.value)} />
            </Field>
            <Field label="Notice period (days)">
              <Input value={form.noticePeriod} onChange={(event) => updateField("noticePeriod", event.target.value)} />
            </Field>
          </CardContent>
          <CardContent className="pt-0">
            <Button onClick={handleSave} disabled={isSaving} className="w-full rounded-full sm:w-auto">
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save profile"
              )}
            </Button>
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4 sm:space-y-6">
          <Card className="overflow-hidden rounded-xl border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Email verification</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
                {overview?.emailVerified ? (
                  <span className="inline-flex items-start gap-2 break-words sm:items-center">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    Verified on {overview.emailVerifiedAt ? formatDate(overview.emailVerifiedAt) : "this account"}
                  </span>
                ) : (
                  <span className="inline-flex items-start gap-2 break-words sm:items-center">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
                    Verify your email to enable secure account recovery and hiring updates.
                  </span>
                )}
              </div>

              {!overview?.emailVerified && (
                <>
                  <Button onClick={handleSendVerificationCode} disabled={isSendingCode} className="w-full rounded-full sm:w-auto">
                    {isSendingCode ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Sending code...
                      </>
                    ) : (
                      <>
                        <MailCheck className="h-4 w-4" />
                        Send verification code
                      </>
                    )}
                  </Button>
                  <Field label="One-time verification code">
                    <Input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} placeholder="Enter 6-digit OTP" />
                  </Field>
                  <Button variant="outline" onClick={handleVerifyEmail} disabled={isVerifying} className="w-full rounded-full sm:w-auto">
                    {isVerifying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Verify email"
                    )}
                  </Button>
                  {developmentCode && (
                    <div className="break-words rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                      Development OTP: <span className="font-semibold text-foreground">{developmentCode}</span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-xl border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Account snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SnapshotRow label="Portal email" value={user?.email || "-"} />
              <SnapshotRow label="Current role" value={currentApplication?.position?.title || "Not selected"} />
              <SnapshotRow label="Application stage" value={currentApplication ? currentApplication.currentStatus : "Profile only"} />
              <SnapshotRow label="Documents" value="Stored in your HRMS record" />
              <SnapshotRow label="Aadhaar" value={currentApplication?.aadhaarLast4 ? `Ending in ${currentApplication.aadhaarLast4}` : "Available after verification"} />
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-xl border-0 shadow-sm">
            <CardContent className="flex items-start gap-3 p-4 sm:p-5">
              <UserCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <p className="min-w-0 break-words text-sm text-muted-foreground">
                Resume, Aadhaar, and other files continue to live in your HRMS record after
                they are submitted through the required candidate forms.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      {children}
    </div>
  );
}


function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start gap-1 rounded-xl bg-muted/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words font-medium text-foreground sm:text-right">{value}</span>
    </div>
  );
}

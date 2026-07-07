"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/page-header";
import { candidateIdCardApi, candidatesApi, type CandidateIdCardFormRecord } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import type { CandidatePortalOverview, CandidateStage } from "@/types";

const ID_CARD_UNLOCKED_STAGES: CandidateStage[] = [
  "contract_signed",
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
  "onboarding_completed",
];

export default function PortalIdCardPage() {
  const [overview, setOverview] = useState<CandidatePortalOverview | null>(null);
  const [record, setRecord] = useState<CandidateIdCardFormRecord | null>(null);
  const [name, setName] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [emergencyNo, setEmergencyNo] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isCancelled = false;

    const load = async () => {
      try {
        const portal = await candidatesApi.me();
        if (isCancelled) return;
        setOverview(portal);

        const currentApplication = portal?.currentApplication;
        const unlocked = Boolean(
          currentApplication?.currentStage
          && ID_CARD_UNLOCKED_STAGES.includes(currentApplication.currentStage)
          && currentApplication.contract?.status === "signed"
        );

        if (!currentApplication) {
          setName("");
          return;
        }

        if (!unlocked) {
          setName(currentApplication.fullName ?? "");
          return;
        }

        const existing = await candidateIdCardApi.getMine();
        if (isCancelled) return;
        setRecord(existing);
        setName(existing.name ?? currentApplication.fullName ?? "");
        setEmployeeId(existing.employeeId ?? "");
        setBloodGroup(existing.bloodGroup ?? "");
        setEmergencyNo(existing.emergencyNo ?? "");
      } catch {
        if (!isCancelled) {
          setError("Unable to load your ID card details right now.");
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      isCancelled = true;
    };
  }, []);

  const currentApplication = overview?.currentApplication;
  const isUnlocked = useMemo(
    () =>
      Boolean(
        currentApplication?.currentStage
        && ID_CARD_UNLOCKED_STAGES.includes(currentApplication.currentStage)
        && currentApplication.contract?.status === "signed"
      ),
    [currentApplication]
  );
  const canSubmit = Boolean(isUnlocked && currentApplication?.etharaEmail);

  const handleSave = async () => {
    if (!canSubmit) return;
    if (!name.trim() || !bloodGroup.trim() || !emergencyNo.trim()) {
      toast.error("Please complete all ID card fields before saving.");
      return;
    }

    setSaving(true);
    try {
      const saved = await candidateIdCardApi.submitMine({
        name: name.trim(),
        employeeId: employeeId.trim(),
        bloodGroup: bloodGroup.trim(),
        emergencyNo: emergencyNo.trim(),
      });
      setRecord(saved);
      setName(saved.name ?? name.trim());
      setEmployeeId(saved.employeeId ?? employeeId.trim());
      setBloodGroup(saved.bloodGroup ?? bloodGroup.trim());
      setEmergencyNo(saved.emergencyNo ?? emergencyNo.trim());
      toast.success("ID card details saved.");
    } catch (submitError) {
      const apiError = submitError as { response?: { data?: { detail?: string } } };
      toast.error(apiError.response?.data?.detail || "Could not save the ID card details.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
        <CreditCard className="h-10 w-10 text-muted-foreground mx-auto" />
        <h2 className="text-lg font-semibold">Unable to load ID card details</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!currentApplication) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
        <CreditCard className="h-10 w-10 text-muted-foreground mx-auto" />
        <h2 className="text-lg font-semibold">No active candidate application</h2>
        <p className="text-sm text-muted-foreground">
          This module becomes available once you have an active application and the signed contract stage is completed.
        </p>
      </div>
    );
  }

  if (!isUnlocked) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader
          icon={CreditCard}
          title="ID Card Details"
          description="Fill the details that Admin, HR, and IT will use for your official ID card."
        />

        <Card className="border-0 shadow-sm">
          <CardContent className="py-12 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-muted/50">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <p className="text-lg font-semibold">Locked until contract signing is complete</p>
              <p className="text-sm text-muted-foreground">
                This module unlocks after your contract and NDA are signed.
                Your current stage is <strong>{currentApplication.currentStatus}</strong>.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        icon={CreditCard}
        title="ID Card Details"
        description="Submit the profile details that will be visible to Admin, HR, and IT for your official ID card."
      />

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">{currentApplication.fullName}</CardTitle>
              <CardDescription>
                {currentApplication.position?.title || "Candidate profile"}
              </CardDescription>
            </div>
            <Badge variant="outline" className="rounded-full">
              {currentApplication.currentStatus}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <InfoRow label="Personal Email" value={currentApplication.personalEmail} />
          <InfoRow label="Ethara Email" value={currentApplication.etharaEmail || "Pending creation"} />
          <InfoRow
            label="Contract Status"
            value={currentApplication.contract?.status === "signed" ? "Signed" : (currentApplication.contract?.status ?? "Pending")}
          />
          <InfoRow
            label="Last Submission"
            value={record?.submittedAt ? formatDateTime(record.submittedAt) : "Not submitted yet"}
          />
        </CardContent>
      </Card>

      {!currentApplication.etharaEmail ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="py-10 text-center space-y-3">
            <CreditCard className="h-10 w-10 text-muted-foreground mx-auto" />
            <h2 className="text-lg font-semibold">Waiting for your Ethara email ID</h2>
            <p className="text-sm text-muted-foreground">
              Your signed contract has unlocked this module. The form becomes editable as soon as your Ethara email ID is created.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Fill ID Card Form</CardTitle>
            <CardDescription>
              Enter the exact details you want printed on your ID card.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField label="Name">
                <Input
                  className="rounded-xl"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your full name"
                />
              </FormField>
              <FormField label="Employee ID">
                <Input
                  className="rounded-xl bg-muted/40"
                  value={employeeId || "Assigning…"}
                  readOnly
                  disabled
                />
                <p className="text-[11px] text-muted-foreground">
                  Auto-assigned by the system — you can&apos;t edit this.
                </p>
              </FormField>
              <FormField label="Blood Group">
                <Input
                  className="rounded-xl"
                  value={bloodGroup}
                  onChange={(event) => setBloodGroup(event.target.value)}
                  placeholder="e.g. O+, A-, AB+"
                />
              </FormField>
              <FormField label="Emergency No">
                <Input
                  className="rounded-xl"
                  value={emergencyNo}
                  onChange={(event) => setEmergencyNo(event.target.value)}
                  placeholder="Emergency contact number"
                />
              </FormField>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {record?.submittedAt
                  ? `Last submitted ${formatDateTime(record.submittedAt)}`
                  : "Once submitted, these details will be visible to Admin, HR, and IT."}
              </p>
              <Button className="rounded-full" onClick={() => void handleSave()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Save ID Card Details
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FormField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium break-all">{value}</p>
    </div>
  );
}

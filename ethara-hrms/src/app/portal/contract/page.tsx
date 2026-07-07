"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatDateTime, formatLabel } from "@/lib/utils";
import {
  CheckCircle2, Clock, Download, FileCheck, Lock, Loader2,
} from "lucide-react";
import { candidatesApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import type { CandidateContract } from "@/types";

const CONTRACT_VISIBLE_STAGES = [
  "selection_form_validated",
  "contract_sent", "contract_signed", "induction_completed",
  "it_email_created", "welcome_mail_sent", "statutory_forms_sent",
  "statutory_forms_submitted", "compliance_verified", "onboarding_completed",
];

const STATUS_LABELS: Record<string, string> = {
  draft: "Preparing",
  sent: "Awaiting Your Signature",
  viewed: "Opened",
  signed: "Signed",
  expired: "Expired",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  signed: "default",
  sent: "outline",
  viewed: "outline",
  draft: "secondary",
  expired: "destructive",
};

export default function PortalContractPage() {
  const [contract, setContract] = useState<CandidateContract | null>(null);
  const [stage, setStage] = useState<string>("");
  const [candidateName, setCandidateName] = useState<string>("");
  const [positionTitle, setPositionTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    candidatesApi.me()
      .then((data) => {
        const app = data?.currentApplication;
        if (app) {
          setStage(app.currentStage ?? "");
          setCandidateName(app.fullName ?? "");
          setPositionTitle(app.position?.title ?? "");
          if (app.contract) {
            setContract(app.contract as CandidateContract);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!CONTRACT_VISIBLE_STAGES.includes(stage)) {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
        <Lock className="h-10 w-10 text-muted-foreground mx-auto" />
        <h2 className="text-lg font-semibold">Contract Not Available Yet</h2>
        <p className="text-sm text-muted-foreground">
          Your offer letter will appear here once HR prepares and sends it.
          You&apos;ll receive an email with a signing link.
        </p>
      </div>
    );
  }

  if (!contract || contract.status === "draft") {
    return (
      <div className="max-w-2xl mx-auto py-12 text-center space-y-3">
        <FileCheck className="h-10 w-10 text-muted-foreground mx-auto" />
        <h2 className="text-lg font-semibold">Contract Being Prepared</h2>
        <p className="text-sm text-muted-foreground">
          HR is finalising your contract. You&apos;ll receive an email when it&apos;s ready to sign.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader
        icon={FileCheck}
        title="Offer Letter & Contract"
        description="Review and sign your employment contract"
      />

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Contract Status</CardTitle>
            <Badge variant={STATUS_VARIANT[contract.status] ?? "secondary"}>
              {STATUS_LABELS[contract.status] ?? formatLabel(contract.status)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {candidateName && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{candidateName}</span>
            </div>
          )}
          {positionTitle && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Position</span>
              <span className="font-medium">{positionTitle}</span>
            </div>
          )}
          {contract.ctc && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Annual CTC</span>
              <span className="font-medium">
                ₹{Number(contract.ctc).toLocaleString("en-IN")}
              </span>
            </div>
          )}
          {contract.joiningDate && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Joining Date</span>
              <span className="font-medium">{formatDateTime(contract.joiningDate)}</span>
            </div>
          )}
          {contract.sentAt && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Sent
              </span>
              <span>{formatDateTime(contract.sentAt)}</span>
            </div>
          )}
          {contract.signedAt && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-success" /> Signed
              </span>
              <span className="text-success font-medium">{formatDateTime(contract.signedAt)}</span>
            </div>
          )}
          {contract.expiresAt && contract.status === "sent" && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Signing Deadline</span>
              <span className="text-destructive">{formatDateTime(contract.expiresAt)}</span>
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap gap-2 pt-1">
            {contract.pdfUrl && (
              <a
                href={contract.pdfUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                <Download className="h-4 w-4" />
                Download Signed Copy
              </a>
            )}
          </div>

          {contract.status === "sent" && (
            <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
              We&apos;ve emailed you a secure signing link to <strong>review and sign</strong> your
              offer letter. Please check your inbox (and spam folder). The link is unique to you —
              do not share it. For your security, signing is done only through that emailed link.
            </div>
          )}
          {contract.status === "signed" && (
            <div className="rounded-xl bg-success/10 p-3 text-xs text-success">
              <CheckCircle2 className="inline h-3.5 w-3.5 mr-1" />
              Your contract has been signed. HR will be in touch with next steps.
              Download your signed copy using the button above.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

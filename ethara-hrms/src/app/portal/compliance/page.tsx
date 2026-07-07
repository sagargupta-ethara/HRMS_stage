"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Shield, CheckCircle2, Clock, FileSignature, Download, Lock, Loader2,
} from "lucide-react";
import { candidatesApi } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";

const COMPLIANCE_ALLOWED_STAGES = [
  "statutory_forms_sent", "statutory_forms_submitted",
  "compliance_verified", "onboarding_completed",
  "it_email_created", "welcome_mail_sent",
];

type ComplianceForm = {
  id: string;
  formType: string;
  formTitle: string;
  status: string;
  documensoId?: string | null;
  signedUrl?: string | null;
  pdfUrl?: string | null;
};

export default function PortalCompliancePage() {
  const [stage, setStage] = useState<string | null>(null);
  const [forms, setForms] = useState<ComplianceForm[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (sync: boolean) => {
    try {
      // Syncing first pulls the latest signing status from Documenso (and, when every form is
      // signed, completes onboarding + issues the employee credentials on the backend).
      const data = sync
        ? await candidatesApi.refreshMyCompliance().catch(() => candidatesApi.me())
        : await candidatesApi.me();
      setStage(data?.currentApplication?.currentStage ?? "");
      setForms((data?.currentApplication?.complianceForms ?? []) as ComplianceForm[]);
    } catch {
      setStage("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(true);
  }, []);

  const docForms = forms.filter((f) => f.documensoId);
  const signed = docForms.filter((f) => f.status === "signed").length;
  const canAccess = stage !== null && (COMPLIANCE_ALLOWED_STAGES.includes(stage) || docForms.length > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccess || docForms.length === 0) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
        <PageHeader icon={Shield} title="Compliance & Statutory Forms" />
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16 text-center text-muted-foreground">
          <Lock className="h-10 w-10 opacity-30 mb-3" />
          <p className="text-sm max-w-sm">
            Your statutory forms will appear here once your Ethara email/ID is created.
            You&apos;ll be able to e-sign them directly from this page.
          </p>
        </div>
      </div>
    );
  }

  const allSigned = signed === docForms.length;

  return (
    <div className="space-y-4 animate-fade-in">
      <PageHeader
        icon={Shield}
        title="Compliance & Statutory Forms"
        description="E-sign your statutory forms below. Once all are signed, your onboarding is complete and your employee login is emailed to you."
      />

      <div className="rounded-xl border border-border p-4 bg-card">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Signing progress</p>
          <Badge variant="outline" className="text-xs">{signed}/{docForms.length} Signed</Badge>
        </div>
        <div className="w-full bg-muted rounded-full h-2">
          <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${(signed / docForms.length) * 100}%` }} />
        </div>
        {allSigned && (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-success">
            <CheckCircle2 className="h-4 w-4" /> Onboarding completed — check your email for your employee login.
          </p>
        )}
      </div>

      <div className="space-y-3">
        {docForms.map((form) => {
          const isSigned = form.status === "signed";
          return (
            <div key={form.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  {isSigned
                    ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success mt-0.5" />
                    : <Clock className="h-5 w-5 shrink-0 text-warning mt-0.5" />}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight">{form.formTitle}</p>
                    <Badge variant="outline" className={cn(
                      "text-[10px] mt-1.5 border",
                      isSigned ? "text-success border-success/30" : "text-warning border-warning/30",
                    )}>
                      {isSigned ? "Signed" : "Awaiting signature"}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isSigned ? (
                    form.pdfUrl && (
                      <a href={form.pdfUrl} download target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted">
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                    )
                  ) : (
                    form.signedUrl && (
                      <a href={form.signedUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                        <FileSignature className="h-3.5 w-3.5" /> Open &amp; Sign
                      </a>
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

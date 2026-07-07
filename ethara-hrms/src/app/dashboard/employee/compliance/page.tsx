"use client";

import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Download, FileBadge2, FileSignature } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { employeesApi } from "@/lib/api";
import { useEmployeeDashboard } from "@/lib/queries";
import { cn, formatLabel, timeAgo } from "@/lib/utils";

const statusLabels: Record<string, string> = {
  pending: "Pending",
  sent: "Awaiting signature",
  signed: "Signed",
  verified: "Verified",
  rejected: "Rejected",
  needs_correction: "Needs correction",
};

const statusStyles: Record<string, string> = {
  signed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  verified: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  sent: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  pending: "border-border bg-muted/20 text-muted-foreground",
  needs_correction: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  rejected: "border-red-500/25 bg-red-500/10 text-red-300",
};

export default function EmployeeCompliancePage() {
  const qc = useQueryClient();
  const { data: dashboard, isLoading, isError } = useEmployeeDashboard();
  const syncedRef = useRef(false);

  const forms = dashboard?.complianceForms ?? [];
  const docForms = forms.filter((form) => form.documensoId);
  const signedCount = docForms.filter((form) => form.status === "signed" || form.status === "verified").length;

  useEffect(() => {
    if (syncedRef.current || docForms.length === 0) return;
    syncedRef.current = true;
    employeesApi
      .refreshMyComplianceEsign()
      .then(() => qc.invalidateQueries({ queryKey: ["employees", "me", "dashboard"] }))
      .catch(() => {});
  }, [docForms.length, qc]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 animate-fade-in">
        <Skeleton className="h-8 w-48" />
        {[1, 2, 3].map((item) => <Skeleton key={item} className="h-28 rounded-xl" />)}
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-3 text-sm font-medium">Could not load compliance data.</p>
      </div>
    );
  }

  const allSigned = docForms.length > 0 && signedCount === docForms.length;

  return (
    <div className="mx-auto max-w-3xl space-y-5 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <FileBadge2 className="h-6 w-6 text-primary" />
          Compliance &amp; Statutory Forms
        </h1>
        <p className="text-muted-foreground">
          E-sign your assigned Documenso forms below.
        </p>
      </div>

      {docForms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <FileBadge2 className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">No compliance forms yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your Documenso forms will appear here once HR assigns them.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Signing progress</p>
              <Badge variant="outline" className="text-xs">{signedCount}/{docForms.length} Signed</Badge>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary transition-all"
                style={{ width: `${(signedCount / docForms.length) * 100}%` }}
              />
            </div>
            {allSigned && (
              <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-green-600">
                <CheckCircle2 className="h-4 w-4" /> All assigned statutory forms are signed.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {docForms.map((form) => {
              const isSigned = form.status === "signed" || form.status === "verified";
              const dateLabel = isSigned && form.signedAt
                ? `Signed ${timeAgo(form.signedAt)}`
                : form.sentAt
                  ? `Sent ${timeAgo(form.sentAt)}`
                  : null;

              return (
                <div key={form.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      {isSigned ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                      ) : (
                        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight">{form.formTitle}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn("border text-[10px]", statusStyles[form.status] ?? statusStyles.pending)}
                          >
                            {statusLabels[form.status] ?? formatLabel(form.status)}
                          </Badge>
                          {dateLabel && <span className="text-xs text-muted-foreground">{dateLabel}</span>}
                        </div>
                        {form.remarks && (
                          <p className="mt-1 text-xs text-muted-foreground">{form.remarks}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {isSigned ? (
                        form.pdfUrl && (
                          <a
                            href={form.pdfUrl}
                            download
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </a>
                        )
                      ) : (
                        form.signedUrl && (
                          <a
                            href={form.signedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                          >
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
        </>
      )}
    </div>
  );
}

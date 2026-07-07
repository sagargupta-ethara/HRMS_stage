"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import {
  AlertCircle, Eye, FileText,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { employeesApi, type EmployeeDocumentRecord } from "@/lib/api";
import { useEmployeeDashboard } from "@/lib/queries";
import { cn, formatLabel, timeAgo } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  verified: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  uploaded: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  needs_correction: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  rejected: "border-red-500/25 bg-red-500/10 text-red-300",
  missing: "border-border bg-muted/20 text-muted-foreground",
};

export default function EmployeeDocumentsPage() {
  const { data: dashboard, isLoading, isError } = useEmployeeDashboard();

  const [preview, setPreview] = useState<{ title: string; url: string; mimeType?: string | null } | null>(null);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const hasProfile = Boolean(dashboard?.employee?.id);

  const handlePreview = async (doc: EmployeeDocumentRecord) => {
    if (!doc.previewEndpoint) {
      toast.error("This file cannot be previewed inline.");
      return;
    }
    try {
      const blob = await employeesApi.getBlobFromEndpoint(doc.previewEndpoint);
      if (preview?.url) URL.revokeObjectURL(preview.url);
      setPreview({ title: doc.label, url: URL.createObjectURL(blob), mimeType: doc.mimeType || blob.type });
    } catch {
      toast.error("Could not load document preview.");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 animate-fade-in">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 rounded-2xl" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-3 text-sm font-medium">Could not load document data.</p>
      </div>
    );
  }

  const { documents, documentCompletionStatus, missingDocuments } = dashboard;

  return (
    <div className="space-y-4 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <FileText className="h-6 w-6 text-primary" />
          Documents
        </h1>
        <p className="text-muted-foreground">
          Preview your employee documents.
        </p>
      </div>

      <div className="rounded-2xl border border-border p-4 bg-card">
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium">Document Completion</p>
          <Badge variant="outline" className="w-fit text-xs">
            {documentCompletionStatus.completed}/{documentCompletionStatus.total} uploaded
          </Badge>
        </div>
        <Progress value={documentCompletionStatus.percentage} className="h-2" />
        {missingDocuments.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Missing: {missingDocuments.join(", ")}
          </p>
        )}
      </div>

      {!hasProfile && (
        <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 flex items-start gap-2 text-sm text-amber-200">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          Document previews will be available once your employee record is fully linked by HR.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {documents.map((doc) => (
          <div
            key={doc.id}
            className="rounded-2xl border border-border/70 bg-card p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <p className="break-words text-sm font-semibold">{doc.label}</p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "capitalize text-[10px]",
                      statusStyles[doc.verificationStatus] ?? statusStyles.missing,
                    )}
                  >
                    {formatLabel(doc.verificationStatus)}
                  </Badge>
                  {doc.needsReview && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300"
                    >
                      Needs review
                    </Badge>
                  )}
                </div>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {doc.fileName || "No file uploaded yet"}
                </p>
                {doc.uploadedAt && (
                  <p className="text-xs text-muted-foreground">
                    Uploaded {timeAgo(doc.uploadedAt)}
                  </p>
                )}
                {doc.remarks && (
                  <p className="text-xs text-muted-foreground mt-1 italic">{doc.remarks}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-9 rounded-full text-xs sm:h-8"
                onClick={() => void handlePreview(doc)}
                disabled={doc.missing || !doc.canPreview || !doc.previewEndpoint}
              >
                <Eye className="mr-1.5 h-3 w-3" /> Preview
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open && preview?.url) {
            URL.revokeObjectURL(preview.url);
            setPreview(null);
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto border-border bg-background sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {preview?.title}
            </DialogTitle>
          </DialogHeader>
          {preview && (
            preview.mimeType?.startsWith("image/") ? (
              <img
                src={preview.url}
                alt={preview.title}
                className="max-h-[70vh] w-full rounded-xl object-contain"
              />
            ) : (
              <iframe
                src={preview.url}
                title={preview.title}
                className="h-[70vh] w-full rounded-xl border"
              />
            )
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import {
  AlertCircle, Download, Eye, FileCheck, FileText, Loader2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { employeesApi, type EmployeeContractRecord } from "@/lib/api";
import { useEmployeeDashboard } from "@/lib/queries";
import { cn, formatLabel, timeAgo } from "@/lib/utils";

const statusStyles: Record<string, string> = {
  completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  signed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  pending: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  sent: "border-blue-500/25 bg-blue-500/10 text-blue-300",
  viewed: "border-blue-500/25 bg-blue-500/10 text-blue-300",
  expired: "border-red-500/25 bg-red-500/10 text-red-300",
  draft: "border-border bg-muted/20 text-muted-foreground",
};

const contractStatusLabel = (status: string) => (
  status === "sent" || status === "viewed" ? "Unsigned" : formatLabel(status)
);

export default function EmployeeContractsPage() {
  const { data: dashboard, isLoading, isError } = useEmployeeDashboard();
  const [preview, setPreview] = useState<{ title: string; url: string; mimeType?: string | null } | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const handlePreview = async (contract: EmployeeContractRecord) => {
    if (!contract.previewEndpoint) {
      toast.error("This contract cannot be previewed inline yet.");
      return;
    }
    try {
      const blob = await employeesApi.getBlobFromEndpoint(contract.previewEndpoint);
      if (preview?.url) URL.revokeObjectURL(preview.url);
      setPreview({ title: contract.title, url: URL.createObjectURL(blob), mimeType: contract.mimeType || blob.type });
    } catch {
      toast.error("Could not load contract preview.");
    }
  };

  const handleDownload = async (contract: EmployeeContractRecord) => {
    if (!contract.downloadEndpoint || !contract.fileName) {
      toast.error("Nothing to download yet.");
      return;
    }
    setDownloadingId(contract.id);
    try {
      await employeesApi.downloadFromEndpoint(
        contract.downloadEndpoint,
        contract.fileName,
      );
    } catch {
      toast.error("Could not download the contract.");
    } finally {
      setDownloadingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto space-y-6 animate-fade-in max-w-3xl">
        <Skeleton className="h-8 w-48" />
        {[1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-2xl" />)}
      </div>
    );
  }

  if (isError || !dashboard) {
    return (
      <div className="mx-auto rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center max-w-3xl">
        <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
        <p className="mt-3 text-sm font-medium">Could not load contract data.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 overflow-x-hidden animate-fade-in">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight sm:text-2xl">
          <FileCheck className="h-6 w-6 text-primary" />
          Contracts
        </h1>
        <p className="text-muted-foreground">
          View, preview, and download your employment contracts.
        </p>
      </div>

      {dashboard.contracts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No contracts assigned yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your employment contracts will appear here once issued by HR.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {dashboard.contracts.map((contract) => (
            <div
              key={contract.id}
              className="rounded-2xl border border-border/70 bg-card p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-base font-semibold">{contract.title}</p>
                  {contract.remarks && (
                    <p className="mt-1 break-words text-sm text-muted-foreground">{contract.remarks}</p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
                    {contract.issuedAt && (
                      <span>Issued {timeAgo(contract.issuedAt)}</span>
                    )}
                    {contract.completedAt && (
                      <span>Completed {timeAgo(contract.completedAt)}</span>
                    )}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn("capitalize shrink-0", statusStyles[contract.status] ?? statusStyles.draft)}
                >
                  {contractStatusLabel(contract.status)}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full text-xs sm:h-8"
                  onClick={() => void handlePreview(contract)}
                  disabled={!contract.previewEndpoint}
                >
                  <Eye className="mr-1.5 h-3.5 w-3.5" /> Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-full text-xs sm:h-8"
                  onClick={() => void handleDownload(contract)}
                  disabled={!contract.downloadEndpoint || !contract.fileName || downloadingId === contract.id}
                >
                  {downloadingId === contract.id
                    ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Downloading…</>
                    : <><Download className="mr-1.5 h-3.5 w-3.5" /> Download</>}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

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
              <FileCheck className="h-4 w-4 text-primary" />
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

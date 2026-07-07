"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { cn, getInitials, timeAgo } from "@/lib/utils";
import {
  FileText, CheckCircle2, Clock, AlertTriangle, Search, Eye,
  Download, Trash2, Loader2, X,
} from "lucide-react";
import { toast } from "sonner";
import { useAllDocuments, useVerifyDocument } from "@/lib/queries";
import { documentsApi } from "@/lib/api";

type DocStatus = "verified" | "pending" | "rejected";

type DocRecord = {
  id: string;
  candidateId: string;
  type: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  mimeType: string | null;
  status: DocStatus;
  ocrStatus: string;
  extractedData?: Record<string, unknown> | null;
  createdAt: string;
  candidate?: { id: string; fullName: string } | null;
};

const statusConfig: Record<DocStatus, { label: string; icon: React.ElementType; color: string; badgeVariant: "outline" | "destructive" }> = {
  verified: { label: "Verified", icon: CheckCircle2, color: "text-success", badgeVariant: "outline" },
  pending: { label: "Pending Review", icon: Clock, color: "text-warning", badgeVariant: "outline" },
  rejected: { label: "Rejected", icon: AlertTriangle, color: "text-destructive", badgeVariant: "destructive" },
};

const statusFilterLabels: Record<string, string> = {
  all: "All Status",
  pending: "Pending",
  verified: "Verified",
  rejected: "Rejected",
};

const formatFileSize = (size: number | null) => {
  if (!size) return null;
  return size > 1024 * 1024
    ? `${(size / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(size / 1024)} KB`;
};

const getOcrLabel = (status: string) => (
  status === "extracted" ? "Extracted"
    : status === "needs_review" ? "Needs review"
    : status === "failed" ? "Failed" : "Pending"
);

const ocrTextClass = (status: string) =>
  status === "extracted" ? "text-success"
    : status === "needs_review" ? "text-warning"
    : "text-foreground";

export default function DocumentsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewDoc, setViewDoc] = useState<DocRecord | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const { data: rawData, isLoading, isError } = useAllDocuments({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
  });

  const docs: DocRecord[] = rawData?.data ?? rawData ?? [];

  const { mutate: verifyDoc, isPending: isVerifying } = useVerifyDocument();

  const stats = {
    total: docs.length,
    pending: docs.filter((d) => d.status === "pending").length,
    verified: docs.filter((d) => d.status === "verified").length,
    rejected: docs.filter((d) => d.status === "rejected").length,
  };

  const handleDownload = async (doc: DocRecord) => {
    setDownloading(doc.id);
    try {
      await documentsApi.download(doc.id, doc.fileName);
    } catch {
      toast.error("Download failed. The file may no longer be available.");
    } finally {
      setDownloading(null);
    }
  };

  const handleVerify = (doc: DocRecord) => {
    verifyDoc({ id: doc.id, status: "verified" });
  };

  const handleReject = (doc: DocRecord) => {
    verifyDoc({ id: doc.id, status: "rejected" });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Document Management
          </h1>
          <p className="text-muted-foreground">Review and verify candidate documents</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total", value: stats.total, color: "text-primary" },
          { label: "Pending", value: stats.pending, color: "text-warning" },
          { label: "Verified", value: stats.verified, color: "text-success" },
          { label: "Rejected", value: stats.rejected, color: "text-destructive" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border p-3 bg-card">
            <p className={cn("text-2xl font-bold", s.color)}>{isLoading ? "—" : s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by candidate name or document type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl h-10"
          />
          {search && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch("")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="h-10 w-full rounded-xl sm:w-44">
            <SelectValue>
              {(value) => statusFilterLabels[String(value ?? "all")] ?? "All Status"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="verified">Verified</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="space-y-3 p-3 sm:hidden">
            {isLoading ? (
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm">Loading documents...</p>
              </div>
            ) : isError ? (
              <div className="py-12 text-center text-sm text-destructive">
                Failed to load documents.
              </div>
            ) : docs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <FileText className="h-10 w-10 opacity-30" />
                <p className="font-medium">No documents found</p>
                <p className="text-xs">Try adjusting your filters</p>
              </div>
            ) : docs.map((doc) => {
              const statusKey = (doc.status || "pending") as DocStatus;
              const cfg = statusConfig[statusKey] ?? statusConfig.pending;
              const Icon = cfg.icon;
              const candidateName = doc.candidate?.fullName ?? "Unknown";
              const fileSizeLabel = formatFileSize(doc.fileSize);
              const ocrLabel = getOcrLabel(doc.ocrStatus);

              return (
                <div key={doc.id} className="rounded-2xl border border-border bg-card/80 p-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{doc.type}</p>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{doc.fileName}</p>
                        </div>
                        <Badge variant={cfg.badgeVariant} className="shrink-0 gap-1 text-[10px]">
                          <Icon className={cn("h-3 w-3", cfg.color)} />
                          {cfg.label}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                        <div className="min-w-0 rounded-xl bg-muted/25 px-2.5 py-2">
                          <p className="text-muted-foreground">Candidate</p>
                          {doc.candidateId ? (
                            <Link href={`/dashboard/candidates/${doc.candidateId}`} className="mt-0.5 block truncate font-medium text-foreground">
                              {candidateName}
                            </Link>
                          ) : (
                            <p className="mt-0.5 truncate font-medium text-foreground">{candidateName}</p>
                          )}
                        </div>
                        <div className="rounded-xl bg-muted/25 px-2.5 py-2">
                          <p className="text-muted-foreground">Uploaded</p>
                          <p className="mt-0.5 font-medium text-foreground">{timeAgo(doc.createdAt)}</p>
                        </div>
                        <div className="rounded-xl bg-muted/25 px-2.5 py-2">
                          <p className="text-muted-foreground">OCR</p>
                          <p className={cn("mt-0.5 font-medium", ocrTextClass(doc.ocrStatus))}>{ocrLabel}</p>
                        </div>
                        <div className="rounded-xl bg-muted/25 px-2.5 py-2">
                          <p className="text-muted-foreground">Size</p>
                          <p className="mt-0.5 font-medium text-foreground">{fileSizeLabel ?? "—"}</p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-xl text-xs"
                          onClick={() => setViewDoc(doc)}
                        >
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 rounded-xl text-xs"
                          onClick={() => handleDownload(doc)}
                          disabled={downloading === doc.id}
                        >
                          {downloading === doc.id
                            ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            : <Download className="mr-1.5 h-3.5 w-3.5" />}
                          Download
                        </Button>
                        {statusKey === "pending" && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-xl text-xs text-success hover:text-success"
                              onClick={() => handleVerify(doc)}
                              disabled={isVerifying}
                            >
                              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                              Verify
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-xl text-xs text-destructive hover:text-destructive"
                              onClick={() => handleReject(doc)}
                              disabled={isVerifying}
                            >
                              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Document", "Candidate", "Status", "OCR", "Uploaded", ""].map((h) => (
                    <th key={h} className={cn(
                      "py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                      h === "" ? "text-right" : "text-left"
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        <p className="text-sm">Loading documents...</p>
                      </div>
                    </td>
                  </tr>
                ) : isError ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-destructive text-sm">
                      Failed to load documents.
                    </td>
                  </tr>
                ) : docs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-muted-foreground">
                        <FileText className="h-10 w-10 opacity-30" />
                        <p className="font-medium">No documents found</p>
                        <p className="text-xs">Try adjusting your filters</p>
                      </div>
                    </td>
                  </tr>
                ) : docs.map((doc) => {
                  const statusKey = (doc.status || "pending") as DocStatus;
                  const cfg = statusConfig[statusKey] ?? statusConfig.pending;
                  const Icon = cfg.icon;
                  const candidateName = doc.candidate?.fullName ?? "Unknown";
                  const fileSizeLabel = formatFileSize(doc.fileSize);

                  return (
                    <tr key={doc.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors group">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <FileText className="h-4 w-4 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-sm">{doc.type}</p>
                            <p className="text-[10px] text-muted-foreground font-mono truncate max-w-[160px]">{doc.fileName}</p>
                            {fileSizeLabel && <p className="text-[10px] text-muted-foreground">{fileSizeLabel}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <Avatar className="h-7 w-7">
                            <AvatarFallback className="bg-primary/10 text-primary text-[10px]">{getInitials(candidateName)}</AvatarFallback>
                          </Avatar>
                          {doc.candidateId ? (
                            <Link href={`/dashboard/candidates/${doc.candidateId}`} className="text-sm hover:underline">
                              {candidateName}
                            </Link>
                          ) : (
                            <span className="text-sm">{candidateName}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={cfg.badgeVariant} className="text-xs gap-1">
                          <Icon className={cn("h-3 w-3", cfg.color)} /> {cfg.label}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className={cn(
                          "text-xs",
                          doc.ocrStatus === "needs_review" ? "text-warning" : doc.ocrStatus === "extracted" ? "text-success" : "text-muted-foreground"
                        )}>
                          {getOcrLabel(doc.ocrStatus)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-muted-foreground">{timeAgo(doc.createdAt)}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => setViewDoc(doc)}
                            title="View details"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7"
                            onClick={() => handleDownload(doc)}
                            disabled={downloading === doc.id}
                            title="Download"
                          >
                            {downloading === doc.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Download className="h-3.5 w-3.5" />}
                          </Button>
                          {statusKey === "pending" && (
                            <>
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-success hover:text-success"
                                onClick={() => handleVerify(doc)}
                                disabled={isVerifying}
                                title="Verify"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost" size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => handleReject(doc)}
                                disabled={isVerifying}
                                title="Reject"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!viewDoc} onOpenChange={(open) => { if (!open) setViewDoc(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              {viewDoc?.type}
            </DialogTitle>
            <DialogDescription>Document details and verification status</DialogDescription>
          </DialogHeader>
          {viewDoc && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">File Name</Label>
                  <p className="font-mono text-xs mt-0.5 break-all">{viewDoc.fileName}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Status</Label>
                  <div className="mt-0.5">
                    {(() => {
                      const key = (viewDoc.status || "pending") as DocStatus;
                      const cfg = statusConfig[key] ?? statusConfig.pending;
                      const Icon = cfg.icon;
                      return (
                        <Badge variant={cfg.badgeVariant} className="text-xs gap-1">
                          <Icon className={cn("h-3 w-3", cfg.color)} /> {cfg.label}
                        </Badge>
                      );
                    })()}
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Candidate</Label>
                  <p className="mt-0.5">{viewDoc.candidate?.fullName ?? "Unknown"}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Uploaded</Label>
                  <p className="mt-0.5 text-xs">{timeAgo(viewDoc.createdAt)}</p>
                </div>
                {viewDoc.fileSize && (
                  <div>
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">File Size</Label>
                    <p className="mt-0.5">
                      {viewDoc.fileSize > 1024 * 1024
                        ? `${(viewDoc.fileSize / 1024 / 1024).toFixed(1)} MB`
                        : `${Math.round(viewDoc.fileSize / 1024)} KB`}
                    </p>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">OCR Status</Label>
                  <p className={cn("mt-0.5", ocrTextClass(viewDoc.ocrStatus))}>
                    {getOcrLabel(viewDoc.ocrStatus)}
                  </p>
                </div>
              </div>
              {viewDoc.extractedData && Object.keys(viewDoc.extractedData).length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Extracted Data</Label>
                  <div className="mt-1 rounded-lg bg-muted/50 p-3 text-xs font-mono space-y-1">
                    {Object.entries(viewDoc.extractedData).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-muted-foreground capitalize">{k}:</span>
                        <span>{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2 flex-row justify-end">
            <Button
              variant="outline" size="sm" className="rounded-xl"
              onClick={() => viewDoc && handleDownload(viewDoc)}
              disabled={downloading === viewDoc?.id}
            >
              {downloading === viewDoc?.id
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                : <Download className="h-3.5 w-3.5 mr-1.5" />}
              Download
            </Button>
            {viewDoc?.status === "pending" && (
              <>
                <Button
                  size="sm" className="rounded-xl bg-success hover:bg-success/90 text-success-foreground"
                  onClick={() => { handleVerify(viewDoc); setViewDoc(null); }}
                  disabled={isVerifying}
                >
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Verify
                </Button>
                <Button
                  variant="destructive" size="sm" className="rounded-xl"
                  onClick={() => { handleReject(viewDoc); setViewDoc(null); }}
                  disabled={isVerifying}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Reject
                </Button>
              </>
            )}
            <DialogClose render={<Button variant="ghost" size="sm" className="rounded-xl" />}>
              Close
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

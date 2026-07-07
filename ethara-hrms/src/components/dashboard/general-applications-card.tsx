"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Inbox,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { careerApplicationsApi } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";
import type { CareerApplication } from "@/types";

const APPLICATIONS_PAGE_SIZE = 20;

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "Size unavailable";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSubmittedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Submitted date unavailable";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function canPreviewResume(mimeType: string): boolean {
  return mimeType === "application/pdf" || mimeType.startsWith("image/");
}

function ApplicationField({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "rgba(144,141,206,0.05)",
        border: "1px solid rgba(144,141,206,0.10)",
      }}
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] uppercase" style={{ color: "rgba(197,203,232,0.45)" }}>
        {icon}
        {label}
      </div>
      <div className="break-words text-sm font-medium" style={{ color: "#C5CBE8" }}>
        {value}
      </div>
    </div>
  );
}

export function GeneralApplicationsCard() {
  const [page, setPage] = useState(1);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [selectedApplication, setSelectedApplication] = useState<CareerApplication | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMimeType, setPreviewMimeType] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const pageOffset = (page - 1) * APPLICATIONS_PAGE_SIZE;
  const { data = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["career-applications", page],
    queryFn: () => careerApplicationsApi.list(APPLICATIONS_PAGE_SIZE + 1, pageOffset),
    staleTime: 30_000,
  });
  const applications = data.slice(0, APPLICATIONS_PAGE_SIZE);
  const hasNextPage = data.length > APPLICATIONS_PAGE_SIZE;
  const pageStart = applications.length > 0 ? pageOffset + 1 : 0;
  const pageEnd = pageOffset + applications.length;

  useEffect(() => {
    if (!selectedApplication || !selectedApplication.resumeUrl) {
      queueMicrotask(() => {
        setPreviewUrl(null);
        setPreviewMimeType("");
        setPreviewError(
          selectedApplication && !selectedApplication.resumeUrl
            ? "No resume was attached to this entry."
            : "",
        );
        setPreviewLoading(false);
      });
      return;
    }

    let active = true;
    let objectUrl: string | null = null;

    queueMicrotask(() => {
      if (!active) return;
      setPreviewUrl(null);
      setPreviewMimeType("");
      setPreviewError("");
      setPreviewLoading(true);
    });

    void careerApplicationsApi
      .getResumeBlob(selectedApplication.id)
      .then((blob) => {
        if (!active) return;
        const mimeType = (blob.type || selectedApplication.resumeMimeType || "").toLowerCase();
        setPreviewMimeType(mimeType);
        if (canPreviewResume(mimeType)) {
          objectUrl = URL.createObjectURL(blob);
          setPreviewUrl(objectUrl);
          return;
        }
        setPreviewError("Resume preview is available for PDF or image files. Download this resume to view it.");
      })
      .catch(() => {
        if (active) {
          setPreviewError("Could not load resume preview.");
        }
      })
      .finally(() => {
        if (active) {
          setPreviewLoading(false);
        }
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [selectedApplication]);

  const handleDownload = async (id: string, fileName: string) => {
    setDownloadingId(id);
    try {
      await careerApplicationsApi.downloadResume(id, fileName || "resume");
    } finally {
      setDownloadingId(null);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await careerApplicationsApi.exportCsv();
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div
        className="flex min-h-[calc(100dvh-11rem)] flex-col rounded-2xl p-5"
        style={{
          background: "rgba(25,24,44,0.85)",
          border: "1px solid rgba(144,141,206,0.18)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs gap-1.5"
              onClick={() => void handleExport()}
              disabled={exporting || isLoading}
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs gap-1.5"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : page === 1 && applications.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
            <Inbox className="mb-2 h-8 w-8 opacity-25" />
            <p className="text-sm" style={{ color: "rgba(197,203,232,0.45)" }}>
              No applications yet
            </p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col">
            <div className="space-y-2">
              {applications.map((application) => (
                <div
                  key={application.id}
                  className="flex flex-col gap-3 rounded-xl px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  style={{
                    background: "rgba(144,141,206,0.05)",
                    border: "1px solid rgba(144,141,206,0.10)",
                  }}
                >
                  <button
                    type="button"
                    className="group min-w-0 flex-1 text-left"
                    onClick={() => setSelectedApplication(application)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium group-hover:text-primary" style={{ color: "#C5CBE8" }}>
                        {application.fullName}
                      </span>
                      {application.referredByName && (
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] text-primary" style={{ border: "1px solid rgba(144,141,206,0.3)" }}>
                          Referred by {application.referredByName}
                        </span>
                      )}
                      <Eye className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-100" />
                    </span>
                    <span className="mt-1 block truncate text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>
                      {application.email} - {application.phone}
                    </span>
                    <span className="mt-1 block truncate text-[10px]" style={{ color: "rgba(197,203,232,0.35)" }}>
                      Submitted {timeAgo(application.createdAt)}
                    </span>
                  </button>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
                    {application.linkedinUrl && (
                      <a
                        href={application.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-xl px-3 text-xs text-primary hover:underline"
                        style={{
                          border: "1px solid rgba(144,141,206,0.18)",
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        LinkedIn
                      </a>
                    )}
                    {application.portfolioUrl && (
                      <a
                        href={application.portfolioUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-xl px-3 text-xs text-primary hover:underline"
                        style={{
                          border: "1px solid rgba(144,141,206,0.18)",
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Portfolio
                      </a>
                    )}
                    {application.githubUrl && (
                      <a
                        href={application.githubUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center justify-center gap-1 rounded-xl px-3 text-xs text-primary hover:underline"
                        style={{
                          border: "1px solid rgba(144,141,206,0.18)",
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        GitHub
                      </a>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full rounded-xl text-xs gap-1.5 sm:w-auto"
                      onClick={() => setSelectedApplication(application)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Open
                    </Button>
                    {application.resumeUrl && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full rounded-xl text-xs gap-1.5 sm:w-auto"
                        onClick={() => void handleDownload(application.id, application.resumeFileName ?? "resume")}
                        disabled={downloadingId === application.id}
                      >
                        {downloadingId === application.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        Resume
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-auto flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: "rgba(144,141,206,0.12)" }}>
              <p className="text-xs" style={{ color: "rgba(197,203,232,0.48)" }}>
                Page {page} · Showing {pageStart}-{pageEnd} · 20 resumes per page
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-xs"
                  disabled={page === 1 || isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg text-xs"
                  disabled={!hasNextPage || isFetching}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Next
                  <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <Sheet
        open={Boolean(selectedApplication)}
        onOpenChange={(open) => {
          if (!open) setSelectedApplication(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto border-l sm:max-w-3xl"
          style={{
            background: "rgba(12,12,24,0.98)",
            borderColor: "rgba(144,141,206,0.18)",
          }}
        >
          {selectedApplication && (
            <>
              <SheetHeader className="border-b px-5 py-5" style={{ borderColor: "rgba(144,141,206,0.14)" }}>
                <SheetTitle className="text-lg" style={{ color: "#C5CBE8" }}>
                  {selectedApplication.fullName}
                </SheetTitle>
                <SheetDescription>
                  Application profile and resume preview
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-5 pb-6">
                <div className="grid gap-3 sm:grid-cols-2">
                  <ApplicationField
                    icon={<UserRound className="h-3.5 w-3.5" />}
                    label="Name"
                    value={selectedApplication.fullName}
                  />
                  <ApplicationField
                    icon={<Mail className="h-3.5 w-3.5" />}
                    label="Email"
                    value={
                      <a href={`mailto:${selectedApplication.email}`} className="hover:text-primary hover:underline">
                        {selectedApplication.email}
                      </a>
                    }
                  />
                  <ApplicationField
                    icon={<Phone className="h-3.5 w-3.5" />}
                    label="Phone"
                    value={selectedApplication.phone}
                  />
                  <ApplicationField
                    icon={<CalendarDays className="h-3.5 w-3.5" />}
                    label="Submitted"
                    value={formatSubmittedDate(selectedApplication.createdAt)}
                  />
                </div>

                <div
                  className="rounded-xl p-4"
                  style={{
                    background: "rgba(144,141,206,0.05)",
                    border: "1px solid rgba(144,141,206,0.10)",
                  }}
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>
                        Resume
                      </p>
                      <p className="mt-1 text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>
                        {selectedApplication.resumeFileName
                          ? `${selectedApplication.resumeFileName} - ${formatFileSize(selectedApplication.resumeSize)}`
                          : selectedApplication.referredByName
                            ? "No resume attached (referral)"
                            : "No resume attached"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedApplication.linkedinUrl && (
                        <a
                          href={selectedApplication.linkedinUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-xl px-3 text-xs text-primary hover:underline"
                          style={{ border: "1px solid rgba(144,141,206,0.18)" }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          LinkedIn
                        </a>
                      )}
                      {selectedApplication.portfolioUrl && (
                        <a
                          href={selectedApplication.portfolioUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-xl px-3 text-xs text-primary hover:underline"
                          style={{ border: "1px solid rgba(144,141,206,0.18)" }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Portfolio
                        </a>
                      )}
                      {selectedApplication.githubUrl && (
                        <a
                          href={selectedApplication.githubUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-xl px-3 text-xs text-primary hover:underline"
                          style={{ border: "1px solid rgba(144,141,206,0.18)" }}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          GitHub
                        </a>
                      )}
                      {selectedApplication.resumeUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl text-xs gap-1.5"
                          onClick={() => void handleDownload(selectedApplication.id, selectedApplication.resumeFileName ?? "resume")}
                          disabled={downloadingId === selectedApplication.id}
                        >
                          {downloadingId === selectedApplication.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="h-3.5 w-3.5" />
                          )}
                          Download
                        </Button>
                      )}
                    </div>
                  </div>

                  <div
                    className="flex min-h-[420px] items-center justify-center overflow-hidden rounded-xl"
                    style={{
                      background: "rgba(8,8,16,0.65)",
                      border: "1px solid rgba(144,141,206,0.12)",
                    }}
                  >
                    {previewLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    ) : previewUrl && previewMimeType.startsWith("image/") ? (
                      <img
                        src={previewUrl}
                        alt={`Resume preview for ${selectedApplication.fullName}`}
                        className="max-h-[70vh] w-full object-contain"
                      />
                    ) : previewUrl ? (
                      <iframe
                        title={`Resume preview for ${selectedApplication.fullName}`}
                        src={previewUrl}
                        className="h-[70vh] w-full"
                      />
                    ) : (
                      <div className="max-w-md px-6 text-center">
                        <FileText className="mx-auto mb-3 h-8 w-8 opacity-30" />
                        <p className="text-sm" style={{ color: "rgba(197,203,232,0.62)" }}>
                          {previewError || "Resume preview is unavailable."}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

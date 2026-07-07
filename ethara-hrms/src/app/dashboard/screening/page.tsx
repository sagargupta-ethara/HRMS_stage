"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  PenLine,
  Search,
  XCircle,
  MoreHorizontal,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { documentsApi, screeningApi, type ScreeningRecord } from "@/lib/api";
import { queryKeys, useScreeningRecords } from "@/lib/queries";
import { cn, getInitials, timeAgo } from "@/lib/utils";

type TabKey = "all" | "pending" | "shortlisted" | "rejected";

const recommendationBadge: Record<string, string> = {
  shortlisted: "bg-success/10 text-success border-success/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  needs_review: "bg-warning/10 text-warning border-warning/20",
  pending: "bg-muted text-muted-foreground border-border",
};

function normalizeRecommendation(record: ScreeningRecord): "shortlisted" | "rejected" | "needs_review" | "pending" {
  const value = (record.recommendation || "").toLowerCase();
  if (value === "shortlisted") return "shortlisted";
  if (value === "rejected") return "rejected";
  if (value === "needs_review") return "needs_review";
  return "pending";
}

function scoreFor(record: ScreeningRecord) {
  return record.screeningScore ?? record.matchScore ?? 0;
}

function cleanScreeningSummary(summary: string): string {
  return summary.toLowerCase().includes("llm screening requires") ? "" : summary;
}

function screeningErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    code?: string;
    message?: string;
    response?: { data?: { detail?: string } };
  };
  if (candidate.response?.data?.detail) return candidate.response.data.detail;
  if (candidate.code === "ECONNABORTED") {
    return "Screening is taking longer than expected. Please try again in a moment.";
  }
  return candidate.message || fallback;
}

export default function ScreeningPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [search, setSearch] = useState("");
  const [actingIds, setActingIds] = useState<Set<string>>(new Set());
  const [overrideTarget, setOverrideTarget] = useState<ScreeningRecord | null>(null);
  const [mobileReportTarget, setMobileReportTarget] = useState<ScreeningRecord | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideRecommendation, setOverrideRecommendation] = useState<"shortlisted" | "rejected">("shortlisted");

  const { data, isLoading, isError, refetch, isFetching } = useScreeningRecords({
    search: search.trim() || undefined,
    page: 1,
    limit: 200,
  });

  const records = useMemo(() => data?.data ?? [], [data?.data]);

  const counts = useMemo(() => {
    const summary = { all: records.length, pending: 0, shortlisted: 0, rejected: 0 };
    for (const record of records) {
      const recommendation = normalizeRecommendation(record);
      if (recommendation === "shortlisted") summary.shortlisted += 1;
      else if (recommendation === "rejected") summary.rejected += 1;
      else summary.pending += 1;
    }
    return summary;
  }, [records]);

  const visible = useMemo(() => {
    if (activeTab === "all") return records;
    if (activeTab === "shortlisted") return records.filter((record) => normalizeRecommendation(record) === "shortlisted");
    if (activeTab === "rejected") return records.filter((record) => normalizeRecommendation(record) === "rejected");
    return records.filter((record) => !["shortlisted", "rejected"].includes(normalizeRecommendation(record)));
  }, [activeTab, records]);

  const invalidateScreening = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["screening"] }),
      qc.invalidateQueries({ queryKey: ["candidates"] }),
      qc.invalidateQueries({ queryKey: queryKeys.reportSummary() }),
    ]);
  };

  const withActing = async (candidateId: string, action: () => Promise<void>) => {
    setActingIds((prev) => new Set(prev).add(candidateId));
    try {
      await action();
    } finally {
      setActingIds((prev) => {
        const next = new Set(prev);
        next.delete(candidateId);
        return next;
      });
    }
  };

  const handleRescreen = async (record: ScreeningRecord) => {
    await withActing(record.candidateId, async () => {
      try {
        await screeningApi.run(record.candidateId);
        await invalidateScreening();
        toast.success(`Re-screened ${record.candidateName}.`);
      } catch (error: unknown) {
        toast.error(screeningErrorMessage(error, "Could not rerun screening."));
      }
    });
  };

  const handleOverride = async () => {
    if (!overrideTarget || !overrideReason.trim()) return;
    const candidateId = overrideTarget.candidateId;
    await withActing(candidateId, async () => {
      try {
        await screeningApi.override(candidateId, {
          recommendation: overrideRecommendation,
          reason: overrideReason.trim(),
        });
        await invalidateScreening();
        toast.success("Screening decision updated.");
        setOverrideTarget(null);
        setOverrideReason("");
      } catch (error: unknown) {
        const message =
          (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
          "Could not override this screening result.";
        toast.error(message);
      }
    });
  };

  const handleDecision = async (record: ScreeningRecord, recommendation: "shortlisted" | "rejected", reason: string) => {
    await withActing(record.candidateId, async () => {
      try {
        await screeningApi.override(record.candidateId, { recommendation, reason });
        await invalidateScreening();
        toast.success(
          recommendation === "shortlisted"
            ? `${record.candidateName} shortlisted.`
            : `${record.candidateName} rejected.`
        );
      } catch (error: unknown) {
        const message =
          (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
          "Could not update the screening decision.";
        toast.error(message);
      }
    });
  };

  const handleDownloadResume = async (record: ScreeningRecord) => {
    if (!record.resumeDocument?.id || !record.resumeDocument.fileName) {
      toast.error("Resume file is not available for download.");
      return;
    }
    await withActing(record.candidateId, async () => {
      try {
        await documentsApi.download(record.resumeDocument!.id, record.resumeDocument!.fileName);
      } catch {
        toast.error("Resume download failed.");
      }
    });
  };

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Brain className="h-6 w-6 text-primary" />
            Resume Screening
          </h1>
          <p className="text-sm text-muted-foreground">
            Live screening queue for candidate resumes across Admin and HR dashboards.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5 py-1 text-xs">
            <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
            Auto-screening active
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total", value: counts.all, icon: FileText, color: "text-primary", bg: "bg-primary/10" },
          { label: "Pending", value: counts.pending, icon: Clock, color: "text-warning", bg: "bg-warning/10" },
          { label: "Shortlisted", value: counts.shortlisted, icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
          { label: "Rejected", value: counts.rejected, icon: XCircle, color: "text-destructive", bg: "bg-destructive/10" },
        ].map((card) => (
          <div
            key={card.label}
            className="relative min-w-0 overflow-hidden rounded-2xl p-4"
            style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{card.label}</p>
                {isLoading ? (
                  <Skeleton className="mt-1 h-7 w-10" />
                ) : (
                  <p className="mt-1 truncate text-2xl font-bold tabular-nums text-foreground">{card.value}</p>
                )}
              </div>
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", card.bg)}>
                <card.icon className={cn("h-4 w-4", card.color)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <CardTitle className="text-base">Screening Queue</CardTitle>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 sm:w-72">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by candidate name, email, code..."
                  className="h-9 rounded-xl pl-9"
                />
              </div>
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
                <TabsList className="grid h-auto w-full grid-cols-2 gap-1 group-data-horizontal/tabs:h-auto sm:flex sm:h-9 sm:w-fit">
                  <TabsTrigger value="all" className="h-8 text-xs sm:h-auto">All ({counts.all})</TabsTrigger>
                  <TabsTrigger value="pending" className="h-8 text-xs sm:h-auto">Pending ({counts.pending})</TabsTrigger>
                  <TabsTrigger value="shortlisted" className="h-8 text-xs sm:h-auto">Shortlisted</TabsTrigger>
                  <TabsTrigger value="rejected" className="h-8 text-xs sm:h-auto">Rejected</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading && (
            <>
              {[1, 2, 3].map((row) => (
                <div key={row} className="rounded-xl border border-border p-4">
                  <div className="flex gap-4">
                    <Skeleton className="h-14 w-14 rounded-2xl shrink-0" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-64" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {isError && (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <p className="text-sm">Could not load screening records.</p>
            </div>
          )}

          {!isLoading && !isError && visible.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
              <Search className="h-8 w-8" />
              <p className="text-sm">No resumes match the current filters.</p>
              <p className="text-xs">New candidate submissions with resumes will appear here automatically.</p>
            </div>
          )}

          {visible.map((record) => {
            const recommendation = normalizeRecommendation(record);
            const score = scoreFor(record);
            const acting = actingIds.has(record.candidateId);
            const summary = cleanScreeningSummary(record.screeningSummary || record.parsedResumeDetails?.summary || "");
            const keyPoints = record.parsedResumeDetails?.keyPoints ?? [];
            const skills = record.parsedResumeDetails?.skills ?? [];

            return (
              <div
                key={record.candidateId}
                className="relative min-w-0 rounded-xl border border-border p-4 transition-colors hover:bg-muted/20"
              >
                <div className="absolute right-3 top-3 sm:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 rounded-full"
                          aria-label={`${record.candidateName} screening actions`}
                        />
                      }
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 rounded-xl">
                      <DropdownMenuItem className="gap-2 text-xs" disabled={acting} onClick={() => void handleRescreen(record)}>
                        {acting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        Re-screen
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 text-xs"
                        disabled={!record.resumeDocument?.id || acting}
                        onClick={() => void handleDownloadResume(record)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Download Resume
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="gap-2 text-xs"
                        disabled={acting || recommendation === "shortlisted"}
                        onClick={() => void handleDecision(record, "shortlisted", "Approved from resume screening queue.")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve / Shortlist
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        className="gap-2 text-xs"
                        disabled={acting || recommendation === "rejected"}
                        onClick={() => void handleDecision(record, "rejected", "Rejected from resume screening queue.")}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Reject
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="gap-2 text-xs"
                        onClick={() => {
                          setOverrideTarget(record);
                          setOverrideRecommendation(recommendation === "rejected" ? "shortlisted" : "rejected");
                          setOverrideReason("");
                        }}
                      >
                        <PenLine className="h-3.5 w-3.5" />
                        Override
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="gap-2 text-xs" onClick={() => setMobileReportTarget(record)}>
                        <FileText className="h-3.5 w-3.5" />
                        Full Report
                      </DropdownMenuItem>
                      <DropdownMenuItem className="gap-2 text-xs" onClick={() => router.push(`/dashboard/candidates/${record.candidateId}`)}>
                        <Eye className="h-3.5 w-3.5" />
                        View Details
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
                  <div
                    className={cn(
                      "flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2",
                      score >= 70
                        ? "border-success/30 bg-success/5"
                        : score >= 50
                        ? "border-warning/30 bg-warning/5"
                        : score > 0
                        ? "border-destructive/30 bg-destructive/5"
                        : "border-border bg-muted"
                    )}
                  >
                    {acting ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : score > 0 ? (
                      <span
                        className={cn(
                          "text-xl font-bold",
                          score >= 70 ? "text-success" : score >= 50 ? "text-warning" : "text-destructive"
                        )}
                      >
                        {Math.round(score)}
                      </span>
                    ) : (
                      <Clock className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-3 pr-10 sm:pr-0">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-[10px]">{getInitials(record.candidateName)}</AvatarFallback>
                          </Avatar>
                          <h3 className="min-w-0 break-words text-sm font-semibold sm:truncate">{record.candidateName}</h3>
                          <Badge className={cn("border text-[10px]", recommendationBadge[recommendation] || recommendationBadge.pending)}>
                            {recommendation === "shortlisted"
                              ? "Shortlisted"
                              : recommendation === "rejected"
                              ? "Rejected"
                              : recommendation === "needs_review"
                              ? "Needs Review"
                              : "Pending"}
                          </Badge>
                          {record.manualOverride && (
                            <Badge variant="outline" className="text-[10px]">
                              Manual Override
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {record.positionTitle || "Unassigned role"} · {record.currentStatus}
                        </p>
                        <p className="mt-1 break-all text-xs text-muted-foreground">
                          {record.personalEmail} · {record.candidateCode}
                        </p>
                      </div>
                      <div className="text-left text-[10px] text-muted-foreground lg:text-right">
                        <p>Resume uploaded {record.resumeUploadedAt || record.createdAt ? timeAgo(record.resumeUploadedAt || record.createdAt || "") : "recently"}</p>
                        {record.lastScreenedAt && <p>Last screened {timeAgo(record.lastScreenedAt)}</p>}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <Progress value={Math.max(Math.min(score, 100), 0)} className="h-2" />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Match {Math.round(record.matchScore ?? score)}%
                        </span>
                      </div>
                      {summary && <p className="break-words text-xs leading-relaxed text-muted-foreground">{summary}</p>}
                      {(skills.length > 0 || keyPoints.length > 0) && (
                        <div className="flex flex-wrap gap-1">
                          {[...skills, ...keyPoints].slice(0, 5).map((item) => (
                            <Badge key={item} variant="outline" className="text-[10px]">
                              {item}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="hidden min-w-0 grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 w-full rounded-lg text-xs sm:h-7 sm:w-auto"
                        disabled={acting}
                        onClick={() => void handleRescreen(record)}
                      >
                        {acting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RotateCcw className="mr-1 h-3 w-3" />}
                        Re-screen
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 w-full rounded-lg text-xs sm:h-7 sm:w-auto"
                        onClick={() => void handleDownloadResume(record)}
                        disabled={!record.resumeDocument?.id || acting}
                      >
                        <Download className="mr-1 h-3 w-3" />
                        Download Resume
                      </Button>

                      <Button
                        size="sm"
                        className="h-9 w-full rounded-lg text-xs sm:h-7 sm:w-auto"
                        disabled={acting || recommendation === "shortlisted"}
                        onClick={() => void handleDecision(record, "shortlisted", "Approved from resume screening queue.")}
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Approve / Shortlist
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9 w-full rounded-lg border-destructive/30 text-xs text-destructive hover:bg-destructive/10 sm:h-7 sm:w-auto"
                        disabled={acting || recommendation === "rejected"}
                        onClick={() => void handleDecision(record, "rejected", "Rejected from resume screening queue.")}
                      >
                        <XCircle className="mr-1 h-3 w-3" />
                        Reject
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-full rounded-lg text-xs text-muted-foreground sm:h-7 sm:w-auto"
                        onClick={() => {
                          setOverrideTarget(record);
                          setOverrideRecommendation(recommendation === "rejected" ? "shortlisted" : "rejected");
                          setOverrideReason("");
                        }}
                      >
                        <PenLine className="mr-1 h-3 w-3" />
                        Override
                      </Button>

                      <Dialog>
                        <DialogTrigger
                          render={<Button variant="ghost" size="sm" className="h-9 w-full rounded-lg text-xs text-muted-foreground sm:h-7 sm:w-auto" />}
                        >
                          <FileText className="mr-1 h-3 w-3" />
                          Full Report
                        </DialogTrigger>
                        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto rounded-2xl sm:w-full">
                          <DialogHeader>
                            <DialogTitle>Screening Details</DialogTitle>
                            <DialogDescription>
                              {record.candidateName} · {record.positionTitle || "Unassigned role"}
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-5">
                            <div className="grid gap-4 sm:grid-cols-[120px_1fr] sm:items-center">
                              <div className="text-center">
                                <p className="text-4xl font-bold text-primary">{Math.round(score)}</p>
                                <p className="text-xs text-muted-foreground">screening score</p>
                              </div>
                              <div className="space-y-2">
                                <Progress value={Math.max(Math.min(score, 100), 0)} className="h-2" />
                                {summary && <p className="break-words text-sm leading-relaxed">{summary}</p>}
                              </div>
                            </div>

                            {record.manualOverride && (
                              <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
                                <p className="text-xs font-semibold text-warning">Manual Override</p>
                                <p className="mt-1 text-sm">{record.manualOverride.reason}</p>
                              </div>
                            )}

                            {keyPoints.length > 0 && (
                              <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Parsed Resume Highlights
                                </p>
                                <div className="space-y-2">
                                  {keyPoints.map((point) => (
                                    <div key={point} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                                      {point}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {skills.length > 0 && (
                              <div>
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  Skills
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {skills.map((skill) => (
                                    <Badge key={skill} variant="outline" className="text-[11px]">
                                      {skill}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="grid gap-2 sm:flex sm:flex-wrap">
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full rounded-lg text-xs sm:w-auto"
                                onClick={() => void handleDownloadResume(record)}
                              >
                                <Download className="mr-1 h-3 w-3" />
                                Download Resume
                              </Button>
                              <Link href={`/dashboard/candidates/${record.candidateId}`}>
                                <Button variant="outline" size="sm" className="w-full rounded-lg text-xs sm:w-auto">
                                  <Eye className="mr-1 h-3 w-3" />
                                  View Candidate Profile
                                </Button>
                              </Link>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>

                      <Link href={`/dashboard/candidates/${record.candidateId}`}>
                        <Button variant="ghost" size="sm" className="h-9 w-full rounded-lg text-xs text-muted-foreground sm:h-7 sm:w-auto">
                          <Eye className="mr-1 h-3 w-3" />
                          View Details
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Dialog open={!!mobileReportTarget} onOpenChange={(open) => !open && setMobileReportTarget(null)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto rounded-2xl sm:w-full">
          {mobileReportTarget && (() => {
            const reportScore = scoreFor(mobileReportTarget);
            const reportSummary = cleanScreeningSummary(
              mobileReportTarget.screeningSummary || mobileReportTarget.parsedResumeDetails?.summary || "",
            );
            const reportKeyPoints = mobileReportTarget.parsedResumeDetails?.keyPoints ?? [];
            const reportSkills = mobileReportTarget.parsedResumeDetails?.skills ?? [];

            return (
              <>
                <DialogHeader>
                  <DialogTitle>Screening Details</DialogTitle>
                  <DialogDescription>
                    {mobileReportTarget.candidateName} · {mobileReportTarget.positionTitle || "Unassigned role"}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-[120px_1fr] sm:items-center">
                    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-center">
                      <p className="text-4xl font-bold text-primary">{Math.round(reportScore)}</p>
                      <p className="text-xs text-muted-foreground">screening score</p>
                    </div>
                    <div className="space-y-2">
                      <Progress value={Math.max(Math.min(reportScore, 100), 0)} className="h-2" />
                      {reportSummary && <p className="break-words text-sm leading-relaxed">{reportSummary}</p>}
                    </div>
                  </div>

                  {mobileReportTarget.manualOverride && (
                    <div className="rounded-xl border border-warning/30 bg-warning/5 p-3">
                      <p className="text-xs font-semibold text-warning">Manual Override</p>
                      <p className="mt-1 text-sm">{mobileReportTarget.manualOverride.reason}</p>
                    </div>
                  )}

                  {reportKeyPoints.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Parsed Resume Highlights
                      </p>
                      <div className="space-y-2">
                        {reportKeyPoints.map((point) => (
                          <div key={point} className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                            {point}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {reportSkills.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Skills
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {reportSkills.map((skill) => (
                          <Badge key={skill} variant="outline" className="text-[11px]">
                            {skill}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="grid gap-2 sm:flex sm:flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full rounded-lg text-xs sm:w-auto"
                      onClick={() => void handleDownloadResume(mobileReportTarget)}
                      disabled={!mobileReportTarget.resumeDocument?.id}
                    >
                      <Download className="mr-1 h-3 w-3" />
                      Download Resume
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full rounded-lg text-xs sm:w-auto"
                      onClick={() => router.push(`/dashboard/candidates/${mobileReportTarget.candidateId}`)}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      View Candidate Profile
                    </Button>
                  </div>
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={!!overrideTarget} onOpenChange={(open) => !open && setOverrideTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Override Screening Decision</DialogTitle>
            <DialogDescription>
              {overrideTarget?.candidateName} · {overrideTarget?.positionTitle || "Unassigned role"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                variant={overrideRecommendation === "shortlisted" ? "default" : "outline"}
                size="sm"
                className="flex-1 rounded-xl text-xs"
                onClick={() => setOverrideRecommendation("shortlisted")}
              >
                Shortlist
              </Button>
              <Button
                type="button"
                variant={overrideRecommendation === "rejected" ? "destructive" : "outline"}
                size="sm"
                className="flex-1 rounded-xl text-xs"
                onClick={() => setOverrideRecommendation("rejected")}
              >
                Reject
              </Button>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Reason for override</label>
              <Textarea
                rows={4}
                value={overrideReason}
                onChange={(event) => setOverrideReason(event.target.value)}
                placeholder="Explain why you are overriding the current screening recommendation..."
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" size="sm" className="rounded-xl text-xs" />}>
              Cancel
            </DialogClose>
            <Button
              size="sm"
              className="rounded-xl text-xs"
              disabled={!overrideReason.trim() || actingIds.has(overrideTarget?.candidateId || "")}
              onClick={() => void handleOverride()}
            >
              {actingIds.has(overrideTarget?.candidateId || "") ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Saving…
                </>
              ) : (
                "Apply Override"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { assessmentPlatformApi, campusApi, type ApAttemptSummary } from "@/lib/api";
import {
  useApAssessments, useCloneApAssessment, usePublishApAssessment, useDeleteApAssessment,
} from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ApStatusBadge } from "@/components/assessment-platform/question-types";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Users, BarChart3, Copy, Archive, Send, FileQuestion, Code2 } from "lucide-react";
import { CodeImportDialog } from "@/components/assessment-platform/code-import-dialog";
import { hasAssignedRole } from "@/lib/utils";

type PerformanceRow = ApAttemptSummary & {
  assessmentTitle: string;
};

function formatScore(row: ApAttemptSummary): string {
  if (row.totalScore == null || row.maxScore == null) return "-";
  return `${row.totalScore}/${row.maxScore}`;
}

function formatSubmittedAt(value?: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
  });
}

export default function AssessmentPlatformListPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("assessments");
  const [performanceRows, setPerformanceRows] = useState<PerformanceRow[]>([]);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [performanceError, setPerformanceError] = useState("");
  const { data, isLoading } = useApAssessments({
    search: activeTab === "assessments" ? search || undefined : undefined,
    status: activeTab === "assessments" && status !== "all" ? status : undefined,
    limit: activeTab === "performance" ? 500 : 100,
  });
  const clone = useCloneApAssessment();
  const publish = usePublishApAssessment();
  const remove = useDeleteApAssessment();
  const [codeOpen, setCodeOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; title: string } | null>(null);

  const { user } = useAuth();
  const isAdmin = hasAssignedRole(user, ["admin", "super_admin", "leadership"]);
  const [campusEnabled, setCampusEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (isAdmin) campusApi.config().then((c) => setCampusEnabled(c.enabled)).catch(() => setCampusEnabled(false));
  }, [isAdmin]);
  const toggleCampus = async (next: boolean) => {
    setCampusEnabled(next);
    try { await campusApi.setConfig(next); toast.success(`Campus drive ${next ? "enabled" : "disabled"}.`); }
    catch { setCampusEnabled(!next); toast.error("Could not update campus drive."); }
  };

  const rows = useMemo(() => data?.data ?? [], [data?.data]);
  const reportTargets = useMemo(
    () => rows.map((assessment) => ({ id: assessment.id, title: assessment.title })),
    [rows],
  );
  const performanceSummary = useMemo(() => {
    const scored = performanceRows.filter((row) => row.percentage != null);
    const average = scored.length
      ? Math.round(scored.reduce((sum, row) => sum + (row.percentage ?? 0), 0) / scored.length)
      : null;
    return {
      attempts: performanceRows.length,
      average,
      pass: performanceRows.filter((row) => row.resultStatus === "pass").length,
      fail: performanceRows.filter((row) => row.resultStatus === "fail").length,
      pending: performanceRows.filter((row) => !row.resultStatus || row.resultStatus === "pending").length,
      released: performanceRows.filter((row) => row.resultReleased).length,
    };
  }, [performanceRows]);

  useEffect(() => {
    if (activeTab !== "performance") return;
    let cancelled = false;
    const loadPerformance = async () => {
      if (reportTargets.length === 0) {
        setPerformanceRows([]);
        setPerformanceError("");
        setPerformanceLoading(false);
        return;
      }
      setPerformanceLoading(true);
      setPerformanceError("");
      try {
        const chunks = await Promise.all(
          reportTargets.map(async (assessment) => {
            const result = await assessmentPlatformApi.results(assessment.id, { limit: 500 });
            return result.data.map((attempt) => ({
              ...attempt,
              assessmentTitle: assessment.title,
            }));
          }),
        );
        if (!cancelled) {
          setPerformanceRows(
            chunks
              .flat()
              .sort((a, b) => {
                const aTime = a.submittedAt ? Date.parse(a.submittedAt) : 0;
                const bTime = b.submittedAt ? Date.parse(b.submittedAt) : 0;
                return bTime - aTime;
              }),
          );
        }
      } catch {
        if (!cancelled) setPerformanceError("Unable to load the performance report.");
      } finally {
        if (!cancelled) setPerformanceLoading(false);
      }
    };
    void loadPerformance();
    return () => {
      cancelled = true;
    };
  }, [activeTab, reportTargets]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Assessment Platform</h1>
          <p className="text-sm text-muted-foreground">Build tests, invite candidates by email, and review results.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard/assessment-platform/question-bank">
            <Button variant="outline"><FileQuestion className="size-4" /> Question Bank</Button>
          </Link>
          <Button variant="outline" onClick={() => setCodeOpen(true)}><Code2 className="size-4" /> Create from code</Button>
          <Button onClick={() => router.push("/dashboard/assessment-platform/new")}>
            <Plus className="size-4" /> New assessment
          </Button>
        </div>
      </div>

      <CodeImportDialog open={codeOpen} onOpenChange={setCodeOpen} onCreated={(id) => router.push(`/dashboard/assessment-platform/${id}/edit`)} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="assessments"><FileQuestion className="size-4" /> Assessment Library</TabsTrigger>
          <TabsTrigger value="performance"><BarChart3 className="size-4" /> Performance Report</TabsTrigger>
        </TabsList>

        <TabsContent value="assessments" className="space-y-5">
          {isAdmin && (
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox checked={!!campusEnabled} disabled={campusEnabled === null} onCheckedChange={(c) => toggleCampus(!!c)} />
                    Campus drive registration
                  </label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    When on, students can self-register the light way at <code className="rounded bg-muted px-1">/candidate/campus-register</code> (tagged Direct hire · campus), take an assessment you push, and complete full registration only after passing.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search assessments…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={status} onValueChange={(v) => setStatus(v ?? "all")}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="space-y-2 p-4">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : rows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                  <FileQuestion className="size-8" />
                  <p>No assessments yet. Create your first one.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-center">Questions</TableHead>
                      <TableHead className="text-center">Assigned</TableHead>
                      <TableHead className="text-center">Marks</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <Link href={`/dashboard/assessment-platform/${a.id}/edit`} className="font-medium hover:underline">
                            {a.title}
                          </Link>
                        </TableCell>
                        <TableCell><ApStatusBadge status={a.status} /></TableCell>
                        <TableCell className="text-center">{a.questionCount}</TableCell>
                        <TableCell className="text-center">{a.assignmentCount ?? 0}</TableCell>
                        <TableCell className="text-center">{a.totalMarks}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" title="Edit" onClick={() => router.push(`/dashboard/assessment-platform/${a.id}/edit`)}>
                              <Pencil className="size-4" />
                            </Button>
                            {a.status === "draft" && (
                              <Button variant="ghost" size="icon" title="Publish" onClick={() => publish.mutate(a.id)}>
                                <Send className="size-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" title="Assign / Invite" disabled={a.status !== "published"}
                              onClick={() => router.push(`/dashboard/assessment-platform/${a.id}/assignments`)}>
                              <Users className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Results" onClick={() => router.push(`/dashboard/assessment-platform/${a.id}/results`)}>
                              <BarChart3 className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Clone" onClick={() => clone.mutate(a.id)}>
                              <Copy className="size-4" />
                            </Button>
                            <Button variant="ghost" size="icon" title="Archive"
                              onClick={() => setArchiveTarget({ id: a.id, title: a.title })}>
                              <Archive className="size-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            {[
              { label: "Attempts", value: performanceSummary.attempts },
              { label: "Average Score", value: performanceSummary.average == null ? "-" : `${performanceSummary.average}%` },
              { label: "Passed", value: performanceSummary.pass },
              { label: "Failed", value: performanceSummary.fail },
              { label: "Pending", value: performanceSummary.pending },
              { label: "Released", value: performanceSummary.released },
            ].map((item) => (
              <Card key={item.label}>
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase text-muted-foreground">{item.label}</p>
                  <p className="mt-2 text-2xl font-semibold">{item.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="p-0">
              {performanceLoading || isLoading ? (
                <div className="space-y-2 p-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
              ) : performanceError ? (
                <div className="py-16 text-center text-sm text-destructive">{performanceError}</div>
              ) : performanceRows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
                  <BarChart3 className="size-8" />
                  <p>No assessment scores or reports are available yet.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead>Assessment</TableHead>
                      <TableHead className="text-center">Score</TableHead>
                      <TableHead className="text-center">%</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead className="text-right">Report</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {performanceRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <p className="font-medium">{row.name ?? row.email ?? "Candidate"}</p>
                          <p className="text-xs text-muted-foreground">{row.email}</p>
                        </TableCell>
                        <TableCell>{row.assessmentTitle}</TableCell>
                        <TableCell className="text-center">{formatScore(row)}</TableCell>
                        <TableCell className="text-center">{row.percentage == null ? "-" : `${row.percentage}%`}</TableCell>
                        <TableCell><ApStatusBadge status={row.resultStatus ?? row.status} /></TableCell>
                        <TableCell>{formatSubmittedAt(row.submittedAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/dashboard/assessment-platform/${row.assessmentId}/results/${row.id}`)}
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archive assessment?"
        description={archiveTarget ? `Archive "${archiveTarget.title}"?` : undefined}
        confirmLabel="Archive"
        destructive
        loading={remove.isPending}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        onConfirm={() => {
          if (!archiveTarget) return;
          remove.mutate(archiveTarget.id, { onSettled: () => setArchiveTarget(null) });
        }}
      />
    </div>
  );
}

"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart2,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Download,
  Loader2,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { employeesApi, pmsApi } from "@/lib/api";
import type {
  PmsEmployeePerformanceReport,
  PmsEvaluationRecord,
  PmsScores,
} from "@/lib/api";
import { cn, getInitials, timeAgo } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  MeetingScheduler,
  PMS_METRICS,
  PmsEvaluationFormCard,
  PmsSubmittedRecordCard,
  formatScore,
  normalizedRatingValue,
  ratingLabel,
} from "@/components/employee-evaluation/pms-panel";

function formatPlainLabel(value: string | null | undefined) {
  if (!value) return "—";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type CandidateRow = {
  id: string;
  employeeCode?: string;
  name: string;
  designation?: string | null;
};

type PmsTab = "pms-scores" | "performance-report";

function EmployeePerformanceReportPanel({
  selectedEmployee,
  report,
  loading,
}: {
  selectedEmployee: CandidateRow | null;
  report: PmsEmployeePerformanceReport | null | undefined;
  loading: boolean;
}) {
  if (!selectedEmployee) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-20 text-center text-muted-foreground">
          <BarChart2 className="h-10 w-10 opacity-20" />
          <p className="text-sm">
            Select an employee to view the performance report
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const pmsRecords = report?.pmsRecords ?? [];
  const candidateRecords = report?.candidateRecords ?? [];
  const evaluationRows = candidateRecords
    .flatMap((candidate) =>
      candidate.evaluations.map((evaluation) => ({ ...evaluation, candidate })),
    )
    .sort(
      (left, right) =>
        new Date(right.completedAt ?? 0).getTime() -
        new Date(left.completedAt ?? 0).getTime(),
    );
  const latestPms = pmsRecords[0] ?? null;
  const latestEvaluation = evaluationRows[0] ?? null;
  const primaryCandidate = candidateRecords[0] ?? null;
  const piCompleted = evaluationRows.filter((evaluation) => evaluation.completedAt).length;
  const piTotal = Math.max(
    primaryCandidate?.evaluations.length ?? 0,
    evaluationRows.length,
    piCompleted,
  );
  const finalDecision = latestPms?.overallRating
    ? ratingLabel(latestPms.overallRating)
    : latestEvaluation?.recommendation
      ? formatPlainLabel(latestEvaluation.recommendation)
      : "In Progress";
  const finalDecisionClass =
    /selected|pass|above/i.test(finalDecision)
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
      : /reject|fail|needs/i.test(finalDecision)
        ? "border-red-500/30 bg-red-500/10 text-red-500"
        : "border-amber-500/30 bg-amber-500/10 text-amber-500";
  const latestActivity =
    latestPms?.submittedAt ??
    latestEvaluation?.completedAt ??
    null;
  const feedbackItems = [
    latestPms?.remarks ? { label: "PMS Feedback", value: latestPms.remarks } : null,
    latestEvaluation?.notes ? { label: "Candidate Evaluation Notes", value: latestEvaluation.notes } : null,
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="min-w-0 space-y-5">
      <p className="text-sm text-muted-foreground">
        Consolidated employee performance view with PI rounds, PMS score, and final recommendation.
      </p>

      <Card className="overflow-hidden border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {[
                    "Employee",
                    "Position",
                    "PI Rounds",
                    "PMS Score",
                    "Final Decision",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="whitespace-nowrap px-5 py-4 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border/60">
                  <td className="px-5 py-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                          {getInitials(selectedEmployee.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">{selectedEmployee.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {selectedEmployee.employeeCode ?? report?.employee.employeeCode ?? "—"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-5">
                    <p className="font-medium text-foreground">
                      {selectedEmployee.designation ?? report?.employee.designation ?? primaryCandidate?.positionTitle ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {report?.employee.department ?? "Department not recorded"}
                    </p>
                  </td>
                  <td className="px-5 py-5">
                    <div className="whitespace-nowrap">
                      <span className="font-semibold text-foreground">{piCompleted} / {piTotal}</span>
                      <p className="text-xs text-muted-foreground">completed</p>
                    </div>
                  </td>
                  <td className="px-5 py-5">
                    <div className="whitespace-nowrap">
                      <span className="font-semibold text-primary">
                        {formatScore(latestPms?.totalScore)}
                      </span>
                      <span className="text-xs text-muted-foreground"> / 36</span>
                      <p className="text-xs text-muted-foreground">
                        Avg {formatScore(latestPms?.averageScore)} / 3
                      </p>
                    </div>
                  </td>
                  <td className="px-5 py-5">
                    <Badge variant="outline" className={cn("whitespace-nowrap rounded-full px-3 text-xs", finalDecisionClass)}>
                      {finalDecision}
                    </Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Linked Candidate Records
          </p>
          <p className="mt-2 text-2xl font-bold text-foreground">{candidateRecords.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            PMS Records
          </p>
          <p className="mt-2 text-2xl font-bold text-primary">{pmsRecords.length}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Latest Activity
          </p>
          <p className="mt-2 text-sm font-semibold text-foreground">
            {latestActivity ? timeAgo(latestActivity) : "No activity yet"}
          </p>
        </div>
      </div>

      {feedbackItems.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Feedback & Notes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {feedbackItems.map((item) => (
              <div key={item.label} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">
                  {item.value}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function HRPmsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<PmsTab>("pms-scores");
  const [selectedCandidate, setSelectedCandidate] =
    useState<CandidateRow | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [scores, setScores] = useState<Partial<PmsScores>>({});
  const [metricRemarks, setMetricRemarks] = useState<Record<string, string>>(
    {},
  );
  const [overallRating, setOverallRating] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    data: candidatesData,
    isLoading: loadingCandidates,
    refetch: refetchCandidates,
  } = useQuery({
    queryKey: ["employees-pms"],
    queryFn: () => employeesApi.list({ limit: 200 }),
    staleTime: 30_000,
  });

  const {
    data: pmsRecords = [],
    isLoading: loadingPms,
    refetch: refetchPms,
  } = useQuery({
    queryKey: ["pms-evaluations", selectedCandidate?.id],
    queryFn: () =>
      selectedCandidate
        ? pmsApi.forEmployee(selectedCandidate.id)
        : Promise.resolve([]),
    enabled: !!selectedCandidate,
    staleTime: 10_000,
  });
  const { data: allPmsRecords = [] } = useQuery({
    queryKey: ["pms-evaluations-all-members"],
    queryFn: () => pmsApi.list(),
    staleTime: 30_000,
  });
  const {
    data: performanceReport,
    isLoading: loadingReport,
    refetch: refetchReport,
  } = useQuery({
    queryKey: ["pms-employee-performance-report", selectedCandidate?.id],
    queryFn: () =>
      selectedCandidate
        ? pmsApi.employeeReport(selectedCandidate.id)
        : Promise.resolve(null),
    enabled: !!selectedCandidate && activeTab === "performance-report",
    staleTime: 10_000,
  });

  const allCandidates: CandidateRow[] = useMemo(
    () => (candidatesData ?? []) as CandidateRow[],
    [candidatesData],
  );

  const filtered = useMemo(() => {
    if (!search.trim()) return allCandidates;
    const q = search.toLowerCase();
    return allCandidates.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.employeeCode ?? "").toLowerCase().includes(q) ||
        (c.designation ?? "").toLowerCase().includes(q),
    );
  }, [allCandidates, search]);

  const existingRecord: PmsEvaluationRecord | null = useMemo(
    () => (pmsRecords.length > 0 ? pmsRecords[0] : null),
    [pmsRecords],
  );
  const completedCandidateIds = useMemo(
    () =>
      new Set(
        allPmsRecords
          .filter(
            (record) =>
              record.employeeId &&
              (record.submittedAt || record.totalScore !== null),
          )
          .map((record) => record.employeeId),
      ),
    [allPmsRecords],
  );

  const totalScore = useMemo(() => {
    const vals = PMS_METRICS.map((m) => scores[m.key] ?? null).filter(
      (v) => v !== null,
    ) as number[];
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100;
  }, [scores]);

  const averageScore = useMemo(() => {
    const vals = PMS_METRICS.map((m) => scores[m.key] ?? null).filter(
      (v) => v !== null,
    ) as number[];
    if (!vals.length) return null;
    return (
      Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
    );
  }, [scores]);

  const loadRecordIntoForm = useCallback((record: PmsEvaluationRecord) => {
    setScores({ ...record.scores });
    setMetricRemarks({ ...record.metricRemarks });
    setOverallRating(normalizedRatingValue(record.overallRating));
    setRemarks(record.remarks ?? "");
    setEditingId(record.id);
  }, []);

  const resetForm = useCallback(() => {
    setScores({});
    setMetricRemarks({});
    setOverallRating(null);
    setRemarks("");
    setEditingId(null);
  }, []);

  const handleSelectCandidate = (c: CandidateRow) => {
    setSelectedCandidate(c);
    resetForm();
  };

  const handleSave = async () => {
    if (!selectedCandidate) return;
    setSaving(true);
    try {
      const payload = {
        employeeId: selectedCandidate.id,
        scores,
        metricRemarks,
        overallRating,
        remarks: remarks || null,
      };
      if (editingId) {
        await pmsApi.update(editingId, payload);
        toast.success("PMS evaluation updated.");
      } else {
        await pmsApi.create(payload);
        toast.success("PMS evaluation saved.");
      }
      qc.invalidateQueries({ queryKey: ["pms-evaluations"] });
      qc.invalidateQueries({
        queryKey: ["pms-employee-performance-report", selectedCandidate.id],
      });
      void refetchPms();
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(msg || "Failed to save PMS evaluation.");
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    if (!pmsRecords.length) {
      toast.error("No PMS records to export.");
      return;
    }
    const headers = [
      "Candidate",
      "Code",
      "Position",
      "Evaluator",
      "Rating",
      "Total",
      "Average",
      ...PMS_METRICS.map((m) => m.label),
      "Remarks",
      "Submitted",
    ];
    const rows = pmsRecords.map((r) => [
      r.candidateName ?? "",
      r.candidateCode ?? "",
      r.positionTitle ?? "",
      r.evaluatorName ?? "",
      ratingLabel(r.overallRating),
      formatScore(r.totalScore),
      formatScore(r.averageScore),
      ...PMS_METRICS.map((m) => formatScore(r.scores[m.key])),
      r.remarks ?? "",
      r.submittedAt ? new Date(r.submittedAt).toLocaleDateString("en-IN") : "",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `pms_${selectedCandidate?.employeeCode ?? "export"}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex min-w-0 items-center gap-2 text-2xl font-bold tracking-tight">
            <Star className="h-6 w-6 text-primary" />
            <span className="min-w-0 truncate">PMS Evaluation</span>
          </h1>
          <p className="text-muted-foreground text-sm">
            Performance Management System — HR evaluation panel
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 rounded-xl"
          onClick={() => {
            void refetchCandidates();
            void refetchPms();
            void refetchReport();
          }}
          aria-label="Refresh PMS evaluation"
        >
          <RefreshCw
            className={cn(
              "h-4 w-4",
              (loadingCandidates || loadingPms || loadingReport) &&
                "animate-spin",
            )}
          />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        {[
          { key: "pms-scores" as PmsTab, label: "PMS Scores", icon: Star },
          {
            key: "performance-report" as PmsTab,
            label: "Performance Report",
            icon: BarChart2,
          },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex min-w-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[300px_1fr]">
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search employees…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 rounded-xl text-sm"
            />
          </div>
          <div className="space-y-1 max-h-[calc(100vh-220px)] overflow-y-auto pr-0.5">
            {loadingCandidates ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No employees found
              </div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelectCandidate(c)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all",
                    selectedCandidate?.id === c.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border bg-card hover:border-primary/30 hover:bg-muted/30",
                  )}
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                      {getInitials(c.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      {completedCandidateIds.has(c.id) && (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {c.employeeCode}
                    </p>
                    {c.designation && (
                      <p className="text-[10px] text-muted-foreground truncate">
                        {c.designation}
                      </p>
                    )}
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>
              ))
            )}
          </div>
        </div>

        <div className="min-w-0">
          {activeTab === "performance-report" ? (
            <EmployeePerformanceReportPanel
              selectedEmployee={selectedCandidate}
              report={performanceReport}
              loading={loadingReport}
            />
          ) : !selectedCandidate ? (
            <Card className="border-0 shadow-sm">
              <CardContent className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
                <ClipboardCheck className="h-10 w-10 opacity-20" />
                <p className="text-sm">
                  Select an employee to begin PMS evaluation
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-5">
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-11 w-11">
                        <AvatarFallback className="bg-primary/10 text-primary font-bold">
                          {getInitials(selectedCandidate.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold text-base">
                          {selectedCandidate.name}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {selectedCandidate.employeeCode}
                        </p>
                        {selectedCandidate.designation && (
                          <p className="text-xs text-muted-foreground">
                            {selectedCandidate.designation}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {existingRecord && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-xl text-xs gap-1.5"
                          onClick={handleExport}
                        >
                          <Download className="h-3.5 w-3.5" /> Export
                        </Button>
                      )}
                      {existingRecord && !editingId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl text-xs"
                          onClick={() => loadRecordIntoForm(existingRecord)}
                        >
                          Edit Evaluation
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>

              <MeetingScheduler employee={selectedCandidate} />

              {existingRecord && !editingId && (
                <PmsSubmittedRecordCard record={existingRecord} />
              )}

              {(!existingRecord || editingId) && (
                <PmsEvaluationFormCard
                  editing={Boolean(editingId)}
                  scores={scores}
                  onScore={(key, v) =>
                    setScores((prev) => ({ ...prev, [key]: v ?? undefined }))
                  }
                  metricRemarks={metricRemarks}
                  onMetricRemark={(key, v) =>
                    setMetricRemarks((prev) => ({ ...prev, [key]: v }))
                  }
                  overallRating={overallRating}
                  onOverallRating={setOverallRating}
                  remarks={remarks}
                  onRemarks={setRemarks}
                  totalScore={totalScore}
                  averageScore={averageScore}
                  saving={saving}
                  onSave={() => void handleSave()}
                  onCancelEdit={editingId ? resetForm : undefined}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

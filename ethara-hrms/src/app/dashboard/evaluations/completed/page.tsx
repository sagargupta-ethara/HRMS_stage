"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2, ClipboardCheck, Download, Eye, Loader2, Star,
} from "lucide-react";
import { assessmentsApi, evaluationsApi } from "@/lib/api";
import type { EvaluatorCandidateRecord } from "@/lib/api";
import { cn, formatLabel, getInitials, timeAgo } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";

type SectionTab = "pi" | "selection";

type ApiEvaluation = {
  id: string;
  candidateId: string;
  totalScore?: number | null;
  recommendation?: string | null;
  notes?: string | null;
  completedAt?: string | null;
  technicalSkills?: number | null;
  communication?: number | null;
  problemSolving?: number | null;
  culturalFit?: number | null;
  attitude?: number | null;
  interviewSubject?: string | null;
  interviewStatus?: string | null;
  interviewScheduledAt?: string | null;
  piScore?: number | null;
  candidate?: {
    fullName?: string;
    full_name?: string;
    candidateCode?: string;
    position?: { title?: string };
    college?: { name?: string };
  };
  evaluator?: { name: string };
};

const recColorMap: Record<string, string> = {
  strongly_recommended: "bg-success/10 text-success border-success/30",
  passed: "bg-primary/10 text-primary border-primary/30",
  recommended: "bg-primary/10 text-primary border-primary/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  not_recommended: "bg-destructive/10 text-destructive border-destructive/30",
};

function exportCSV(rows: Array<Record<string, string>>) {
  if (!rows.length) { toast.error("No data to export."); return; }
  const headers = Object.keys(rows[0]);
  const csv = [headers, ...rows.map((r) => headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`))]
    .map((r) => r.join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `completed_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast.success("Exported.");
}

export default function CompletedEvaluationsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SectionTab>("pi");

  const { data: evalsData, isLoading: loadingEvals } = useQuery({
    queryKey: ["evaluations"],
    queryFn: evaluationsApi.list,
    staleTime: 30_000,
  });

  const { data: reportData, isLoading: loadingReport } = useQuery({
    queryKey: ["evaluator-view", "", "", "", ""],
    queryFn: () => assessmentsApi.evaluatorView({}),
    staleTime: 30_000,
  });

  const allEvals = useMemo(
    () => (Array.isArray(evalsData) ? evalsData : (evalsData as { data?: ApiEvaluation[] })?.data ?? []) as ApiEvaluation[],
    [evalsData],
  );
  const allRecords = useMemo(
    () => (Array.isArray(reportData) ? reportData : []) as EvaluatorCandidateRecord[],
    [reportData],
  );

  const completedPI = useMemo(
    () => allEvals.filter((e) => !!e.completedAt),
    [allEvals]
  );

  const selectionFormCandidates = useMemo(
    () => allRecords.filter((r) =>
      ["selection_form_sent", "selection_form_submitted", "selection_form_validated"].includes(r.currentStage)
    ),
    [allRecords]
  );

  const isLoading = loadingEvals || loadingReport;

  const tabs: { key: SectionTab; label: string; count: number }[] = [
    { key: "pi", label: "PI Evaluations", count: completedPI.length },
    { key: "selection", label: "Selection Form Stage", count: selectionFormCandidates.length },
  ];

  if (isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-primary" /> Completed
          </h1>
          <p className="text-muted-foreground text-sm">All evaluator-completed records</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl text-xs gap-1.5"
          onClick={() => {
            if (activeTab === "pi") {
              exportCSV(completedPI.map((e) => ({
                Candidate: e.candidate?.fullName ?? e.candidate?.full_name ?? "—",
                Code: e.candidate?.candidateCode ?? "—",
                Role: e.candidate?.position?.title ?? "—",
                "PI Score": String(e.piScore ?? ""),
                "PI Status": e.interviewStatus ?? "",
                Score: String(e.totalScore ?? ""),
                Recommendation: e.recommendation ?? "",
                Evaluator: e.evaluator?.name ?? "—",
                Completed: e.completedAt ? new Date(e.completedAt).toLocaleDateString("en-IN") : "—",
                Notes: e.notes ?? "",
              })));
            } else if (activeTab === "selection") {
              exportCSV(selectionFormCandidates.map((r) => ({
                Candidate: r.fullName,
                Code: r.candidateCode,
                Role: r.positionTitle ?? "—",
                Stage: formatLabel(r.currentStage),
                PI: r.piInterview?.status ? formatLabel(r.piInterview.status) : "—",
                Evaluator: r.evaluation?.evaluatorName ?? "—",
              })));
            }
          }}
        >
          <Download className="h-3.5 w-3.5" /> Export CSV
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
              activeTab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            <span className={cn(
              "text-[10px] font-bold h-4 min-w-[1rem] flex items-center justify-center rounded-full px-1",
              activeTab === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {activeTab === "pi" && (
        <div className="space-y-4">
          {completedPI.length === 0 ? (
            <EmptyState message="No completed PI evaluations" sub="Marked-as-complete interviews will appear here." />
          ) : (
            completedPI.map((ev) => {
              const name = ev.candidate?.fullName ?? ev.candidate?.full_name ?? "Unknown Candidate";
              const position = ev.candidate?.position?.title ?? "—";
              const college = ev.candidate?.college?.name ?? "";
              const rec = ev.recommendation ?? "";
              const recCls = recColorMap[rec] ?? "bg-muted text-muted-foreground border-border";
              const score = ev.totalScore ?? 0;
              const scoreItems = [
                { key: "technicalSkills", label: "Technical", val: ev.technicalSkills },
                { key: "communication", label: "Comm.", val: ev.communication },
                { key: "problemSolving", label: "Problem", val: ev.problemSolving },
                { key: "culturalFit", label: "Culture", val: ev.culturalFit },
                { key: "attitude", label: "Attitude", val: ev.attitude },
              ].filter((s) => s.val != null);

              return (
                <Card key={ev.id} className="border-0 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                      <Avatar className="h-12 w-12 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary font-bold">
                          {getInitials(name)}
                        </AvatarFallback>
                      </Avatar>

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="font-semibold">{name}</h3>
                          {ev.candidate?.candidateCode && (
                            <span className="text-[10px] font-mono text-muted-foreground">{ev.candidate.candidateCode}</span>
                          )}
                          {rec && (
                            <Badge className={cn("text-[10px] border", recCls)}>{formatLabel(rec)}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{position}{college ? ` · ${college}` : ""}</p>
                        {ev.interviewSubject && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            PI: {ev.interviewSubject}
                            {ev.interviewScheduledAt && ` · ${new Date(ev.interviewScheduledAt).toLocaleDateString("en-IN")}`}
                          </p>
                        )}
                        {ev.piScore != null && (
                          <p className="text-xs font-medium mt-0.5">PI Score: <span className="text-primary">{ev.piScore}/100</span></p>
                        )}
                        {ev.evaluator?.name && (
                          <p className="text-[10px] text-muted-foreground">Evaluator: {ev.evaluator.name}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Completed {ev.completedAt ? timeAgo(ev.completedAt) : "—"}
                        </p>

                        {scoreItems.length > 0 && (
                          <div className="grid gap-2 mt-3" style={{ gridTemplateColumns: `repeat(${scoreItems.length}, 1fr)` }}>
                            {scoreItems.map(({ key, label, val }) => (
                              <div key={key} className="text-center">
                                <div className="flex justify-center gap-0.5 mb-1">
                                  {[1, 2, 3].map((n) => (
                                    <Star key={n} className={cn("h-2.5 w-2.5", (val ?? 0) >= n * 3 ? "text-warning fill-warning" : "text-muted-foreground")} />
                                  ))}
                                </div>
                                <p className="text-sm font-bold">{val}<span className="text-[10px] text-muted-foreground">/10</span></p>
                                <p className="text-[9px] text-muted-foreground leading-tight">{label}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {ev.notes && (
                          <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border/50">
                            <p className="text-xs text-muted-foreground leading-relaxed">{ev.notes}</p>
                          </div>
                        )}
                      </div>

                      <div className="text-center shrink-0">
                        <div className={cn(
                          "flex h-16 w-16 items-center justify-center rounded-2xl border-2",
                          score >= 8 ? "border-success/30 bg-success/5"
                            : score >= 5 ? "border-warning/30 bg-warning/5"
                            : "border-destructive/30 bg-destructive/5"
                        )}>
                          <div>
                            <p className={cn("text-2xl font-bold", score >= 8 ? "text-success" : score >= 5 ? "text-warning" : "text-destructive")}>
                              {score.toFixed(1)}
                            </p>
                            <p className="text-[9px] text-muted-foreground">/10</p>
                          </div>
                        </div>
                        <Progress value={score * 10} className="mt-2 h-1 w-16" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}

      {activeTab === "selection" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Candidates who have passed all evaluations and moved to the Selection Form stage.
          </p>
          {selectionFormCandidates.length === 0 ? (
            <EmptyState message="No candidates at Selection Form stage" sub="Candidates who pass all evaluations will appear here." />
          ) : (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Candidate", "Role", "Stage", "PI", "Evaluator", ""].map((h) => (
                          <th key={h} className="py-2.5 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {selectionFormCandidates.map((r) => (
                        <tr key={r.candidateId} className="border-b border-border/40 hover:bg-muted/20 transition-colors group">
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-7 w-7 shrink-0">
                                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">{getInitials(r.fullName)}</AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-xs font-medium leading-none">{r.fullName}</p>
                                <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{r.candidateCode}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground">{r.positionTitle ?? "—"}</td>
                          <td className="py-2.5 px-3">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                              {formatLabel(r.currentStage)}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {r.piInterview ? (
                              <div className="flex flex-col items-center gap-0.5">
                                {r.piInterview.score != null && <span className="text-xs font-semibold">{r.piInterview.score}</span>}
                                <span className={cn(
                                  "text-[10px] font-medium px-1 py-0.5 rounded-full",
                                  r.piInterview.status === "completed" ? "bg-green-100 text-green-700"
                                    : "bg-blue-100 text-blue-700"
                                )}>
                                  {formatLabel(r.piInterview.status ?? "")}
                                </span>
                              </div>
                            ) : <span className="text-[10px] text-muted-foreground">—</span>}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground">{r.evaluation?.evaluatorName ?? "—"}</td>
                          <td className="py-2.5 px-3">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
                              onClick={() => router.push(`/dashboard/candidates/${r.candidateId}`)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ message, sub }: { message: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-12 text-center text-muted-foreground">
      <ClipboardCheck className="h-8 w-8 mx-auto mb-2 opacity-20" />
      <p className="text-sm font-medium">{message}</p>
      <p className="text-xs mt-1">{sub}</p>
    </div>
  );
}

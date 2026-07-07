"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useApScorecard } from "@/lib/queries";
import { AnswerReport, ApStatusBadge } from "@/components/assessment-platform/question-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ShieldAlert } from "lucide-react";

export default function ScorecardPage() {
  const params = useParams();
  const id = String(params.assessmentId);
  const attemptId = String(params.attemptId);
  const { data: scorecard, isLoading } = useApScorecard(attemptId);

  if (isLoading || !scorecard) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const attempt = scorecard.attempt;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href={`/dashboard/assessment-platform/${id}/results`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All results
      </Link>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <h1 className="text-lg font-semibold">{attempt.name ?? attempt.email}</h1>
            <p className="text-sm text-muted-foreground">{attempt.email}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold">{attempt.totalScore ?? "—"}/{attempt.maxScore ?? "—"}
              {attempt.percentage != null && <span className="ml-2 text-base font-normal text-muted-foreground">({attempt.percentage}%)</span>}
            </p>
            <div className="mt-1 flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">Auto {attempt.autoScore ?? 0} · Manual {attempt.manualScore ?? 0}</span>
              <ApStatusBadge status={attempt.resultStatus ?? attempt.status} />
            </div>
          </div>
        </CardContent>
      </Card>

      {attempt.proctoring &&
        attempt.proctoring.tabSwitches + attempt.proctoring.fullscreenExits + attempt.proctoring.copyAttempts > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            <span className="flex items-center gap-1.5 font-medium"><ShieldAlert className="size-4" /> Proctoring flags</span>
            {attempt.proctoring.tabSwitches > 0 && <span>{attempt.proctoring.tabSwitches} tab/window switch(es)</span>}
            {attempt.proctoring.fullscreenExits > 0 && <span>{attempt.proctoring.fullscreenExits} full-screen exit(s)</span>}
            {attempt.proctoring.copyAttempts > 0 && <span>{attempt.proctoring.copyAttempts} copy/paste attempt(s)</span>}
          </div>
        )}

      {attempt.overallFeedback && (
        <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
          <p className="mb-1 font-medium">Overall feedback (HR)</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{attempt.overallFeedback}</p>
        </div>
      )}

      {scorecard.sections.map((sec) => (
        <Card key={sec.sectionId}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">{sec.title}</CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{sec.awarded}/{sec.maxMarks}</Badge>
              {sec.cutoffMark != null && (
                <Badge variant={sec.cutoffMet ? "secondary" : "outline"} className={sec.cutoffMet ? "" : "text-red-600"}>
                  Cutoff {sec.cutoffMark} {sec.cutoffMet ? "✓" : "✗"}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {sec.questions.map((q) => <AnswerReport key={q.id} question={q} />)}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

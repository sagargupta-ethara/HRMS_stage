"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAttemptForGrading, useGradeAnswer, useFinalizeGrading } from "@/lib/queries";
import { summarizeResponse, correctAnswerText, ApStatusBadge } from "@/components/assessment-platform/question-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, CheckCircle2, XCircle, Loader2 } from "lucide-react";

export default function GradingPanelPage() {
  const params = useParams();
  const router = useRouter();
  const attemptId = String(params.attemptId);
  const { data: scorecard, isLoading } = useAttemptForGrading(attemptId);
  const grade = useGradeAnswer(attemptId);
  const finalize = useFinalizeGrading(attemptId);
  const [drafts, setDrafts] = useState<Record<string, { marks: string; feedback: string }>>({});
  // Seed the draft inputs once per attempt (render-phase, guarded so it can't loop).
  // Subsequent scorecard refetches (after each grade) keep in-progress edits intact.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (scorecard && seededFor !== scorecard.attempt.id) {
    setSeededFor(scorecard.attempt.id);
    const next: Record<string, { marks: string; feedback: string }> = {};
    for (const sec of scorecard.sections) {
      for (const q of sec.questions) {
        if (q.scored && !q.autoScored) {
          next[q.id] = { marks: q.awardedMarks != null ? String(q.awardedMarks) : "", feedback: q.feedback ?? "" };
        }
      }
    }
    setDrafts(next);
  }

  if (isLoading || !scorecard) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const attempt = scorecard.attempt;
  const pending = scorecard.sections.some((s) => s.questions.some((q) => q.needsManual && q.awardedMarks == null));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link href="/dashboard/assessment-platform/grading" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Grading queue
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{attempt.name ?? attempt.email}</h1>
          <p className="text-sm text-muted-foreground">{attempt.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm">Auto: <b>{attempt.autoScore}</b> · Total: <b>{attempt.totalScore}</b>/{attempt.maxScore}</span>
          <ApStatusBadge status={attempt.resultStatus ?? attempt.status} />
        </div>
      </div>

      {scorecard.sections.map((sec) => (
        <Card key={sec.sectionId}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{sec.title}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {sec.questions.map((q) => {
              const candidate = q.type === "file_upload" ? null : summarizeResponse(q.type, q.response ?? null, q.config);
              const correct = correctAnswerText(q.type, q.config);
              const manual = q.scored && !q.autoScored;
              return (
                <div key={q.id} className="rounded-lg border border-border/70 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium">{q.prompt}</p>
                    <div className="flex shrink-0 items-center gap-2">
                      {q.isCorrect === true && <CheckCircle2 className="size-4 text-green-600" />}
                      {q.isCorrect === false && <XCircle className="size-4 text-red-500" />}
                      {q.scored ? <Badge variant="outline">{q.awardedMarks ?? "—"} / {q.marks}</Badge> : <Badge variant="secondary">Survey</Badge>}
                    </div>
                  </div>
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {q.type === "file_upload" ? (
                      q.fileName ? <a href={q.fileUrl ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary"><FileText className="size-4" /> {q.fileName}</a> : <p>No file submitted</p>
                    ) : <p><span className="text-foreground/70">Answer:</span> {candidate || "—"}</p>}
                    {correct && <p><span className="text-foreground/70">Correct:</span> {correct}</p>}
                    {q.config?.rubric ? <p><span className="text-foreground/70">Rubric:</span> {String(q.config.rubric)}</p> : null}
                  </div>

                  {manual && (
                    <div className="mt-3 grid gap-2 md:grid-cols-[120px_1fr_auto] md:items-end">
                      <div className="space-y-1">
                        <Label className="text-xs">Marks (max {q.marks})</Label>
                        <Input
                          type="number" min={0} max={q.marks} step="0.5"
                          value={drafts[q.id]?.marks ?? ""}
                          onChange={(e) => setDrafts((p) => ({ ...p, [q.id]: { ...p[q.id], marks: e.target.value } }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Feedback (optional)</Label>
                        <Textarea
                          rows={1}
                          value={drafts[q.id]?.feedback ?? ""}
                          onChange={(e) => setDrafts((p) => ({ ...p, [q.id]: { ...p[q.id], feedback: e.target.value } }))}
                        />
                      </div>
                      <Button
                        size="sm"
                        disabled={grade.isPending || drafts[q.id]?.marks === "" || drafts[q.id]?.marks == null}
                        onClick={() => grade.mutate({ questionId: q.id, marks: Number(drafts[q.id].marks), feedback: drafts[q.id].feedback || undefined })}
                      >Save</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <div className="flex items-center justify-end gap-3">
        {pending && <span className="text-sm text-amber-600">Grade all manual answers to finalize.</span>}
        <Button
          disabled={pending || finalize.isPending}
          onClick={async () => { await finalize.mutateAsync(); router.push("/dashboard/assessment-platform/grading"); }}
        >
          {finalize.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Finalize grading
        </Button>
      </div>
    </div>
  );
}

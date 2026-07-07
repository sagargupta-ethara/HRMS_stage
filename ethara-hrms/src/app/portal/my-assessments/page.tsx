"use client";

import { useRouter } from "next/navigation";
import { useMyAssignments } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApStatusBadge } from "@/components/assessment-platform/question-types";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/shared/page-header";
import { ClipboardCheck, Clock } from "lucide-react";

export default function MyAssessmentsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { data: assignments, isLoading } = useMyAssignments();
  const rows = assignments ?? [];
  const campusLocked = profile?.type === "candidate" && profile.campusLock === true;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        icon={ClipboardCheck}
        title="My Assessments"
        description="Tests assigned to you. Only assessments you've been invited to appear here."
      />

      {isLoading ? (
        <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <Card><CardContent className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <ClipboardCheck className="size-8" />
          <p>No assessments assigned to you right now.</p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((a) => {
            const attempt = a.attempt;
            const submitted = attempt && attempt.status !== "in_progress";
            const inProgress = attempt && attempt.status === "in_progress";
            const canCompleteCampusRegistration = Boolean(
              campusLocked && attempt?.released && attempt.resultStatus === "pass"
            );
            return (
              <Card key={a.assignmentId}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-medium">{a.title}</p>
                    {a.description && <p className="text-sm text-muted-foreground line-clamp-1">{a.description}</p>}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {a.timeLimitMinutes && <span className="flex items-center gap-1"><Clock className="size-3.5" /> {a.timeLimitMinutes} min</span>}
                      <span>Attempts: {a.attemptsUsed}/{a.attemptsAllowed}</span>
                      {attempt && (
                        attempt.released && attempt.resultStatus
                          ? <ApStatusBadge status={attempt.resultStatus} />
                          : submitted
                            ? <span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">Under review</span>
                            : <ApStatusBadge status={attempt.status} />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {attempt?.released && attempt.totalScore != null && (
                      <span className="text-sm font-semibold">{attempt.totalScore}/{attempt.maxScore}</span>
                    )}
                    {canCompleteCampusRegistration ? (
                      <Button onClick={() => router.push("/candidate/complete-registration")}>
                        Complete registration
                      </Button>
                    ) : submitted ? (
                      a.attemptsUsed < a.attemptsAllowed ? (
                        <Button onClick={() => router.push(`/portal/my-assessments/${a.assignmentId}`)}>Retake</Button>
                      ) : (
                        <Button variant="outline" disabled>Submitted</Button>
                      )
                    ) : (
                      <Button onClick={() => router.push(`/portal/my-assessments/${a.assignmentId}`)}>
                        {inProgress ? "Resume" : "Start"}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

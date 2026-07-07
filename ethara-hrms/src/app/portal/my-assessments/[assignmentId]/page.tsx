"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { assessmentPlatformApi, type ApTakerAttempt } from "@/lib/api";
import { AttemptPlayer } from "@/components/assessment-platform/attempt-player";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Loader2 } from "lucide-react";

export default function TakeAssessmentPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = String(params.assignmentId);
  const [attempt, setAttempt] = useState<ApTakerAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    // Resume can hit a transient network blip; retry a few times before giving up so
    // a dropped connection doesn't dead-end the candidate. Real errors (4xx with a
    // response) surface immediately.
    const attempt = async (tries: number): Promise<void> => {
      try {
        const data = await assessmentPlatformApi.startAttempt(assignmentId);
        if (!cancelled) setAttempt(data);
      } catch (e) {
        const err = e as { response?: { status?: number; data?: { detail?: string } } };
        const isNetworkOrServer = !err.response || (err.response.status ?? 500) >= 500;
        if (isNetworkOrServer && tries > 0) {
          await new Promise((r) => setTimeout(r, 1500));
          if (!cancelled) await attempt(tries - 1);
          return;
        }
        if (!cancelled) {
          setError(
            err.response?.data?.detail ??
              (isNetworkOrServer
                ? "We couldn't reach the server. Check your connection and try again."
                : "This assessment is not available."),
          );
        }
      }
    };
    void attempt(3);
    return () => { cancelled = true; };
  }, [assignmentId]);

  if (error) {
    return (
      <Card className="mx-auto max-w-md">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertTriangle className="size-10 text-amber-500" />
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex gap-2">
            <Button onClick={() => window.location.reload()}>Try again</Button>
            <Button variant="outline" onClick={() => router.push("/portal/my-assessments")}>Back to my assessments</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!attempt) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return <AttemptPlayer key={attempt.attemptId} initial={attempt} onExit={() => router.push("/portal/my-assessments")} />;
}

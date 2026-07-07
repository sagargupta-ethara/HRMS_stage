"use client";

import { cn, STAGE_LABELS, STAGE_COLORS, STAGE_ACCENTS } from "@/lib/utils";
import type { CandidateStage } from "@/types";
import { CheckCircle2, Circle, Clock } from "lucide-react";

const ORDERED_STAGES: CandidateStage[] = [
  "new_application", "source_tagged", "resume_uploaded", "resume_screening_pending",
  "resume_shortlisted", "evaluation_assigned", "evaluation_in_progress", "evaluation_passed",
  "selection_form_sent", "selection_form_submitted", "selection_form_validated",
  "contract_sent", "contract_signed", "induction_completed", "it_email_created",
  "welcome_mail_sent", "statutory_forms_sent", "statutory_forms_submitted",
  "compliance_verified", "onboarding_completed",
];

interface StageTimelineProps {
  currentStage: CandidateStage;
  compact?: boolean;
}

export function StageTimeline({ currentStage, compact = false }: StageTimelineProps) {
  const currentIdx = ORDERED_STAGES.indexOf(currentStage);
  const rejectedStages: CandidateStage[] = ["resume_rejected", "evaluation_failed"];
  const isRejected = rejectedStages.includes(currentStage);

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {ORDERED_STAGES.slice(0, 8).map((stage, i) => (
          <div
            key={stage}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-all",
              i <= currentIdx ? (STAGE_ACCENTS[stage] ?? "bg-primary") : "bg-muted",
              isRejected && i === currentIdx && "bg-destructive"
            )}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-0">
      {ORDERED_STAGES.map((stage, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isPending = i > currentIdx;

        return (
          <div key={stage} className="flex min-w-0 items-start gap-3">
            {/* Connector line + Icon */}
            <div className="flex flex-col items-center">
              {isCompleted ? (
                <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
              ) : isCurrent ? (
                <div className="relative">
                  <Clock className={cn("h-5 w-5 shrink-0", isRejected ? "text-destructive" : "text-primary")} />
                  <span className={cn(
                    "absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full animate-pulse",
                    isRejected ? "bg-destructive" : "bg-primary"
                  )} />
                </div>
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/30 shrink-0" />
              )}
              {i < ORDERED_STAGES.length - 1 && (
                <div className={cn("w-0.5 h-6 my-0.5", isCompleted ? "bg-success/40" : "bg-muted")} />
              )}
            </div>
            {/* Label */}
            <div className={cn("min-w-0 pb-4 -mt-0.5", isPending && "opacity-40")}>
              <div className="flex min-w-0 items-start gap-2">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STAGE_ACCENTS[stage] ?? "bg-muted-foreground")} />
                <p className={cn(
                  "break-words text-sm font-medium leading-snug",
                  isCurrent && !isRejected && "text-primary font-semibold",
                  isCurrent && isRejected && "text-destructive font-semibold"
                )}>
                  {STAGE_LABELS[stage]}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface StageBadgeProps {
  stage: CandidateStage;
  className?: string;
}

export function StageBadge({ stage, className }: StageBadgeProps) {
  return (
    <span className={cn(
      "inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-left text-xs font-semibold leading-snug whitespace-normal break-words",
      STAGE_COLORS[stage] || "bg-muted text-muted-foreground",
      className
    )}>
      {STAGE_LABELS[stage]}
    </span>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Briefcase, Calendar, CheckCircle2, ChevronRight, Clock3, CreditCard, UserCircle2, Video, Phone, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { assessmentsApi, candidatesApi } from "@/lib/api";
import type { PIInterviewRecord } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { STAGE_COLORS, STAGE_LABELS, cn, formatDate, formatDateTime, formatLabel } from "@/lib/utils";
import type { CandidatePortalOverview, CandidateStage } from "@/types";


const STAGE_SEQUENCE: CandidateStage[] = [
  "new_application",
  "source_tagged",
  "resume_uploaded",
  "resume_screening_pending",
  "resume_shortlisted",
  "resume_rejected",
  "evaluation_assigned",
  "evaluation_in_progress",
  "evaluation_passed",
  "evaluation_failed",
  "selection_form_sent",
  "selection_form_submitted",
  "selection_form_validated",
  "contract_sent",
  "contract_signed",
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
  "onboarding_completed",
];

const MILESTONES = [
  { key: "application", label: "Application received", minStageIdx: 0 },
  { key: "screening", label: "Screening", minStageIdx: 3 },
  { key: "evaluation", label: "Evaluation", minStageIdx: 6 },
  { key: "selection", label: "Selection form", minStageIdx: 10 },
  { key: "contract", label: "Offer and contract", minStageIdx: 13 },
  { key: "compliance", label: "Compliance", minStageIdx: 16 },
  { key: "onboarding", label: "Onboarding", minStageIdx: 18 },
];

const EVALUATION_PASSED_STAGES: CandidateStage[] = [
  "evaluation_passed",
  "selection_form_sent",
  "selection_form_submitted",
  "selection_form_validated",
  "contract_sent",
  "contract_signed",
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
  "onboarding_completed",
];

const EVALUATION_FAILED_STAGES: CandidateStage[] = [
  "evaluation_failed",
  "resume_rejected",
];

const ID_CARD_UNLOCKED_STAGES: CandidateStage[] = [
  "contract_signed",
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
  "onboarding_completed",
];


function milestoneIndex(stage?: CandidateStage): number {
  if (!stage) return 0;
  if (["new_application", "source_tagged", "resume_uploaded"].includes(stage)) return 0;
  if (["resume_screening_pending", "resume_shortlisted", "resume_rejected"].includes(stage)) return 1;
  if (["evaluation_assigned", "evaluation_in_progress", "evaluation_passed", "evaluation_failed"].includes(stage)) return 2;
  if (["selection_form_sent", "selection_form_submitted", "selection_form_validated"].includes(stage)) return 3;
  if (["contract_sent", "contract_signed"].includes(stage)) return 4;
  if (["statutory_forms_sent", "statutory_forms_submitted", "compliance_verified"].includes(stage)) return 5;
  return 6;
}


const PI_MODE_ICONS: Record<string, React.ElementType> = {
  google_meet: Video,
  teams: Video,
  zoom: Video,
  phone: Phone,
  offline: MapPin,
};

const PI_MODE_LABELS: Record<string, string> = {
  google_meet: "Google Meet",
  teams: "Microsoft Teams",
  zoom: "Zoom",
  phone: "Phone Call",
  offline: "Offline / In-person",
};

function piInterviewStatusBadge(status: string | null | undefined) {
  if (!status) return null;
  const map: Record<string, string> = {
    scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    rescheduled: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    completed: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
    cancelled: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", map[status] ?? "bg-muted text-muted-foreground")}>
      {label}
    </span>
  );
}

export default function CandidatePortalDashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<CandidatePortalOverview | null>(null);
  const [piInterviews, setPiInterviews] = useState<PIInterviewRecord[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      candidatesApi.me(),
      assessmentsApi.myInterviews().catch(() => []),
    ])
      .then(([ov, interviews]) => {
        setOverview(ov);
        setPiInterviews(interviews);
      })
      .catch(() => setError("Unable to load your candidate dashboard right now."))
      .finally(() => setIsLoading(false));
  }, []);

  const currentApplication = overview?.currentApplication;

  const evaluationPassed = Boolean(
    currentApplication?.currentStage
    && EVALUATION_PASSED_STAGES.includes(currentApplication.currentStage)
  );

  const evaluationRejected = Boolean(
    currentApplication?.currentStage
    && EVALUATION_FAILED_STAGES.includes(currentApplication.currentStage)
  );

  const progress = useMemo(() => {
    if (!currentApplication?.currentStage) return 0;
    if (evaluationRejected) return Math.round(((STAGE_SEQUENCE.indexOf("evaluation_failed") + 1) / STAGE_SEQUENCE.length) * 100);
    const stageIndex = STAGE_SEQUENCE.indexOf(currentApplication.currentStage);
    if (stageIndex < 0) return 0;
    return Math.round(((stageIndex + 1) / STAGE_SEQUENCE.length) * 100);
  }, [currentApplication?.currentStage, evaluationRejected]);

  const activeMilestone = milestoneIndex(currentApplication?.currentStage);
  const idCardModuleUnlocked = Boolean(
    currentApplication?.currentStage
    && ID_CARD_UNLOCKED_STAGES.includes(currentApplication.currentStage)
    && currentApplication.contract?.status === "signed"
  );
  const idCardFormReady = Boolean(idCardModuleUnlocked && currentApplication?.etharaEmail);

  if (isLoading) {
    return <PortalState message="Loading your application dashboard..." />;
  }

  if (error || !overview) {
    return <PortalState message={error || "We couldn't load your portal right now."} />;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div
        className="rounded-xl p-6 text-white"
        style={{
          background: "linear-gradient(135deg, rgba(237,0,237,0.12) 0%, rgba(144,141,206,0.08) 50%, rgba(19,18,44,0.95) 100%)",
          border: "1px solid rgba(144,141,206,0.18)",
          boxShadow: "0 0 40px rgba(237,0,237,0.06), 0 16px 48px rgba(0,0,0,0.30)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm" style={{ color: "rgba(197,203,232,0.55)" }}>Welcome back</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight" style={{ color: "#C5CBE8" }}>{user?.name}</h1>
            <p className="mt-2 text-sm" style={{ color: "rgba(197,203,232,0.65)" }}>
              {currentApplication?.position?.title || "Candidate profile"}{" "}
              {currentApplication?.position?.department ? `· ${currentApplication.position.department}` : ""}
            </p>
            {evaluationRejected && (
              <div
                className="mt-3 rounded-xl px-4 py-2 text-sm font-medium"
                style={{
                  background: "rgba(239,68,68,0.10)",
                  border: "1px solid rgba(239,68,68,0.25)",
                  color: "#f87171",
                }}
              >
                Application status: Not selected — {STAGE_LABELS[currentApplication!.currentStage]}
              </div>
            )}
          </div>
          <div
            className="min-w-[240px] rounded-xl p-4"
            style={{
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(144,141,206,0.18)",
            }}
          >
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.2em]" style={{ color: "rgba(197,203,232,0.50)" }}>Journey progress</p>
              <p
                className="text-2xl font-semibold"
                style={{
                  background: evaluationRejected ? "#f87171" : "linear-gradient(135deg, #ED00ED, #908DCE)",
                  WebkitBackgroundClip: "text",
                  backgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {progress}%
              </p>
            </div>
            <div className="mt-4 h-2 w-full rounded-full overflow-hidden" style={{ background: "rgba(144,141,206,0.15)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: evaluationRejected
                    ? "rgba(239,68,68,0.70)"
                    : "linear-gradient(90deg, #ED00ED, #908DCE)",
                }}
              />
            </div>
            <p className="mt-2 text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>
              Current stage: {currentApplication ? STAGE_LABELS[currentApplication.currentStage] : "Profile created"}
            </p>
          </div>
        </div>
      </div>

      {!overview.emailVerified && (
        <Card className="border-warning/30 bg-warning/5 shadow-sm">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 text-warning" />
              <div>
                <p className="text-sm font-semibold">Verify your email</p>
                <p className="text-xs text-muted-foreground">
                  OTP-based email verification is enabled. Verify your address to keep account recovery and hiring updates working smoothly.
                </p>
              </div>
            </div>
            <Link href="/portal/profile">
              <Button size="sm" className="rounded-full">Verify now</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-xl border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Application journey</CardTitle>
          </CardHeader>
          <CardContent>
            {evaluationRejected && (
              <div
                className="mb-4 rounded-xl p-3 text-sm flex items-center gap-2"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.22)",
                  color: "#f87171",
                }}
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                Application closed — this position was not selected at the evaluation stage.
              </div>
            )}
            <div className="space-y-2">
              {MILESTONES.map((milestone, index) => {
                const done = index < activeMilestone;
                const current = index === activeMilestone;
                const isRejectedMilestone = evaluationRejected && index === 2;
                const isFutureAfterReject = evaluationRejected && index > 2;
                const isFutureBeforeEval = !evaluationPassed && !evaluationRejected && index > activeMilestone;

                return (
                  <div
                    key={milestone.key}
                    className={cn(
                      "flex items-start gap-3 transition-opacity",
                      (isFutureAfterReject || isFutureBeforeEval) && "opacity-30"
                    )}
                  >
                    <div className="flex flex-col items-center">
                      <div
                        className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold",
                          done && !isRejectedMilestone && "border-emerald-500 bg-emerald-500 text-white",
                          isRejectedMilestone && "border-red-500 bg-red-500/10 text-red-400",
                          current && !isRejectedMilestone && "border-primary bg-primary/10 text-primary",
                          !done && !current && !isRejectedMilestone && "border-border bg-muted text-muted-foreground"
                        )}
                      >
                        {done && !isRejectedMilestone ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : isRejectedMilestone ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          index + 1
                        )}
                      </div>
                      {index < MILESTONES.length - 1 && (
                        <div className={cn("mt-1 h-8 w-px", done && !isRejectedMilestone ? "bg-emerald-400/60" : "bg-border")} />
                      )}
                    </div>
                    <div className="pb-4 pt-1">
                      <p className={cn(
                        "text-sm font-medium",
                        current && !isRejectedMilestone && "text-primary",
                        isRejectedMilestone && "text-red-400"
                      )}>
                        {milestone.label}
                        {isRejectedMilestone && " — Not selected"}
                      </p>
                      {current && currentApplication && !isRejectedMilestone && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {STAGE_LABELS[currentApplication.currentStage]}
                        </p>
                      )}
                      {(isFutureAfterReject || (isFutureBeforeEval && index >= 3)) && (
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {isFutureAfterReject ? "Not applicable" : "Locked — complete evaluation first"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="rounded-xl border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Current application</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentApplication ? (
                <>
                  <div>
                    <p className="text-xl font-semibold">{currentApplication.position?.title || "Pending role selection"}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Applied {currentApplication.lastAppliedAt ? formatDate(currentApplication.lastAppliedAt) : formatDate(currentApplication.createdAt)}
                    </p>
                  </div>
                  <Badge className={cn("w-fit rounded-full border-0", STAGE_COLORS[currentApplication.currentStage])}>
                    {STAGE_LABELS[currentApplication.currentStage]}
                  </Badge>
                  <div className="rounded-xl bg-muted/40 p-4 text-sm text-muted-foreground">
                    {currentApplication.position?.summary || currentApplication.position?.description || "Your profile is active in the hiring system. We'll keep this page updated as your application moves ahead."}
                  </div>
                  <Link href="/portal/application">
                    <Button className="w-full rounded-full">
                      Track application
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                  Your account is ready. Pick an open role from careers to start your first application.
                </div>
              )}
            </CardContent>
          </Card>

          {currentApplication?.currentStage === "resume_shortlisted" && (
            <Card className="rounded-xl border-0 shadow-sm border-primary/20 bg-primary/5">
              <CardContent className="p-4">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-primary mb-1"><CheckCircle2 className="h-4 w-4 shrink-0" /> You are shortlisted!</p>
                <p className="text-xs text-muted-foreground mb-3">Complete your assigned assessment to continue your application.</p>
                <Link href="/portal/my-assessments">
                  <Button size="sm" className="rounded-full w-full">Open My Assessments →</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {piInterviews.length > 0 && (
            <Card className="rounded-xl border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-blue-500" />
                  PI Interview
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {piInterviews.slice(0, 2).map((iv) => {
                  const ModeIcon = PI_MODE_ICONS[iv.mode ?? ""] ?? Calendar;
                  return (
                    <div
                      key={iv.id}
                      className="rounded-xl border border-border p-4 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold">{iv.subject ?? "PI Interview"}</p>
                        {piInterviewStatusBadge(iv.status)}
                      </div>
                      {iv.scheduledAt && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5 shrink-0" />
                          {formatDateTime(iv.scheduledAt)}
                        </div>
                      )}
                      {iv.mode && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <ModeIcon className="h-3.5 w-3.5 shrink-0" />
                          {PI_MODE_LABELS[iv.mode] ?? formatLabel(iv.mode)}
                        </div>
                      )}
                      {iv.evaluatorName && (
                        <p className="text-xs text-muted-foreground">
                          Interviewer: <span className="font-medium text-foreground">{iv.evaluatorName}</span>
                        </p>
                      )}
                      {iv.notes && (
                        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{iv.notes}</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <div className="space-y-3">
            {[
              { label: "Browse open roles", href: "/careers", icon: Briefcase, description: "View all sample openings" },
              { label: "Update profile", href: "/portal/profile", icon: UserCircle2, description: "Edit personal details and verify your email" },
              {
                label: "ID Card Details",
                href: "/portal/id-card",
                icon: CreditCard,
                description: !currentApplication
                  ? "Available once your application reaches the signed contract stage"
                  : idCardFormReady
                    ? "Fill or update the ID card information shared with Admin, HR, and IT"
                    : idCardModuleUnlocked
                      ? "Unlocked now. Waiting for your Ethara email ID before the form can be filled"
                      : "Unlocks after your contract and NDA are signed",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/25 hover:bg-muted/40">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              );
            })}
          </div>

          <Card className="rounded-xl border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Application history</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {overview.applications.map((application) => (
                <div key={application.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{application.position?.title || "Candidate profile"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Candidate code: {application.candidateCode}
                      </p>
                    </div>
                    <Badge variant="outline" className="rounded-full">
                      {STAGE_LABELS[application.currentStage]}
                    </Badge>
                  </div>
                </div>
              ))}
              {overview.applications.length === 0 && (
                <p className="text-sm text-muted-foreground">No applications have been created yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


function PortalState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
      <Clock3 className="mx-auto mb-3 h-5 w-5" />
      {message}
    </div>
  );
}

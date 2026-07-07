"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowRight, Briefcase, CheckCircle2, Clock3, Loader2, MapPin, Target } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { assessmentPlatformApi, assessmentsApi, candidatesApi, positionsApi } from "@/lib/api";
import type { ApMyAssignment, AssessmentRecord } from "@/lib/api";
import { STAGE_COLORS, STAGE_LABELS, cn, formatDate } from "@/lib/utils";
import type { CandidatePortalOverview, CandidateStage, Position } from "@/types";

type TrackerStatus = "completed" | "current" | "upcoming" | "failed";

type TrackerStep = {
  key: string;
  title: string;
  description: string;
  status: TrackerStatus;
};

type AssessmentTrackerSummary = {
  description: string;
  status: TrackerStatus;
};

const POST_EVALUATION_STAGES: readonly CandidateStage[] = [
  "evaluation_in_progress",
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

const SELECTION_FORM_STAGES: readonly CandidateStage[] = [
  "selection_form_sent",
  "selection_form_submitted",
  "selection_form_validated",
] ;

const POST_SELECTION_FORM_STAGES: readonly CandidateStage[] = [
  "contract_sent",
  "contract_signed",
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
  "onboarding_completed",
] ;

const POST_CONTRACT_STAGES: readonly CandidateStage[] = [
  "contract_signed",
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
  "onboarding_completed",
] ;

const ONBOARDING_IN_PROGRESS_STAGES: readonly CandidateStage[] = [
  "induction_completed",
  "it_email_created",
  "welcome_mail_sent",
  "statutory_forms_sent",
  "statutory_forms_submitted",
  "compliance_verified",
] ;

function formatAttemptScore(attempt: ApMyAssignment["attempt"]): string {
  if (!attempt || attempt.totalScore == null || attempt.maxScore == null) return "";
  return ` (${attempt.totalScore}/${attempt.maxScore})`;
}

function buildAssessmentTrackerSummary(
  platformAssignments: ApMyAssignment[],
  assessmentRows: AssessmentRecord[],
  currentStatus?: string | null
): AssessmentTrackerSummary | null {
  const failedPlatform = platformAssignments.find((assignment) =>
    assignment.attempt?.resultStatus === "fail"
  );
  if (failedPlatform?.attempt) {
    return {
      status: "failed",
      description: `${failedPlatform.title}: Not passed${formatAttemptScore(failedPlatform.attempt)}.`,
    };
  }

  const passedPlatform = platformAssignments.find((assignment) =>
    assignment.attempt?.resultStatus === "pass"
  );
  if (passedPlatform?.attempt) {
    return {
      status: "completed",
      description: `${passedPlatform.title}: Passed${formatAttemptScore(passedPlatform.attempt)}.`,
    };
  }

  const submittedPlatform = platformAssignments.find((assignment) =>
    assignment.attempt && assignment.attempt.status !== "in_progress"
  );
  if (submittedPlatform) {
    return {
      status: "current",
      description: `${submittedPlatform.title}: Submitted and under review.`,
    };
  }

  const activePlatform = platformAssignments.find((assignment) =>
    assignment.attempt?.status === "in_progress"
  );
  if (activePlatform) {
    return {
      status: "current",
      description: `${activePlatform.title}: In progress.`,
    };
  }

  if (platformAssignments.length > 0) {
    return {
      status: "current",
      description: "Assessment assigned. Open My Assessments to complete it.",
    };
  }

  const failedManual = assessmentRows.find((assessment) => assessment.decision === "fail");
  if (failedManual) {
    return {
      status: "failed",
      description: "Assessments were reviewed manually and not passed.",
    };
  }

  const manuallyPassed = assessmentRows.some((assessment) =>
    assessment.decision === "pass" || assessment.status === "bypassed"
  );
  if (manuallyPassed) {
    return {
      status: "completed",
      description: currentStatus?.toLowerCase().includes("bypass")
        ? currentStatus
        : "Assessments manually marked as passed by the hiring team.",
    };
  }

  return null;
}

function buildApplicationTracker(
  currentApplication: CandidatePortalOverview["currentApplication"],
  assessmentSummary: AssessmentTrackerSummary | null
): TrackerStep[] {
  if (!currentApplication) return [];

  const currentStage = currentApplication.currentStage;
  const evaluationFailed = currentStage === "evaluation_failed";
  const assessmentPlatformCompleted = POST_EVALUATION_STAGES.includes(currentStage);
  const evaluationCompleted = currentStage === "evaluation_passed" || SELECTION_FORM_STAGES.includes(currentStage) || POST_SELECTION_FORM_STAGES.includes(currentStage);
  const selectionCompleted = POST_SELECTION_FORM_STAGES.includes(currentStage);
  const contractCompleted = POST_CONTRACT_STAGES.includes(currentStage);
  const currentStatus = currentApplication.currentStatus || "";

  const applicationDescription = currentApplication.position?.title
    ? `${currentApplication.position.title} is linked to your candidate profile.`
    : "Your candidate application has been created.";

  let selectionDescription = "Selection form unlocks once evaluation is cleared.";
  if (currentStage === "selection_form_sent") selectionDescription = "Selection form has been shared with you.";
  if (currentStage === "selection_form_submitted") selectionDescription = "Selection form submitted and awaiting review.";
  if (currentStage === "selection_form_validated") selectionDescription = "Selection form has been validated.";
  if (selectionCompleted) selectionDescription = "Selection form completed and moved forward.";

  let contractDescription = "Contract and NDA will appear after the selection form is validated.";
  if (currentStage === "contract_sent") contractDescription = "Review and sign your contract and NDA.";
  if (contractCompleted) contractDescription = "Contract and NDA have been signed.";

  let onboardingDescription = "Onboarding and compliance steps unlock after contract signing.";
  if (ONBOARDING_IN_PROGRESS_STAGES.includes(currentStage)) {
    onboardingDescription = `Current step: ${STAGE_LABELS[currentStage]}.`;
  }
  if (currentStage === "onboarding_completed") {
    onboardingDescription = "All onboarding and compliance steps are complete.";
  }

  const assessmentDescription =
    assessmentSummary?.description ??
    (evaluationFailed
      ? "The assessment stage was not cleared."
      : assessmentPlatformCompleted
        ? currentStatus.toLowerCase().includes("assessment")
          ? currentStatus
          : "Assessments completed."
        : ["resume_shortlisted", "evaluation_assigned"].includes(currentStage)
          ? "Complete your assigned assessments."
          : "Unlocks after resume screening.");

  const assessmentStatus =
    assessmentSummary?.status ??
    (evaluationFailed
      ? "failed"
      : assessmentPlatformCompleted
        ? "completed"
        : ["resume_shortlisted", "evaluation_assigned"].includes(currentStage)
          ? "current"
          : "upcoming");

  const evaluationDescription =
    evaluationFailed
      ? currentStatus || "The evaluation stage was not cleared."
      : evaluationCompleted
        ? /pi|evaluation|bypass|selected|passed/i.test(currentStatus)
          ? currentStatus
          : "Evaluation cleared and the application moved to the selection form."
        : currentStage === "evaluation_assigned" || currentStage === "evaluation_in_progress"
          ? "Evaluation review is in progress."
          : "Unlocks after assessments.";

  return [
    {
      key: "application",
      title: "Application received",
      description: applicationDescription,
      status: "completed",
    },
    {
      key: "screening",
      title: "Resume screening",
      description:
        currentStage === "resume_rejected"
          ? "Your resume was not shortlisted."
          : ["new_application", "source_tagged", "resume_uploaded", "resume_screening_pending"].includes(currentStage)
            ? "HR is screening your profile and resume."
            : "Resume screening cleared.",
      status:
        currentStage === "resume_rejected"
          ? "failed"
          : ["new_application", "source_tagged", "resume_uploaded", "resume_screening_pending"].includes(currentStage)
            ? "current"
            : "completed",
    },
    {
      key: "assessment-platform",
      title: "Assessments",
      description: assessmentDescription,
      status: assessmentStatus,
    },
    {
      key: "evaluation",
      title: "Evaluation in progress",
      description: evaluationDescription,
      status:
        evaluationFailed
          ? "failed"
          : evaluationCompleted
            ? "completed"
            : currentStage === "evaluation_assigned" || currentStage === "evaluation_in_progress"
              ? "current"
              : "upcoming",
    },
    {
      key: "selection-form",
      title: "Selection form",
      description: selectionDescription,
      status:
        selectionCompleted
          ? "completed"
          : SELECTION_FORM_STAGES.includes(currentStage)
            ? "current"
            : "upcoming",
    },
    {
      key: "contract",
      title: "Contract & NDA",
      description: contractDescription,
      status:
        contractCompleted
          ? "completed"
          : currentStage === "contract_sent"
            ? "current"
            : "upcoming",
    },
    {
      key: "onboarding",
      title: "Onboarding & compliance",
      description: onboardingDescription,
      status:
        currentStage === "onboarding_completed"
          ? "completed"
          : ONBOARDING_IN_PROGRESS_STAGES.includes(currentStage)
            ? "current"
            : "upcoming",
    },
  ];
}


export default function CandidateApplicationPage() {
  return (
    <Suspense fallback={<ApplicationPageState message="Loading your application details..." loading />}>
      <CandidateApplicationPageContent />
    </Suspense>
  );
}

function CandidateApplicationPageContent() {
  const searchParams = useSearchParams();
  const selectedPositionId = searchParams.get("positionId");
  const [overview, setOverview] = useState<CandidatePortalOverview | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<Position | null>(null);
  const [platformAssignments, setPlatformAssignments] = useState<ApMyAssignment[]>([]);
  const [assessmentRows, setAssessmentRows] = useState<AssessmentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState("");

  const loadPortal = async () => {
    const data = await candidatesApi.me();
    setOverview(data);
    return data;
  };

  useEffect(() => {
    let cancelled = false;

    const loadApplicationView = async () => {
      try {
        const [portal, position, platformRows, manualRows] = await Promise.all([
          candidatesApi.me(),
          selectedPositionId ? positionsApi.publicGet(selectedPositionId).catch(() => null) : Promise.resolve(null),
          assessmentPlatformApi.myAssignments().catch(() => []),
          assessmentsApi.mine().catch(() => []),
        ]);
        if (cancelled) return;
        setOverview(portal);
        setSelectedPosition(position);
        setPlatformAssignments(platformRows);
        setAssessmentRows(manualRows);
      } catch {
        if (!cancelled) {
          setError("Unable to load your application view right now.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadApplicationView();
    return () => {
      cancelled = true;
    };
  }, [selectedPositionId]);

  const currentApplication = overview?.currentApplication;
  const assessmentSummary = buildAssessmentTrackerSummary(
    platformAssignments,
    assessmentRows,
    currentApplication?.currentStatus,
  );
  const trackerSteps = buildApplicationTracker(currentApplication, assessmentSummary);
  const currentPositionId = currentApplication?.positionId;
  const canSwitchRole =
    !!selectedPosition &&
    !!currentApplication &&
    currentApplication.currentStage === "new_application";

  const alreadyApplied =
    !!selectedPosition && !!currentApplication && currentPositionId === selectedPosition.id;

  const canApplySelectedRole =
    !!selectedPosition &&
    !!currentApplication &&
    (!currentPositionId || currentPositionId === selectedPosition.id || canSwitchRole);

  const activePosition = selectedPosition || currentApplication?.position || null;

  const statusMessage = useMemo(() => {
    if (!selectedPosition) return "";
    if (alreadyApplied) {
      return "You have already applied for this role. We'll keep the tracker below updated as your application moves ahead.";
    }
    if (canSwitchRole && currentPositionId && currentPositionId !== selectedPosition.id) {
      return "You can still switch roles because your application is in its earliest stage.";
    }
    if (!canApplySelectedRole) {
      return "You already have an application in progress for another role. Keep tracking it here, or contact HR if you need to change the role.";
    }
    return "Your profile is ready. Submit this role to your HRMS application record when you're ready.";
  }, [alreadyApplied, canApplySelectedRole, canSwitchRole, currentPositionId, selectedPosition]);

  const handleApply = async () => {
    if (!selectedPosition) return;
    setIsApplying(true);
    setError("");
    try {
      await candidatesApi.apply(selectedPosition.id);
      await loadPortal();
      toast.success("Application submitted successfully.");
    } catch (err: unknown) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      const detail = apiError.response?.data?.detail || "Unable to apply for this role right now.";
      setError(detail);
      toast.error(detail);
    } finally {
      setIsApplying(false);
    }
  };

  if (isLoading) {
    return <ApplicationPageState message="Loading your application details..." loading />;
  }

  if (!overview) {
    return <ApplicationPageState message={error || "We couldn't load your application details."} />;
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Candidate application</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {selectedPosition ? selectedPosition.title : currentApplication?.position?.title || "My application"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {statusMessage || "Browse open roles and submit a position to your candidate account."}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/careers">
              <Button variant="outline" className="rounded-full">
                Browse roles
              </Button>
            </Link>
            {selectedPosition && canApplySelectedRole && !alreadyApplied && (
              <Button onClick={handleApply} disabled={isApplying} className="rounded-full">
                {isApplying ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Applying...
                  </>
                ) : (
                  <>
                    Apply for this role
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>

      {(error || statusMessage) && (
        <Card className={cn("border shadow-sm", error ? "border-destructive/30 bg-destructive/5" : "border-info/20 bg-info/5")}>
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className={cn("mt-0.5 h-5 w-5", error ? "text-destructive" : "text-info")} />
            <p className="text-sm text-muted-foreground">{error || statusMessage}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-xl border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Application tracker</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!currentApplication && (
              <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                Your candidate account exists, but no job role has been attached to it yet.
              </div>
            )}

            {currentApplication && (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge className={cn("rounded-full border-0", STAGE_COLORS[currentApplication.currentStage])}>
                    {STAGE_LABELS[currentApplication.currentStage]}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    Applied {currentApplication.lastAppliedAt ? formatDate(currentApplication.lastAppliedAt) : formatDate(currentApplication.createdAt)}
                  </span>
                </div>

                <div className="space-y-3">
                  {trackerSteps.map((step, index) => (
                    <div key={step.key} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-full",
                            step.status === "completed" && "bg-primary/10 text-primary",
                            step.status === "current" && "bg-info/10 text-info",
                            step.status === "failed" && "bg-destructive/10 text-destructive",
                            step.status === "upcoming" && "bg-muted text-muted-foreground"
                          )}
                        >
                          {step.status === "completed" ? (
                            <CheckCircle2 className="h-4 w-4" />
                          ) : step.status === "failed" ? (
                            <AlertCircle className="h-4 w-4" />
                          ) : step.status === "current" ? (
                            <Clock3 className="h-4 w-4" />
                          ) : (
                            <span className="text-xs font-semibold">{index + 1}</span>
                          )}
                        </div>
                        {index < trackerSteps.length - 1 && <div className="mt-1 h-8 w-px bg-border" />}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-semibold">{step.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="rounded-xl border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Role details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {activePosition ? (
                <>
                  <div>
                    <p className="text-xl font-semibold">{activePosition.title}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {activePosition.summary || activePosition.description}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><Briefcase className="h-4 w-4" />{activePosition.department}</span>
                    <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{activePosition.location || "Bengaluru, India"}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" />{activePosition.workMode || "Hybrid"}</span>
                    <span className="inline-flex items-center gap-1.5"><Target className="h-4 w-4" />{activePosition.experienceLevel || "Mid-Senior"}</span>
                  </div>
                  {(activePosition.requirements || []).length > 0 && (
                    <div>
                      <p className="text-sm font-semibold">Core requirements</p>
                      <div className="mt-3 space-y-2">
                        {activePosition.requirements?.slice(0, 3).map((item) => (
                          <div key={item} className="rounded-xl bg-muted/40 p-3 text-sm text-muted-foreground">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Select a role from the careers page to see the job details here.</p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">What you can do next</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: "Update candidate profile", href: "/portal/profile" },
                { label: "Explore other roles", href: "/careers" },
              ].map((action) => (
                <Link key={action.href} href={action.href}>
                  <div className="rounded-xl border border-border p-4 text-sm font-medium transition-colors hover:border-primary/25 hover:bg-muted/40">
                    {action.label}
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ApplicationPageState({
  message,
  loading = false,
}: {
  message: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
      {loading && <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" />}
      {message}
    </div>
  );
}

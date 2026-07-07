"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import {
  cn,
  getInitials,
  getTodayDateInputMin,
  hasAssignedRole,
  timeAgo,
  formatDateTime,
  formatLabel,
  STAGE_LABELS,
} from "@/lib/utils";
import {
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Clock,
  ClipboardCheck,
  Loader2,
  Send,
  ChevronRight,
  User,
  Briefcase,
  XCircle,
  Star,
  BarChart2,
  ChevronDown,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  candidatesApi,
  evaluationsApi,
  pmsApi,
  assessmentsApi,
  usersApi,
} from "@/lib/api";
import type { PmsEvaluationRecord, EvaluatorCandidateRecord } from "@/lib/api";

const PI_MODES = [
  { value: "google_meet", label: "Google Meet" },
  { value: "offline", label: "Offline / In-person" },
  { value: "phone", label: "Phone Call" },
  { value: "teams", label: "Microsoft Teams" },
  { value: "zoom", label: "Zoom" },
];

type SelectionCandidate = {
  id: string;
  candidateCode: string;
  fullName: string;
  currentStage: string;
  position?: { title?: string } | null;
  createdAt: string;
};

type ApiEvaluation = {
  id: string;
  candidateId: string;
  evaluatorId: string;
  candidate?: {
    id?: string;
    candidateCode?: string;
    fullName?: string;
    full_name?: string;
    personalEmail?: string;
    currentStage?: string;
    currentStatus?: string;
    position?: { title: string };
  };
  evaluator?: { name: string; email?: string };
  technicalSkills?: number;
  communication?: number;
  problemSolving?: number;
  culturalFit?: number;
  attitude?: number;
  totalScore?: number;
  recommendation?: string;
  notes?: string;
  completedAt?: string;
  interviewSubject?: string;
  interviewScheduledAt?: string;
  interviewStatus?: string;
  interviewMode?: string;
  piRounds?: {
    id?: string;
    roundNumber?: number;
    panelLabel?: string | null;
    subject?: string | null;
    scheduledAt?: string | null;
    completedAt?: string | null;
    status?: string | null;
    mode?: string | null;
    durationMinutes?: number | null;
    score?: number | null;
    remarks?: string | null;
    roundDecision?: string | null;
    noFurtherPiRequired?: boolean | null;
    finalVerdict?: string | null;
    panelMembers?: string[] | null;
    evaluatorName?: string | null;
  }[];
  createdAt?: string;
};

const MAX_PI_ROUNDS = 5;

const DEFAULT_SCHEDULE_FORM = {
  subject: "PI Interview",
  date: "",
  time: "",
  durationMinutes: "60",
  mode: "google_meet",
  notes: "",
  evaluatorId: "",
  interviewerEmail: "",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseInterviewerEmails(value: string) {
  return value
    .split(/[,\s;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function dateTimeInputParts(value?: string | null) {
  if (!value) return { date: "", time: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return {
    date: date.toISOString().slice(0, 10),
    time: date.toISOString().slice(11, 16),
  };
}

const criteria = [
  { key: "technicalSkills", label: "Technical Skills", weight: 30 },
  { key: "communication", label: "Communication", weight: 20 },
  { key: "problemSolving", label: "Problem Solving", weight: 20 },
  { key: "culturalFit", label: "Cultural Fit", weight: 15 },
  { key: "attitude", label: "Attitude & Motivation", weight: 15 },
];

const PMS_RATING_COLORS: Record<string, string> = {
  unsatisfactory: "bg-rose-100 text-rose-700",
  needs_improvement: "bg-orange-100 text-orange-700",
  average: "bg-amber-100 text-amber-700",
  meets_expectations: "bg-sky-100 text-sky-700",
  exceeds_expectations: "bg-emerald-100 text-emerald-700",
  above_expectation: "bg-emerald-100 text-emerald-700",
};

const PMS_RATING_LABELS: Record<string, string> = {
  unsatisfactory: "Unsatisfactory",
  needs_improvement: "Needs Improvement",
  average: "Average",
  meets_expectations: "Meets Expectations",
  exceeds_expectations: "Exceeds Expectations",
  above_expectation: "Exceeds Expectations",
};

const PMS_METRIC_KEYS = [
  "verbalClarity",
  "conciseness",
  "fluency",
  "vocabulary",
  "pronunciation",
  "nonverbalConfidence",
  "introBackground",
  "etharaAwareness",
  "currentAffairs",
  "instagramFamiliarity",
  "promptEngineering",
  "videoEditing",
] as const;

const PMS_METRIC_LABELS: Record<string, string> = {
  verbalClarity: "Verbal Clarity",
  conciseness: "Conciseness",
  fluency: "Fluency",
  vocabulary: "Vocabulary",
  pronunciation: "Pronunciation",
  nonverbalConfidence: "Non-verbal",
  introBackground: "Intro",
  etharaAwareness: "Ethara Awareness",
  currentAffairs: "Current Affairs",
  instagramFamiliarity: "Instagram",
  promptEngineering: "Prompt Eng.",
  videoEditing: "Video Editing",
};

function getTopPmsMetrics(rec: PmsEvaluationRecord) {
  return PMS_METRIC_KEYS.map((key) => ({ key, val: rec.scores[key] ?? 0 }))
    .sort((a, b) => b.val - a.val)
    .slice(0, 3)
    .filter((metric) => metric.val > 0);
}

function formatPmsNumber(value: number | null) {
  if (value === null) return "—";
  return value.toFixed(2);
}

function formatScoreValue(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(2);
}

type Scores = Record<string, number>;

type ActiveTab =
  | "evaluations"
  | "pi-scheduling"
  | "pms-scores"
  | "performance-report";

export default function EvaluationsPage() {
  const minScheduleDate = getTodayDateInputMin();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ActiveTab>("evaluations");
  const [selected, setSelected] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, Scores>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [piScores, setPiScores] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleTarget, setScheduleTarget] = useState<string | null>(null);
  const [scheduleForm, setScheduleForm] = useState(DEFAULT_SCHEDULE_FORM);
  const [scheduleRoundNumber, setScheduleRoundNumber] = useState<number | null>(
    null,
  );
  const [scheduling, setScheduling] = useState(false);
  const [completingRound, setCompletingRound] = useState<string | null>(null);
  const [assigningScheduleCandidateId, setAssigningScheduleCandidateId] =
    useState<string | null>(null);
  const [pageLoadedAt] = useState(() => Date.now());

  const { data: evaluations = [], isLoading } = useQuery({
    queryKey: ["evaluations-page"],
    queryFn: async () => {
      try {
        const data = await evaluationsApi.list();
        return Array.isArray(data)
          ? data
          : ((data as { data?: ApiEvaluation[] }).data ?? []);
      } catch {
        toast.error("Failed to load evaluations");
        return [] as ApiEvaluation[];
      }
    },
  });

  const { data: selectionCandidates = [], isLoading: loadingSelection } =
    useQuery({
      queryKey: ["pi-selection-candidates"],
      queryFn: async () => {
        try {
          // Include shortlisted and evaluation-assigned stages so candidates appear
          // in the queue immediately after screening shortlists them.
          const selectionStages = [
            "resume_shortlisted",
            "evaluation_assigned",
            "evaluation_in_progress",
            "selection_form_sent",
            "selection_form_submitted",
            "selection_form_validated",
          ];
          const results = await Promise.all(
            selectionStages.map((stage) =>
              candidatesApi.list({ stage, limit: 200 }),
            ),
          );
          const all: SelectionCandidate[] = results.flatMap(
            (result) => result.data ?? [],
          );
          return Array.from(
            new Map(all.map((candidate) => [candidate.id, candidate])).values(),
          );
        } catch {
          toast.error("Failed to load selection-stage candidates");
          return [] as SelectionCandidate[];
        }
      },
    });

  // Keep the two PI data sources (Evaluation records + selection-stage candidates) in
  // sync: invalidate BOTH after any mutation so scheduled/passed states never diverge.
  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["evaluations-page"] }),
      queryClient.invalidateQueries({ queryKey: ["pi-selection-candidates"] }),
    ]);
  };

  const mergeEvaluationCache = (updated: ApiEvaluation) => {
    queryClient.setQueryData<ApiEvaluation[]>(
      ["evaluations-page"],
      (current) => {
        const rows = Array.isArray(current) ? current : [];
        const index = rows.findIndex((item) => item.id === updated.id);
        if (index === -1) return [updated, ...rows];
        return rows.map((item) =>
          item.id === updated.id ? { ...item, ...updated } : item,
        );
      },
    );
  };

  // Candidates eligible for PI that don't yet have an evaluation — shown in the merged
  // list with a "Schedule PI" action (this folds the old PI Scheduling tab in here).
  const unscheduledCandidates = useMemo(() => {
    const withEval = new Set(evaluations.map((e) => e.candidateId));
    return selectionCandidates.filter((c) => !withEval.has(c.id));
  }, [evaluations, selectionCandidates]);

  const getStatus = (ev: ApiEvaluation) => {
    if (ev.completedAt)
      return { label: "Completed", cls: "bg-green-100 text-green-700" };
    if (
      ev.interviewStatus === "scheduled" ||
      ev.interviewStatus === "rescheduled" ||
      ev.interviewScheduledAt
    )
      return { label: "Interview Scheduled", cls: "bg-blue-100 text-blue-700" };
    const isOverdue =
      ev.createdAt &&
      pageLoadedAt - new Date(ev.createdAt).getTime() > 72 * 3600 * 1000;
    if (isOverdue) return { label: "Overdue", cls: "bg-red-100 text-red-700" };
    return { label: "Pending", cls: "bg-amber-100 text-amber-700" };
  };

  const [piSearch, setPiSearch] = useState("");
  const piQuery = piSearch.trim().toLowerCase();
  const matchPi = (...values: Array<string | null | undefined>) =>
    !piQuery ||
    values.some((value) => (value ?? "").toLowerCase().includes(piQuery));
  const filteredUnscheduled = unscheduledCandidates.filter((c) =>
    matchPi(
      c.fullName,
      c.candidateCode,
      c.position?.title,
      STAGE_LABELS[c.currentStage as keyof typeof STAGE_LABELS],
    ),
  );
  const filteredEvaluations = evaluations.filter((e) => {
    const status = getStatus(e);
    return matchPi(
      e.candidate?.fullName ?? e.candidate?.full_name,
      e.candidate?.candidateCode,
      e.candidate?.personalEmail,
      e.candidate?.position?.title,
      e.evaluator?.name,
      e.evaluator?.email,
      status.label,
      e.interviewSubject,
    );
  });

  const { data: allPmsRecords = [], isLoading: loadingPms } = useQuery({
    queryKey: ["evaluations-pms-all"],
    queryFn: async () => {
      try {
        return await pmsApi.list();
      } catch {
        toast.error("Failed to load PMS scores");
        return [] as PmsEvaluationRecord[];
      }
    },
    enabled: activeTab === "pms-scores",
  });

  const { data: evaluatorView = [], isLoading: loadingEvaluatorView } =
    useQuery({
      queryKey: ["evaluations-performance-report"],
      queryFn: async () => {
        try {
          return await assessmentsApi.evaluatorView();
        } catch {
          toast.error("Failed to load performance report");
          return [] as EvaluatorCandidateRecord[];
        }
      },
      enabled: activeTab === "performance-report",
    });
  const { data: usersData = [] } = useQuery({
    queryKey: ["users"],
    queryFn: usersApi.list,
    staleTime: 300_000,
  });
  const evaluators = (Array.isArray(usersData) ? usersData : []).filter(
    (user): user is { id: string; name: string; role: string; roles?: string[] } =>
      hasAssignedRole(user, ["evaluator"]),
  );

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const ev = evaluations.find((e) => e.id === selected);
  const candidateName =
    ev?.candidate?.fullName ?? ev?.candidate?.full_name ?? "Unknown Candidate";
  const positionTitle = ev?.candidate?.position?.title ?? "Unknown Position";

  const getScore = (id: string, key: string) => scores[id]?.[key] ?? 0;
  const setScore = (id: string, key: string, val: number) =>
    setScores((prev) => ({ ...prev, [id]: { ...prev[id], [key]: val } }));
  const totalScore = (id: string) =>
    criteria.reduce(
      (acc, c) => acc + (getScore(id, c.key) * c.weight) / 100,
      0,
    );

  const handleSubmit = async (id: string) => {
    if (!criteria.every((c) => getScore(id, c.key) > 0)) {
      toast.error("Please score all criteria before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      const score = totalScore(id);
      await evaluationsApi.submit(id, {
        technicalSkills: getScore(id, "technicalSkills"),
        communication: getScore(id, "communication"),
        problemSolving: getScore(id, "problemSolving"),
        culturalFit: getScore(id, "culturalFit"),
        attitude: getScore(id, "attitude"),
        totalScore: score,
        notes: notes[id] ?? "",
        recommendation:
          score >= 7
            ? "strongly_recommended"
            : score >= 5
              ? "passed"
              : "rejected",
      });
      toast.success("Evaluation submitted successfully");
      setSelected(null);
      await refreshAll();
    } catch {
      toast.error("Failed to submit evaluation");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSchedule = async () => {
    if (
      !scheduleTarget ||
      !scheduleForm.subject ||
      !scheduleForm.date ||
      !scheduleForm.time
    ) {
      toast.error("Meeting title, date, and time are required");
      return;
    }
    const scheduledAt = new Date(
      `${scheduleForm.date}T${scheduleForm.time}:00`,
    ).toISOString();
    const notesWithDuration = scheduleForm.notes.trim()
      ? `${scheduleForm.notes.trim()}\nDuration: ${scheduleForm.durationMinutes} min`
      : `Duration: ${scheduleForm.durationMinutes} min`;
    const panelMembers = parseInterviewerEmails(scheduleForm.interviewerEmail);
    const invalidEmails = panelMembers.filter(
      (email) => !EMAIL_PATTERN.test(email),
    );
    if (invalidEmails.length > 0) {
      toast.error(
        `Enter valid interviewer email ID${invalidEmails.length > 1 ? "s" : ""}: ${invalidEmails.join(", ")}`,
      );
      return;
    }
    setScheduling(true);
    try {
      const scheduled = (await evaluationsApi.schedule(scheduleTarget, {
        subject: scheduleForm.subject,
        scheduledAt,
        notes: notesWithDuration,
        mode: scheduleForm.mode,
        durationMinutes: parseInt(scheduleForm.durationMinutes, 10) || 60,
        evaluatorId: scheduleForm.evaluatorId || undefined,
        panelMembers,
        roundNumber: scheduleRoundNumber ?? undefined,
      })) as ApiEvaluation;
      mergeEvaluationCache(scheduled);
      toast.success(
        scheduleRoundNumber
          ? `PI Round ${scheduleRoundNumber} scheduled`
          : "PI Interview scheduled",
      );
      setScheduleOpen(false);
      setScheduleForm(DEFAULT_SCHEDULE_FORM);
      setScheduleRoundNumber(null);
      await refreshAll();
    } catch {
      toast.error("Failed to schedule interview");
    } finally {
      setScheduling(false);
    }
  };

  const openSchedule = async (candidate: SelectionCandidate) => {
    setAssigningScheduleCandidateId(candidate.id);
    try {
      const evalForCandidate = evaluations.find(
        (evaluation) => evaluation.candidateId === candidate.id,
      );
      const ensuredEvaluation =
        evalForCandidate ??
        ((await evaluationsApi.assign({
          candidateId: candidate.id,
        })) as ApiEvaluation);
      if (!evalForCandidate) mergeEvaluationCache(ensuredEvaluation);
      setScheduleTarget(ensuredEvaluation.id);
      setScheduleForm({
        ...DEFAULT_SCHEDULE_FORM,
        evaluatorId: ensuredEvaluation.evaluatorId ?? "",
      });
      setScheduleOpen(true);
      if (!evalForCandidate) {
        await refreshAll();
      }
    } catch (err) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      toast.error(
        apiError.response?.data?.detail || "Could not prepare PI scheduling.",
      );
    } finally {
      setAssigningScheduleCandidateId(null);
    }
  };

  // Reschedule a specific (active) round, or schedule the NEXT round when
  // roundNumber is the next unused slot. roundNumber=null lets the backend
  // auto-assign (first round).
  const openEvaluationSchedule = (
    evaluation: ApiEvaluation,
    opts?: {
      roundNumber?: number;
      reschedule?: {
        subject?: string | null;
        scheduledAt?: string | null;
        mode?: string | null;
        durationMinutes?: number | null;
        panelMembers?: string[] | null;
      };
    },
  ) => {
    const latestRound = evaluation.piRounds?.[evaluation.piRounds.length - 1];
    const src = opts?.reschedule ?? {
      subject: evaluation.interviewSubject ?? latestRound?.subject,
      scheduledAt: evaluation.interviewScheduledAt ?? latestRound?.scheduledAt,
      mode: evaluation.interviewMode ?? latestRound?.mode,
      durationMinutes: latestRound?.durationMinutes,
      panelMembers: latestRound?.panelMembers,
    };
    const dateParts = dateTimeInputParts(
      opts?.reschedule
        ? src.scheduledAt
        : opts?.roundNumber
          ? null
          : src.scheduledAt,
    );

    setScheduleTarget(evaluation.id);
    setScheduleRoundNumber(opts?.roundNumber ?? null);
    setScheduleForm({
      ...DEFAULT_SCHEDULE_FORM,
      subject: opts?.roundNumber
        ? `PI Round ${opts.roundNumber}`
        : (src.subject ?? DEFAULT_SCHEDULE_FORM.subject),
      date: dateParts.date,
      time: dateParts.time,
      durationMinutes: String(
        src.durationMinutes ?? DEFAULT_SCHEDULE_FORM.durationMinutes,
      ),
      mode: src.mode ?? DEFAULT_SCHEDULE_FORM.mode,
      evaluatorId: evaluation.evaluatorId ?? "",
      interviewerEmail: (src.panelMembers ?? []).join(", "),
    });
    setScheduleOpen(true);
  };

  // Complete a single PI round. mode "next" closes it as pass-and-continue (a
  // further round can then be scheduled); "select"/"reject" are FINAL verdicts
  // that advance the candidate's stage (backend: EVALUATION_PASSED / FAILED).
  const handleCompleteRound = async (
    evaluationId: string,
    round: NonNullable<ApiEvaluation["piRounds"]>[number],
    mode: "next" | "select" | "reject",
    score?: string,
  ) => {
    const key = round.id ?? `${evaluationId}-${round.roundNumber}`;
    setCompletingRound(key);
    try {
      const parsed = score && score.trim() ? parseFloat(score) : undefined;
      await evaluationsApi.complete(evaluationId, {
        decision:
          mode === "next"
            ? "proceed_to_next_round"
            : mode === "select"
              ? "selected"
              : "rejected",
        roundId: round.id,
        roundNumber: round.roundNumber,
        piScore: parsed !== undefined && !isNaN(parsed) ? parsed : undefined,
        noFurtherPiRequired: mode !== "next",
        finalVerdict:
          mode === "select"
            ? "selected"
            : mode === "reject"
              ? "rejected"
              : null,
      });
      toast.success(
        mode === "next"
          ? `Round ${round.roundNumber} passed — schedule the next round`
          : mode === "select"
            ? "Candidate selected — moved to next stage"
            : "Candidate rejected",
      );
      if (mode !== "next") setSelected(null);
      await refreshAll();
    } catch (err) {
      const apiError = err as { response?: { data?: { detail?: string } } };
      toast.error(
        apiError.response?.data?.detail || "Failed to record round outcome",
      );
    } finally {
      setCompletingRound(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-w-0 max-w-full space-y-6 overflow-x-hidden animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-primary/10 p-2.5">
          <ClipboardCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">Evaluations</h1>
          <p className="text-sm text-muted-foreground">
            {evaluations.filter((e) => !e.completedAt).length} pending &middot;{" "}
            {evaluations.filter((e) => e.completedAt).length} completed
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1 border-b border-border sm:flex sm:items-center">
        {[
          {
            key: "evaluations" as ActiveTab,
            label: "Personal Interview",
            icon: ClipboardCheck,
          },
          {
            key: "performance-report" as ActiveTab,
            label: "Performance Report",
            icon: BarChart2,
          },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1.5 border-b-2 px-2 py-2.5 text-center text-xs font-medium leading-tight transition-colors sm:justify-start sm:px-4 sm:text-sm",
              activeTab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            <span className="min-w-0 break-words">{t.label}</span>
          </button>
        ))}
      </div>

      {activeTab === "pi-scheduling" && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Candidates at Selection Form stage — schedule PI interview for any
              of them.
            </p>
          </div>
          {loadingSelection ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : selectionCandidates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <p className="text-sm font-medium">
                No candidates at Selection Form stage
              </p>
              <p className="text-xs mt-1">
                Candidates here have completed the evaluation stage.
              </p>
            </div>
          ) : (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="space-y-3 p-3 sm:hidden">
                  {selectionCandidates.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl border border-border bg-muted/10 p-3"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                            {getInitials(c.fullName)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <p className="min-w-0 break-words text-sm font-semibold">
                              {c.fullName}
                            </p>
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                              {STAGE_LABELS[
                                c.currentStage as keyof typeof STAGE_LABELS
                              ] ?? formatLabel(c.currentStage)}
                            </span>
                          </div>
                          <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                            {c.candidateCode}
                          </p>
                          <p className="mt-2 break-words text-xs text-muted-foreground">
                            {c.position?.title ?? "—"}
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            Since {timeAgo(c.createdAt)}
                          </p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 h-9 w-full rounded-xl text-xs gap-1"
                        disabled={assigningScheduleCandidateId === c.id}
                        onClick={() => void openSchedule(c)}
                      >
                        {assigningScheduleCandidateId === c.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <CalendarPlus className="h-3 w-3" />
                        )}{" "}
                        Schedule PI
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {["Candidate", "Role", "Stage", "Since", ""].map(
                          (h) => (
                            <th
                              key={h}
                              className="py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left"
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {selectionCandidates.map((c) => (
                        <tr
                          key={c.id}
                          className="border-b border-border/40 hover:bg-muted/20 transition-colors group"
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Avatar className="h-7 w-7">
                                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                  {getInitials(c.fullName)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <p className="text-xs font-medium">
                                  {c.fullName}
                                </p>
                                <p className="text-[10px] text-muted-foreground font-mono">
                                  {c.candidateCode}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">
                            {c.position?.title ?? "—"}
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {STAGE_LABELS[
                                c.currentStage as keyof typeof STAGE_LABELS
                              ] ?? formatLabel(c.currentStage)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-xs text-muted-foreground">
                            {timeAgo(c.createdAt)}
                          </td>
                          <td className="py-3 px-4">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-full text-xs h-7 gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100"
                              disabled={assigningScheduleCandidateId === c.id}
                              onClick={() => void openSchedule(c)}
                            >
                              {assigningScheduleCandidateId === c.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CalendarPlus className="h-3 w-3" />
                              )}{" "}
                              Schedule PI
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

      {activeTab === "evaluations" && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[320px_1fr]">
          <div className="min-w-0 space-y-3 px-1 sm:px-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search candidate, code, email, role…"
                value={piSearch}
                onChange={(e) => setPiSearch(e.target.value)}
                className="h-9 rounded-xl pl-9 text-sm"
              />
            </div>
            {/* Candidates eligible for PI but not yet scheduled — schedule them right here. */}
            {filteredUnscheduled.map((c) => (
              <Card
                key={`unsched-${c.id}`}
                className="min-w-0 overflow-hidden rounded-2xl border border-border/70 shadow-sm sm:border-0"
              >
                <CardContent className="p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="h-11 w-11 shrink-0 sm:h-9 sm:w-9">
                      <AvatarFallback className="text-xs">
                        {getInitials(c.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium sm:truncate">
                        {c.fullName}
                      </p>
                      <p className="mt-0.5 break-words text-xs text-muted-foreground sm:truncate">
                        {c.position?.title ?? "No position"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      Not scheduled
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => void openSchedule(c)}
                      disabled={assigningScheduleCandidateId === c.id}
                    >
                      {assigningScheduleCandidateId === c.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <CalendarPlus className="h-3 w-3" />
                      )}
                      Schedule PI
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {filteredEvaluations.length === 0 &&
            filteredUnscheduled.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                {piSearch
                  ? "No matching candidates."
                  : "No candidates in the Personal Interview stage yet."}
              </div>
            ) : (
              filteredEvaluations.map((item) => {
                const name =
                  item.candidate?.fullName ??
                  item.candidate?.full_name ??
                  "Unknown";
                const pos = item.candidate?.position?.title ?? "No position";
                const st = getStatus(item);
                return (
                  <Card
                    key={item.id}
                    onClick={() =>
                      setSelected(item.id === selected ? null : item.id)
                    }
                    className={cn(
                      "min-w-0 cursor-pointer overflow-hidden rounded-2xl border border-border/70 shadow-sm transition-all hover:shadow-md sm:border-0",
                      selected === item.id && "ring-2 ring-inset ring-primary",
                    )}
                  >
                    <CardContent className="p-4 sm:p-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="h-11 w-11 shrink-0 sm:h-9 sm:w-9">
                          <AvatarFallback className="text-xs">
                            {getInitials(name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium sm:truncate">
                            {name}
                          </p>
                          <p className="mt-0.5 break-words text-xs text-muted-foreground sm:truncate">
                            {pos}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-2">
                        <span
                          className={cn(
                            "text-[10px] font-medium px-2 py-0.5 rounded-full",
                            st.cls,
                          )}
                        >
                          {st.label}
                        </span>
                        {item.totalScore !== undefined &&
                          item.totalScore > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              Score: {item.totalScore.toFixed(1)}/10
                            </span>
                          )}
                        {item.interviewScheduledAt && (
                          <span className="text-[10px] text-blue-600 flex items-center gap-0.5">
                            <CalendarClock className="h-3 w-3" />
                            {new Date(
                              item.interviewScheduledAt,
                            ).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>

          {/* Evaluation Panel */}
          <div className="min-w-0 px-1 sm:px-0">
            {!ev ? (
              <Card className="border-0 shadow-sm">
                <CardContent className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground gap-3">
                  <ClipboardCheck className="h-10 w-10 opacity-20" />
                  <p className="text-sm">
                    Select a candidate to begin evaluation
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                <Card className="border-0 shadow-sm">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <CardTitle className="text-base">
                        {candidateName}
                      </CardTitle>
                    </div>
                    <CardDescription className="flex flex-wrap items-center gap-3 text-xs">
                      <span className="flex items-center gap-1">
                        <Briefcase className="h-3.5 w-3.5" />
                        {positionTitle}
                      </span>
                      {ev.evaluator && (
                        <span className="flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {ev.evaluator.name}
                        </span>
                      )}
                      {ev.createdAt && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {timeAgo(ev.createdAt)}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                </Card>

                {/* Personal Interview rounds — stacked, up to 5 levels */}
                {(() => {
                  const rounds = [...(ev.piRounds ?? [])].sort(
                    (a, b) => (a.roundNumber ?? 0) - (b.roundNumber ?? 0),
                  );
                  const finalVerdict =
                    rounds.find((r) => r.finalVerdict)?.finalVerdict ?? null;
                  const activeRound = rounds.find((r) => !r.completedAt);
                  const latest = rounds[rounds.length - 1];
                  const nextRoundNumber = (latest?.roundNumber ?? 0) + 1;
                  // Can schedule the next round when: no final verdict yet, no round
                  // currently awaiting an outcome, and we're under the 5-round cap.
                  const canScheduleNext =
                    !finalVerdict &&
                    !activeRound &&
                    nextRoundNumber <= MAX_PI_ROUNDS &&
                    !ev.completedAt;
                  return (
                    <Card className="border-0 shadow-sm">
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm">
                            Personal Interview Rounds
                          </CardTitle>
                          <span className="text-[11px] text-muted-foreground">
                            {rounds.length}/{MAX_PI_ROUNDS} scheduled
                          </span>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {rounds.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No interview rounds scheduled yet.
                          </p>
                        )}

                        {rounds.map((round) => {
                          const isActive = !round.completedAt;
                          const roundKey =
                            round.id ?? `${ev.id}-${round.roundNumber}`;
                          const busy = completingRound === roundKey;
                          const verdict = round.finalVerdict;
                          const decisionLabel = verdict
                            ? verdict === "selected"
                              ? "Selected (final)"
                              : "Rejected (final)"
                            : round.roundDecision === "proceed_to_next_round"
                              ? "Passed → next round"
                              : round.completedAt
                                ? "Completed"
                                : "Awaiting outcome";
                          const badgeCls =
                            verdict === "selected"
                              ? "bg-emerald-100 text-emerald-700"
                              : verdict === "rejected"
                                ? "bg-red-100 text-red-700"
                                : isActive
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-blue-100 text-blue-700";
                          return (
                            <div
                              key={roundKey}
                              className="rounded-xl border border-border/70 p-3 space-y-2"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium">
                                    Round {round.roundNumber}
                                    {round.panelLabel
                                      ? ` · ${round.panelLabel}`
                                      : ""}
                                  </p>
                                  {round.scheduledAt && (
                                    <p className="text-[11px] text-muted-foreground">
                                      {formatDateTime(round.scheduledAt)}
                                    </p>
                                  )}
                                </div>
                                <span
                                  className={cn(
                                    "text-[10px] font-medium px-2 py-0.5 rounded-full",
                                    badgeCls,
                                  )}
                                >
                                  {decisionLabel}
                                </span>
                              </div>
                              {(round.score != null || round.evaluatorName) && (
                                <p className="text-[11px] text-muted-foreground">
                                  {round.score != null && (
                                    <>
                                      Score:{" "}
                                      <span className="font-medium">
                                        {round.score}
                                      </span>
                                      {round.evaluatorName ? " · " : ""}
                                    </>
                                  )}
                                  {round.evaluatorName}
                                </p>
                              )}

                              {isActive && !ev.completedAt && (
                                <div className="space-y-2 pt-1">
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      min="0"
                                      max="100"
                                      placeholder="Score (0–100)"
                                      value={piScores[roundKey] ?? ""}
                                      onChange={(e) =>
                                        setPiScores((p) => ({
                                          ...p,
                                          [roundKey]: e.target.value,
                                        }))
                                      }
                                      className="h-8 rounded-lg text-xs"
                                    />
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 shrink-0 rounded-lg text-xs gap-1"
                                      onClick={() =>
                                        openEvaluationSchedule(ev, {
                                          roundNumber: round.roundNumber,
                                          reschedule: round,
                                        })
                                      }
                                    >
                                      <CalendarClock className="h-3.5 w-3.5" />{" "}
                                      Reschedule
                                    </Button>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {(round.roundNumber ?? 1) <
                                      MAX_PI_ROUNDS && (
                                      <Button
                                        size="sm"
                                        disabled={busy}
                                        className="flex-1 gap-1 bg-blue-600 hover:bg-blue-700 text-xs h-8"
                                        onClick={() =>
                                          handleCompleteRound(
                                            ev.id,
                                            round,
                                            "next",
                                            piScores[roundKey],
                                          )
                                        }
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                                        Pass → Next Round
                                      </Button>
                                    )}
                                    <Button
                                      size="sm"
                                      disabled={busy}
                                      className="flex-1 gap-1 bg-green-600 hover:bg-green-700 text-xs h-8"
                                      onClick={() =>
                                        handleCompleteRound(
                                          ev.id,
                                          round,
                                          "select",
                                          piScores[roundKey],
                                        )
                                      }
                                    >
                                      <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                                      Select
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={busy}
                                      className="flex-1 gap-1 text-xs h-8"
                                      onClick={() =>
                                        handleCompleteRound(
                                          ev.id,
                                          round,
                                          "reject",
                                          piScores[roundKey],
                                        )
                                      }
                                    >
                                      <XCircle className="h-3.5 w-3.5" /> Reject
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {finalVerdict && (
                          <div
                            className={cn(
                              "rounded-xl p-3 text-sm font-medium",
                              finalVerdict === "selected"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20"
                                : "bg-red-50 text-red-700 dark:bg-red-950/20",
                            )}
                          >
                            Final decision:{" "}
                            {finalVerdict === "selected"
                              ? "Selected — candidate advanced to the next stage."
                              : "Rejected."}
                          </div>
                        )}

                        {canScheduleNext && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full gap-1 rounded-xl text-xs h-9"
                            onClick={() =>
                              openEvaluationSchedule(
                                ev,
                                rounds.length === 0
                                  ? undefined
                                  : { roundNumber: nextRoundNumber },
                              )
                            }
                          >
                            <CalendarClock className="h-3.5 w-3.5" />
                            {rounds.length === 0
                              ? "Schedule Interview"
                              : `Schedule Round ${nextRoundNumber}`}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Scoring */}
                {!ev.completedAt && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">
                          Evaluation Scores
                        </CardTitle>
                        <span className="text-sm font-bold text-primary">
                          {totalScore(ev.id).toFixed(2)} / 10
                        </span>
                      </div>
                      <Progress
                        value={totalScore(ev.id) * 10}
                        className="h-1.5 mt-1"
                      />
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {criteria.map((c) => (
                        <div key={c.key}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium">
                              {c.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {c.weight}%
                            </span>
                          </div>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
                              <button
                                key={val}
                                onClick={() => setScore(ev.id, c.key, val)}
                                className={cn(
                                  "flex-1 h-7 rounded text-xs font-medium transition-all",
                                  getScore(ev.id, c.key) === val
                                    ? "bg-primary text-primary-foreground"
                                    : getScore(ev.id, c.key) >= val
                                      ? "bg-primary/20 text-primary"
                                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                                )}
                              >
                                {val}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                      <div>
                        <Label className="text-xs">Notes</Label>
                        <Textarea
                          className="mt-1 text-sm resize-none"
                          rows={3}
                          placeholder="Evaluation notes..."
                          value={notes[ev.id] ?? ""}
                          onChange={(e) =>
                            setNotes((p) => ({ ...p, [ev.id]: e.target.value }))
                          }
                        />
                      </div>
                      <Button
                        className="w-full gap-2"
                        onClick={() => handleSubmit(ev.id)}
                        disabled={submitting}
                      >
                        {submitting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Submitting…
                          </>
                        ) : (
                          <>
                            <Send className="h-4 w-4" />
                            Submit Evaluation
                          </>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Completed */}
                {ev.completedAt && (
                  <Card className="border-0 shadow-sm">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />{" "}
                        Evaluation Complete
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Score</p>
                          <p className="font-bold text-lg">
                            {ev.totalScore?.toFixed(2) ?? "—"} / 10
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            Recommendation
                          </p>
                          <Badge
                            className={cn(
                              "text-[11px] mt-0.5",
                              ev.recommendation === "passed" ||
                                ev.recommendation === "strongly_recommended"
                                ? "bg-green-100 text-green-700"
                                : ev.recommendation === "rejected" ||
                                    ev.recommendation === "failed"
                                  ? "bg-red-100 text-red-700"
                                  : "bg-amber-100 text-amber-700",
                            )}
                          >
                            {ev.recommendation ?? "—"}
                          </Badge>
                        </div>
                      </div>
                      {ev.notes && <p className="text-sm">{ev.notes}</p>}
                      <p className="text-xs text-muted-foreground">
                        Completed {timeAgo(ev.completedAt)}
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PMS Scores Tab */}
      {activeTab === "pms-scores" && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            PMS evaluation scores for all candidates — rated across 12
            performance metrics (0–3 each).
          </p>
          {loadingPms ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : allPmsRecords.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <Star className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">No PMS evaluations found</p>
              <p className="text-xs mt-1">
                PMS records will appear here once HR completes evaluations.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3 sm:hidden">
                {allPmsRecords.map((rec) => {
                  const topMetrics = getTopPmsMetrics(rec);
                  const submittedLabel = rec.submittedAt
                    ? new Date(rec.submittedAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "2-digit",
                      })
                    : rec.createdAt
                      ? timeAgo(rec.createdAt)
                      : "—";

                  return (
                    <div
                      key={rec.id}
                      className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <Avatar className="h-10 w-10 shrink-0">
                          <AvatarFallback className="bg-primary/10 text-xs text-primary">
                            {getInitials(rec.candidateName ?? "?")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="break-words text-sm font-semibold">
                                {rec.candidateName ?? "—"}
                              </p>
                              {rec.candidateCode && (
                                <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">
                                  {rec.candidateCode}
                                </p>
                              )}
                            </div>
                            <span className="shrink-0 whitespace-nowrap text-[10px] text-muted-foreground">
                              {submittedLabel}
                            </span>
                          </div>
                          <p className="mt-2 break-words text-xs text-muted-foreground">
                            {rec.positionTitle ?? "Role not assigned"}
                          </p>
                          <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                            Evaluator: {rec.evaluatorName ?? "—"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Total
                          </p>
                          <p
                            className={cn(
                              "mt-1 text-lg font-bold",
                              rec.totalScore === null
                                ? "text-muted-foreground"
                                : rec.totalScore >= 30
                                  ? "text-emerald-500"
                                  : rec.totalScore >= 18
                                    ? "text-amber-500"
                                    : "text-red-500",
                            )}
                          >
                            {formatPmsNumber(rec.totalScore)}{" "}
                            <span className="text-[10px] font-medium text-muted-foreground">
                              / 36
                            </span>
                          </p>
                        </div>
                        <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Avg / 3
                          </p>
                          <div className="mt-1 flex min-w-0 items-center gap-2">
                            <p
                              className={cn(
                                "text-lg font-bold",
                                rec.averageScore === null
                                  ? "text-muted-foreground"
                                  : rec.averageScore >= 2.5
                                    ? "text-emerald-500"
                                    : rec.averageScore >= 1.5
                                      ? "text-amber-500"
                                      : "text-red-500",
                              )}
                            >
                              {formatPmsNumber(rec.averageScore)}
                            </p>
                            {rec.averageScore !== null && (
                              <Progress
                                value={(rec.averageScore / 3) * 100}
                                className="h-1.5 min-w-0 flex-1"
                              />
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-col gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Rating
                          </span>
                          {rec.overallRating ? (
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-[11px] font-medium",
                                PMS_RATING_COLORS[rec.overallRating] ??
                                  "bg-muted text-muted-foreground",
                              )}
                            >
                              {PMS_RATING_LABELS[rec.overallRating] ??
                                rec.overallRating}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </div>

                        <div>
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Top Metrics
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {topMetrics.map((metric) => (
                              <span
                                key={metric.key}
                                className="rounded-lg bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary"
                              >
                                {PMS_METRIC_LABELS[metric.key]}: {metric.val}
                              </span>
                            ))}
                            {topMetrics.length === 0 && (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Card className="hidden border-0 shadow-sm sm:block">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {[
                            "Candidate",
                            "Position",
                            "Evaluator",
                            "Total",
                            "Avg / 3",
                            "Rating",
                            "Top Metrics",
                            "Date",
                          ].map((h) => (
                            <th
                              key={h}
                              className="py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allPmsRecords.map((rec) => {
                          const topMetrics = getTopPmsMetrics(rec);
                          return (
                            <tr
                              key={rec.id}
                              className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                            >
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-7 w-7">
                                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                      {getInitials(rec.candidateName ?? "?")}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div>
                                    <p className="text-xs font-medium">
                                      {rec.candidateName ?? "—"}
                                    </p>
                                    {rec.candidateCode && (
                                      <p className="text-[10px] text-muted-foreground font-mono">
                                        {rec.candidateCode}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-xs text-muted-foreground">
                                {rec.positionTitle ?? "—"}
                              </td>
                              <td className="py-3 px-4 text-xs text-muted-foreground">
                                {rec.evaluatorName ?? "—"}
                              </td>
                              <td className="py-3 px-4">
                                <span
                                  className={cn(
                                    "text-sm font-bold",
                                    rec.totalScore === null
                                      ? "text-muted-foreground"
                                      : rec.totalScore >= 30
                                        ? "text-emerald-600"
                                        : rec.totalScore >= 18
                                          ? "text-amber-600"
                                          : "text-red-500",
                                  )}
                                >
                                  {rec.totalScore ?? "—"}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {" "}
                                  / 36
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={cn(
                                      "text-sm font-semibold",
                                      rec.averageScore === null
                                        ? "text-muted-foreground"
                                        : rec.averageScore >= 2.5
                                          ? "text-emerald-600"
                                          : rec.averageScore >= 1.5
                                            ? "text-amber-600"
                                            : "text-red-500",
                                    )}
                                  >
                                    {rec.averageScore ?? "—"}
                                  </span>
                                  {rec.averageScore !== null && (
                                    <Progress
                                      value={(rec.averageScore / 3) * 100}
                                      className="h-1.5 w-16"
                                    />
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4">
                                {rec.overallRating ? (
                                  <span
                                    className={cn(
                                      "text-[10px] font-medium px-2 py-0.5 rounded-full",
                                      PMS_RATING_COLORS[rec.overallRating] ??
                                        "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {PMS_RATING_LABELS[rec.overallRating] ??
                                      rec.overallRating}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground text-xs">
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex flex-wrap gap-1">
                                  {topMetrics.map((m) => (
                                    <span
                                      key={m.key}
                                      className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium"
                                    >
                                      {PMS_METRIC_LABELS[m.key]}: {m.val}
                                    </span>
                                  ))}
                                  {topMetrics.length === 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-xs text-muted-foreground whitespace-nowrap">
                                {rec.submittedAt
                                  ? new Date(
                                      rec.submittedAt,
                                    ).toLocaleDateString("en-IN", {
                                      day: "numeric",
                                      month: "short",
                                      year: "2-digit",
                                    })
                                  : rec.createdAt
                                    ? timeAgo(rec.createdAt)
                                    : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {/* Performance Report Tab */}
      {activeTab === "performance-report" && (
        <div className="space-y-4 animate-fade-in">
          <p className="text-sm text-muted-foreground">
            Consolidated candidate performance view with platform scores, PI
            rounds, and final recommendation.
          </p>
          {loadingEvaluatorView ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : evaluatorView.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
              <BarChart2 className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm font-medium">
                No performance data available
              </p>
              <p className="text-xs mt-1">
                Data appears here once candidates have platform or PI records.
              </p>
            </div>
          ) : (
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                <div className="space-y-3 p-3 sm:hidden">
                  {evaluatorView.map((row) => {
                    const isExpanded = expandedRows.has(row.candidateId);
                    const completedPiRounds = row.piRounds.filter(
                      (round) => round.completedAt,
                    );
                    const decisionLabel =
                      row.finalDecision === "pass"
                        ? "Selected"
                        : row.finalDecision === "fail"
                          ? "Rejected"
                          : "In Progress";
                    const decisionClass =
                      row.finalDecision === "pass"
                        ? "border-emerald-400/30 text-emerald-500"
                        : row.finalDecision === "fail"
                          ? "border-red-400/30 text-red-500"
                          : "border-amber-400/30 text-amber-500";
                    return (
                      <button
                        key={row.candidateId}
                        type="button"
                        className="w-full rounded-xl border border-border bg-muted/10 p-3 text-left transition-colors hover:bg-muted/20"
                        onClick={() => toggleRow(row.candidateId)}
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar className="h-9 w-9 shrink-0">
                            <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                              {getInitials(row.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="break-words text-sm font-semibold">
                                  {row.fullName}
                                </p>
                                <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                                  {row.candidateCode}
                                </p>
                              </div>
                              <ChevronDown
                                className={cn(
                                  "mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                                  isExpanded && "rotate-180",
                                )}
                              />
                            </div>
                            <p className="mt-2 break-words text-xs text-muted-foreground">
                              {row.positionTitle ?? "—"}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                          <div className="rounded-lg border border-border/60 bg-card/60 p-2">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                              PI Rounds
                            </p>
                            <p className="mt-1 font-semibold">
                              {row.piRounds.length
                                ? `${completedPiRounds.length}/${row.piRounds.length}`
                                : "—"}
                            </p>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px]", decisionClass)}
                          >
                            {decisionLabel}
                          </Badge>
                          <Badge
                            variant="outline"
                            className="break-words text-[10px]"
                          >
                            {STAGE_LABELS[
                              row.currentStage as keyof typeof STAGE_LABELS
                            ] ?? formatLabel(row.currentStage)}
                          </Badge>
                        </div>

                        {isExpanded && (
                          <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
                            {row.piRounds.length > 0 ? (
                              row.piRounds.map((round) => (
                                <div
                                  key={round.id}
                                  className="rounded-lg border border-border/60 bg-card p-2 text-xs"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="font-medium">
                                      Round {round.roundNumber}
                                      {round.panelLabel
                                        ? ` - ${round.panelLabel}`
                                        : ""}
                                    </p>
                                    <span className="shrink-0 text-[10px] text-muted-foreground">
                                      {round.roundDecision ??
                                        round.status ??
                                        "pending"}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[10px] text-muted-foreground">
                                    Score: {round.score ?? "—"} · Mode:{" "}
                                    {round.mode?.replace("_", " ") ?? "—"}
                                  </p>
                                </div>
                              ))
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                No PI rounds scheduled.
                              </p>
                            )}
                            {row.evaluation?.notes && (
                              <p className="break-words text-xs text-muted-foreground">
                                {row.evaluation.notes}
                              </p>
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {[
                          "",
                          "Candidate",
                          "Position",
                          "PI Rounds",
                          "Final Decision",
                        ].map((h) => (
                          <th
                            key={h}
                            className="py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-left whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {evaluatorView.map((row) => {
                        const isExpanded = expandedRows.has(row.candidateId);
                        const decisionColor =
                          row.finalDecision === "pass"
                            ? "bg-emerald-100 text-emerald-700"
                            : row.finalDecision === "fail"
                              ? "bg-red-100 text-red-700"
                              : "bg-muted text-muted-foreground";
                        const completedPiRounds = row.piRounds.filter(
                          (r) => r.completedAt,
                        );
                        return (
                          <>
                            <tr
                              key={row.candidateId}
                              className="border-b border-border/40 hover:bg-muted/20 transition-colors cursor-pointer"
                              onClick={() => toggleRow(row.candidateId)}
                            >
                              <td className="py-3 px-3 w-8">
                                <ChevronDown
                                  className={cn(
                                    "h-4 w-4 text-muted-foreground transition-transform",
                                    isExpanded && "rotate-180",
                                  )}
                                />
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-7 w-7">
                                    <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                                      {getInitials(row.fullName)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div>
                                    <p className="text-xs font-medium">
                                      {row.fullName}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground font-mono">
                                      {row.candidateCode}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-xs text-muted-foreground">
                                {row.positionTitle ?? "—"}
                              </td>
                              <td className="py-3 px-4">
                                {row.piRounds.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">
                                    —
                                  </span>
                                ) : (
                                  <div className="space-y-0.5">
                                    <span className="text-xs font-medium">
                                      {completedPiRounds.length} /{" "}
                                      {row.piRounds.length}
                                    </span>
                                    <p className="text-[10px] text-muted-foreground">
                                      completed
                                    </p>
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                {row.finalDecision ? (
                                  <span
                                    className={cn(
                                      "text-[10px] font-medium px-2 py-0.5 rounded-full",
                                      decisionColor,
                                    )}
                                  >
                                    {row.finalDecision === "pass"
                                      ? "Selected"
                                      : "Rejected"}
                                  </span>
                                ) : (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
                                    In Progress
                                  </span>
                                )}
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr
                                key={`${row.candidateId}-expanded`}
                                className="border-b border-border/60 bg-muted/10"
                              >
                                <td colSpan={5} className="px-6 py-4">
                                  <div className="grid gap-4 md:grid-cols-2">
                                    {/* PI Rounds Details */}
                                    <div className="space-y-2">
                                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        PI Interview Rounds
                                      </p>
                                      {row.piRounds.length === 0 ? (
                                        <p className="text-xs text-muted-foreground">
                                          No PI rounds scheduled
                                        </p>
                                      ) : (
                                        row.piRounds.map((round) => (
                                          <div
                                            key={round.id}
                                            className="rounded-lg border border-border/60 bg-card p-2.5 space-y-1"
                                          >
                                            <div className="flex items-center justify-between">
                                              <p className="text-xs font-medium">
                                                Round {round.roundNumber}
                                                {round.panelLabel
                                                  ? ` — ${round.panelLabel}`
                                                  : ""}
                                              </p>
                                              <span
                                                className={cn(
                                                  "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                                                  round.roundDecision ===
                                                    "passed" ||
                                                    round.finalVerdict ===
                                                      "selected"
                                                    ? "bg-emerald-100 text-emerald-700"
                                                    : round.roundDecision ===
                                                          "failed" ||
                                                        round.finalVerdict ===
                                                          "rejected"
                                                      ? "bg-red-100 text-red-700"
                                                      : round.status ===
                                                          "scheduled"
                                                        ? "bg-blue-100 text-blue-700"
                                                        : "bg-muted text-muted-foreground",
                                                )}
                                              >
                                                {round.roundDecision ??
                                                  round.status ??
                                                  "pending"}
                                              </span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
                                              <div>
                                                <p>Score</p>
                                                <p className="font-medium text-foreground">
                                                  {formatScoreValue(
                                                    round.score,
                                                  )}
                                                </p>
                                              </div>
                                              <div>
                                                <p>Mode</p>
                                                <p className="font-medium text-foreground capitalize">
                                                  {round.mode?.replace(
                                                    "_",
                                                    " ",
                                                  ) ?? "—"}
                                                </p>
                                              </div>
                                            </div>
                                            {round.scheduledAt && (
                                              <p className="text-[10px] text-muted-foreground">
                                                {formatDateTime(
                                                  round.scheduledAt,
                                                )}
                                              </p>
                                            )}
                                            {round.remarks && (
                                              <p className="text-[10px] text-muted-foreground italic">
                                                {round.remarks}
                                              </p>
                                            )}
                                          </div>
                                        ))
                                      )}
                                    </div>

                                    {/* Evaluation Summary */}
                                    <div className="space-y-2">
                                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Evaluation Summary
                                      </p>
                                      {row.evaluation ? (
                                        <div className="rounded-lg border border-border/60 bg-card p-2.5 space-y-2">
                                          <div className="grid gap-2 text-[10px] text-muted-foreground">
                                            <div>
                                              <p>Eval Score</p>
                                              <p className="font-medium text-foreground text-sm">
                                                {row.evaluation.totalScore?.toFixed(
                                                  2,
                                                ) ?? "—"}{" "}
                                                / 10
                                              </p>
                                            </div>
                                          </div>
                                          {row.evaluation.recommendation && (
                                            <Badge
                                              className={cn(
                                                "text-[10px]",
                                                row.evaluation
                                                  .recommendation ===
                                                  "passed" ||
                                                  row.evaluation
                                                    .recommendation ===
                                                    "strongly_recommended"
                                                  ? "bg-emerald-100 text-emerald-700"
                                                  : row.evaluation
                                                        .recommendation ===
                                                      "rejected"
                                                    ? "bg-red-100 text-red-700"
                                                    : "bg-amber-100 text-amber-700",
                                              )}
                                            >
                                              {row.evaluation.recommendation}
                                            </Badge>
                                          )}
                                          {row.evaluation.notes && (
                                            <p className="text-[10px] text-muted-foreground italic">
                                              {row.evaluation.notes}
                                            </p>
                                          )}
                                          {row.evaluation.completedAt && (
                                            <p className="text-[10px] text-muted-foreground">
                                              Completed{" "}
                                              {timeAgo(
                                                row.evaluation.completedAt,
                                              )}
                                            </p>
                                          )}
                                        </div>
                                      ) : (
                                        <p className="text-xs text-muted-foreground">
                                          No evaluation record
                                        </p>
                                      )}
                                      <div className="rounded-lg border border-border/60 bg-card p-2.5">
                                        <p className="text-[10px] text-muted-foreground mb-1">
                                          Stage
                                        </p>
                                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                          {STAGE_LABELS[
                                            row.currentStage as keyof typeof STAGE_LABELS
                                          ] ?? formatLabel(row.currentStage)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <Dialog
        open={scheduleOpen}
        onOpenChange={(o) => {
          setScheduleOpen(o);
          if (!o) setScheduleRoundNumber(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarPlus className="h-5 w-5 text-primary" />{" "}
              {scheduleRoundNumber
                ? `Schedule PI Round ${scheduleRoundNumber}`
                : "Schedule PI Interview"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Assign Evaluator</Label>
              <Select
                value={scheduleForm.evaluatorId}
                onValueChange={(v) =>
                  setScheduleForm((f) => ({ ...f, evaluatorId: v ?? "" }))
                }
              >
                <SelectTrigger className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm">
                  <SelectValue placeholder="Keep current evaluation owner" />
                </SelectTrigger>
                <SelectContent>
                  {evaluators.map((evaluator) => (
                    <SelectItem key={evaluator.id} value={evaluator.id}>
                      {evaluator.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Interviewer email (optional)</Label>
              <Input
                type="text"
                placeholder="interviewer@example.com (comma-separate for multiple)"
                value={scheduleForm.interviewerEmail}
                onChange={(e) =>
                  setScheduleForm((f) => ({
                    ...f,
                    interviewerEmail: e.target.value,
                  }))
                }
              />
              <p className="text-[11px] text-muted-foreground">
                The interview invite is also sent to this address, along with
                the assigned evaluator.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Meeting Title *</Label>
              <Input
                placeholder="e.g. PI Interview Round 1 - Technical Discussion"
                value={scheduleForm.subject}
                onChange={(e) =>
                  setScheduleForm((f) => ({ ...f, subject: e.target.value }))
                }
                className="rounded-xl"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date *</Label>
                <DatePicker
                  min={minScheduleDate}
                  value={scheduleForm.date}
                  onChange={(v) => setScheduleForm((f) => ({ ...f, date: v }))}
                  className="rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Time *</Label>
                <Input
                  type="time"
                  value={scheduleForm.time}
                  onChange={(e) =>
                    setScheduleForm((f) => ({ ...f, time: e.target.value }))
                  }
                  className="rounded-xl"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Duration</Label>
                <Select
                  value={scheduleForm.durationMinutes}
                  onValueChange={(v) =>
                    setScheduleForm((f) => ({ ...f, durationMinutes: v ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["30", "45", "60", "90", "120"].map((d) => (
                      <SelectItem key={d} value={d}>
                        {d} min
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select
                  value={scheduleForm.mode}
                  onValueChange={(v) =>
                    setScheduleForm((f) => ({ ...f, mode: v ?? "" }))
                  }
                >
                  <SelectTrigger className="w-full h-10 rounded-xl border border-input bg-background px-3 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PI_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Instructions / Notes</Label>
              <Textarea
                rows={2}
                placeholder="Meeting link, location, preparation notes…"
                value={scheduleForm.notes}
                onChange={(e) =>
                  setScheduleForm((f) => ({ ...f, notes: e.target.value }))
                }
                className="rounded-xl resize-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setScheduleOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSchedule}
                disabled={
                  scheduling ||
                  !scheduleForm.subject ||
                  !scheduleForm.date ||
                  !scheduleForm.time
                }
              >
                {scheduling ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Scheduling…
                  </>
                ) : (
                  <>
                    <CalendarPlus className="h-4 w-4 mr-2" />
                    Schedule PI
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

// Shared per-employee PMS building blocks + the self-contained PmsPanel.
//
// Extracted from src/app/dashboard/hr/pms/page.tsx so the same metric
// definitions, score controls, submitted-record view, evaluation form and
// meeting scheduler power BOTH the HR PMS page and the Employee Evaluation
// view's PMS tab without duplication.

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Loader2,
  MapPin,
  Star,
  Trash2,
  Users,
  Video,
} from "lucide-react";
import { toast } from "sonner";
import { pmsApi } from "@/lib/api";
import type { PmsEvaluationRecord, PmsMeetingRecord, PmsScores } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";

export const PMS_METRICS: {
  key: keyof PmsScores;
  label: string;
  description: string;
}[] = [
  {
    key: "verbalClarity",
    label: "Verbal Clarity & Structure",
    description:
      "Evaluates how clearly and logically the employee expresses their thoughts.",
  },
  {
    key: "conciseness",
    label: "Conciseness & Precision",
    description:
      "Ability to convey ideas without unnecessary elaboration or repetition.",
  },
  {
    key: "fluency",
    label: "Fluency",
    description:
      "Smoothness and ease of spoken communication without excessive pauses or fillers.",
  },
  {
    key: "vocabulary",
    label: "Vocabulary",
    description:
      "Range and accuracy of word choice appropriate to the context.",
  },
  {
    key: "pronunciation",
    label: "Pronunciation",
    description: "Clarity and correctness of speech sounds and word stress.",
  },
  {
    key: "nonverbalConfidence",
    label: "Non-verbal Confidence",
    description:
      "Body language, eye contact, posture, and overall presence during interaction.",
  },
  {
    key: "introBackground",
    label: "Introduction — Background & Life Context",
    description:
      "Quality and relevance of self-introduction covering background and life context.",
  },
  {
    key: "etharaAwareness",
    label: "Awareness of Ethara & Industry",
    description:
      "Knowledge of Ethara's business, products, and relevant industry trends.",
  },
  {
    key: "currentAffairs",
    label: "Current Affairs & News Habits",
    description:
      "Awareness of recent events and demonstrated habit of staying informed.",
  },
  {
    key: "instagramFamiliarity",
    label: "Instagram — Platform Familiarity & Usage Depth",
    description:
      "Understanding of Instagram features, content types, and engagement strategies.",
  },
  {
    key: "promptEngineering",
    label: "Prompt Engineering — Conceptual Understanding",
    description:
      "Grasp of how to craft effective prompts for AI/LLM tools and systems.",
  },
  {
    key: "videoEditing",
    label: "Video Editing — Skill & Tools",
    description:
      "Familiarity with video editing workflows, tools, and output quality.",
  },
];

// The 12 metrics organised into 3 themed sections so the evaluation form reads
// as grouped subject areas instead of one long undifferentiated stack.
export const PMS_METRIC_GROUPS: { title: string; keys: (keyof PmsScores)[] }[] = [
  {
    title: "Communication & Delivery",
    keys: ["verbalClarity", "conciseness", "fluency", "vocabulary", "pronunciation", "nonverbalConfidence"],
  },
  {
    title: "Awareness & Knowledge",
    keys: ["introBackground", "etharaAwareness", "currentAffairs"],
  },
  {
    title: "Digital & Technical Skills",
    keys: ["instagramFamiliarity", "promptEngineering", "videoEditing"],
  },
];

export const PMS_METRIC_BY_KEY = Object.fromEntries(
  PMS_METRICS.map((m) => [m.key, m]),
) as Record<keyof PmsScores, (typeof PMS_METRICS)[number]>;

export const RATING_OPTIONS: { value: string; label: string; color: string }[] = [
  {
    value: "unsatisfactory",
    label: "Unsatisfactory",
    color: "text-rose-500 border-rose-500/40 bg-rose-500/10",
  },
  {
    value: "needs_improvement",
    label: "Needs Improvement",
    color: "text-orange-500 border-orange-500/40 bg-orange-500/10",
  },
  {
    value: "average",
    label: "Average",
    color: "text-amber-500 border-amber-500/40 bg-amber-500/10",
  },
  {
    value: "meets_expectations",
    label: "Meets Expectations",
    color: "text-sky-500 border-sky-500/40 bg-sky-500/10",
  },
  {
    value: "exceeds_expectations",
    label: "Exceeds Expectations",
    color: "text-emerald-500 border-emerald-500/40 bg-emerald-500/10",
  },
];

export const PMS_MAX_SCORE = 3;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseAttendeeEmails(value: string) {
  return value
    .split(/[,\s;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

export function ratingColor(rating: string | null | undefined) {
  const normalizedRating = rating === "above_expectation" ? "exceeds_expectations" : rating;
  const opt = RATING_OPTIONS.find((r) => r.value === normalizedRating);
  return opt?.color ?? "text-muted-foreground border-border";
}

export function ratingLabel(rating: string | null | undefined) {
  const normalizedRating = rating === "above_expectation" ? "exceeds_expectations" : rating;
  const opt = RATING_OPTIONS.find((r) => r.value === normalizedRating);
  return opt?.label ?? rating ?? "—";
}

export function normalizedRatingValue(rating: string | null | undefined) {
  return rating === "above_expectation" ? "exceeds_expectations" : rating ?? null;
}

export function formatScore(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  return numeric.toFixed(2);
}

export function ScoreInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const TICKS = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
  const tone =
    value === null
      ? "text-muted-foreground"
      : value >= 2.5
        ? "text-success"
        : value >= 1.5
          ? "text-warning"
          : "text-destructive";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* Compact, single connected row (scrolls on overflow) instead of a
            13-button grid that wrapped to ragged rows. */}
        <div className="flex flex-1 items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/20 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TICKS.map((tick) => {
            const isSelected = value === tick;
            const isFilled = value !== null && tick <= value;
            return (
              <button
                key={tick}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onChange(isSelected ? null : tick)}
                className={cn(
                  "h-7 min-w-[1.9rem] shrink-0 rounded-md px-1 text-[11px] font-semibold transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : isFilled
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-muted",
                )}
              >
                {tick % 1 === 0 ? tick.toFixed(0) : tick}
              </button>
            );
          })}
        </div>
        <span className={cn("w-12 shrink-0 text-right text-xs font-bold tabular-nums", tone)}>
          {value !== null ? `${formatScore(value)}/${PMS_MAX_SCORE}` : "—"}
        </span>
      </div>
      <Progress value={value !== null ? (value / PMS_MAX_SCORE) * 100 : 0} className="h-1" />
    </div>
  );
}

/** One evaluation metric: label + description, compact score control, and an
 *  optional note that stays collapsed behind "+ Add note" to cut form height. */
export function MetricRow({
  metric,
  value,
  onScore,
  remark,
  onRemark,
}: {
  metric: { key: keyof PmsScores; label: string; description: string };
  value: number | null;
  onScore: (v: number | null) => void;
  remark: string;
  onRemark: (v: string) => void;
}) {
  const [showNote, setShowNote] = useState(Boolean(remark));
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border/50 bg-card/40 p-3.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-tight">{metric.label}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
          {metric.description}
        </p>
      </div>
      <ScoreInput value={value} onChange={onScore} />
      {showNote ? (
        <Input
          value={remark}
          onChange={(e) => onRemark(e.target.value)}
          placeholder="Add notes for this metric…"
          className="h-8 rounded-lg text-xs"
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="self-start text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          + Add note
        </button>
      )}
    </div>
  );
}

// ─── Review meetings ─────────────────────────────────────────────────────────

export function MeetingScheduler({ employee }: { employee: { id: string; name: string } }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"online" | "offline">("online");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState("");
  const [attendeeInput, setAttendeeInput] = useState("");
  const [inviteEmployee, setInviteEmployee] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: meetings = [], isLoading } = useQuery({
    queryKey: ["pms-meetings", employee.id],
    queryFn: () => pmsApi.listMeetings(employee.id),
    staleTime: 10_000,
  });

  const resetForm = useCallback(() => {
    setTitle("");
    setMode("online");
    setDate("");
    setTime("");
    setDuration(60);
    setLocation("");
    setAttendeeInput("");
    setInviteEmployee(true);
    setNotes("");
  }, []);

  const handleSchedule = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.error("Meeting title is required.");
      return;
    }
    const attendees = parseAttendeeEmails(attendeeInput);
    const invalid = attendees.filter((email) => !EMAIL_PATTERN.test(email));
    if (invalid.length > 0) {
      toast.error(
        `Enter valid attendee email${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`,
      );
      return;
    }
    let scheduledAt: string | undefined;
    if (mode === "online") {
      if (!date || !time) {
        toast.error("Date & time are required for an online meeting.");
        return;
      }
      scheduledAt = new Date(`${date}T${time}:00`).toISOString();
    }
    setSaving(true);
    try {
      const created = await pmsApi.createMeeting({
        employeeId: employee.id,
        title: trimmedTitle,
        mode,
        scheduledAt,
        durationMinutes: duration,
        location: location.trim() || null,
        attendees,
        inviteEmployee,
        notes: notes.trim() || null,
      });
      if (mode === "online") {
        const count = created.notifiedEmails?.length ?? 0;
        toast.success(
          `Meeting scheduled — calendar invite sent to ${count} ${count === 1 ? "person" : "people"}.`,
        );
      } else {
        toast.success("Offline review logged (no invite sent).");
      }
      resetForm();
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["pms-meetings", employee.id] });
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(msg || "Failed to schedule meeting.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await pmsApi.deleteMeeting(id);
      toast.success("Meeting removed.");
      qc.invalidateQueries({ queryKey: ["pms-meetings", employee.id] });
    } catch {
      toast.error("Failed to remove meeting.");
    }
  };

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            Review Meetings
          </CardTitle>
          <Button
            size="sm"
            variant={open ? "outline" : "default"}
            className="rounded-xl text-xs gap-1.5"
            onClick={() => {
              if (open) resetForm();
              setOpen((prev) => !prev);
            }}
          >
            {open ? "Cancel" : "Schedule Meeting"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {open && (
          <div className="space-y-4 rounded-xl border border-border/60 bg-muted/10 p-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Meeting Title</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Q2 Performance Review — discussion"
                className="h-9 rounded-xl text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Shown in the meeting and in the calendar-invite email.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Meeting Mode</Label>
              <div className="flex gap-2">
                {[
                  { value: "online" as const, label: "Online", icon: Video },
                  { value: "offline" as const, label: "Offline", icon: MapPin },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setMode(opt.value)}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all",
                      mode === opt.value
                        ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/20"
                        : "border-border text-muted-foreground hover:border-primary/30",
                    )}
                  >
                    <opt.icon className="h-3.5 w-3.5" />
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {mode === "online"
                  ? "An online review sends a calendar invite to all participants."
                  : "An offline review is logged only — no calendar invite is sent."}
              </p>
            </div>

            {mode === "online" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Date</Label>
                    <Input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="h-9 rounded-xl text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Time</Label>
                    <Input
                      type="time"
                      value={time}
                      onChange={(e) => setTime(e.target.value)}
                      className="h-9 rounded-xl text-sm"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      Duration (minutes)
                    </Label>
                    <Input
                      type="number"
                      min={15}
                      step={15}
                      value={duration}
                      onChange={(e) =>
                        setDuration(Math.max(15, Number(e.target.value) || 60))
                      }
                      className="h-9 rounded-xl text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">
                      Meeting Link
                    </Label>
                    <Input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Leave blank to auto-generate a Google Meet link"
                      className="h-9 rounded-xl text-sm"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      A Google Meet link is created automatically. Paste your own (Meet/Zoom) to override.
                    </p>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3">
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Users className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                    <span>
                      You
                      {user?.name ? (
                        <strong className="text-foreground"> ({user.name})</strong>
                      ) : null}{" "}
                      will be added to the call as the organizer.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInviteEmployee((prev) => !prev)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all",
                      inviteEmployee
                        ? "border-primary/40 bg-primary/5"
                        : "border-border",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="font-medium">Invite {employee.name}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        The employee being reviewed
                      </span>
                    </span>
                    <span
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        inviteEmployee
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted-foreground/40",
                      )}
                    >
                      {inviteEmployee && <CheckCircle2 className="h-3.5 w-3.5" />}
                    </span>
                  </button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">
                    Add other people (optional)
                  </Label>
                  <Input
                    value={attendeeInput}
                    onChange={(e) => setAttendeeInput(e.target.value)}
                    placeholder="email@ethara.ai, another@ethara.ai"
                    className="h-9 rounded-xl text-sm"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Separate multiple emails with commas or spaces.
                  </p>
                </div>
              </>
            )}

            {mode === "offline" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Venue (optional)</Label>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Meeting Room 2, 3rd Floor"
                  className="h-9 rounded-xl text-sm"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Agenda or context for this review meeting…"
                rows={2}
                className="rounded-xl resize-none text-sm"
              />
            </div>

            <div className="flex justify-end">
              <Button
                size="sm"
                className="rounded-xl text-xs gap-1.5"
                disabled={saving}
                onClick={handleSchedule}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <CalendarClock className="h-3.5 w-3.5" />
                    {mode === "online" ? "Schedule & Send Invite" : "Log Meeting"}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : meetings.length === 0 ? (
          !open && (
            <p className="py-2 text-center text-xs text-muted-foreground">
              No review meetings scheduled yet.
            </p>
          )
        ) : (
          <div className="space-y-2">
            {meetings.map((m) => (
              <MeetingRow key={m.id} meeting={m} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MeetingRow({
  meeting,
  onDelete,
}: {
  meeting: PmsMeetingRecord;
  onDelete: (id: string) => void;
}) {
  const isOnline = meeting.mode === "online";
  const participantCount =
    1 + (meeting.inviteEmployee ? 1 : 0) + (meeting.attendees?.length ?? 0);
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{meeting.title}</p>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 rounded-full px-2 text-[10px]",
              isOnline
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                : "border-amber-500/30 bg-amber-500/10 text-amber-500",
            )}
          >
            {isOnline ? (
              <Video className="mr-1 h-3 w-3" />
            ) : (
              <MapPin className="mr-1 h-3 w-3" />
            )}
            {isOnline ? "Online" : "Offline"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {meeting.scheduledAt && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDateTime(meeting.scheduledAt)}
              {isOnline ? ` · ${meeting.durationMinutes} min` : ""}
            </span>
          )}
          {isOnline && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {participantCount}{" "}
              {participantCount === 1 ? "participant" : "participants"}
            </span>
          )}
          {meeting.location && (
            <span className="flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3" />
              {meeting.location}
            </span>
          )}
        </div>
        {meeting.organizerName && (
          <p className="text-[10px] text-muted-foreground">
            Organized by {meeting.organizerName}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 rounded-lg text-muted-foreground hover:text-red-500"
        onClick={() => onDelete(meeting.id)}
        aria-label="Remove meeting"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ─── Submitted record view ───────────────────────────────────────────────────

/** Read-only card for a submitted PMS record: total /36, average, rating badge,
 *  per-metric bars with remarks, overall remarks and evaluator/submitted meta.
 *  `actions` renders in the card header (e.g. an Edit button). */
export function PmsSubmittedRecordCard({
  record,
  actions,
}: {
  record: PmsEvaluationRecord;
  actions?: React.ReactNode;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Submitted PMS Evaluation
          </CardTitle>
          {actions}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-border p-3 text-center col-span-2">
            <p className="text-2xl font-bold text-primary">
              {formatScore(record.totalScore)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Total Score
            </p>
          </div>
          <div className="rounded-xl border border-border p-3 text-center">
            <p className="text-xl font-bold">
              {formatScore(record.averageScore)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              Avg / 3
            </p>
          </div>
          {record.overallRating && (
            <div
              className={cn(
                "rounded-xl border p-3 text-center flex items-center justify-center",
                ratingColor(record.overallRating),
              )}
            >
              <p className="text-xs font-semibold">
                {ratingLabel(record.overallRating)}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {PMS_METRICS.map((m) => {
            const val = record.scores[m.key];
            const remark = record.metricRemarks[m.key] ?? "";
            return (
              <div
                key={m.key}
                className="rounded-xl border border-border p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">{m.label}</p>
                  <span
                    className={cn(
                      "text-xs font-bold px-2 py-0.5 rounded-full border",
                      val == null
                        ? "text-muted-foreground border-border"
                        : val >= 2.5
                          ? "text-success border-success/30 bg-success/5"
                          : val >= 1.5
                            ? "text-warning border-warning/30 bg-warning/5"
                            : "text-destructive border-destructive/30 bg-destructive/5",
                    )}
                  >
                    {val != null
                      ? `${formatScore(val)} / ${PMS_MAX_SCORE}`
                      : "—"}
                  </span>
                </div>
                {val != null && (
                  <Progress
                    value={(val / PMS_MAX_SCORE) * 100}
                    className="h-1"
                  />
                )}
                {remark && (
                  <p className="text-[10px] text-muted-foreground italic">
                    {remark}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {record.remarks && (
          <div className="rounded-xl bg-muted/30 border border-border/50 p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              Overall Remarks
            </p>
            <p className="text-xs">{record.remarks}</p>
          </div>
        )}

        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          {record.evaluatorName && (
            <span>
              Evaluator:{" "}
              <strong className="text-foreground">
                {record.evaluatorName}
              </strong>
            </span>
          )}
          {record.submittedAt && (
            <span>
              Submitted:{" "}
              <strong className="text-foreground">
                {formatDateTime(record.submittedAt)}
              </strong>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── New/Edit evaluation form ────────────────────────────────────────────────

/** Controlled New/Edit PMS form card: the 12 metrics in 3 themed groups with
 *  ScoreInput ticks (0-3 step .25), overall-rating buttons, remarks, live
 *  total/avg readouts, and Save/Update + Cancel-edit actions. State is owned
 *  by the caller so it can pre-load an existing record for editing. */
export function PmsEvaluationFormCard({
  editing,
  scores,
  onScore,
  metricRemarks,
  onMetricRemark,
  overallRating,
  onOverallRating,
  remarks,
  onRemarks,
  totalScore,
  averageScore,
  saving,
  onSave,
  onCancelEdit,
}: {
  editing: boolean;
  scores: Partial<PmsScores>;
  onScore: (key: keyof PmsScores, value: number | null) => void;
  metricRemarks: Record<string, string>;
  onMetricRemark: (key: keyof PmsScores, value: string) => void;
  overallRating: string | null;
  onOverallRating: (value: string | null) => void;
  remarks: string;
  onRemarks: (value: string) => void;
  totalScore: number | null;
  averageScore: number | null;
  saving: boolean;
  onSave: () => void;
  onCancelEdit?: () => void;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Star className="h-4 w-4 text-primary" />
            {editing ? "Edit PMS Evaluation" : "New PMS Evaluation"}
          </CardTitle>
          {totalScore !== null && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                Total:{" "}
                <strong className="text-primary">
                  {formatScore(totalScore)}
                </strong>
              </span>
              <span className="text-muted-foreground">
                Avg:{" "}
                <strong className="text-primary">
                  {formatScore(averageScore)}
                </strong>
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {PMS_METRIC_GROUPS.map((group) => (
          <div key={group.title} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-4 w-1 rounded-full bg-primary" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {group.keys.map((key) => (
                <MetricRow
                  key={key}
                  metric={PMS_METRIC_BY_KEY[key]}
                  value={scores[key] ?? null}
                  onScore={(v) => onScore(key, v)}
                  remark={metricRemarks[key] ?? ""}
                  onRemark={(v) => onMetricRemark(key, v)}
                />
              ))}
            </div>
          </div>
        ))}

        <div className="rounded-xl border border-border/50 p-4 space-y-3">
          <p className="text-sm font-semibold">Overall Rating</p>
          <div className="flex flex-wrap gap-2">
            {RATING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  onOverallRating(overallRating === opt.value ? null : opt.value)
                }
                className={cn(
                  "px-3 py-1.5 rounded-full border text-xs font-medium transition-all",
                  overallRating === opt.value
                    ? opt.color + " ring-2 ring-offset-1"
                    : "border-border text-muted-foreground hover:border-primary/30",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-medium">
            Overall Remarks
          </Label>
          <Textarea
            value={remarks}
            onChange={(e) => onRemarks(e.target.value)}
            placeholder="Add overall evaluation notes and feedback for this employee..."
            rows={3}
            className="rounded-xl resize-none text-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          {editing && onCancelEdit && (
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs"
              onClick={onCancelEdit}
            >
              Cancel Edit
            </Button>
          )}
          <div className="flex items-center gap-3 ml-auto">
            {totalScore !== null && (
              <div className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">
                  {formatScore(totalScore)}
                </span>{" "}
                total ·{" "}
                <span className="font-semibold text-foreground">
                  {formatScore(averageScore)}
                </span>{" "}
                avg
              </div>
            )}
            <Button
              className="rounded-xl text-xs gap-1.5"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                  {editing ? "Update" : "Save"} Evaluation
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Self-contained per-employee panel ───────────────────────────────────────

/** Full per-employee PMS capability in one panel: the submitted-record view
 *  (with Edit), the New/Edit evaluation form, and the review-meeting scheduler.
 *  Used by the Employee Evaluation view's PMS tab. Pass `enabled={false}` to
 *  defer fetching until the panel is actually shown. */
export function PmsPanel({
  employeeId,
  employeeName,
  enabled = true,
}: {
  employeeId: string;
  employeeName?: string | null;
  enabled?: boolean;
}) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scores, setScores] = useState<Partial<PmsScores>>({});
  const [metricRemarks, setMetricRemarks] = useState<Record<string, string>>({});
  const [overallRating, setOverallRating] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    data: pmsRecords = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["pms-evaluations", employeeId],
    queryFn: () => pmsApi.forEmployee(employeeId),
    enabled: enabled && !!employeeId,
    staleTime: 10_000,
  });

  const existingRecord: PmsEvaluationRecord | null = pmsRecords[0] ?? null;

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        employeeId,
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
      resetForm();
      qc.invalidateQueries({ queryKey: ["pms-evaluations"] });
      // The evaluation profile header shows the PMS summary — keep it fresh.
      qc.invalidateQueries({ queryKey: ["employee-evaluation", "profile", employeeId] });
      void refetch();
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(msg || "Failed to save PMS evaluation.");
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {existingRecord && !editingId && (
        <PmsSubmittedRecordCard
          record={existingRecord}
          actions={
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl text-xs"
              onClick={() => loadRecordIntoForm(existingRecord)}
            >
              Edit Evaluation
            </Button>
          }
        />
      )}

      {(!existingRecord || editingId) && (
        <PmsEvaluationFormCard
          editing={Boolean(editingId)}
          scores={scores}
          onScore={(key, v) => setScores((prev) => ({ ...prev, [key]: v ?? undefined }))}
          metricRemarks={metricRemarks}
          onMetricRemark={(key, v) => setMetricRemarks((prev) => ({ ...prev, [key]: v }))}
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

      <MeetingScheduler employee={{ id: employeeId, name: employeeName || "this employee" }} />
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { assessmentPlatformApi, type ApTakerAttempt, type ApTakerAnswer } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { QuestionTaker, ApStatusBadge } from "./question-types";
import {
  Clock, ChevronLeft, ChevronRight, Loader2, CheckCircle2, Lock, ShieldAlert, AlertTriangle,
} from "lucide-react";

type Phase = "intro" | "taking" | "review" | "done";

function fmt(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function AttemptPlayer({ initial, onExit }: { initial: ApTakerAttempt; onExit: () => void }) {
  const attemptId = initial.attemptId;
  const [phase, setPhase] = useState<Phase>(
    initial.status !== "in_progress" ? "done" : (Object.keys(initial.answers ?? {}).length > 0 ? "taking" : "intro")
  );
  const [answers, setAnswers] = useState<Record<string, ApTakerAnswer>>(initial.answers ?? {});
  const [remaining, setRemaining] = useState<number | null>(initial.remainingSeconds ?? null);
  const [sectionIdx, setSectionIdx] = useState(0);
  const [locked, setLocked] = useState<Set<number>>(new Set());
  const [consent, setConsent] = useState(!initial.consentText);
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(initial.result ?? null);
  const [fullscreenActive, setFullscreenActive] = useState(false);

  // ── proctoring / anti-cheat ──
  const proctor = initial.proctoring ?? null;
  const proctorEnabled = !!proctor?.enabled;
  const maxWarnings = proctor?.maxWarnings ?? 0;
  // Seed the warning count from the server so it survives a reload / leave-and-return.
  const [warnings, setWarnings] = useState(
    () => (initial.proctoringCounts?.tabSwitches ?? 0) + (initial.proctoringCounts?.fullscreenExits ?? 0),
  );
  const [proctorMsg, setProctorMsg] = useState<string | null>(null);

  const debouncers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const revs = useRef<Record<string, number>>(
    Object.fromEntries(Object.entries(initial.answers ?? {}).map(([k, v]) => [k, v.clientRev ?? 0]))
  );
  const submittedRef = useRef(false);
  const attentionViolationAt = useRef(0);
  const fullscreenViolationAt = useRef(0);
  const hasEnteredFullscreen = useRef(false);

  const sections = initial.sections;
  const allQuestions = useMemo(() => sections.flatMap((s) => s.questions), [sections]);

  const doSubmit = useCallback(async (reason?: "time" | "violations") => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    try {
      const res = await assessmentPlatformApi.submitAttempt(attemptId);
      setResult(res.result ?? null);
      setPhase("done");
      if (reason === "time") toast.info("Time's up — your test was submitted automatically.");
      if (reason === "violations") toast.error("Too many warnings — your test was submitted automatically.");
    } catch {
      submittedRef.current = false;
      toast.error("Could not submit. Please try again.");
    }
  }, [attemptId]);

  // Server-authoritative countdown: tick locally, but treat server values as truth.
  const timerActive = phase !== "done" && remaining != null;
  useEffect(() => {
    if (!timerActive) return;
    const t = setInterval(() => {
      setRemaining((prev) => {
        if (prev == null) return prev;
        if (prev <= 1) { void doSubmit("time"); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [timerActive, doSubmit]);

  // Heartbeat: re-sync remaining time + detect server-side auto-submit.
  useEffect(() => {
    if (phase === "done") return;
    const t = setInterval(async () => {
      try {
        const hb = await assessmentPlatformApi.heartbeat(attemptId);
        if (hb.remainingSeconds != null) setRemaining(hb.remainingSeconds);
        if (hb.status !== "in_progress") { submittedRef.current = true; setPhase("done"); }
      } catch { /* transient */ }
    }, 25000);
    return () => clearInterval(t);
  }, [phase, attemptId]);

  const recordViolation = useCallback(
    (type: "tab_switch" | "fullscreen_exit" | "copy", message?: string) => {
      void assessmentPlatformApi.proctoringEvent(attemptId, type).catch(() => {});
      if (message) setProctorMsg(message);
      if (type === "tab_switch" || type === "fullscreen_exit") {
        setWarnings((w) => {
          const next = w + 1;
          if (maxWarnings > 0 && next >= maxWarnings) void doSubmit("violations");
          return next;
        });
      }
    },
    [attemptId, maxWarnings, doSubmit],
  );

  const recordAttentionLoss = useCallback((message: string) => {
    const now = Date.now();
    if (now - attentionViolationAt.current < 1500) return;
    attentionViolationAt.current = now;
    recordViolation("tab_switch", message);
  }, [recordViolation]);

  const requestTestFullscreen = useCallback(async () => {
    if (!proctor?.requireFullscreen || typeof document === "undefined") return;
    if (document.fullscreenElement) {
      setFullscreenActive(true);
      hasEnteredFullscreen.current = true;
      return;
    }
    if (!document.fullscreenEnabled) {
      setProctorMsg("Full-screen mode is not available in this browser.");
      return;
    }
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenActive(true);
      hasEnteredFullscreen.current = true;
    } catch {
      setProctorMsg("Full-screen mode was not started. Continue in this window and avoid switching away.");
    }
  }, [proctor?.requireFullscreen]);

  // Anti-cheat listeners — active only while taking / reviewing.
  const proctoringActive = proctorEnabled && (phase === "taking" || phase === "review");
  useEffect(() => {
    if (!proctoringActive || !proctor) return;
    const leaveMessage = "You left the test window or switched apps/tabs — this was recorded.";
    const onVisibility = () => {
      if (document.hidden && proctor.blockTabSwitch) {
        recordAttentionLoss(leaveMessage);
      }
    };
    const onWindowBlur = () => {
      if (!proctor.blockTabSwitch) return;
      window.setTimeout(() => {
        if (document.hidden || !document.hasFocus()) recordAttentionLoss(leaveMessage);
      }, 250);
    };
    const onFullscreenChange = () => {
      const active = !!document.fullscreenElement;
      setFullscreenActive(active);
      if (active) {
        hasEnteredFullscreen.current = true;
        return;
      }
      if (!proctor.requireFullscreen || !hasEnteredFullscreen.current) return;
      const now = Date.now();
      if (now - fullscreenViolationAt.current < 1500) return;
      fullscreenViolationAt.current = now;
      recordViolation("fullscreen_exit", "Full-screen mode was exited — this was recorded.");
    };
    const onFocus = () => {
      setFullscreenActive(!!document.fullscreenElement);
    };
    const onPageHide = () => {
      if (proctor.blockTabSwitch) {
        recordAttentionLoss("You navigated away from the test — this was recorded.");
      }
    };
    const onClipboard = (e: Event) => {
      e.preventDefault();
      recordViolation("copy", "Copy, paste & right-click are disabled during this test.");
    };
    // Best-effort block of in-browser shortcuts. NOTE: OS-level keys (Alt+Tab, the
    // Windows/Cmd keys, Spotlight) cannot be intercepted by any web page — they never
    // reach the browser. These only stop combos the browser actually delivers.
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const meta = e.ctrlKey || e.metaKey;
      const blocked =
        e.key === "F12" ||
        (meta && e.shiftKey && ["i", "j", "c"].includes(k)) || // devtools
        (meta && ["c", "v", "x", "p", "s", "u"].includes(k) && proctor.blockCopyPaste) ||
        (meta && k === "tab") || // browser tab cycling (OS Alt+Tab still unblockable)
        (e.ctrlKey && ["tab", "pageup", "pagedown"].includes(k));
      if (blocked) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("blur", onWindowBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("keydown", onKeyDown, true);
    const clip = ["copy", "cut", "paste", "contextmenu"];
    if (proctor.blockCopyPaste) clip.forEach((ev) => document.addEventListener(ev, onClipboard));
    onFullscreenChange();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("keydown", onKeyDown, true);
      if (proctor.blockCopyPaste) clip.forEach((ev) => document.removeEventListener(ev, onClipboard));
    };
  }, [proctoringActive, proctor, recordViolation, recordAttentionLoss]);

  useEffect(() => {
    if (phase === "done" && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [phase]);

  useEffect(() => {
    const timers = debouncers.current;
    return () => {
      Object.values(timers).forEach(clearTimeout);
    };
  }, []);

  const persist = useCallback(async (questionId: string, response: Record<string, unknown> | null) => {
    setSaving(true);
    try {
      const rev = (revs.current[questionId] ?? 0) + 1;
      revs.current[questionId] = rev;
      const res = await assessmentPlatformApi.saveAnswer(attemptId, questionId, { response, clientRev: rev });
      if (res.remainingSeconds != null) setRemaining(res.remainingSeconds);
    } catch (e) {
      const err = e as { response?: { status?: number } };
      if (err.response?.status === 409) { submittedRef.current = true; setPhase("done"); }
    } finally {
      setSaving(false);
    }
  }, [attemptId]);

  const onAnswer = useCallback((questionId: string, response: Record<string, unknown> | null) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...(prev[questionId] ?? { questionId, clientRev: 0 }), questionId, response } }));
    clearTimeout(debouncers.current[questionId]);
    debouncers.current[questionId] = setTimeout(() => void persist(questionId, response), 700);
  }, [persist]);

  const onFileUpload = useCallback(async (questionId: string, file: File) => {
    setUploading(questionId);
    try {
      const res = await assessmentPlatformApi.uploadAnswerFile(attemptId, questionId, file);
      setAnswers((prev) => ({
        ...prev,
        [questionId]: { ...(prev[questionId] ?? { questionId, clientRev: 0 }), questionId, response: { fileName: res.fileName }, fileName: res.fileName, fileUrl: res.fileUrl },
      }));
      if (res.remainingSeconds != null) setRemaining(res.remainingSeconds);
    } catch {
      toast.error("Upload failed. Check file type/size.");
    } finally {
      setUploading(null);
    }
  }, [attemptId]);

  const answeredCount = useMemo(
    () => allQuestions.filter((q) => {
      const r = answers[q.id]?.response;
      return r && Object.values(r).some((v) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0));
    }).length,
    [allQuestions, answers]
  );

  const section = sections[sectionIdx];
  const isLocked = locked.has(sectionIdx);
  // Memoize the question cards so the 1-second timer tick (which re-renders the
  // header/clock) does NOT rebuild every QuestionTaker each second — that full-tree
  // re-render is what made a multi-section test feel unresponsive. Rebuilds only when
  // the section, answers, lock or upload state actually change.
  const questionCards = useMemo(
    () => section?.questions.map((q, i) => (
      <Card key={q.id}>
        <CardContent className="space-y-3 pt-5">
          <p className="text-sm font-medium">
            {i + 1}. {q.prompt} {q.isRequired && <span className="text-red-500">*</span>}
            <Badge variant="outline" className="ml-2 align-middle text-xs">{q.marks} marks</Badge>
          </p>
          <QuestionTaker
            question={q}
            answer={answers[q.id]}
            disabled={isLocked}
            uploading={uploading === q.id}
            onChange={(r) => onAnswer(q.id, r)}
            onFileUpload={(file) => onFileUpload(q.id, file)}
          />
        </CardContent>
      </Card>
    )),
    [section, answers, isLocked, uploading, onAnswer, onFileUpload],
  );

  const goNext = () => {
    if (sections[sectionIdx].lockAfterLeave) setLocked((p) => new Set(p).add(sectionIdx));
    if (sectionIdx < sections.length - 1) setSectionIdx(sectionIdx + 1);
    else setPhase("review");
  };
  const goPrev = () => { if (sectionIdx > 0 && !locked.has(sectionIdx - 1)) setSectionIdx(sectionIdx - 1); };
  const beginAttempt = async () => {
    if (proctorEnabled && proctor?.requireFullscreen) await requestTestFullscreen();
    setPhase("taking");
  };

  // ── render ──
  if (phase === "done") {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <CheckCircle2 className="size-12 text-green-600" />
          <h2 className="text-lg font-semibold">Assessment submitted</h2>
          <p className="text-sm text-muted-foreground">Thank you. Your responses have been recorded.</p>
          {result?.released && result.resultStatus ? (
            <div className="flex flex-col items-center gap-2">
              <ApStatusBadge status={result.resultStatus} />
              {result.totalScore != null && (
                <p className="text-2xl font-bold">{result.totalScore}/{result.maxScore} <span className="text-base font-normal text-muted-foreground">({result.percentage}%)</span></p>
              )}
            </div>
          ) : (
            <p className="text-sm text-amber-600">Your result is under review. You&apos;ll be notified once it&apos;s available.</p>
          )}
          <Button onClick={onExit} className="mt-2">Back to my assessments</Button>
        </CardContent>
      </Card>
    );
  }

  if (phase === "intro") {
    return (
      <Card className="mx-auto max-w-xl">
        <CardHeader><CardTitle>{initial.title}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {initial.instructions && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{initial.instructions}</p>}
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1"><Clock className="size-4" /> {initial.timeLimitMinutes ? `${initial.timeLimitMinutes} min` : "No time limit"}</span>
            <span>{allQuestions.length} question(s)</span>
            <span>{sections.length} section(s)</span>
          </div>
          {initial.timeLimitMinutes && (
            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700">The timer is already running. Your answers auto-save as you go.</p>
          )}
          {proctorEnabled && (
            <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-xs text-blue-700">
              <ShieldAlert className="size-4 shrink-0" />
              <span>
                This test is proctored.
                {proctor?.blockTabSwitch ? " Switching tabs or windows is detected and recorded." : ""}
                {proctor?.blockCopyPaste ? " Copy/paste is disabled." : ""}
                {maxWarnings > 0 ? ` After ${maxWarnings} warning(s) the test auto-submits.` : ""}
              </span>
            </div>
          )}
          {initial.consentText && (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={consent} onCheckedChange={(c) => setConsent(!!c)} />
              <span>{initial.consentText}</span>
            </label>
          )}
          <div className="flex justify-end">
            <Button
              onClick={() => void beginAttempt()}
              disabled={!consent}
            >
              Begin
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const Timer = (
    <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium ${remaining != null && remaining < 60 ? "bg-red-500/15 text-red-600" : "bg-muted"}`}>
      <Clock className="size-4" aria-hidden /> <span aria-live="polite">{fmt(remaining)}</span>
    </div>
  );

  if (phase === "review") {
    return (
      <ImmersiveShell>
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Review &amp; submit</h2>
          {remaining != null && Timer}
        </div>
        <Card><CardContent className="space-y-3 pt-5">
          <p className="text-sm text-muted-foreground">You answered <b className="text-foreground">{answeredCount}</b> of {allQuestions.length} questions.</p>
          <div className="grid grid-cols-8 gap-2 sm:grid-cols-12">
            {allQuestions.map((q, i) => {
              const done = !!answers[q.id]?.response && Object.keys(answers[q.id]?.response ?? {}).length > 0;
              return <span key={q.id} className={`flex size-7 items-center justify-center rounded-md text-xs ${done ? "bg-green-500/20 text-green-700" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>;
            })}
          </div>
        </CardContent></Card>
        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setPhase("taking")}><ChevronLeft className="size-4" /> Back</Button>
          <Button onClick={() => setConfirmOpen(true)}>Submit test</Button>
        </div>
        <SubmitConfirm open={confirmOpen} onOpenChange={setConfirmOpen} unanswered={allQuestions.length - answeredCount} onConfirm={() => { setConfirmOpen(false); void doSubmit(); }} />
      </div>
      </ImmersiveShell>
    );
  }

  // taking
  return (
    <ImmersiveShell>
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{initial.title}</h2>
          <p className="text-xs text-muted-foreground">Section {sectionIdx + 1} of {sections.length} · {section.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{saving ? <span className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Saving…</span> : "Saved"}</span>
          {remaining != null && Timer}
        </div>
      </div>

      {proctorEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-blue-700"><ShieldAlert className="size-3.5" /> Proctored test in progress</span>
          {proctor?.requireFullscreen && !fullscreenActive && (
            <Button type="button" variant="outline" size="sm" onClick={() => void requestTestFullscreen()}>
              Enter full screen
            </Button>
          )}
          {maxWarnings > 0 && (
            <span className={warnings > 0 ? "font-medium text-amber-600" : "text-muted-foreground"}>Warnings: {warnings}/{maxWarnings}</span>
          )}
        </div>
      )}
      {proctorMsg && (
        <p className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700">
          <AlertTriangle className="size-3.5 shrink-0" /> {proctorMsg}
        </p>
      )}

      {section.instructions && <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">{section.instructions}</p>}
      {isLocked && <p className="flex items-center gap-1 text-xs text-amber-600"><Lock className="size-3.5" /> This section is locked.</p>}

      <div className="space-y-5">{questionCards}</div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={goPrev} disabled={sectionIdx === 0 || locked.has(sectionIdx - 1)}>
          <ChevronLeft className="size-4" /> Previous
        </Button>
        <Button onClick={goNext}>
          {sectionIdx < sections.length - 1 ? <>Next <ChevronRight className="size-4" /></> : "Review"}
        </Button>
      </div>
    </div>
    </ImmersiveShell>
  );
}

function ImmersiveShell({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function SubmitConfirm({
  open, onOpenChange, unanswered, onConfirm,
}: { open: boolean; onOpenChange: (o: boolean) => void; unanswered: number; onConfirm: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Submit your test?</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          {unanswered > 0 ? `You have ${unanswered} unanswered question(s). ` : ""}
          You won&apos;t be able to change your answers after submitting.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Keep working</Button>
          <Button onClick={onConfirm}>Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

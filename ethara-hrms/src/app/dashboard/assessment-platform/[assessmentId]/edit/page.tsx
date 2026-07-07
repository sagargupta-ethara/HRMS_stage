"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  apKeys, useApAssessment, useUpdateApAssessment, usePublishApAssessment,
  useUnpublishApAssessment, useCloneApAssessment, useApQuestionBank,
} from "@/lib/queries";
import { assessmentPlatformApi, type ApQuestion, type ApSection } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { ApStatusBadge, QuestionTaker, QUESTION_TYPE_META } from "@/components/assessment-platform/question-types";
import { QuestionEditorDialog, type QuestionDraft } from "@/components/assessment-platform/question-editor-dialog";
import {
  ArrowLeft, Plus, Trash2, ChevronUp, ChevronDown, Pencil, Send, Copy, Users,
  BarChart3, Library, Lock, Code2, FileSpreadsheet,
} from "lucide-react";

const typeLabel = (t: string) => QUESTION_TYPE_META.find((m) => m.type === t)?.label ?? t;

export default function AssessmentBuilderPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = String(params.assessmentId);
  const { data: assessment, isLoading } = useApAssessment(id);
  const update = useUpdateApAssessment(id);
  const publish = usePublishApAssessment();
  const unpublish = useUnpublishApAssessment();
  const clone = useCloneApAssessment();

  const editable = assessment?.status === "draft";
  const refresh = () => qc.invalidateQueries({ queryKey: apKeys.assessment(id) });

  // ── settings form ── seed once per assessment (render-phase, guarded vs loops).
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [seededId, setSeededId] = useState<string | null>(null);
  const [sheetSyncing, setSheetSyncing] = useState(false);
  if (assessment && seededId !== assessment.id) {
    setSeededId(assessment.id);
    const proc = ((assessment.settings as Record<string, unknown> | null)?.proctoring ?? {}) as Record<string, unknown>;
    const sheet = ((assessment.settings as Record<string, unknown> | null)?.sheetSync ?? {}) as Record<string, unknown>;
    setForm({
      title: assessment.title,
      description: assessment.description ?? "",
      instructions: assessment.instructions ?? "",
      consentText: assessment.consentText ?? "",
      timeLimitMinutes: assessment.timeLimitMinutes ?? "",
      attemptsAllowed: assessment.attemptsAllowed,
      passPercentage: assessment.passPercentage ?? "",
      negativeMarking: assessment.negativeMarking,
      negativeFactor: assessment.negativeFactor,
      randomizeSections: assessment.randomizeSections,
      randomizeQuestions: assessment.randomizeQuestions,
      shuffleOptions: assessment.shuffleOptions,
      showResultsToCandidate: assessment.showResultsToCandidate,
      availableFrom: assessment.availableFrom?.slice(0, 10) ?? "",
      availableUntil: assessment.availableUntil?.slice(0, 10) ?? "",
      proctorFullscreen: !!proc.requireFullscreen,
      proctorTabSwitch: !!proc.blockTabSwitch,
      proctorCopyPaste: !!proc.blockCopyPaste,
      proctorMaxWarnings: (proc.maxWarnings as number) ?? 3,
      sheetEnabled: !!sheet.enabled,
      sheetUrl: (sheet.spreadsheetUrl as string) ?? "",
      sheetTab: (sheet.tabName as string) ?? "Form Responses",
    });
  }

  const f = (k: string) => form[k];
  const setF = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const opsSettingsPayload = () => ({
    showResultsToCandidate: !!f("showResultsToCandidate"),
    settings: {
      ...((assessment?.settings as Record<string, unknown> | null) ?? {}),
      proctoring: {
        requireFullscreen: !!f("proctorFullscreen"),
        blockTabSwitch: !!f("proctorTabSwitch"),
        blockCopyPaste: !!f("proctorCopyPaste"),
        maxWarnings: Number(f("proctorMaxWarnings")) || 0,
      },
      sheetSync: {
        enabled: !!f("sheetEnabled"),
        spreadsheetUrl: (f("sheetUrl") as string) || "",
        tabName: (f("sheetTab") as string) || "Form Responses",
      },
    },
  });

  const saveSettings = async () => {
    await update.mutateAsync({
      title: String(f("title") ?? "").trim() || "Untitled",
      description: (f("description") as string) || null,
      instructions: (f("instructions") as string) || null,
      consentText: (f("consentText") as string) || null,
      timeLimitMinutes: f("timeLimitMinutes") ? Number(f("timeLimitMinutes")) : null,
      attemptsAllowed: Number(f("attemptsAllowed")) || 1,
      passPercentage: f("passPercentage") !== "" ? Number(f("passPercentage")) : null,
      negativeMarking: !!f("negativeMarking"),
      negativeFactor: Number(f("negativeFactor")) || 0,
      randomizeSections: !!f("randomizeSections"),
      randomizeQuestions: !!f("randomizeQuestions"),
      shuffleOptions: !!f("shuffleOptions"),
      showResultsToCandidate: !!f("showResultsToCandidate"),
      availableFrom: (f("availableFrom") as string) || null,
      availableUntil: (f("availableUntil") as string) || null,
      settings: {
        ...((assessment?.settings as Record<string, unknown> | null) ?? {}),
        proctoring: {
          requireFullscreen: !!f("proctorFullscreen"),
          blockTabSwitch: !!f("proctorTabSwitch"),
          blockCopyPaste: !!f("proctorCopyPaste"),
          maxWarnings: Number(f("proctorMaxWarnings")) || 0,
        },
        sheetSync: {
          enabled: !!f("sheetEnabled"),
          spreadsheetUrl: (f("sheetUrl") as string) || "",
          tabName: (f("sheetTab") as string) || "Form Responses",
        },
      },
    });
    refresh();
  };

  // Operational settings (Google Sheet sync, proctoring, result visibility) — saved
  // via a dedicated endpoint that works even after publish, so HR can wire up the
  // sheet on a live assessment without cloning it.
  const saveOpsSettings = async () => {
    try {
      await assessmentPlatformApi.updateSettings(id, opsSettingsPayload());
      toast.success("Sheet & proctoring settings saved.");
      refresh();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "Could not save settings.");
    }
  };

  const saveAndSyncSheet = async () => {
    if (!f("sheetEnabled") || !String(f("sheetUrl") ?? "").trim()) {
      toast.error("Enable sheet sync and add the Google Sheet link first.");
      return;
    }
    setSheetSyncing(true);
    try {
      await assessmentPlatformApi.updateSettings(id, opsSettingsPayload());
      const res = await assessmentPlatformApi.resyncSheet(id);
      toast.success(`Synced ${res.synced} of ${res.total} submission(s) to the Google Sheet.`);
      refresh();
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail ?? "Could not sync to the Google Sheet.");
    } finally {
      setSheetSyncing(false);
    }
  };

  // ── question dialog state ──
  const [qDialog, setQDialog] = useState<{ sectionId: string; question: ApQuestion | null } | null>(null);
  const [bankPickerSection, setBankPickerSection] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: "section"; section: ApSection }
    | { type: "question"; question: ApQuestion }
    | null
  >(null);
  const [codeView, setCodeView] = useState<string | null>(null);

  const openCode = async () => {
    try {
      const spec = await assessmentPlatformApi.exportSpec(id);
      setCodeView(JSON.stringify(spec, null, 2));
    } catch (e) { toast.error(errMsg(e)); }
  };

  const sections = useMemo(() => assessment?.sections ?? [], [assessment]);

  const addSection = async () => {
    try {
      await assessmentPlatformApi.createSection(id, { title: `Section ${sections.length + 1}` });
      refresh();
    } catch (e) { toast.error(errMsg(e)); }
  };
  const renameSection = async (section: ApSection, title: string) => {
    if (title === section.title) return;
    try { await assessmentPlatformApi.updateSection(id, section.id, { title }); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const updateSectionField = async (section: ApSection, patch: Record<string, unknown>) => {
    try { await assessmentPlatformApi.updateSection(id, section.id, patch); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
  };
  const deleteSection = async (section: ApSection) => {
    setDeleteBusy(true);
    try { await assessmentPlatformApi.deleteSection(id, section.id); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setDeleteBusy(false); setDeleteTarget(null); }
  };
  const moveSection = async (index: number, dir: -1 | 1) => {
    const order = sections.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    try { await assessmentPlatformApi.reorderSections(id, order); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  const submitQuestion = async (draft: QuestionDraft) => {
    if (!qDialog) return;
    setBusy(true);
    try {
      if (qDialog.question) {
        await assessmentPlatformApi.updateQuestion(id, qDialog.question.id, draft as unknown as Record<string, unknown>);
      } else {
        await assessmentPlatformApi.createQuestion(id, qDialog.sectionId, draft as unknown as Record<string, unknown>);
      }
      setQDialog(null);
      refresh();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };
  const deleteQuestion = async (q: ApQuestion) => {
    setDeleteBusy(true);
    try { await assessmentPlatformApi.deleteQuestion(id, q.id); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setDeleteBusy(false); setDeleteTarget(null); }
  };
  const moveQuestion = async (section: ApSection, index: number, dir: -1 | 1) => {
    const order = (section.questions ?? []).map((q) => q.id);
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j], order[index]];
    try { await assessmentPlatformApi.reorderQuestions(id, section.id, order); refresh(); }
    catch (e) { toast.error(errMsg(e)); }
  };

  if (isLoading || !assessment) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-5">
      <button onClick={() => router.push("/dashboard/assessment-platform")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All assessments
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{assessment.title}</h1>
          <ApStatusBadge status={assessment.status} />
          <Badge variant="outline">{assessment.totalMarks} marks</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/dashboard/assessment-platform/${id}/assignments`}>
            <Button variant="outline" disabled={assessment.status !== "published"}><Users className="size-4" /> Assign</Button>
          </Link>
          <Link href={`/dashboard/assessment-platform/${id}/results`}>
            <Button variant="outline"><BarChart3 className="size-4" /> Results</Button>
          </Link>
          <Button variant="outline" onClick={openCode}><Code2 className="size-4" /> View code</Button>
          <Button variant="outline" onClick={() => clone.mutate(id)}><Copy className="size-4" /> Clone</Button>
          {assessment.status === "draft" ? (
            <Button onClick={() => publish.mutate(id)}><Send className="size-4" /> Publish</Button>
          ) : (
            <Button variant="outline" onClick={() => unpublish.mutate(id)}>Unpublish</Button>
          )}
        </div>
      </div>

      {!editable && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
          <Lock className="size-4" /> Published assessments are locked. Clone to make changes.
        </div>
      )}

      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="questions">Sections &amp; Questions</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>

        {/* ── Settings ── */}
        <TabsContent value="settings">
          <Card>
            <CardContent className="space-y-4 pt-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1"><Label>Title</Label>
                  <Input value={String(f("title") ?? "")} disabled={!editable} onChange={(e) => setF("title", e.target.value)} /></div>
                <div className="space-y-1"><Label>Time limit (minutes, blank = none)</Label>
                  <Input type="number" value={String(f("timeLimitMinutes") ?? "")} disabled={!editable} onChange={(e) => setF("timeLimitMinutes", e.target.value)} /></div>
              </div>
              <div className="space-y-1"><Label>Description</Label>
                <Textarea value={String(f("description") ?? "")} disabled={!editable} rows={2} onChange={(e) => setF("description", e.target.value)} /></div>
              <div className="space-y-1"><Label>Instructions (shown before start)</Label>
                <Textarea value={String(f("instructions") ?? "")} disabled={!editable} rows={2} onChange={(e) => setF("instructions", e.target.value)} /></div>
              <div className="space-y-1"><Label>Consent / declaration text (optional)</Label>
                <Textarea value={String(f("consentText") ?? "")} disabled={!editable} rows={2} onChange={(e) => setF("consentText", e.target.value)} /></div>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-1"><Label>Attempts allowed</Label>
                  <Input type="number" min={1} value={String(f("attemptsAllowed") ?? 1)} disabled={!editable} onChange={(e) => setF("attemptsAllowed", e.target.value)} /></div>
                <div className="space-y-1"><Label>Pass percentage</Label>
                  <Input type="number" min={0} max={100} value={String(f("passPercentage") ?? "")} disabled={!editable} onChange={(e) => setF("passPercentage", e.target.value)} /></div>
                <div className="space-y-1"><Label>Negative factor (× marks)</Label>
                  <Input type="number" min={0} step="0.05" value={String(f("negativeFactor") ?? 0)} disabled={!editable || !f("negativeMarking")} onChange={(e) => setF("negativeFactor", e.target.value)} /></div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                {([
                  ["negativeMarking", "Enable negative marking"],
                  ["showResultsToCandidate", "Show score to candidate"],
                  ["randomizeSections", "Randomize section order"],
                  ["randomizeQuestions", "Randomize question order"],
                  ["shuffleOptions", "Shuffle MCQ options"],
                ] as [string, string][]).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={!!f(key)} disabled={!editable} onCheckedChange={(c) => setF(key, !!c)} /> {label}
                  </label>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1"><Label>Available from</Label>
                  <DatePicker value={String(f("availableFrom") ?? "")} onChange={(v) => editable && setF("availableFrom", v)} /></div>
                <div className="space-y-1"><Label>Available until</Label>
                  <DatePicker value={String(f("availableUntil") ?? "")} onChange={(v) => editable && setF("availableUntil", v)} /></div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/60 p-3">
                <p className="text-sm font-medium">Proctoring &amp; anti-cheat</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {([
                    ["proctorFullscreen", "Force full-screen mode"],
                    ["proctorTabSwitch", "Detect tab / window switching"],
                    ["proctorCopyPaste", "Block copy, paste & right-click"],
                  ] as [string, string][]).map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={!!f(key)} onCheckedChange={(c) => setF(key, !!c)} /> {label}
                    </label>
                  ))}
                </div>
                <div className="max-w-xs space-y-1">
                  <Label className="text-xs">Auto-submit after this many warnings (0 = never)</Label>
                  <Input type="number" min={0} value={String(f("proctorMaxWarnings") ?? 3)} onChange={(e) => setF("proctorMaxWarnings", e.target.value)} />
                </div>
              </div>

              <div className="space-y-3 rounded-lg border border-border/60 p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox checked={!!f("sheetEnabled")} onCheckedChange={(c) => setF("sheetEnabled", !!c)} />
                  Sync responses to a Google Sheet on submit
                </label>
                <p className="text-xs text-muted-foreground">
                  Share the sheet (Editor access) with <code className="rounded bg-muted px-1">your-service-account@your-project.iam.gserviceaccount.com</code>,
                  then paste its link. Each submission appends a row (Timestamp, Email, Score, then one column per question) — like a Google Form.
                </p>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">Google Sheet link</Label>
                    <Input value={String(f("sheetUrl") ?? "")} disabled={!f("sheetEnabled")} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={(e) => setF("sheetUrl", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tab name</Label>
                    <Input value={String(f("sheetTab") ?? "")} disabled={!f("sheetEnabled")} placeholder="Form Responses" onChange={(e) => setF("sheetTab", e.target.value)} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sheet &amp; proctoring settings can be saved even after the test is published — they apply to future submissions.
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={saveAndSyncSheet}
                    disabled={sheetSyncing || !f("sheetEnabled") || !String(f("sheetUrl") ?? "").trim()}
                  >
                    <FileSpreadsheet className="size-4" />
                    {sheetSyncing ? "Syncing..." : "Save & sync to Sheet"}
                  </Button>
                  <Button variant="outline" onClick={saveOpsSettings}>Save sheet &amp; proctoring</Button>
                </div>
              </div>

              {editable && (
                <div className="flex justify-end"><Button onClick={saveSettings} disabled={update.isPending}>Save settings</Button></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Questions ── */}
        <TabsContent value="questions">
          <div className="space-y-4">
            {sections.map((section, si) => (
              <Card key={section.id}>
                <CardHeader className="flex flex-row items-center gap-2 pb-3">
                  <Input
                    defaultValue={section.title}
                    disabled={!editable}
                    className="max-w-sm font-medium"
                    onBlur={(e) => editable && renameSection(section, e.target.value.trim() || section.title)}
                  />
                  <div className="ml-auto flex items-center gap-1">
                    {editable && <>
                      <Button variant="ghost" size="icon" onClick={() => moveSection(si, -1)} disabled={si === 0}><ChevronUp className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => moveSection(si, 1)} disabled={si === sections.length - 1}><ChevronDown className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ type: "section", section })}><Trash2 className="size-4" /></Button>
                    </>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {editable && (
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1"><Label className="text-xs">Section cutoff (marks)</Label>
                        <Input type="number" defaultValue={section.cutoffMark ?? ""} onBlur={(e) => updateSectionField(section, { cutoffMark: e.target.value ? Number(e.target.value) : null })} /></div>
                      <div className="space-y-1"><Label className="text-xs">Pick random N (blank = all)</Label>
                        <Input type="number" defaultValue={section.pickCount ?? ""} onBlur={(e) => updateSectionField(section, { pickCount: e.target.value ? Number(e.target.value) : null })} /></div>
                      <label className="flex items-end gap-2 text-xs pb-2">
                        <Checkbox checked={section.lockAfterLeave} onCheckedChange={(c) => updateSectionField(section, { lockAfterLeave: !!c })} /> Lock after leaving
                      </label>
                    </div>
                  )}

                  {(section.questions ?? []).map((q, qi) => (
                    <div key={q.id} className="flex items-center gap-2 rounded-lg border border-border/60 p-2">
                      <span className="text-xs text-muted-foreground w-6 text-center">{qi + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{q.prompt || <span className="italic text-muted-foreground">Untitled</span>}</p>
                        <p className="text-xs text-muted-foreground">{typeLabel(q.type)} · {q.marks} marks{q.autoScored ? " · auto" : " · manual"}</p>
                      </div>
                      {editable && <>
                        <Button variant="ghost" size="icon" onClick={() => moveQuestion(section, qi, -1)} disabled={qi === 0}><ChevronUp className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => moveQuestion(section, qi, 1)} disabled={qi === (section.questions?.length ?? 1) - 1}><ChevronDown className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setQDialog({ sectionId: section.id, question: q })}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ type: "question", question: q })}><Trash2 className="size-4" /></Button>
                      </>}
                    </div>
                  ))}

                  {editable && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => setQDialog({ sectionId: section.id, question: null })}>
                        <Plus className="size-4" /> Add question
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setBankPickerSection(section.id)}>
                        <Library className="size-4" /> Add from bank
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {editable && (
              <Button variant="outline" onClick={addSection}><Plus className="size-4" /> Add section</Button>
            )}
            {sections.length === 0 && !editable && (
              <p className="text-sm text-muted-foreground">No questions.</p>
            )}
          </div>
        </TabsContent>

        {/* ── Preview ── */}
        <TabsContent value="preview">
          <PreviewPane sections={sections} />
        </TabsContent>
      </Tabs>

      {qDialog && (
        <QuestionEditorDialog
          open={!!qDialog}
          onOpenChange={(o) => { if (!o) setQDialog(null); }}
          initial={qDialog.question ? {
            type: qDialog.question.type, prompt: qDialog.question.prompt, marks: qDialog.question.marks,
            negativeMarks: qDialog.question.negativeMarks, isRequired: qDialog.question.isRequired, config: qDialog.question.config,
          } : null}
          onSubmit={submitQuestion}
          busy={busy}
        />
      )}

      {bankPickerSection && (
        <BankPickerDialog
          assessmentId={id}
          sectionId={bankPickerSection}
          onClose={() => setBankPickerSection(null)}
          onAdded={() => { setBankPickerSection(null); refresh(); }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={deleteTarget?.type === "section" ? "Delete section?" : "Delete question?"}
        description={
          deleteTarget?.type === "section"
            ? `Delete section "${deleteTarget.section.title}" and its questions?`
            : "This will permanently remove the question from this assessment."
        }
        confirmLabel="Delete"
        destructive
        loading={deleteBusy}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (!deleteTarget) return;
          if (deleteTarget.type === "section") void deleteSection(deleteTarget.section);
          else void deleteQuestion(deleteTarget.question);
        }}
      />

      <Dialog open={codeView !== null} onOpenChange={(o) => { if (!o) setCodeView(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Code2 className="size-5" /> Assessment as code</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Copy this JSON to clone or version this assessment elsewhere — paste it into &quot;Create from code&quot;.</p>
          <pre className="max-h-[55vh] overflow-auto rounded-lg border border-border/60 bg-muted/40 p-3 font-mono text-xs">{codeView}</pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCodeView(null)}>Close</Button>
            <Button onClick={() => { if (codeView) { void navigator.clipboard.writeText(codeView); toast.success("Copied to clipboard"); } }}>Copy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PreviewPane({ sections }: { sections: ApSection[] }) {
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown> | null>>({});
  if (sections.every((s) => (s.questions ?? []).length === 0)) {
    return <p className="text-sm text-muted-foreground">Add questions to preview the candidate experience.</p>;
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {sections.map((section) => (
        <Card key={section.id}>
          <CardHeader><CardTitle className="text-base">{section.title}</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            {(section.questions ?? []).map((q, i) => (
              <div key={q.id} className="space-y-2">
                <p className="text-sm font-medium">{i + 1}. {q.prompt} {q.isRequired && <span className="text-red-500">*</span>}</p>
                <QuestionTaker
                  question={{ id: q.id, type: q.type, prompt: q.prompt, marks: q.marks, isRequired: q.isRequired, mediaUrl: q.mediaUrl, config: q.config }}
                  answer={{ questionId: q.id, response: answers[q.id] ?? null, clientRev: 0 }}
                  onChange={(r) => setAnswers((p) => ({ ...p, [q.id]: r }))}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <p className="text-center text-xs text-muted-foreground">Preview only — answers are not saved.</p>
    </div>
  );
}

function BankPickerDialog({
  assessmentId, sectionId, onClose, onAdded,
}: { assessmentId: string; sectionId: string; onClose: () => void; onAdded: () => void }) {
  const { data: items = [] } = useApQuestionBank();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try { await assessmentPlatformApi.addFromBank(assessmentId, sectionId, selected); onAdded(); }
    catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Add from question bank</DialogTitle></DialogHeader>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">Your question bank is empty.</p> : (
          <div className="space-y-2">
            {items.map((it) => (
              <label key={it.id} className="flex items-start gap-3 rounded-lg border border-border/60 p-2 text-sm">
                <Checkbox checked={selected.includes(it.id)} onCheckedChange={(c) => setSelected((p) => c ? [...p, it.id] : p.filter((x) => x !== it.id))} />
                <div><p>{it.prompt}</p><p className="text-xs text-muted-foreground">{typeLabel(it.type)} · {it.defaultMarks} marks</p></div>
              </label>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={add} disabled={busy || selected.length === 0}>Add {selected.length || ""}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function errMsg(e: unknown): string {
  const err = e as { response?: { data?: { detail?: string } } };
  return err.response?.data?.detail ?? "Something went wrong";
}

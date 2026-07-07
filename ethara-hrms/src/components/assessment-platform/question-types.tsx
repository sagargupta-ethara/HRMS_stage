"use client";

/**
 * The single source of truth for every question type's three render slots —
 * ConfigEditor (builder), QuestionTaker (candidate), AnswerReport (scorecard) —
 * mirroring the backend plugin contract. Adding a new type = extend this file
 * (and the backend scorer). Answer keys never reach the taker: the backend
 * strips them, and QuestionTaker only reads render-safe config.
 */

import type { ApQuestionType, ApQuestionConfig, ApTakerQuestion, ApTakerAnswer } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Upload, CheckCircle2, XCircle, FileText, Loader2 } from "lucide-react";
import { formatLabel } from "@/lib/utils";

export type Option = { id: string; text: string };
type Cfg = ApQuestionConfig;
type Resp = Record<string, unknown> | null;

export const QUESTION_TYPE_META: { type: ApQuestionType; label: string; group: string }[] = [
  { type: "mcq_single", label: "Single-choice MCQ", group: "Auto-scored" },
  { type: "mcq_multi", label: "Multiple-choice MCQ", group: "Auto-scored" },
  { type: "true_false", label: "True / False", group: "Auto-scored" },
  { type: "short_answer", label: "Short answer", group: "Auto or manual" },
  { type: "long_answer", label: "Long answer / Essay", group: "Manual" },
  { type: "file_upload", label: "File upload", group: "Manual" },
  { type: "url_submission", label: "URL submission", group: "Manual" },
  { type: "rating", label: "Rating / Likert", group: "Survey" },
  { type: "form_text", label: "Text field", group: "Survey" },
  { type: "form_date", label: "Date field", group: "Survey" },
  { type: "form_dropdown", label: "Dropdown", group: "Survey" },
  { type: "consent", label: "Consent checkbox", group: "Survey" },
];

const oid = () => Math.random().toString(36).slice(2, 10);

export function defaultConfigFor(type: ApQuestionType): Cfg {
  switch (type) {
    case "mcq_single":
      return { options: [{ id: oid(), text: "" }, { id: oid(), text: "" }], correctOptionId: null };
    case "mcq_multi":
      return { options: [{ id: oid(), text: "" }, { id: oid(), text: "" }], correctOptionIds: [], partialMarking: false };
    case "true_false":
      return { correct: true };
    case "short_answer":
      return { acceptedAnswers: [], matchMode: "manual" };
    case "rating":
      return { scaleMin: 1, scaleMax: 5 };
    case "form_dropdown":
      return { options: ["Option 1"] };
    case "consent":
      return { statement: "I confirm the above." };
    case "file_upload":
      return { maxSizeMb: 10 };
    default:
      return {};
  }
}

const getOptions = (cfg: Cfg): Option[] => (Array.isArray(cfg.options) ? (cfg.options as Option[]) : []);
const getStringOptions = (cfg: Cfg): string[] => (Array.isArray(cfg.options) ? (cfg.options as string[]) : []);

// ───────────────────────────── ConfigEditor (builder) ────────────────────────

export function ConfigEditor({
  type, config, onChange,
}: { type: ApQuestionType; config: Cfg; onChange: (next: Cfg) => void }) {
  const set = (patch: Cfg) => onChange({ ...config, ...patch });

  if (type === "mcq_single" || type === "mcq_multi") {
    const options = getOptions(config);
    const correctIds: string[] =
      type === "mcq_single"
        ? (config.correctOptionId ? [config.correctOptionId as string] : [])
        : ((config.correctOptionIds as string[]) ?? []);

    const updateOption = (id: string, text: string) =>
      set({ options: options.map((o) => (o.id === id ? { ...o, text } : o)) });
    const addOption = () => set({ options: [...options, { id: oid(), text: "" }] });
    const removeOption = (id: string) =>
      set({
        options: options.filter((o) => o.id !== id),
        ...(type === "mcq_single"
          ? { correctOptionId: config.correctOptionId === id ? null : config.correctOptionId }
          : { correctOptionIds: correctIds.filter((c) => c !== id) }),
      });
    const toggleCorrect = (id: string) => {
      if (type === "mcq_single") set({ correctOptionId: id });
      else set({ correctOptionIds: correctIds.includes(id) ? correctIds.filter((c) => c !== id) : [...correctIds, id] });
    };

    return (
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
          Options {type === "mcq_single" ? "(select the one correct answer)" : "(check all correct answers)"}
        </Label>
        {options.map((opt) => (
          <div key={opt.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggleCorrect(opt.id)}
              aria-label={correctIds.includes(opt.id) ? "Correct answer" : "Mark correct"}
              className={`flex size-6 shrink-0 items-center justify-center rounded-md border ${
                correctIds.includes(opt.id) ? "border-green-500 bg-green-500/15 text-green-600" : "border-input text-muted-foreground"
              } ${type === "mcq_single" ? "rounded-full" : ""}`}
            >
              <CheckCircle2 className="size-4" />
            </button>
            <Input value={opt.text} placeholder="Option text" onChange={(e) => updateOption(opt.id, e.target.value)} />
            <Button type="button" variant="ghost" size="icon" onClick={() => removeOption(opt.id)} disabled={options.length <= 2}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" size="sm" onClick={addOption}>
            <Plus className="size-4" /> Add option
          </Button>
          {type === "mcq_multi" && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={!!config.partialMarking} onCheckedChange={(c) => set({ partialMarking: !!c })} />
              Allow partial marking
            </label>
          )}
        </div>
      </div>
    );
  }

  if (type === "true_false") {
    return (
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Correct answer</Label>
        <RadioGroup
          value={config.correct ? "true" : "false"}
          onValueChange={(v) => set({ correct: v === "true" })}
          className="flex gap-6"
        >
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="true" /> True</label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="false" /> False</label>
        </RadioGroup>
      </div>
    );
  }

  if (type === "short_answer") {
    const accepted = (config.acceptedAnswers as string[]) ?? [];
    const mode = (config.matchMode as string) ?? "manual";
    return (
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Accepted answers (comma-separated; leave blank for manual grading)</Label>
        <Input
          value={accepted.join(", ")}
          placeholder="e.g. Paris, paris"
          onChange={(e) => {
            const list = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            set({ acceptedAnswers: list, matchMode: list.length ? (mode === "manual" ? "exact" : mode) : "manual" });
          }}
        />
        {accepted.length > 0 && (
          <Select value={mode} onValueChange={(v) => set({ matchMode: v ?? "exact" })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="exact">Exact match</SelectItem>
              <SelectItem value="fuzzy">Fuzzy (case / whitespace insensitive, partial)</SelectItem>
              <SelectItem value="manual">Manual grading</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    );
  }

  if (type === "long_answer") {
    return (
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Grading rubric (shown to evaluators)</Label>
        <Textarea value={(config.rubric as string) ?? ""} onChange={(e) => set({ rubric: e.target.value })} rows={2} placeholder="What a good answer should cover…" />
      </div>
    );
  }

  if (type === "file_upload") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Max size (MB)</Label>
          <Input type="number" min={1} value={(config.maxSizeMb as number) ?? 10} onChange={(e) => set({ maxSizeMb: Number(e.target.value) || 10 })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Allowed MIME types (comma-sep, blank = any)</Label>
          <Input
            value={((config.allowedTypes as string[]) ?? []).join(", ")}
            placeholder="application/pdf, image/png"
            onChange={(e) => set({ allowedTypes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
          />
        </div>
      </div>
    );
  }

  if (type === "rating") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Scale min</Label>
          <Input type="number" value={(config.scaleMin as number) ?? 1} onChange={(e) => set({ scaleMin: Number(e.target.value) })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Scale max</Label>
          <Input type="number" value={(config.scaleMax as number) ?? 5} onChange={(e) => set({ scaleMax: Number(e.target.value) })} />
        </div>
      </div>
    );
  }

  if (type === "form_dropdown") {
    const options = getStringOptions(config);
    return (
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Dropdown options</Label>
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={opt} onChange={(e) => set({ options: options.map((o, idx) => (idx === i ? e.target.value : o)) })} />
            <Button type="button" variant="ghost" size="icon" onClick={() => set({ options: options.filter((_, idx) => idx !== i) })} disabled={options.length <= 1}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => set({ options: [...options, `Option ${options.length + 1}`] })}>
          <Plus className="size-4" /> Add option
        </Button>
      </div>
    );
  }

  if (type === "consent") {
    return (
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Consent statement</Label>
        <Textarea value={(config.statement as string) ?? ""} onChange={(e) => set({ statement: e.target.value })} rows={2} />
      </div>
    );
  }

  // url_submission, form_text, form_date — nothing extra to configure
  return <p className="text-xs text-muted-foreground">No extra configuration for this type.</p>;
}

// ───────────────────────────── QuestionTaker (candidate) ─────────────────────

export function QuestionTaker({
  question, answer, onChange, onFileUpload, uploading, disabled,
}: {
  question: ApTakerQuestion;
  answer?: ApTakerAnswer;
  onChange: (response: Resp) => void;
  onFileUpload?: (file: File) => void;
  uploading?: boolean;
  disabled?: boolean;
}) {
  const { type, config } = question;
  const resp = answer?.response ?? {};

  switch (type) {
    case "mcq_single":
      return (
        <RadioGroup
          value={(resp.optionId as string) ?? ""}
          onValueChange={(v) => onChange({ optionId: v })}
          disabled={disabled}
          className="gap-2"
        >
          {getOptions(config).map((opt) => (
            <label key={opt.id} className="flex items-center gap-3 rounded-lg border border-border/70 p-3 text-sm hover:bg-muted/40">
              <RadioGroupItem value={opt.id} /> {opt.text}
            </label>
          ))}
        </RadioGroup>
      );
    case "mcq_multi": {
      const selected = (resp.optionIds as string[]) ?? [];
      return (
        <div className="space-y-2">
          {getOptions(config).map((opt) => (
            <label key={opt.id} className="flex items-center gap-3 rounded-lg border border-border/70 p-3 text-sm hover:bg-muted/40">
              <Checkbox
                checked={selected.includes(opt.id)}
                disabled={disabled}
                onCheckedChange={(c) =>
                  onChange({ optionIds: c ? [...selected, opt.id] : selected.filter((id) => id !== opt.id) })
                }
              />
              {opt.text}
            </label>
          ))}
        </div>
      );
    }
    case "true_false":
      return (
        <RadioGroup
          value={resp.value === undefined ? "" : resp.value ? "true" : "false"}
          onValueChange={(v) => onChange({ value: v === "true" })}
          disabled={disabled}
          className="flex gap-6"
        >
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="true" /> True</label>
          <label className="flex items-center gap-2 text-sm"><RadioGroupItem value="false" /> False</label>
        </RadioGroup>
      );
    case "short_answer":
    case "form_text":
      return <Input value={(resp.text as string) ?? ""} disabled={disabled} onChange={(e) => onChange({ text: e.target.value })} placeholder="Your answer" />;
    case "long_answer":
      return <Textarea value={(resp.text as string) ?? ""} disabled={disabled} rows={6} onChange={(e) => onChange({ text: e.target.value })} placeholder="Write your answer…" />;
    case "url_submission":
      return <Input type="url" value={(resp.url as string) ?? ""} disabled={disabled} onChange={(e) => onChange({ url: e.target.value })} placeholder="https://…" />;
    case "form_date":
      return <DatePicker value={(resp.value as string) ?? ""} onChange={(v) => onChange({ value: v })} />;
    case "form_dropdown":
      return (
        <Select value={(resp.value as string) ?? ""} onValueChange={(v) => onChange({ value: v })} disabled={disabled}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {getStringOptions(config).map((opt, i) => <SelectItem key={i} value={opt}>{opt}</SelectItem>)}
          </SelectContent>
        </Select>
      );
    case "consent":
      return (
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={!!resp.value} disabled={disabled} onCheckedChange={(c) => onChange({ value: !!c })} />
          <span>{(config.statement as string) ?? "I agree."}</span>
        </label>
      );
    case "rating": {
      const min = (config.scaleMin as number) ?? 1;
      const max = (config.scaleMax as number) ?? 5;
      const values = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      return (
        <div className="flex flex-wrap gap-2">
          {values.map((v) => (
            <Button
              key={v}
              type="button"
              variant={resp.value === v ? "default" : "outline"}
              size="sm"
              disabled={disabled}
              onClick={() => onChange({ value: v })}
            >
              {v}
            </Button>
          ))}
        </div>
      );
    }
    case "file_upload":
      return (
        <div className="space-y-2">
          {answer?.fileName && (
            <a href={answer.fileUrl ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-primary">
              <FileText className="size-4" /> {answer.fileName}
            </a>
          )}
          <label className="inline-flex">
            <input
              type="file"
              className="hidden"
              disabled={disabled || uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f && onFileUpload) onFileUpload(f); e.target.value = ""; }}
            />
            <span className={`inline-flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm ${disabled || uploading ? "opacity-50" : "cursor-pointer hover:bg-muted/40"}`}>
              {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {answer?.fileName ? "Replace file" : "Upload file"}
            </span>
          </label>
        </div>
      );
    default:
      return null;
  }
}

// ───────────────────────────── AnswerReport (scorecard) ──────────────────────

export function summarizeResponse(type: ApQuestionType, response: Resp, config: Cfg): string {
  const r = response ?? {};
  switch (type) {
    case "mcq_single": {
      const opt = getOptions(config).find((o) => o.id === r.optionId);
      return opt?.text ?? "—";
    }
    case "mcq_multi": {
      const ids = (r.optionIds as string[]) ?? [];
      const texts = getOptions(config).filter((o) => ids.includes(o.id)).map((o) => o.text);
      return texts.length ? texts.join(", ") : "—";
    }
    case "true_false":
      return r.value === undefined ? "—" : r.value ? "True" : "False";
    case "rating":
      return r.value !== undefined ? String(r.value) : "—";
    case "url_submission":
      return (r.url as string) || "—";
    case "consent":
      return r.value ? "Agreed" : "Not agreed";
    case "file_upload":
      return "(file)";
    default:
      return (r.text as string) || (r.value as string) || "—";
  }
}

export function correctAnswerText(type: ApQuestionType, config: Cfg): string | null {
  switch (type) {
    case "mcq_single": {
      const opt = getOptions(config).find((o) => o.id === config.correctOptionId);
      return opt?.text ?? null;
    }
    case "mcq_multi": {
      const ids = (config.correctOptionIds as string[]) ?? [];
      return getOptions(config).filter((o) => ids.includes(o.id)).map((o) => o.text).join(", ") || null;
    }
    case "true_false":
      return config.correct ? "True" : "False";
    case "short_answer":
      return ((config.acceptedAnswers as string[]) ?? []).join(" / ") || null;
    default:
      return null;
  }
}

export function AnswerReport({
  question,
}: {
  question: {
    id: string; type: ApQuestionType; prompt: string; marks: number; scored: boolean; autoScored: boolean;
    config: Cfg; response?: Resp; fileName?: string | null; fileUrl?: string | null;
    awardedMarks?: number | null; isCorrect?: boolean | null; feedback?: string | null; needsManual: boolean;
  };
}) {
  const correct = correctAnswerText(question.type, question.config);
  const candidate = question.type === "file_upload"
    ? null
    : summarizeResponse(question.type, question.response ?? null, question.config);

  return (
    <div className="rounded-lg border border-border/70 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium">{question.prompt}</p>
        <div className="flex items-center gap-2 shrink-0">
          {question.isCorrect === true && <CheckCircle2 className="size-4 text-green-600" />}
          {question.isCorrect === false && <XCircle className="size-4 text-red-500" />}
          {question.scored ? (
            <Badge variant="outline">
              {question.awardedMarks ?? (question.needsManual ? "—" : 0)} / {question.marks}
            </Badge>
          ) : (
            <Badge variant="secondary">Survey</Badge>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1 text-muted-foreground">
        {question.type === "file_upload" ? (
          question.fileName ? (
            <a href={question.fileUrl ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-primary">
              <FileText className="size-4" /> {question.fileName}
            </a>
          ) : <p>No file submitted</p>
        ) : (
          <p><span className="text-foreground/70">Answer:</span> {candidate}</p>
        )}
        {correct && <p><span className="text-foreground/70">Correct:</span> {correct}</p>}
        {question.feedback && <p className="text-foreground/80"><span className="text-foreground/70">Feedback:</span> {question.feedback}</p>}
        {question.needsManual && question.awardedMarks == null && <p className="text-amber-600">Awaiting manual grading</p>}
      </div>
    </div>
  );
}

/** A reusable status pill used across builder / results / taker lists. */
export function ApStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    draft: { label: "Draft", cls: "bg-muted text-muted-foreground" },
    published: { label: "Published", cls: "bg-green-500/15 text-green-600" },
    archived: { label: "Archived", cls: "bg-muted text-muted-foreground" },
    invited: { label: "Invited", cls: "bg-blue-500/15 text-blue-600" },
    started: { label: "In progress", cls: "bg-amber-500/15 text-amber-600" },
    in_progress: { label: "In progress", cls: "bg-amber-500/15 text-amber-600" },
    submitted: { label: "Submitted", cls: "bg-indigo-500/15 text-indigo-600" },
    graded: { label: "Graded", cls: "bg-green-500/15 text-green-600" },
    revoked: { label: "Revoked", cls: "bg-red-500/15 text-red-600" },
    pass: { label: "Pass", cls: "bg-green-500/15 text-green-600" },
    fail: { label: "Fail", cls: "bg-red-500/15 text-red-600" },
    pending: { label: "Grading pending", cls: "bg-amber-500/15 text-amber-600" },
  };
  const item = map[status] ?? { label: formatLabel(status), cls: "bg-muted text-muted-foreground" };
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${item.cls}`}>{item.label}</span>;
}

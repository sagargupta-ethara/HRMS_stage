"use client";

import { useState } from "react";
import type { ApQuestionType, ApQuestionConfig } from "@/lib/api";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfigEditor, defaultConfigFor, QUESTION_TYPE_META } from "./question-types";

export type QuestionDraft = {
  type: ApQuestionType;
  prompt: string;
  marks: number;
  negativeMarks: number;
  isRequired: boolean;
  config: ApQuestionConfig;
};

export function QuestionEditorDialog({
  open, onOpenChange, initial, onSubmit, busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<QuestionDraft> | null;
  onSubmit: (draft: QuestionDraft) => void | Promise<void>;
  busy?: boolean;
}) {
  // Initialized once per mount. The parent only renders this dialog while open
  // (`{state && <QuestionEditorDialog .../>}`), so every open is a fresh mount.
  const [draft, setDraft] = useState<QuestionDraft>(() => ({
    type: initial?.type ?? "mcq_single",
    prompt: initial?.prompt ?? "",
    marks: initial?.marks ?? 1,
    negativeMarks: initial?.negativeMarks ?? 0,
    isRequired: initial?.isRequired ?? true,
    config: initial?.config ?? defaultConfigFor(initial?.type ?? "mcq_single"),
  }));

  const changeType = (type: ApQuestionType) =>
    setDraft((d) => ({ ...d, type, config: defaultConfigFor(type) }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial?.prompt ? "Edit question" : "Add question"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Question type</Label>
            <Select value={draft.type} onValueChange={(v) => v && changeType(v as ApQuestionType)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUESTION_TYPE_META.map((t) => (
                  <SelectItem key={t.type} value={t.type}>{t.label} · {t.group}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Question prompt</Label>
            <Textarea value={draft.prompt} rows={2} onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))} placeholder="Ask the question…" />
          </div>

          <ConfigEditor type={draft.type} config={draft.config} onChange={(config) => setDraft((d) => ({ ...d, config }))} />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Marks</Label>
              <Input type="number" min={0} step="0.5" value={draft.marks} onChange={(e) => setDraft((d) => ({ ...d, marks: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1">
              <Label>Negative marks (wrong answer)</Label>
              <Input type="number" min={0} step="0.5" value={draft.negativeMarks} onChange={(e) => setDraft((d) => ({ ...d, negativeMarks: Number(e.target.value) }))} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={draft.isRequired} onCheckedChange={(c) => setDraft((d) => ({ ...d, isRequired: !!c }))} />
            Required question
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => onSubmit(draft)} disabled={busy || !draft.prompt.trim()}>Save question</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

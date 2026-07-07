"use client";

import { useState } from "react";
import Link from "next/link";
import { useApQuestionBank, useBankCreate, useBankUpdate, useBankArchive } from "@/lib/queries";
import type { ApQuestionBankItem, ApQuestionConfig, ApQuestionType } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ConfigEditor, defaultConfigFor, QUESTION_TYPE_META } from "@/components/assessment-platform/question-types";
import { ArrowLeft, Plus, Pencil, Archive, FileQuestion } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";

const typeLabel = (t: string) => QUESTION_TYPE_META.find((m) => m.type === t)?.label ?? t;

export default function QuestionBankPage() {
  const [search, setSearch] = useState("");
  const { data: items = [], isLoading } = useApQuestionBank({ search: search || undefined });
  const create = useBankCreate();
  const update = useBankUpdate();
  const archive = useBankArchive();
  const [editing, setEditing] = useState<ApQuestionBankItem | "new" | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ApQuestionBankItem | null>(null);

  return (
    <div className="space-y-5">
      <Link href="/dashboard/assessment-platform" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Assessment Platform
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Question Bank</h1>
          <p className="text-sm text-muted-foreground">Reusable questions you can drop into any assessment.</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus className="size-4" /> New question</Button>
      </div>

      <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />

      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? (
        <EmptyState
          icon={FileQuestion}
          title={search ? "No matching questions" : "No questions in the bank yet"}
          description={search ? "Try a different search term." : "Create reusable questions you can drop into any assessment."}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{it.prompt}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{typeLabel(it.type)}</Badge>
                    <Badge variant="secondary">{it.defaultMarks} marks</Badge>
                    {it.skill && <Badge variant="secondary">{it.skill}</Badge>}
                    {it.difficulty && <Badge variant="secondary">{it.difficulty}</Badge>}
                    {(it.tags ?? []).map((t) => <Badge key={t} variant="outline">{t}</Badge>)}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" onClick={() => setEditing(it)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setArchiveTarget(it)}><Archive className="size-4" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <BankEditor
          item={editing === "new" ? null : editing}
          busy={create.isPending || update.isPending}
          onClose={() => setEditing(null)}
          onSubmit={async (payload) => {
            if (editing === "new") await create.mutateAsync(payload);
            else await update.mutateAsync({ id: editing.id, payload });
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="Archive question?"
        description="This will remove the question from the active question bank."
        confirmLabel="Archive"
        destructive
        loading={archive.isPending}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        onConfirm={() => {
          if (!archiveTarget) return;
          archive.mutate(archiveTarget.id, { onSettled: () => setArchiveTarget(null) });
        }}
      />
    </div>
  );
}

function BankEditor({
  item, onClose, onSubmit, busy,
}: {
  item: ApQuestionBankItem | null;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  busy?: boolean;
}) {
  const [type, setType] = useState<ApQuestionType>(item?.type ?? "mcq_single");
  const [prompt, setPrompt] = useState(item?.prompt ?? "");
  const [defaultMarks, setDefaultMarks] = useState(item?.defaultMarks ?? 1);
  const [tags, setTags] = useState((item?.tags ?? []).join(", "));
  const [skill, setSkill] = useState(item?.skill ?? "");
  const [difficulty, setDifficulty] = useState(item?.difficulty ?? "");
  const [config, setConfig] = useState<ApQuestionConfig>(item?.config ?? defaultConfigFor(item?.type ?? "mcq_single"));

  const changeType = (next: ApQuestionType) => { setType(next); setConfig(defaultConfigFor(next)); };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{item ? "Edit question" : "New question"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => v && changeType(v as ApQuestionType)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {QUESTION_TYPE_META.map((t) => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1"><Label>Prompt</Label>
            <Textarea value={prompt} rows={2} onChange={(e) => setPrompt(e.target.value)} /></div>
          <ConfigEditor type={type} config={config} onChange={setConfig} />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1"><Label>Default marks</Label>
              <Input type="number" min={0} step="0.5" value={defaultMarks} onChange={(e) => setDefaultMarks(Number(e.target.value))} /></div>
            <div className="space-y-1"><Label>Skill</Label>
              <Input value={skill} onChange={(e) => setSkill(e.target.value)} /></div>
            <div className="space-y-1"><Label>Difficulty</Label>
              <Input value={difficulty} onChange={(e) => setDifficulty(e.target.value)} placeholder="easy / medium / hard" /></div>
          </div>
          <div className="space-y-1"><Label>Tags (comma-separated)</Label>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy || !prompt.trim()}
            onClick={() => onSubmit({
              type, prompt: prompt.trim(), config, defaultMarks,
              tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
              skill: skill || null, difficulty: difficulty || null,
            })}
          >Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

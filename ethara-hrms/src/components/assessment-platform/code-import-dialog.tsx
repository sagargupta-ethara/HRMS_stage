"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useImportApAssessment } from "@/lib/queries";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Code2 } from "lucide-react";

export const EXAMPLE_SPEC = `{
  "title": "Backend Developer Test",
  "instructions": "Answer all questions. Good luck!",
  "timeLimitMinutes": 45,
  "passPercentage": 50,
  "negativeMarking": true,
  "negativeFactor": 0.25,
  "shuffleOptions": true,
  "showResultsToCandidate": true,
  "sections": [
    {
      "title": "Aptitude",
      "questions": [
        { "type": "mcq_single", "prompt": "2 + 2 = ?", "marks": 2, "options": ["3", "4", "5"], "answer": "4" },
        { "type": "mcq_multi", "prompt": "Select the primes", "marks": 3, "options": ["2", "3", "4", "9"], "answers": ["2", "3"], "partialMarking": true },
        { "type": "true_false", "prompt": "HTTP is stateless", "answer": true }
      ]
    },
    {
      "title": "Skills",
      "questions": [
        { "type": "short_answer", "prompt": "Capital of France", "accept": ["Paris"], "match": "exact" },
        { "type": "long_answer", "prompt": "Explain REST vs GraphQL", "marks": 5, "rubric": "Clarity, examples, trade-offs" },
        { "type": "url_submission", "prompt": "Link to your GitHub" },
        { "type": "file_upload", "prompt": "Upload your resume (PDF)", "maxSizeMb": 5 },
        { "type": "rating", "prompt": "How hard was this test?", "scaleMin": 1, "scaleMax": 5 }
      ]
    }
  ]
}`;

export function CodeImportDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (id: string) => void }) {
  const [text, setText] = useState("");
  const importSpec = useImportApAssessment();

  const submit = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      toast.error(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    try {
      const created = await importSpec.mutateAsync(parsed);
      onOpenChange(false);
      setText("");
      onCreated(created.id);
    } catch {
      /* hook toast already shows the validation error */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Code2 className="size-5" /> Create from code</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Paste a JSON definition and the whole assessment is built for you — sections, questions, options and
          answer keys. Options are plain text and the correct answer is given by its text (or 0-based index);
          ids are generated automatically. Creates a draft you can then publish.
        </p>

        <details className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium">Field reference (click to expand)</summary>
          <div className="mt-2 space-y-2 text-muted-foreground">
            <p><b className="text-foreground">Top level:</b> <code>title</code> (required), <code>instructions</code>, <code>timeLimitMinutes</code>, <code>passPercentage</code>, <code>attemptsAllowed</code>, <code>negativeMarking</code> + <code>negativeFactor</code>, <code>shuffleOptions</code>, <code>randomizeSections</code>, <code>randomizeQuestions</code>, <code>showResultsToCandidate</code>, <code>sections</code> (required).</p>
            <p><b className="text-foreground">Section:</b> <code>title</code> (required), <code>instructions</code>, <code>cutoffMark</code>, <code>pickCount</code> (random N), <code>lockAfterLeave</code>, <code>questions</code> (required).</p>
            <p><b className="text-foreground">Every question:</b> <code>type</code> + <code>prompt</code> (required), <code>marks</code> (default 1; 0 for survey types), <code>required</code> (default true), <code>negativeMarks</code>.</p>
            <ul className="ml-4 list-disc space-y-1">
              <li><b className="text-foreground">mcq_single</b> — <code>options:[...]</code>, <code>answer</code> (correct option text or 0-based index)</li>
              <li><b className="text-foreground">mcq_multi</b> — <code>options:[...]</code>, <code>answers:[...]</code>, <code>partialMarking</code></li>
              <li><b className="text-foreground">true_false</b> — <code>answer: true | false</code></li>
              <li><b className="text-foreground">short_answer</b> — <code>accept:[...]</code> + <code>match: &quot;exact&quot; | &quot;fuzzy&quot; (a.k.a. &quot;contains&quot;) | &quot;manual&quot;</code>. Omit <code>accept</code> ⇒ manual grading.</li>
              <li><b className="text-foreground">long_answer</b> — <code>rubric</code> (always graded manually)</li>
              <li><b className="text-foreground">file_upload</b> — <code>maxSizeMb</code>, <code>allowedTypes:[mime]</code> (manual)</li>
              <li><b className="text-foreground">url_submission</b> — no extra fields (manual)</li>
              <li><b className="text-foreground">rating</b> — <code>scaleMin</code>, <code>scaleMax</code></li>
              <li><b className="text-foreground">form_dropdown</b> — <code>options:[...]</code>; <b className="text-foreground">form_text / form_date / consent</b> — no extra fields</li>
            </ul>
            <p>Auto-scored: mcq_single, mcq_multi, true_false, and short_answer <i>with</i> <code>accept</code>. Everything else is graded by an evaluator in the Grading queue.</p>
          </div>
        </details>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={16}
          placeholder="Paste your assessment JSON here…"
          className="w-full rounded-lg border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button variant="outline" type="button" onClick={() => setText(EXAMPLE_SPEC)}>Insert example</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importSpec.isPending}>Cancel</Button>
            <Button onClick={submit} disabled={importSpec.isPending || !text.trim()}>
              {importSpec.isPending ? "Building…" : "Build assessment"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ApResultsUploadResult } from "@/lib/api";
import { useUploadResults } from "@/lib/queries";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2 } from "lucide-react";

export function ResultsUploadDialog({
  assessmentId, open, onOpenChange,
}: { assessmentId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const upload = useUploadResults(assessmentId);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ApResultsUploadResult | null>(null);

  const submit = async () => {
    if (!file) { toast.error("Choose a CSV file"); return; }
    try {
      setResult(await upload.mutateAsync(file));
    } catch {
      /* hook toast shows the error */
    }
  };
  const reset = () => { setFile(null); setResult(null); };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Upload results (CSV)</DialogTitle></DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="size-5" /> Imported</div>
            <ul className="space-y-1 text-muted-foreground">
              <li>Final scores set: <b className="text-foreground">{result.updated}</b></li>
              <li>Already finalized, skipped: <b className="text-foreground">{result.skippedFinalized}</b></li>
              <li>Email not found: <b className="text-foreground">{result.notFound}</b></li>
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Upload another</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              CSV with columns <code className="rounded bg-muted px-1">email</code>,{" "}
              <code className="rounded bg-muted px-1">score</code> (final marks out of the test total), and optionally{" "}
              <code className="rounded bg-muted px-1">verdict</code> (Pass/Fail) and{" "}
              <code className="rounded bg-muted px-1">feedback</code>. Matched by email; anyone already finalized is
              skipped (safe to re-upload). Results stay hidden from candidates until you <b>Release</b> them.
            </p>
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input py-8 text-sm text-muted-foreground hover:bg-muted/40">
              <Upload className="size-6" />
              {file ? <span className="text-foreground">{file.name}</span> : "Click to choose a CSV"}
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={upload.isPending}>Cancel</Button>
              <Button onClick={submit} disabled={upload.isPending || !file}>{upload.isPending ? "Importing…" : "Import results"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

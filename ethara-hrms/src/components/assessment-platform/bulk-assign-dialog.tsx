"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { ApBulkAssignResult } from "@/lib/api";
import { useAssignEmails, useAssignCsv } from "@/lib/queries";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";

export function BulkAssignDialog({
  assessmentId, open, onOpenChange,
}: { assessmentId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const assignEmails = useAssignEmails(assessmentId);
  const assignCsv = useAssignCsv(assessmentId);
  const [tab, setTab] = useState("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ApBulkAssignResult | null>(null);

  const busy = assignEmails.isPending || assignCsv.isPending;

  const submit = async () => {
    try {
      if (tab === "paste") {
        const emails = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
        if (emails.length === 0) { toast.error("Enter at least one email"); return; }
        setResult(await assignEmails.mutateAsync({ emails }));
      } else {
        if (!file) { toast.error("Choose a CSV file"); return; }
        setResult(await assignCsv.mutateAsync(file));
      }
    } catch {
      /* handled by hook toast */
    }
  };

  const reset = () => { setText(""); setFile(null); setResult(null); };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Assign by email</DialogTitle></DialogHeader>

        {result ? (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-green-600"><CheckCircle2 className="size-5" /> {result.invited} invitation(s) sent</div>
            <ul className="space-y-1 text-muted-foreground">
              <li>New accounts created: <b className="text-foreground">{result.created}</b></li>
              <li>Linked to existing accounts: <b className="text-foreground">{result.linked}</b></li>
              <li>Re-invited: <b className="text-foreground">{result.reinvited}</b></li>
            </ul>
            {result.skipped.length > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                <p className="flex items-center gap-1 font-medium text-amber-700"><AlertTriangle className="size-4" /> Skipped {result.skipped.length}</p>
                <ul className="mt-1 text-xs text-amber-700">
                  {result.skipped.slice(0, 8).map((s, i) => <li key={i}>{s.email} — {s.reason}</li>)}
                </ul>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Assign more</Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <Tabs value={tab} onValueChange={(v) => setTab(v ?? "paste")}>
              <TabsList>
                <TabsTrigger value="paste">Paste emails</TabsTrigger>
                <TabsTrigger value="csv">Upload CSV</TabsTrigger>
              </TabsList>
              <TabsContent value="paste">
                <div className="space-y-1">
                  <Label>One email per line (or comma-separated)</Label>
                  <Textarea value={text} rows={6} onChange={(e) => setText(e.target.value)} placeholder={"alice@example.com\nbob@example.com"} />
                </div>
              </TabsContent>
              <TabsContent value="csv">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-input py-8 text-sm text-muted-foreground hover:bg-muted/40">
                  <Upload className="size-6" />
                  {file ? <span className="text-foreground">{file.name}</span> : "Click to choose a CSV (any column with emails works)"}
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>
              </TabsContent>
            </Tabs>
            <p className="text-xs text-muted-foreground">
              Invitees without an account get one created automatically and receive a login link by email. The assessment stays private — only assigned people can see it.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>{busy ? "Sending…" : "Send invitations"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

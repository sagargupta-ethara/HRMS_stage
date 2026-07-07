"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2, Plus, Send, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { projectsApi, type ProjectBudgetRecord } from "@/lib/api";
import { BudgetStatusBadge, Panel, fmtMoney } from "../shared";

export default function BudgetsPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#F8FAFC" }}>Budgets & Approvals</h1>
        <p className="text-sm text-muted-foreground">Propose project budgets and act on the two-stage approval queue (CTO/COO <ArrowRight className="inline-block size-3.5 align-middle" /> Leadership).</p>
      </div>
      <Tabs defaultValue="propose">
        <TabsList>
          <TabsTrigger value="propose">Propose</TabsTrigger>
          <TabsTrigger value="approvals">Approval Queue</TabsTrigger>
        </TabsList>
        <TabsContent value="propose" className="mt-4"><ProposeTab /></TabsContent>
        <TabsContent value="approvals" className="mt-4"><ApprovalsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ProposeTab() {
  const qc = useQueryClient();
  const [projectId, setProjectId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("overall");
  const [justification, setJustification] = useState("");

  const { data: projects = [] } = useQuery({ queryKey: ["projects", false], queryFn: () => projectsApi.list() });
  const { data: budgets = [], refetch } = useQuery({
    queryKey: ["project-budgets", projectId],
    queryFn: () => projectsApi.budgets(projectId),
    enabled: !!projectId,
  });

  const invalidate = () => { void refetch(); void qc.invalidateQueries({ queryKey: ["project-approval-queue"] }); };

  const createMut = useMutation({
    mutationFn: () => projectsApi.createBudget(projectId, { amount: Number(amount), period, justification }),
    onSuccess: () => { toast.success("Budget draft created."); setAmount(""); setJustification(""); invalidate(); },
    onError: () => toast.error("Could not create budget."),
  });
  const submitMut = useMutation({
    mutationFn: (id: string) => projectsApi.submitBudget(id),
    onSuccess: () => { toast.success("Submitted for CTO/COO approval."); invalidate(); },
    onError: () => toast.error("Submit failed."),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="New Budget Proposal">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Project</Label>
            <Select value={projectId} onValueChange={(v) => setProjectId(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select a project…">
                  {(value) => projects.find((p) => p.id === value)?.internalName ?? "Select a project…"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.internalName}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Amount (₹)</Label>
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Period</Label>
              <Input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="overall / 2026-Q3" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Justification</Label>
            <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} />
          </div>
          <Button disabled={!projectId || !amount || createMut.isPending} onClick={() => createMut.mutate()}>
            {createMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />} Create draft
          </Button>
        </div>
      </Panel>

      <Panel title="Revision History" subtitle={projectId ? undefined : "Select a project to view its budgets"}>
        <div className="space-y-2">
          {budgets.map((b) => (
            <div key={b.id} className="flex items-center justify-between rounded-lg border p-3" style={{ borderColor: "rgba(144,141,206,0.15)" }}>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: "#E5E7EB" }}>v{b.version} · {fmtMoney(b.amount, b.currency)}</span>
                  <BudgetStatusBadge status={b.status} />
                </div>
                <p className="text-xs text-muted-foreground">{b.period ?? "overall"}{b.justification ? ` · ${b.justification}` : ""}</p>
              </div>
              {(b.status === "draft" || b.status === "rejected") && (
                <Button size="sm" variant="outline" disabled={submitMut.isPending} onClick={() => submitMut.mutate(b.id)}>
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Submit
                </Button>
              )}
            </div>
          ))}
          {projectId && budgets.length === 0 && <p className="text-sm text-muted-foreground">No budgets yet.</p>}
        </div>
      </Panel>
    </div>
  );
}

function ApprovalsTab() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["project-approval-queue"], queryFn: projectsApi.leadership });
  const queue = data?.approvalQueue ?? [];

  const decide = useMutation({
    mutationFn: ({ b, action }: { b: ProjectBudgetRecord; action: "approve" | "reject" }) => {
      const comment = action === "reject" ? window.prompt("Reason for rejection?") || undefined : undefined;
      const fn = b.status === "pending_functional_approval" ? projectsApi.functionalDecision : projectsApi.leadershipDecision;
      return fn(b.id, action, comment);
    },
    onSuccess: () => { toast.success("Decision recorded."); void qc.invalidateQueries({ queryKey: ["project-approval-queue"] }); },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "You are not authorized to decide this budget.");
    },
  });

  if (isLoading) return <div className="flex items-center justify-center py-12 text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>;

  return (
    <Panel title="Pending Approvals" subtitle="Stage-1 goes to the CTO/COO; stage-2 to Leadership">
      <div className="space-y-2">
        {queue.map((b) => (
          <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3" style={{ borderColor: "rgba(144,141,206,0.15)" }}>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: "#E5E7EB" }}>{fmtMoney(b.amount, b.currency)}</span>
                <BudgetStatusBadge status={b.status} />
              </div>
              <p className="text-xs text-muted-foreground">
                Proposed by {b.proposedBy ?? "—"}{b.functionalApprover ? ` · approver: ${b.functionalApprover}` : ""}{b.justification ? ` · ${b.justification}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ b, action: "approve" })}>
                <CheckCircle2 className="mr-1.5 h-4 w-4 text-emerald-400" /> Approve
              </Button>
              <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ b, action: "reject" })}>
                <XCircle className="mr-1.5 h-4 w-4 text-red-400" /> Reject
              </Button>
            </div>
          </div>
        ))}
        {queue.length === 0 && <p className="text-sm text-muted-foreground">Nothing pending. 🎉</p>}
      </div>
    </Panel>
  );
}

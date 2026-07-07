"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, ArrowRight, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { projectsApi, usersApi } from "@/lib/api";
import { Panel } from "../shared";

type UserLite = { id: string; name: string };
const EMPTY = "__none__";
const DATA_TYPES: [string, string][] = [["text", "Text"], ["number", "Number"], ["currency", "Currency"], ["date", "Date"], ["boolean", "Yes/No"], ["select", "Select"]];

export default function ProjectSettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["project-settings"], queryFn: projectsApi.settings });
  const { data: fieldDefs = [] } = useQuery({ queryKey: ["project-field-defs-all"], queryFn: () => projectsApi.fieldDefs(true) });
  const { data: users = [] } = useQuery<UserLite[]>({ queryKey: ["users-lite"], queryFn: () => usersApi.list() as Promise<UserLite[]> });

  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState("text");
  const [technical, setTechnical] = useState(EMPTY);
  const [generalist, setGeneralist] = useState(EMPTY);
  const [budgetSla, setBudgetSla] = useState("48");
  const [expenseSla, setExpenseSla] = useState("48");

  useEffect(() => {
    if (!settings) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setTechnical(settings.approvers.technicalUserId ?? EMPTY);
    setGeneralist(settings.approvers.generalistUserId ?? EMPTY);
    setBudgetSla(String(settings.sla.budgetApprovalSlaHours));
    setExpenseSla(String(settings.sla.expenseApprovalSlaHours));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [settings]);

  const addCol = useMutation({
    mutationFn: () => projectsApi.createFieldDef({ label: newLabel.trim(), dataType: newType }),
    onSuccess: () => { toast.success("Column added."); setNewLabel(""); void qc.invalidateQueries({ queryKey: ["project-field-defs-all"] }); void qc.invalidateQueries({ queryKey: ["project-field-defs"] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Could not add column."),
  });
  const delCol = useMutation({
    mutationFn: (id: string) => projectsApi.deleteFieldDef(id),
    onSuccess: () => { toast.success("Column removed."); void qc.invalidateQueries({ queryKey: ["project-field-defs-all"] }); void qc.invalidateQueries({ queryKey: ["project-field-defs"] }); },
  });
  const saveApprovers = useMutation({
    mutationFn: () => projectsApi.setApprovers({ technicalUserId: technical === EMPTY ? null : technical, generalistUserId: generalist === EMPTY ? null : generalist }),
    onSuccess: () => { toast.success("Approvers saved."); void qc.invalidateQueries({ queryKey: ["project-settings"] }); },
    onError: () => toast.error("Could not save approvers."),
  });
  const saveSla = useMutation({
    mutationFn: () => projectsApi.setSla({ budgetApprovalSlaHours: Number(budgetSla), expenseApprovalSlaHours: Number(expenseSla) }),
    onSuccess: () => { toast.success("SLA saved."); void qc.invalidateQueries({ queryKey: ["project-settings"] }); },
    onError: () => toast.error("Could not save SLA."),
  });
  const runEsc = useMutation({
    mutationFn: projectsApi.runEscalations,
    onSuccess: (r) => toast.success(`Escalation sweep: ${r.escalated} of ${r.pending} pending notified.`),
    onError: () => toast.error("Only admins can run escalations."),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "#F8FAFC" }}>Project Settings</h1>
        <p className="text-sm text-muted-foreground">Custom columns, budget approvers and SLA thresholds.</p>
      </div>

      <Panel title="Custom Columns" subtitle="Add or remove restructurable columns shown on the Project Master">
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px] space-y-1.5">
            <Label className="text-xs text-muted-foreground">Column label</Label>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. GPU Hours" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={newType} onValueChange={(v) => setNewType(v ?? "")}>
              <SelectTrigger className="w-36">
                <SelectValue>{(v) => DATA_TYPES.find(([val]) => val === v)?.[1] ?? "Text"}</SelectValue>
              </SelectTrigger>
              <SelectContent>{DATA_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button disabled={!newLabel.trim() || addCol.isPending} onClick={() => addCol.mutate()}>
            {addCol.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />} Add
          </Button>
        </div>
        <div className="space-y-2">
          {fieldDefs.map((fd) => (
            <div key={fd.id} className="flex items-center justify-between rounded-lg border p-2.5 text-sm" style={{ borderColor: "rgba(144,141,206,0.15)", opacity: fd.isActive ? 1 : 0.5 }}>
              <span style={{ color: "#E5E7EB" }}>{fd.label} <span className="text-xs text-muted-foreground">· {fd.dataType}{fd.isActive ? "" : " · inactive"}</span></span>
              {fd.isActive && (
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => delCol.mutate(fd.id)}><Trash2 className="h-4 w-4 text-red-400" /></Button>
              )}
            </div>
          ))}
          {fieldDefs.length === 0 && <p className="text-sm text-muted-foreground">No custom columns yet.</p>}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Budget Approvers" subtitle="Stage-1 functional approver by project type">
          <div className="space-y-3">
            <ApproverSelect label={<>Technical <ArrowRight className="inline-block size-3.5 align-middle" /> CTO</>} value={technical} onChange={setTechnical} users={users} />
            <ApproverSelect label={<>Generalist <ArrowRight className="inline-block size-3.5 align-middle" /> COO</>} value={generalist} onChange={setGeneralist} users={users} />
            <Button disabled={saveApprovers.isPending} onClick={() => saveApprovers.mutate()}>
              {saveApprovers.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save approvers
            </Button>
          </div>
        </Panel>

        <Panel title="SLA & Escalations" subtitle="Hours before a pending approval escalates">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Budget SLA (hrs)</Label>
                <Input value={budgetSla} onChange={(e) => setBudgetSla(e.target.value)} inputMode="numeric" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Expense SLA (hrs)</Label>
                <Input value={expenseSla} onChange={(e) => setExpenseSla(e.target.value)} inputMode="numeric" />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={saveSla.isPending} onClick={() => saveSla.mutate()}>
                {saveSla.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Save SLA
              </Button>
              <Button variant="outline" disabled={runEsc.isPending} onClick={() => runEsc.mutate()}>
                {runEsc.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <AlarmClock className="mr-1.5 h-4 w-4" />} Run escalation sweep
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Email notifications are {settings?.emailEnabled ? "ON" : "OFF (in-app notifications only)"}.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ApproverSelect({ label, value, onChange, users }: { label: ReactNode; value: string; onChange: (v: string) => void; users: UserLite[] }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger>
          <SelectValue placeholder="Select approver…">
            {(v) => (!v || v === EMPTY ? "— Leadership fallback —" : users.find((u) => u.id === v)?.name ?? "Select approver…")}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={EMPTY}>— Leadership fallback —</SelectItem>
          {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

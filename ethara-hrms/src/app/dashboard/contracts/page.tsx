"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatLabel, formatDateTime, getInitials, timeAgo } from "@/lib/utils";
import type { CandidateStage } from "@/types";
import {
  Activity, CheckCircle2, Clock, Download, ExternalLink, Eye, FileDown,
  Loader2, RefreshCw, Repeat, Search, Send, Timer, Upload, Users, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  candidatesApi,
  documensoApi,
  type DocumensoTemplate,
  type SentContractDocument,
  type SendContractPayload,
  type SyncJobRun,
} from "@/lib/api";

type CandidateRow = {
  id: string;
  fullName: string;
  personalEmail: string;
  currentStage: CandidateStage;
  createdAt: string;
  position?: { title?: string };
  contract?: {
    id?: string;
    status?: string;
    sentAt?: string;
    signedAt?: string;
    signedUrl?: string;
    pdfUrl?: string;
    ctc?: number;
    joiningDate?: string | null;
    templateId?: number | null;
    templateTitle?: string | null;
    sentDocuments?: SentContractDocument[] | null;
  } | null;
};

const CONTRACT_STAGES: CandidateStage[] = [
  "selection_form_validated",
  "contract_sent",
  "contract_signed",
];

const STATUS_CONFIG: Record<string, {
  label: string;
  variant: "default" | "outline" | "secondary" | "destructive";
  icon: React.ElementType;
}> = {
  signed: { label: "Signed", variant: "default", icon: CheckCircle2 },
  sent: { label: "Contract Sent", variant: "outline", icon: Clock },
  viewed: { label: "Viewed", variant: "outline", icon: Eye },
  draft: { label: "Not Sent", variant: "secondary", icon: Send },
  expired: { label: "Expired", variant: "destructive", icon: Clock },
  cancelled: { label: "Cancelled", variant: "destructive", icon: XCircle },
};

function contractStatus(stage: CandidateStage, status?: string): string {
  if (status && status !== "draft") return status;
  if (stage === "contract_signed") return "signed";
  if (stage === "contract_sent") return "sent";
  return "draft";
}

function canIssueContract(status: string): boolean {
  return status === "draft" || status === "expired" || status === "cancelled";
}

const NONE = "__none__";

const STAGE_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: NONE, label: "All contract stages" },
  { value: "selection_form_validated", label: "Form Validated" },
  { value: "contract_sent", label: "Contract Sent" },
  { value: "contract_signed", label: "Contract Signed" },
];

function formatTemplateTitle(title: string): string {
  return title.includes("_") ? formatLabel(title) : title;
}

function contractDocuments(contract?: CandidateRow["contract"]): SentContractDocument[] {
  if (!contract) return [];
  const documents = contract.sentDocuments?.filter((doc) => doc.templateTitle || doc.templateId) ?? [];
  if (documents.length > 0) return documents;
  if (contract.templateTitle || contract.templateId) {
    return [{
      templateId: contract.templateId ?? null,
      templateTitle: contract.templateTitle ?? null,
      status: contract.status ?? null,
      sentAt: contract.sentAt ?? null,
      primary: true,
    }];
  }
  return [];
}

function sentDocumentTitle(
  document: SentContractDocument,
  nameById?: Map<number, string>,
): string {
  if (document.templateTitle) return formatTemplateTitle(document.templateTitle);
  if (document.templateId != null) {
    // Older / just-sent rows may not have the title stored on the document yet —
    // resolve it from the loaded templates list so we show "Form 11", not "Template 13647".
    const name = nameById?.get(Number(document.templateId));
    if (name) return formatTemplateTitle(name);
    return `Template ${document.templateId}`;
  }
  return "Contract";
}

function sentDocumentStatus(document: SentContractDocument, fallback: string): string {
  return String(document.status || fallback || "sent").replace(/_/g, " ");
}

type CsvMatchRow = { email: string; status: string; candidate: string; reason: string };

function triggerCsvDownload(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsvMatchResults(rows: CsvMatchRow[]): void {
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["email", "status", "candidate", "reason"].join(",");
  const body = rows.map((r) => [r.email, r.status, r.candidate, r.reason].map(esc).join(",")).join("\n");
  triggerCsvDownload("contract-csv-match-results.csv", `${header}\n${body}\n`);
}

function downloadExampleCsv(): void {
  const contents = "email\ncandidate1@example.com\ncandidate2@example.com\n";
  triggerCsvDownload("contract-emails-example.csv", contents);
}

export default function ContractsPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [templates, setTemplates] = useState<DocumensoTemplate[]>([]);
  const [syncState, setSyncState] = useState<{ syncStatus: string; lastSyncedAt?: string | null } | null>(null);

  const [sendTarget, setSendTarget] = useState<CandidateRow | null>(null);
  // Multi-select: every checked template goes out as its own document in one send.
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<Set<string>>(new Set());
  const [ctcValue, setCtcValue] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshingTemplates, setRefreshingTemplates] = useState(false);
  const [jobRuns, setJobRuns] = useState<SyncJobRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<CandidateRow | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateSearch, setTemplateSearch] = useState("");
  const [search, setSearch] = useState("");
  const [sendDifferentId, setSendDifferentId] = useState<string | null>(null);
  const [csvProcessing, setCsvProcessing] = useState(false);
  const [csvDialogOpen, setCsvDialogOpen] = useState(false);
  const [csvSummary, setCsvSummary] = useState<{ matched: number; selected: number; notFound: number; skipped: number } | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  // templateId → display title, used to resolve a sent document's name when the
  // title was not persisted on the document itself.
  const templateNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of templates) map.set(Number(t.templateId), t.title);
    return map;
  }, [templates]);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      c.fullName.toLowerCase().includes(q) ||
      c.personalEmail.toLowerCase().includes(q) ||
      (c.position?.title ?? "").toLowerCase().includes(q),
    );
  }, [candidates, search]);

  const loadJobRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const runs = await documensoApi.getJobRuns({ jobName: "incremental_contract_sync", limit: 50 });
      setJobRuns(runs);
    } catch {
      // non-critical — just show empty
    } finally {
      setLoadingRuns(false);
    }
  }, []);
  const selectedTemplates = templates.filter((template) =>
    selectedTemplateIds.has(String(template.templateId)),
  );
  const selectedTemplateSummary =
    selectedTemplates.length === 0
      ? "No template selected"
      : selectedTemplates.length === 1
        ? formatTemplateTitle(selectedTemplates[0].title)
        : `${selectedTemplates.length} templates selected`;
  const visibleSelectedTemplates = selectedTemplates.slice(0, 3);
  const remainingSelectedTemplates = Math.max(selectedTemplates.length - visibleSelectedTemplates.length, 0);
  const filteredTemplates = templates.filter((template) =>
    formatTemplateTitle(template.title).toLowerCase().includes(templateSearch.trim().toLowerCase()),
  );

  const toggleTemplate = (id: string) => {
    setSelectedTemplateIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [stageFilter, setStageFilter] = useState<string>(NONE);
  const selectedStageFilter = STAGE_FILTER_OPTIONS.find((option) => option.value === stageFilter);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const stagesToFetch = stageFilter !== NONE ? [stageFilter as CandidateStage] : CONTRACT_STAGES;
      const [results, tplList, state] = await Promise.all([
        Promise.all(stagesToFetch.map((stage) => candidatesApi.list({ stage, limit: 100 }))),
        documensoApi.listTemplates().catch(() => [] as DocumensoTemplate[]),
        documensoApi.getSyncState().catch(() => null),
      ]);
      const merged = results.flatMap((r) => (r.data ?? []) as CandidateRow[]);
      const unique = merged.filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
      unique.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setCandidates(unique);
      setTemplates(tplList);
      setSyncState(state);
      setSelectedTemplateIds((current) => {
        const available = new Set(tplList.map((template) => String(template.templateId)));
        return new Set([...current].filter((id) => available.has(id)));
      });
      } catch {
      toast.error("Failed to load contracts data");
    } finally {
      setIsLoading(false);
    }
  }, [stageFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const openSend = (candidate: CandidateRow) => {
    const status = contractStatus(candidate.currentStage, candidate.contract?.status);
    if (!canIssueContract(status)) {
      toast.error("This contract is already active. Use Check Status instead of sending another one.");
      return;
    }
    setSendTarget(candidate);
    setCtcValue(candidate.contract?.ctc ? String(candidate.contract.ctc) : "");
    setJoiningDate(candidate.contract?.joiningDate ? candidate.contract.joiningDate.slice(0, 10) : "");
  };

  const handleSend = async () => {
    if (!sendTarget || selectedTemplateIds.size === 0) return;
    setSending(true);
    try {
      const payload: SendContractPayload = {
        templateIds: [...selectedTemplateIds].map(Number),
        sendImmediately: true,
      };
      if (ctcValue) payload.ctc = Number(ctcValue);
      if (joiningDate) payload.joiningDate = new Date(joiningDate).toISOString();

      await documensoApi.sendContract(sendTarget.id, payload);
      toast.success(
        selectedTemplateIds.size > 1
          ? `${selectedTemplateIds.size} documents sent to ${sendTarget.fullName}`
          : `Contract sent to ${sendTarget.fullName}`,
      );
      setSendTarget(null);
      setCtcValue("");
      setJoiningDate("");
      loadData();
    } catch {
      toast.error("Failed to send contract");
    } finally {
      setSending(false);
    }
  };

  const handleCheckStatus = async (candidate: CandidateRow) => {
    setCheckingId(candidate.id);
    try {
      const updated = await documensoApi.refreshContractStatus(candidate.id);
      toast.success(`Status: ${String(updated.status).replace(/_/g, " ")}`);
      loadData();
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not check status");
    } finally {
      setCheckingId(null);
    }
  };

  const handleCancelContract = async () => {
    if (!cancelTarget) return;
    setCancellingId(cancelTarget.id);
    try {
      await documensoApi.cancelContract(cancelTarget.id, {
        reason: "Cancelled from HRMS contracts page",
      });
      toast.success(`Contract cancelled for ${cancelTarget.fullName}`);
      setCancelTarget(null);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(cancelTarget.id);
        return next;
      });
      loadData();
    } catch (err) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not cancel contract");
    } finally {
      setCancellingId(null);
    }
  };

  // Cancel the active contract then immediately open the send dialog so staff can
  // issue a new / different contract in one action (backend forbids two live ones).
  const handleSendDifferent = async (candidate: CandidateRow) => {
    setSendDifferentId(candidate.id);
    try {
      await documensoApi.cancelContract(candidate.id, {
        reason: "Replaced with a new contract from HRMS contracts page",
      });
      await loadData();
      setSendTarget(candidate);
      setCtcValue(candidate.contract?.ctc ? String(candidate.contract.ctc) : "");
      setJoiningDate(candidate.contract?.joiningDate ? candidate.contract.joiningDate.slice(0, 10) : "");
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Could not start a new contract");
    } finally {
      setSendDifferentId(null);
    }
  };

  // CSV bulk select: read emails from an uploaded CSV, match them against the
  // candidates already in the contract list, auto-select the eligible ones, and
  // download a results file flagging not-found / already-contracted rows.
  const handleCsvUpload = async (file: File) => {
    setCsvProcessing(true);
    try {
      const text = await file.text();
      const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
      const emails = Array.from(new Set((text.match(emailRe) ?? []).map((e) => e.toLowerCase())));
      if (emails.length === 0) {
        toast.error("No email addresses found in the CSV.");
        return;
      }
      const byEmail = new Map(candidates.map((c) => [c.personalEmail.toLowerCase(), c]));
      const rows: CsvMatchRow[] = [];
      const toSelect = new Set<string>();
      for (const email of emails) {
        const c = byEmail.get(email);
        if (!c) {
          rows.push({ email, status: "not_found", candidate: "", reason: "No candidate in the contract list with this email" });
          continue;
        }
        const st = contractStatus(c.currentStage, c.contract?.status);
        if (!canIssueContract(st)) {
          rows.push({ email, status: "skipped", candidate: c.fullName, reason: `Contract already ${STATUS_CONFIG[st]?.label ?? st}` });
          continue;
        }
        toSelect.add(c.id);
        rows.push({ email, status: "selected", candidate: c.fullName, reason: "" });
      }
      setSelectedIds((current) => new Set([...current, ...toSelect]));
      const summary = {
        matched: rows.filter((r) => r.status !== "not_found").length,
        selected: toSelect.size,
        notFound: rows.filter((r) => r.status === "not_found").length,
        skipped: rows.filter((r) => r.status === "skipped").length,
      };
      setCsvSummary(summary);
      downloadCsvMatchResults(rows);
      setCsvDialogOpen(false);
      toast.success(
        `Selected ${summary.selected} · ${summary.notFound} not found · ${summary.skipped} skipped. Results downloaded.`,
      );
    } catch {
      toast.error("Could not process the CSV file.");
    } finally {
      setCsvProcessing(false);
      if (csvInputRef.current) csvInputRef.current.value = "";
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkSend = async () => {
    if (selectedTemplateIds.size === 0 || selectedIds.size === 0) return;
    setBulkSending(true);
    try {
      const res = await documensoApi.bulkSendContracts({
        candidateIds: [...selectedIds],
        templateIds: [...selectedTemplateIds].map(Number),
        sendImmediately: true,
      });
      toast.success(`Sent ${res.sent} contract(s)${res.failed ? `, ${res.failed} failed` : ""}`);
      setSelectedIds(new Set());
      loadData();
    } catch {
      toast.error("Bulk send failed");
    } finally {
      setBulkSending(false);
    }
  };

  const handleRefreshTemplates = async () => {
    setRefreshingTemplates(true);
    try {
      await documensoApi.refreshTemplates();
      const list = await documensoApi.listTemplates();
      setTemplates(list);
      toast.success("Templates refreshed");
    } catch {
      toast.error("Failed to refresh templates");
    } finally {
      setRefreshingTemplates(false);
    }
  };

  const handleTriggerSync = async () => {
    setSyncing(true);
    try {
      await documensoApi.triggerSync();
      // Poll sync state until the backend reports it is done, then reload data.
      let attempts = 0;
      const poll = async () => {
        attempts++;
        const state = await documensoApi.getSyncState().catch(() => null);
        setSyncState(state);
        if (!state || state.syncStatus === "idle" || state.syncStatus === "failed" || attempts >= 30) {
          await Promise.all([loadData(), loadJobRuns()]);
          setSyncing(false);
          toast.success("Sync complete.");
        } else {
          setTimeout(() => { void poll(); }, 2000);
        }
      };
      setTimeout(() => { void poll(); }, 1000);
    } catch {
      setSyncing(false);
      toast.error("Failed to trigger sync");
    }
  };

  return (
    <div className="space-y-4 overflow-x-hidden px-4 py-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Contracts</h1>
          <p className="text-sm text-muted-foreground">
            Send and track Documenso contracts for candidates
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          {syncState && (
            <Badge
              variant={syncState.syncStatus === "running" ? "secondary" : "outline"}
              className="max-w-full gap-1 text-xs"
            >
              <Activity className="h-3 w-3" />
              <span className="min-w-0 truncate">
                Sync: {syncState.syncStatus}
                {syncState.lastSyncedAt && ` · ${timeAgo(syncState.lastSyncedAt)}`}
              </span>
            </Badge>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={handleTriggerSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {syncing ? "Syncing…" : "Sync Now"}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="contracts" onValueChange={(v) => { if (v === "cron") void loadJobRuns(); }}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:inline-grid sm:w-auto">
          <TabsTrigger value="contracts" className="gap-1.5 text-sm">
            <Users className="h-3.5 w-3.5" />
            Contracts
          </TabsTrigger>
          <TabsTrigger value="cron" className="gap-1.5 text-sm">
            <Timer className="h-3.5 w-3.5" />
            Cron History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contracts" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <Select value={stageFilter} onValueChange={(v) => setStageFilter(v ?? NONE)}>
              <SelectTrigger className="h-10 w-full text-sm sm:h-8 sm:w-60">
                <SelectValue className="min-w-0 truncate" placeholder="Filter by stage">
                  {(value) => {
                    if (!value) return "Filter by stage";
                    return selectedStageFilter?.label ?? formatLabel(String(value));
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {STAGE_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} label={option.label}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name or email…"
                className="h-10 pl-8 text-sm sm:h-8"
              />
            </div>
            <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:flex-1">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRefreshTemplates}
                  disabled={refreshingTemplates}
                  className="gap-2 px-0 text-xs sm:px-3"
                >
                  <RefreshCw className={cn("h-3 w-3", refreshingTemplates && "animate-spin")} />
                  Refresh Templates
                </Button>
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCsvUpload(f); }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCsvDialogOpen(true)}
                  disabled={csvProcessing || candidates.length === 0}
                  className="gap-2 px-0 text-xs sm:px-3"
                  title="Upload a CSV of emails to auto-select matching candidates"
                >
                  {csvProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  Select via CSV
                </Button>
              </div>
              <span className="shrink-0 text-sm text-muted-foreground sm:ml-auto">
                {search ? `${filteredCandidates.length} / ${candidates.length}` : candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {csvSummary && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
              <FileDown className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-medium">CSV matched:</span>
              <Badge variant="secondary" className="text-[11px]">{csvSummary.selected} selected</Badge>
              {csvSummary.skipped > 0 && <Badge variant="outline" className="text-[11px]">{csvSummary.skipped} already contracted</Badge>}
              {csvSummary.notFound > 0 && <Badge variant="outline" className="text-[11px]">{csvSummary.notFound} not in list</Badge>}
              <span className="text-muted-foreground">— results downloaded as CSV.</span>
              <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5 text-[11px]" onClick={() => setCsvSummary(null)}>Dismiss</Button>
            </div>
          )}

          <div className="rounded-md border border-border bg-background px-4 py-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">Templates</span>
                  <Badge variant={selectedTemplates.length > 0 ? "secondary" : "outline"} className="text-xs">
                    {selectedTemplateSummary}
                  </Badge>
                </div>
                <div className="mt-2 flex min-h-7 min-w-0 flex-wrap items-center gap-1.5">
                  {visibleSelectedTemplates.length === 0 ? (
                    <span className="text-xs text-muted-foreground">None selected</span>
                  ) : (
                    visibleSelectedTemplates.map((template) => (
                      <Badge
                        key={template.templateId}
                        variant="outline"
                        className="max-w-[240px] px-2 py-1 text-xs font-normal"
                      >
                        <span className="truncate">{formatTemplateTitle(template.title)}</span>
                      </Badge>
                    ))
                  )}
                  {remainingSelectedTemplates > 0 && (
                    <Badge variant="outline" className="px-2 py-1 text-xs font-normal">
                      +{remainingSelectedTemplates}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTemplatePickerOpen(true)}
                  disabled={templates.length === 0}
                  className="h-8 w-full text-xs sm:w-auto"
                >
                  Choose Templates
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedTemplateIds(new Set())}
                  disabled={selectedTemplateIds.size === 0}
                  className="h-8 w-full text-xs sm:w-auto"
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {selectedIds.size > 0 && (
            <div className="flex flex-col gap-2 border-b border-border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm font-medium">
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  {selectedTemplateSummary}
                </span>
                <Button
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => void handleBulkSend()}
                  disabled={bulkSending || selectedTemplateIds.size === 0}
                >
                  {bulkSending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  Send to {selectedIds.size} selected
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredCandidates.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3">
              <Users className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {search ? `No candidates match “${search}”` : "No candidates in contract stages"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredCandidates.map((c) => {
                const status = contractStatus(c.currentStage, c.contract?.status);
                const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
                const Icon = cfg.icon;
                const canIssue = canIssueContract(status);
                const sentDocuments = contractDocuments(c.contract);

                return (
                  <div
                    key={c.id}
                    className="flex flex-col gap-3 px-4 py-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-4 sm:py-3"
                  >
                    <div className="flex min-w-0 items-start gap-3 sm:flex-1">
                      <input
                        type="checkbox"
                        checked={canIssue && selectedIds.has(c.id)}
                        onChange={() => { if (canIssue) toggleSelect(c.id); }}
                        disabled={!canIssue}
                        className="mt-3 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary disabled:cursor-not-allowed disabled:opacity-40 sm:mt-2"
                        aria-label={`Select ${c.fullName}`}
                      />
                      <Avatar className="h-11 w-11 shrink-0 sm:h-9 sm:w-9">
                        <AvatarFallback className="text-xs">{getInitials(c.fullName)}</AvatarFallback>
                      </Avatar>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
                          <Link
                            href={`/dashboard/candidates/${c.id}`}
                            className="break-words text-sm font-medium leading-5 hover:underline sm:truncate"
                          >
                            {c.fullName}
                          </Link>
                          <Badge variant={cfg.variant} className="w-fit shrink-0 gap-1 text-xs">
                            <Icon className="h-3 w-3" />
                            {cfg.label}
                          </Badge>
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground sm:hidden">
                          <p className="break-all">{c.personalEmail}</p>
                          {c.position?.title && <p className="break-words">{c.position.title}</p>}
                          {(c.contract?.sentAt || c.contract?.signedAt) && (
                            <p>
                              {c.contract?.sentAt && `Sent ${timeAgo(c.contract.sentAt)}`}
                              {c.contract?.sentAt && c.contract?.signedAt && " · "}
                              {c.contract?.signedAt && `Signed ${timeAgo(c.contract.signedAt)}`}
                            </p>
                          )}
                          {sentDocuments.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {sentDocuments.map((document, index) => (
                                <Badge
                                  key={`${document.documensoId ?? document.templateId ?? index}-mobile`}
                                  variant="outline"
                                  className="max-w-full gap-1 text-[11px] font-normal"
                                >
                                  <span className="truncate">{sentDocumentTitle(document, templateNameById)}</span>
                                  <span className="capitalize text-muted-foreground">
                                    {sentDocumentStatus(document, status)}
                                  </span>
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                        <p className="hidden text-xs text-muted-foreground truncate sm:block">
                          {c.personalEmail}
                          {c.position?.title && ` · ${c.position.title}`}
                          {c.contract?.sentAt && ` · Sent ${timeAgo(c.contract.sentAt)}`}
                          {c.contract?.signedAt && ` · Signed ${timeAgo(c.contract.signedAt)}`}
                        </p>
                        {sentDocuments.length > 0 && (
                          <div className="hidden flex-wrap gap-1 sm:flex">
                            {sentDocuments.map((document, index) => (
                              <Badge
                                key={`${document.documensoId ?? document.templateId ?? index}-desktop`}
                                variant="outline"
                                className="max-w-[220px] gap-1 text-[11px] font-normal"
                              >
                                <span className="truncate">{sentDocumentTitle(document, templateNameById)}</span>
                                <span className="capitalize text-muted-foreground">
                                  {sentDocumentStatus(document, status)}
                                </span>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
                      {c.contract?.signedUrl && status !== "signed" && (
                        <a
                          href={c.contract.signedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted sm:h-auto sm:justify-start"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Sign Link
                        </a>
                      )}
                      {c.contract?.pdfUrl && (
                        <a
                          href={c.contract.pdfUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted sm:h-auto sm:justify-start"
                        >
                          <Download className="h-3 w-3" />
                          PDF
                        </a>
                      )}
                      {(status === "sent" || status === "viewed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 w-full gap-1.5 text-xs sm:h-7 sm:w-auto"
                          onClick={() => void handleCheckStatus(c)}
                          disabled={checkingId === c.id}
                        >
                          <RefreshCw className={cn("h-3 w-3", checkingId === c.id && "animate-spin")} />
                          Check Status
                        </Button>
                      )}
                      {(status === "sent" || status === "viewed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 w-full gap-1.5 border-destructive/40 text-xs text-destructive hover:bg-destructive/10 sm:h-7 sm:w-auto"
                          onClick={() => setCancelTarget(c)}
                          disabled={cancellingId === c.id}
                        >
                          {cancellingId === c.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          Cancel
                        </Button>
                      )}
                      {(status === "sent" || status === "viewed") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-9 w-full gap-1.5 text-xs sm:h-7 sm:w-auto"
                          onClick={() => void handleSendDifferent(c)}
                          disabled={sendDifferentId === c.id || templates.length === 0}
                          title="Cancel this contract and send a new / different one"
                        >
                          {sendDifferentId === c.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Repeat className="h-3 w-3" />
                          )}
                          Send Different
                        </Button>
                      )}
                      {canIssue && (
                        <Button
                          size="sm"
                          variant={status === "draft" ? "default" : "outline"}
                          className="h-9 w-full gap-1.5 text-xs sm:h-7 sm:w-auto"
                          onClick={() => openSend(c)}
                          disabled={templates.length === 0}
                        >
                          <Send className="h-3 w-3" />
                          {status === "draft" ? "Send Contract" : "Send Again"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
        </Card>
        </TabsContent>

        {/* ── Cron History tab ──────────────────────────────────────────────── */}
        <TabsContent value="cron" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Incremental Contract Sync</p>
                  <p className="text-xs text-muted-foreground">Runs every 6 hours via Celery Beat · fetches each signed document with fields</p>
                </div>
                <Button variant="outline" size="sm" className="w-full gap-2 sm:w-auto" onClick={() => void loadJobRuns()} disabled={loadingRuns}>
                  <RefreshCw className={cn("h-3.5 w-3.5", loadingRuns && "animate-spin")} />
                  Refresh
                </Button>
              </div>
              {loadingRuns && jobRuns.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : jobRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                  <Timer className="h-8 w-8 opacity-40" />
                  <p className="text-sm">No sync runs recorded yet</p>
                  <p className="text-xs">The cron job runs every 6 hours. Click &quot;Sync Now&quot; to trigger a manual run.</p>
                </div>
              ) : (
                <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Started</th>
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Status</th>
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Trigger</th>
                      <th className="px-4 py-2 text-right font-medium text-xs text-muted-foreground">Processed</th>
                      <th className="px-4 py-2 text-right font-medium text-xs text-muted-foreground">Errors</th>
                      <th className="px-4 py-2 text-right font-medium text-xs text-muted-foreground">Duration</th>
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobRuns.map((run) => (
                      <tr key={run.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 text-xs whitespace-nowrap">{formatDateTime(run.startedAt)}</td>
                        <td className="px-4 py-2.5">
                          <Badge
                            variant={run.status === "completed" ? "success" : run.status === "failed" ? "destructive" : "secondary"}
                            className="text-xs capitalize"
                          >
                            {run.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs capitalize text-muted-foreground">{run.trigger}</td>
                        <td className="px-4 py-2.5 text-xs text-right font-medium">{run.documentsProcessed}</td>
                        <td className="px-4 py-2.5 text-xs text-right text-muted-foreground">{run.errors || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-right text-muted-foreground">
                          {run.durationSeconds != null ? `${run.durationSeconds}s` : run.status === "running" ? <Loader2 className="h-3 w-3 animate-spin inline" /> : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-xs truncate">{run.message || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!sendTarget} onOpenChange={(o) => !o && setSendTarget(null)}>
        <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden sm:max-w-lg">
          <DialogHeader className="min-w-0">
            <DialogTitle className="min-w-0 truncate">
              Send Contract — {sendTarget?.fullName}
            </DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-4 py-2">
            <div className="space-y-2">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Label className="min-w-0">
                  Templates
                  <span className="ml-1.5 text-xs font-normal leading-5 text-muted-foreground">
                    (select one or more — each is sent as its own document)
                  </span>
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={handleRefreshTemplates}
                  disabled={refreshingTemplates}
                >
                  <RefreshCw className={cn("h-3 w-3", refreshingTemplates && "animate-spin")} />
                  Refresh
                </Button>
              </div>
              <div className="max-h-48 min-w-0 space-y-0.5 overflow-y-auto overflow-x-hidden rounded-lg border border-border p-1.5">
                {templates.length === 0 ? (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                    No templates — click Refresh
                  </p>
                ) : (
                  templates.map((t) => {
                    const id = String(t.templateId);
                    return (
                      <label
                        key={t.templateId}
                        className="flex min-w-0 max-w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/40"
                        title={formatTemplateTitle(t.title)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedTemplateIds.has(id)}
                          onChange={() => toggleTemplate(id)}
                          className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                        />
                        <span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                          {formatTemplateTitle(t.title)}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
              {selectedTemplateIds.size > 1 && (
                <p className="text-xs text-muted-foreground">
                  {selectedTemplateIds.size} documents will be sent together in one go.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="dlg-ctc">CTC (Annual, optional)</Label>
              <Input
                id="dlg-ctc"
                type="number"
                placeholder="e.g. 800000"
                value={ctcValue}
                onChange={(e) => setCtcValue(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="dlg-date">Joining Date (optional)</Label>
              <DatePicker
                id="dlg-date"
                value={joiningDate}
                onChange={(v) => setJoiningDate(v)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Candidate fields (name, email, phone, department, position) are auto-prefilled.
              The signing link will be emailed to <strong>{sendTarget?.personalEmail}</strong>.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendTarget(null)} disabled={sending}>
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || selectedTemplateIds.size === 0}
              className="gap-2"
            >
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              {selectedTemplateIds.size > 1 ? `Send ${selectedTemplateIds.size} Documents` : "Send Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] overflow-hidden sm:max-w-2xl">
          <DialogHeader className="min-w-0">
            <DialogTitle className="min-w-0 truncate">Choose Templates</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-3 py-2">
            <Input
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="Search templates"
              className="h-9"
            />
            <div className="max-h-[52vh] min-w-0 overflow-y-auto overflow-x-hidden rounded-md border border-border">
              {filteredTemplates.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No templates found
                </div>
              ) : (
                filteredTemplates.map((template) => {
                  const id = String(template.templateId);
                  const checked = selectedTemplateIds.has(id);
                  return (
                    <label
                      key={template.templateId}
                      className={cn(
                        "flex min-w-0 cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 text-sm transition-colors last:border-b-0",
                        checked ? "bg-primary/10 text-foreground" : "hover:bg-muted/40",
                      )}
                      title={formatTemplateTitle(template.title)}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleTemplate(id)}
                        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate">{formatTemplateTitle(template.title)}</span>
                      {checked && (
                        <Badge variant="secondary" className="shrink-0 text-[11px]">
                          Selected
                        </Badge>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSelectedTemplateIds(new Set())}
              disabled={selectedTemplateIds.size === 0}
            >
              Clear
            </Button>
            <Button onClick={() => setTemplatePickerOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Cancel Contract
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Cancel the active Documenso contract for{" "}
              <span className="font-medium text-foreground">{cancelTarget?.fullName}</span>.
            </p>
            {contractDocuments(cancelTarget?.contract).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {contractDocuments(cancelTarget?.contract).map((document, index) => (
                  <Badge
                    key={`${document.documensoId ?? document.templateId ?? index}-cancel`}
                    variant="outline"
                    className="max-w-full text-xs font-normal"
                  >
                    <span className="truncate">{sentDocumentTitle(document, templateNameById)}</span>
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={!!cancellingId}>
              Keep Contract
            </Button>
            <Button
              variant="destructive"
              onClick={() => void handleCancelContract()}
              disabled={!cancelTarget || !!cancellingId}
              className="gap-2"
            >
              {cancellingId && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel Contract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={csvDialogOpen} onOpenChange={(o) => { if (!csvProcessing) setCsvDialogOpen(o); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Select candidates via CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <p className="text-muted-foreground">
              Upload a CSV containing candidate <strong className="text-foreground">email addresses</strong>.
              We match each email against the candidates in this list and tick the ones that can still
              receive a contract. Then pick template(s) and use <em>Send to N selected</em>.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs">Expected format</Label>
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed">
{`email
candidate1@example.com
candidate2@example.com`}
              </pre>
              <p className="text-[11px] text-muted-foreground">
                A single <code>email</code> column is all that&apos;s needed. Extra columns are ignored, and
                a header row is optional — we read every email we find.
              </p>
            </div>
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              After matching, a <strong className="text-foreground">results CSV</strong> downloads automatically
              showing each email as <em>selected</em>, <em>not&nbsp;found</em> (no candidate in this list), or
              <em>&nbsp;skipped</em> (already has an active/signed contract).
            </div>
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" className="gap-2" onClick={downloadExampleCsv}>
              <FileDown className="h-4 w-4" />
              Download example CSV
            </Button>
            <Button
              className="gap-2"
              onClick={() => csvInputRef.current?.click()}
              disabled={csvProcessing}
            >
              {csvProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload CSV
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

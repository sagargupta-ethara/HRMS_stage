"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn, getInitials, hasAssignedRole, timeAgo } from "@/lib/utils";
import type { CandidateStage } from "@/types";
import { FileText, Send, CheckCircle2, Clock, Search, Eye, RefreshCw, Download, Loader2, Users, Upload, ShieldCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { candidatesApi, selectionFormsApi, type CandidateSelectionFormRecord } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type CandidateRow = {
  id: string;
  candidateCode: string;
  fullName: string;
  personalEmail: string;
  currentStage: CandidateStage;
  createdAt: string;
  position?: { title?: string };
  selectionForm?: {
    sentAt?: string;
    submittedAt?: string;
    validatedAt?: string;
  } | null;
};

type SelectionFormDocument = {
  key: string;
  fileName: string;
  fileAvailable: boolean;
  verificationStatus?: string | null;
  ocrStatus?: string | null;
  needsReview?: boolean;
  detectedDocumentType?: string | null;
  matchesExpectedCategory?: boolean | null;
  verificationMessage?: string | null;
  verifiedAt?: string | null;
};

type DetailsRow = {
  label: string;
  value: string;
  document?: SelectionFormDocument;
};

const SELECTION_STAGES: CandidateStage[] = [
  "evaluation_passed",
  "selection_form_sent",
  "selection_form_submitted",
  "selection_form_validated",
];

function formStatusFromStage(stage: CandidateStage): "pending_send" | "sent" | "submitted" | "validated" {
  if (stage === "selection_form_validated") return "validated";
  if (stage === "selection_form_submitted") return "submitted";
  if (stage === "selection_form_sent") return "sent";
  return "pending_send";
}

const STATUS_CONFIG = {
  pending_send: { label: "Pending Send", icon: Clock, badge: "secondary" as const },
  sent: { label: "Sent", icon: Send, badge: "info" as const },
  submitted: { label: "Submitted", icon: FileText, badge: "warning" as const },
  validated: { label: "Validated", icon: CheckCircle2, badge: "success" as const },
};

const DOCUMENT_VERIFICATION_CONFIG = {
  missing: {
    label: "File missing",
    icon: AlertCircle,
    className: "border-border bg-muted/20 text-muted-foreground",
  },
  uploaded: {
    label: "Uploaded",
    icon: FileText,
    className: "border-info/30 bg-info/10 text-info",
  },
  verified: {
    label: "Verified",
    icon: ShieldCheck,
    className: "border-success/30 bg-success/10 text-success",
  },
  needs_review: {
    label: "Needs review",
    icon: AlertCircle,
    className: "border-warning/35 bg-warning/10 text-warning",
  },
  skipped: {
    label: "Not AI checked",
    icon: Clock,
    className: "border-border bg-muted/20 text-muted-foreground",
  },
} as const;

type DocumentVerificationState = keyof typeof DOCUMENT_VERIFICATION_CONFIG;

function formatFormLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatFormValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(formatFormValue).join(", ") : "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function normalizeStatus(value?: string | null) {
  return (value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function documentVerificationState(document: SelectionFormDocument): DocumentVerificationState {
  if (!document.fileAvailable) return "missing";

  const status = normalizeStatus(document.verificationStatus || document.ocrStatus);
  if (
    document.needsReview ||
    document.matchesExpectedCategory === false ||
    ["needs_review", "failed", "mismatch", "incorrect", "rejected"].includes(status)
  ) {
    return "needs_review";
  }
  if (
    document.matchesExpectedCategory === true ||
    ["verified", "extracted", "passed", "matched", "validated"].includes(status)
  ) {
    return "verified";
  }
  if (status === "skipped") return "skipped";
  return "uploaded";
}

function verificationStateFromResult(result: { matchesExpectedCategory: boolean | null; ocrStatus: string }): DocumentVerificationState {
  const status = normalizeStatus(result.ocrStatus);
  if (result.matchesExpectedCategory === true || ["verified", "extracted"].includes(status)) return "verified";
  if (result.matchesExpectedCategory === false || status === "needs_review") return "needs_review";
  return "skipped";
}

function getSelectionFormDocument(key: string, value: unknown): SelectionFormDocument | null {
  if (typeof value === "string" && value.trim()) {
    return { key, fileName: value.trim(), fileAvailable: false };
  }
  if (!isRecord(value)) return null;
  const fileName = asString(value.fileName) || asString(value.file_name) || asString(value.name);
  if (!fileName) return null;
  const verificationStatus = asString(value.verificationStatus) || asString(value.verification_status) || null;
  const ocrStatus = asString(value.ocrStatus) || asString(value.ocr_status) || null;
  return {
    key,
    fileName,
    fileAvailable: typeof value.fileAvailable === "boolean" ? value.fileAvailable : true,
    verificationStatus,
    ocrStatus,
    needsReview: asBoolean(value.needsReview ?? value.needs_review) ?? undefined,
    detectedDocumentType: asString(value.detectedDocumentType) || asString(value.detected_document_type) || null,
    matchesExpectedCategory: asBoolean(value.matchesExpectedCategory ?? value.matches_expected_category),
    verificationMessage: asString(value.verificationMessage) || asString(value.verification_message) || null,
    verifiedAt: asString(value.verifiedAt) || asString(value.verified_at) || null,
  };
}

function flattenFormData(data?: Record<string, unknown> | null, prefix = ""): DetailsRow[] {
  if (!data) return [];
  return Object.entries(data).flatMap(([key, value]) => {
    const label = prefix ? `${prefix} ${formatFormLabel(key)}` : formatFormLabel(key);
    if (prefix === "Documents Uploaded") {
      const document = getSelectionFormDocument(key, value);
      if (document) return [{ label, value: document.fileName, document }];
    }
    if (isRecord(value)) {
      return flattenFormData(value, label);
    }
    return [{ label, value: formatFormValue(value) }];
  });
}

export default function SelectionFormsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsCandidate, setDetailsCandidate] = useState<CandidateRow | null>(null);
  const [detailsForm, setDetailsForm] = useState<CandidateSelectionFormRecord | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsDocumentAction, setDetailsDocumentAction] = useState<string | null>(null);
  const detailsFileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const canValidateSelectionForm = hasAssignedRole(user, ["super_admin", "admin", "leadership", "hr"]);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // Fetch EVERY candidate in each selection stage by walking all pages.
      // (Previously capped at limit:50/stage, which silently hid candidates once
      // a stage held more than 50 — e.g. 100+ at "selection_form_sent" — and the
      // search box only filters the already-loaded subset, so hidden rows were
      // unsearchable too.)
      const PAGE_SIZE = 100;
      const fetchAllForStage = async (stage: CandidateStage): Promise<CandidateRow[]> => {
        const first = await candidatesApi.list({ stage, limit: PAGE_SIZE, page: 1 });
        const rows: CandidateRow[] = first.data ?? [];
        const totalPages: number = first.totalPages ?? 1;
        if (totalPages > 1) {
          const rest = await Promise.all(
            Array.from({ length: totalPages - 1 }, (_, i) =>
              candidatesApi.list({ stage, limit: PAGE_SIZE, page: i + 2 }),
            ),
          );
          rest.forEach((r) => rows.push(...(r.data ?? [])));
        }
        return rows;
      };
      const results = await Promise.all(SELECTION_STAGES.map(fetchAllForStage));
      const merged: CandidateRow[] = results.flat();
      const unique = merged.filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
      unique.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setCandidates(unique);
    } catch {
      setError("Unable to load selection forms data.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadData(), 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const handleSend = async (candidateId: string, name: string) => {
    setActing(candidateId);
    try {
      await selectionFormsApi.submit(candidateId, {});
      toast.success(`Selection form sent to ${name}`);
      await loadData();
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || `Failed to send form to ${name}`);
    } finally {
      setActing(null);
    }
  };

  const handleValidate = async (candidateId: string, name: string) => {
    setActing(candidateId);
    try {
      const validated = await selectionFormsApi.validate(candidateId);
      setDetailsForm((current) => (current?.candidateId === candidateId ? validated : current));
      toast.success(`${name}'s selection form validated`);
      await loadData();
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || `Failed to validate ${name}'s form`);
    } finally {
      setActing(null);
    }
  };

  const handleReopen = async (candidateId: string, name: string) => {
    setActing(candidateId);
    try {
      const reopened = await selectionFormsApi.reopen(candidateId);
      setDetailsForm((current) => (current?.candidateId === candidateId ? reopened : current));
      setDetailsCandidate((current) => (
        current?.id === candidateId
          ? { ...current, currentStage: "selection_form_sent", selectionForm: { ...(current.selectionForm ?? {}), submittedAt: undefined, validatedAt: undefined } }
          : current
      ));
      toast.success(`${name}'s selection form reopened`);
      await loadData();
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || `Failed to reopen ${name}'s form`);
    } finally {
      setActing(null);
    }
  };

  const openFormDetails = async (candidate: CandidateRow) => {
    setDetailsCandidate(candidate);
    setDetailsForm(null);
    setDetailsDocumentAction(null);
    setDetailsOpen(true);
    setDetailsLoading(true);
    try {
      const form = await selectionFormsApi.get(candidate.id);
      setDetailsForm(form);
    } catch {
      toast.error("Unable to load selection form details.");
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleSelectionFormDocument = async (
    document: SelectionFormDocument,
    action: "preview" | "download",
  ) => {
    if (!detailsCandidate) return;
    if (!document.fileAvailable) {
      toast.error("This selection form only has the filename. The file needs to be re-uploaded.");
      return;
    }
    const actionKey = `${action}:${document.key}`;
    let previewWindow: Window | null = null;

    if (action === "preview" && typeof window !== "undefined") {
      previewWindow = window.open("about:blank", "_blank");
      if (previewWindow) previewWindow.opener = null;
    }

    setDetailsDocumentAction(actionKey);
    try {
      if (action === "download") {
        await selectionFormsApi.downloadDocument(detailsCandidate.id, document.key, document.fileName);
        return;
      }

      const blob = await selectionFormsApi.getDocumentBlob(detailsCandidate.id, document.key, "preview");
      const url = window.URL.createObjectURL(blob);
      if (previewWindow) {
        previewWindow.location.href = url;
      } else {
        const openedWindow = window.open(url, "_blank");
        if (!openedWindow) toast.error("Unable to open the preview window.");
      }
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (err: unknown) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Unable to open this document. The file may not have been uploaded.");
    } finally {
      setDetailsDocumentAction(null);
    }
  };

  const handleSelectionFormDocumentUpload = async (
    document: SelectionFormDocument,
    file: File,
  ) => {
    if (!detailsCandidate) return;
    setDetailsDocumentAction(`upload:${document.key}`);
    try {
      const updated = await selectionFormsApi.uploadDocument(detailsCandidate.id, document.key, file);
      setDetailsForm(updated);
      toast.success(`${document.fileName} attached successfully.`);
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Unable to attach this document.");
    } finally {
      setDetailsDocumentAction(null);
    }
  };

  const handleSelectionFormDocumentVerify = async (document: SelectionFormDocument) => {
    if (!detailsCandidate) return;
    if (!document.fileAvailable) {
      toast.error("Attach the file before verifying this document.");
      return;
    }
    setDetailsDocumentAction(`verify:${document.key}`);
    try {
      const { result, form } = await selectionFormsApi.verifyAttachedDocument(detailsCandidate.id, document.key);
      setDetailsForm(form);
      const state = verificationStateFromResult(result);
      if (state === "verified") {
        toast.success(`${document.fileName} verified.`);
      } else if (state === "needs_review") {
        toast.warning(result.message || `${document.fileName} needs review.`);
      } else {
        toast.info("AI verification is not enabled for this document type.");
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Unable to verify this document.");
    } finally {
      setDetailsDocumentAction(null);
    }
  };

  const handleVerifySelectionFormDocuments = async () => {
    if (!detailsCandidate) return;
    const documents = flattenFormData(detailsForm?.formData)
      .map((row) => row.document)
      .filter((document): document is SelectionFormDocument => Boolean(document?.fileAvailable));

    if (!documents.length) {
      toast.info("No uploaded selection-form documents are available to verify.");
      return;
    }

    setDetailsDocumentAction("verify-all");
    try {
      const summary = { verified: 0, needsReview: 0, skipped: 0 };
      for (const document of documents) {
        const { result, form } = await selectionFormsApi.verifyAttachedDocument(detailsCandidate.id, document.key);
        setDetailsForm(form);
        const state = verificationStateFromResult(result);
        if (state === "verified") summary.verified += 1;
        else if (state === "needs_review") summary.needsReview += 1;
        else summary.skipped += 1;
      }

      if (summary.needsReview > 0) {
        toast.warning(
          `Checked ${documents.length}: ${summary.verified} verified, ${summary.needsReview} need review.`,
        );
      } else if (summary.verified > 0) {
        toast.success(`Verified ${summary.verified} selection-form document(s).`);
      } else {
        toast.info("AI verification is not enabled for these document types.");
      }
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { detail?: string } } };
      toast.error(apiErr.response?.data?.detail || "Unable to verify selection-form documents.");
    } finally {
      setDetailsDocumentAction(null);
    }
  };

  const filtered = candidates.filter((c) =>
    !search ||
    c.fullName.toLowerCase().includes(search.toLowerCase()) ||
    c.personalEmail.toLowerCase().includes(search.toLowerCase()) ||
    (c.position?.title ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const counts = {
    pendingSend: candidates.filter((c) => formStatusFromStage(c.currentStage) === "pending_send").length,
    sent: candidates.filter((c) => formStatusFromStage(c.currentStage) === "sent").length,
    submitted: candidates.filter((c) => formStatusFromStage(c.currentStage) === "submitted").length,
    validated: candidates.filter((c) => formStatusFromStage(c.currentStage) === "validated").length,
  };
  const detailsRows = flattenFormData(detailsForm?.formData);
  const detailsDocumentRows = detailsRows.filter((row) => row.document);
  const detailsStatus = detailsCandidate ? formStatusFromStage(detailsCandidate.currentStage) : "pending_send";

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Selection Forms
          </h1>
          <p className="text-muted-foreground">Send, track, and validate candidate selection forms</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-xl text-xs">
          <Download className="mr-1.5 h-3.5 w-3.5" /> Export
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Pending Send", value: counts.pendingSend, icon: Clock, color: "text-muted-foreground", bg: "bg-muted/30" },
          { label: "Sent", value: counts.sent, icon: Send, color: "text-info", bg: "bg-info/10" },
          { label: "Submitted", value: counts.submitted, icon: FileText, color: "text-warning", bg: "bg-warning/10" },
          { label: "Validated", value: counts.validated, icon: CheckCircle2, color: "text-success", bg: "bg-success/10" },
        ].map((s) => (
          <div
            key={s.label}
            className="relative min-w-0 overflow-hidden rounded-2xl p-4"
            style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{s.label}</p>
                <p className="mt-1 truncate text-2xl font-bold tabular-nums text-foreground">{isLoading ? "—" : s.value}</p>
              </div>
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", s.bg)}>
                <s.icon className={cn("h-4 w-4", s.color)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search candidates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 rounded-xl h-10"
        />
      </div>

      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          <div className="hidden w-full overflow-x-auto sm:block">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {["Candidate", "Position", "Status", "Submitted", "Actions"].map((h) => (
                    <th key={h} className={cn(
                      "py-3 px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
                      h === "Actions" ? "text-right" : "text-left"
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center">
                      <Users className="h-8 w-8 opacity-30 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No candidates at selection form stages</p>
                    </td>
                  </tr>
                ) : filtered.map((c) => {
                  const status = formStatusFromStage(c.currentStage);
                  const cfg = STATUS_CONFIG[status];
                  const Icon = cfg.icon;
                  const isActing = acting === c.id;
                  return (
                    <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className="bg-primary/10 text-primary text-xs">
                              {getInitials(c.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{c.fullName}</p>
                            <p className="text-xs text-muted-foreground">{c.personalEmail}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-sm text-muted-foreground">
                        {c.position?.title ?? "—"}
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={cfg.badge} className="text-xs gap-1">
                          <Icon className="h-3 w-3" /> {cfg.label}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(c.createdAt)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {status === "pending_send" && (
                            <Button
                              size="sm"
                              className="rounded-lg text-xs h-7"
                              disabled={isActing}
                              onClick={() => handleSend(c.id, c.fullName)}
                            >
                              {isActing
                                ? <><RefreshCw className="h-3 w-3 animate-spin mr-1" /> Sending...</>
                                : <><Send className="h-3 w-3 mr-1" /> Send Form</>}
                            </Button>
                          )}
                          {status === "submitted" && (
                            <Button
                              size="sm"
                              className="rounded-lg text-xs h-7 bg-success hover:bg-success/90"
                              disabled={isActing}
                              onClick={() => handleValidate(c.id, c.fullName)}
                            >
                              {isActing
                                ? <><RefreshCw className="h-3 w-3 animate-spin mr-1" /> Validating...</>
                                : <><CheckCircle2 className="h-3 w-3 mr-1" /> Validate</>}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg text-xs h-7"
                            onClick={() => void openFormDetails(c)}
                          >
                            <Eye className="h-3 w-3 mr-1" /> View
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list (matches the candidates responsive pattern) */}
          <div className="space-y-3 p-3 sm:hidden">
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <Users className="h-8 w-8 opacity-30" />
                <p className="text-sm">No candidates at selection form stages</p>
              </div>
            ) : filtered.map((c) => {
              const status = formStatusFromStage(c.currentStage);
              const cfg = STATUS_CONFIG[status];
              const Icon = cfg.icon;
              const isActing = acting === c.id;
              return (
                <div key={c.id} className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="h-9 w-9 shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-xs">
                          {getInitials(c.fullName)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.fullName}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.personalEmail}</p>
                      </div>
                    </div>
                    <Badge variant={cfg.badge} className="shrink-0 gap-1 text-xs">
                      <Icon className="h-3 w-3" /> {cfg.label}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {c.position?.title && <span>{c.position.title}</span>}
                    <span>Submitted {timeAgo(c.createdAt)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {status === "pending_send" && (
                      <Button
                        size="sm"
                        className="h-8 flex-1 rounded-lg text-xs"
                        disabled={isActing}
                        onClick={() => handleSend(c.id, c.fullName)}
                      >
                        {isActing
                          ? <><RefreshCw className="h-3 w-3 animate-spin mr-1" /> Sending...</>
                          : <><Send className="h-3 w-3 mr-1" /> Send Form</>}
                      </Button>
                    )}
                    {status === "submitted" && (
                      <Button
                        size="sm"
                        className="h-8 flex-1 rounded-lg text-xs bg-success hover:bg-success/90"
                        disabled={isActing}
                        onClick={() => handleValidate(c.id, c.fullName)}
                      >
                        {isActing
                          ? <><RefreshCw className="h-3 w-3 animate-spin mr-1" /> Validating...</>
                          : <><CheckCircle2 className="h-3 w-3 mr-1" /> Validate</>}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 flex-1 rounded-lg text-xs"
                      onClick={() => void openFormDetails(c)}
                    >
                      <Eye className="h-3 w-3 mr-1" /> View
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden rounded-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" /> Selection Form Details
            </DialogTitle>
            <DialogDescription>
              Review the information submitted by the candidate before marking the form as validated.
            </DialogDescription>
          </DialogHeader>

          {canValidateSelectionForm && detailsDocumentRows.length > 0 && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 rounded-lg text-xs"
                disabled={detailsDocumentAction !== null || !detailsDocumentRows.some((row) => row.document?.fileAvailable)}
                onClick={() => void handleVerifySelectionFormDocuments()}
                title="Re-check every uploaded selection-form document with AI"
              >
                {detailsDocumentAction === "verify-all" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5" />
                )}
                {detailsDocumentAction === "verify-all" ? "Verifying..." : "Verify documents"}
              </Button>
            </div>
          )}

          <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
            {detailsCandidate && (
              <div className="grid gap-3 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Candidate</p>
                  <p className="mt-1 font-semibold">{detailsCandidate.fullName}</p>
                  <p className="text-xs text-muted-foreground">{detailsCandidate.personalEmail}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Position</p>
                  <p className="mt-1 font-semibold">{detailsCandidate.position?.title ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{detailsCandidate.candidateCode}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Current Stage</p>
                  <Badge variant={STATUS_CONFIG[detailsStatus].badge} className="mt-1 gap-1 text-xs">
                    {STATUS_CONFIG[detailsStatus].label}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Submitted</p>
                  <p className="mt-1 text-sm">{detailsForm?.submittedAt ? timeAgo(detailsForm.submittedAt) : "Not submitted yet"}</p>
                </div>
              </div>
            )}

            {detailsLoading ? (
              <div className="flex min-h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : detailsRows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No submitted form fields are available yet.
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {detailsRows.map((row) => {
                  const verificationState = row.document ? documentVerificationState(row.document) : null;
                  const verificationConfig = verificationState ? DOCUMENT_VERIFICATION_CONFIG[verificationState] : null;
                  const VerificationIcon = verificationConfig?.icon;

                  return (
                  <div key={row.label} className="rounded-xl border border-border bg-muted/20 p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{row.label}</p>
                    {row.document && verificationConfig && VerificationIcon ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 break-words text-sm font-medium">{row.value}</p>
                          <Badge
                            variant="outline"
                            className={cn("shrink-0 gap-1 text-[10px]", verificationConfig.className)}
                          >
                            <VerificationIcon className="h-3 w-3" />
                            {verificationConfig.label}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-2 text-xs"
                            disabled={detailsDocumentAction !== null || !row.document.fileAvailable}
                            onClick={() => void handleSelectionFormDocument(row.document!, "preview")}
                          >
                            {detailsDocumentAction === `preview:${row.document.key}`
                              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              : <Eye className="mr-1 h-3.5 w-3.5" />}
                            Preview
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-2 text-xs"
                            disabled={detailsDocumentAction !== null || !row.document.fileAvailable}
                            onClick={() => void handleSelectionFormDocument(row.document!, "download")}
                          >
                            {detailsDocumentAction === `download:${row.document.key}`
                              ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                              : <Download className="mr-1 h-3.5 w-3.5" />}
                            Download
                          </Button>
                          {canValidateSelectionForm && row.document.fileAvailable && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-8 rounded-lg px-2 text-xs"
                              disabled={detailsDocumentAction !== null}
                              onClick={() => void handleSelectionFormDocumentVerify(row.document!)}
                            >
                              {detailsDocumentAction === `verify:${row.document.key}`
                                ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                : <ShieldCheck className="mr-1 h-3.5 w-3.5" />}
                              Verify
                            </Button>
                          )}
                          {!row.document.fileAvailable && (
                            <>
                              <input
                                ref={(el) => { detailsFileInputs.current[row.document!.key] = el; }}
                                type="file"
                                className="hidden"
                                accept=".pdf,.jpg,.jpeg,.png,.webp"
                                onChange={(event) => {
                                  const file = event.currentTarget.files?.[0];
                                  event.currentTarget.value = "";
                                  if (file) void handleSelectionFormDocumentUpload(row.document!, file);
                                }}
                              />
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg px-2 text-xs"
                                disabled={detailsDocumentAction !== null}
                                onClick={() => detailsFileInputs.current[row.document!.key]?.click()}
                              >
                                {detailsDocumentAction === `upload:${row.document.key}`
                                  ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                                  : <Upload className="mr-1 h-3.5 w-3.5" />}
                                Attach file
                              </Button>
                            </>
                          )}
                        </div>
                        {!row.document.fileAvailable && (
                          <p className="text-xs text-warning">
                            File was not uploaded with this older submission. Attach it here to enable preview and download.
                          </p>
                        )}
                        {row.document.verificationMessage && (
                          <p
                            className={cn(
                              "text-xs",
                              verificationState === "needs_review" ? "text-warning" : "text-muted-foreground",
                            )}
                          >
                            {row.document.verificationMessage}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-1 break-words text-sm font-medium">{row.value}</p>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailsOpen(false)}>Close</Button>
            {canValidateSelectionForm && detailsCandidate && ["submitted", "validated"].includes(detailsStatus) && (
              <Button
                variant="outline"
                disabled={acting === detailsCandidate.id || detailsLoading}
                onClick={() => void handleReopen(detailsCandidate.id, detailsCandidate.fullName)}
              >
                {acting === detailsCandidate.id
                  ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Reopening...</>
                  : <><RefreshCw className="mr-2 h-4 w-4" /> Reopen Form</>}
              </Button>
            )}
            {canValidateSelectionForm && detailsCandidate && detailsStatus === "submitted" && !detailsForm?.validatedAt && (
              <Button
                disabled={acting === detailsCandidate.id || detailsLoading}
                onClick={() => void handleValidate(detailsCandidate.id, detailsCandidate.fullName)}
              >
                {acting === detailsCandidate.id
                  ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Validating...</>
                  : <><CheckCircle2 className="mr-2 h-4 w-4" /> Mark Validated</>}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { type MouseEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn, formatDateTime } from "@/lib/utils";
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  CloudDownload, Download, ExternalLink, FileCheck,
  Loader2, MoreHorizontal, RefreshCw, RotateCcw, Search, Timer, Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  documensoApi,
  employeesApi,
  signedProfilesApi,
  type EmployeeComplianceQueueRecord,
  type ProfileSyncState,
  type SignedProfile,
  type SyncJobRun,
} from "@/lib/api";

function FieldBadge({ label, value }: { label: string; value: string | string[] }) {
  const vals = Array.isArray(value) ? [...new Set(value)] : [value];
  return (
    <div className="flex flex-col gap-0.5 text-xs sm:flex-row sm:items-start sm:gap-1.5">
      <span className="w-auto shrink-0 truncate text-muted-foreground sm:w-32">{label}</span>
      <span className="break-words font-medium">{vals.join(" · ")}</span>
    </div>
  );
}

function ProfileRow({ profile }: { profile: SignedProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [openingDocumenso, setOpeningDocumenso] = useState(false);
  const fields = Object.entries(profile.fieldValues || {}).filter(
    ([, v]) => v && (Array.isArray(v) ? v.some(Boolean) : true)
  );
  const candidate = profile.candidate;
  const candidateDetails = candidate
    ? [
        ["Candidate Code", candidate.candidateCode],
        ["Full Name", candidate.fullName],
        ["Personal Email", candidate.personalEmail],
        ["Ethara Email", candidate.etharaEmail || ""],
        ["Phone", candidate.phone],
        ["Current Status", candidate.currentStatus],
        ["Stage Key", candidate.currentStage],
        ["Position", candidate.position?.title || ""],
      ].filter(([, value]) => value)
    : [];

  const handleOpenDocumenso = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (openingDocumenso) return;

    setOpeningDocumenso(true);
    try {
      const { url } = await signedProfilesApi.getOpenUrl(profile.id);
      const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
      if (!openedWindow) {
        // Popup was blocked — open via a temporary anchor so the current page stays.
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      toast.error("Unable to open the Documenso document");
    } finally {
      setOpeningDocumenso(false);
    }
  };

  return (
    <>
      <tr
        className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {expanded
              ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            }
            <div>
              <p className="text-sm font-medium">
                {candidate?.fullName || profile.recipientName || profile.recipientEmail}
              </p>
              <p className="text-xs text-muted-foreground">
                {candidate?.candidateCode
                  ? `${candidate.candidateCode} · ${candidate.personalEmail}`
                  : profile.recipientEmail}
              </p>
            </div>
          </div>
        </td>
        <td className="px-4 py-3">
          <p className="text-sm truncate max-w-[200px]">{profile.templateTitle || "—"}</p>
        </td>
        <td className="px-4 py-3">
          <p className="text-xs text-muted-foreground whitespace-nowrap">
            {profile.completedAt ? formatDateTime(profile.completedAt) : "—"}
          </p>
        </td>
        <td className="px-4 py-3">
          <Badge variant="secondary" className="text-xs font-mono">
            {fields.length} fields
          </Badge>
        </td>
        <td className="px-4 py-3">
          {profile.candidateId ? (
            <div className="space-y-1">
              <Badge variant="outline" className="text-xs">
                {candidate?.currentStatus || "Matched"}
              </Badge>
              <Link
                href={`/dashboard/candidates/${profile.candidateId}`}
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                <Users className="h-3 w-3" /> View Profile
              </Link>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">Not matched</span>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {profile.pdfUrl && (
              <a
                href={profile.pdfUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted transition-colors"
              >
                <Download className="h-3 w-3" />
                PDF
              </a>
            )}
            <button
              type="button"
              onClick={handleOpenDocumenso}
              disabled={openingDocumenso}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted transition-colors"
            >
              {openingDocumenso ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ExternalLink className="h-3 w-3" />
              )}
              Documenso
            </button>
          </div>
        </td>
      </tr>
      {expanded && (candidateDetails.length > 0 || fields.length > 0) && (
        <tr className="border-b border-border bg-muted/20">
          <td colSpan={6} className="px-8 py-3">
            {candidateDetails.length > 0 && (
              <div className="mb-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  HRMS Candidate Details
                </p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {candidateDetails.map(([label, value]) => (
                    <FieldBadge key={label} label={label} value={String(value)} />
                  ))}
                </div>
              </div>
            )}
            {fields.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Signed Document Fields
                </p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {fields.map(([label, value]) => (
                    <FieldBadge key={label} label={label} value={value} />
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function ProfileMobileCard({ profile }: { profile: SignedProfile }) {
  const [expanded, setExpanded] = useState(false);
  const [openingDocumenso, setOpeningDocumenso] = useState(false);
  const fields = Object.entries(profile.fieldValues || {}).filter(
    ([, v]) => v && (Array.isArray(v) ? v.some(Boolean) : true)
  );
  const candidate = profile.candidate;
  const candidateDetails = candidate
    ? [
        ["Candidate Code", candidate.candidateCode],
        ["Full Name", candidate.fullName],
        ["Personal Email", candidate.personalEmail],
        ["Ethara Email", candidate.etharaEmail || ""],
        ["Phone", candidate.phone],
        ["Current Status", candidate.currentStatus],
        ["Stage Key", candidate.currentStage],
        ["Position", candidate.position?.title || ""],
      ].filter(([, value]) => value)
    : [];

  const handleOpenDocumenso = async () => {
    if (openingDocumenso) return;

    setOpeningDocumenso(true);
    try {
      const { url } = await signedProfilesApi.getOpenUrl(profile.id);
      const openedWindow = window.open(url, "_blank", "noopener,noreferrer");
      if (!openedWindow) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch {
      toast.error("Unable to open the Documenso document");
    } finally {
      setOpeningDocumenso(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <button
        type="button"
        className="flex w-full items-start gap-3 text-left"
        onClick={() => setExpanded((e) => !e)}
      >
        {expanded
          ? <ChevronUp className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
          : <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
        }
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">
            {candidate?.fullName || profile.recipientName || profile.recipientEmail}
          </p>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            {candidate?.candidateCode
              ? `${candidate.candidateCode} · ${candidate.personalEmail}`
              : profile.recipientEmail}
          </p>
        </div>
      </button>

      <div className="mt-3 grid gap-3 text-xs">
        <div>
          <p className="text-muted-foreground">Template</p>
          <p className="break-words text-sm">{profile.templateTitle || "—"}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-muted-foreground">Signed At</p>
            <p>{profile.completedAt ? formatDateTime(profile.completedAt) : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Fields</p>
            <Badge variant="secondary" className="mt-1 font-mono text-xs">
              {fields.length} fields
            </Badge>
          </div>
        </div>
        {profile.candidateId ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {candidate?.currentStatus || "Matched"}
            </Badge>
            <Link
              href={`/dashboard/candidates/${profile.candidateId}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <Users className="h-3 w-3" /> View Profile
            </Link>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not matched</span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2">
        {profile.pdfUrl && (
          <a
            href={profile.pdfUrl}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted"
          >
            <Download className="h-3 w-3" />
            PDF
          </a>
        )}
        <button
          type="button"
          onClick={handleOpenDocumenso}
          disabled={openingDocumenso}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted disabled:opacity-60"
        >
          {openingDocumenso ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <ExternalLink className="h-3 w-3" />
          )}
          Documenso
        </button>
      </div>

      {expanded && (candidateDetails.length > 0 || fields.length > 0) && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          {candidateDetails.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                HRMS Candidate Details
              </p>
              <div className="space-y-2">
                {candidateDetails.map(([label, value]) => (
                  <FieldBadge key={label} label={label} value={String(value)} />
                ))}
              </div>
            </div>
          )}
          {fields.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Signed Document Fields
              </p>
              <div className="space-y-2">
                {fields.map(([label, value]) => (
                  <FieldBadge key={label} label={label} value={value} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 50;

const COMPLIANCE_SIGNED_STATUSES = new Set(["signed", "submitted", "verified", "completed", "approved"]);

function isComplianceSigned(form: EmployeeComplianceQueueRecord): boolean {
  return Boolean(form.signedAt) || COMPLIANCE_SIGNED_STATUSES.has((form.status || "").toLowerCase());
}

function prettyLabel(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function ComplianceRow({ form }: { form: EmployeeComplianceQueueRecord }) {
  const [expanded, setExpanded] = useState(false);
  const fields = Object.entries(form.formData || {}).filter(
    ([, v]) => v != null && v !== "" && (Array.isArray(v) ? v.some(Boolean) : true),
  );
  const openHref = form.signedUrl || form.pdfUrl || null;
  return (
    <div className="rounded-2xl border border-border/60 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" onClick={() => setExpanded((p) => !p)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{form.employeeName}</span>
            {form.employeeCode && <span className="font-mono text-[10px] text-muted-foreground">{form.employeeCode}</span>}
            <Badge variant="outline" className="rounded-full border-success/30 bg-success/10 px-2 text-[10px] text-success">
              {form.formTitle || form.formType}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {form.signedAt ? `Signed ${formatDateTime(form.signedAt)}` : form.submittedAt ? `Submitted ${formatDateTime(form.submittedAt)}` : "—"}
            {" · "}{fields.length} field{fields.length === 1 ? "" : "s"}
          </p>
        </button>
        <div className="flex items-center gap-2">
          {openHref && (
            <a href={openHref} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" onClick={() => setExpanded((p) => !p)}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-1.5 border-t border-border/50 pt-3 sm:grid-cols-2">
          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">No field details captured.</p>
          ) : (
            fields.map(([label, value]) => (
              <FieldBadge key={label} label={prettyLabel(label)} value={Array.isArray(value) ? value.map(String) : String(value)} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StatutoryProfileRow({ profile }: { profile: SignedProfile }) {
  const [opening, setOpening] = useState(false);
  const handleOpen = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const { url } = await signedProfilesApi.getOpenUrl(profile.id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      toast.error("Could not open the signed document.");
    } finally {
      setOpening(false);
    }
  };
  return (
    <div className="rounded-2xl border border-border/60 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{profile.recipientName || profile.recipientEmail}</span>
            <Badge variant="outline" className="rounded-full border-info/30 bg-info/10 px-2 text-[10px] text-info">
              {profile.templateTitle || "Statutory form"}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {profile.completedAt ? `Signed ${formatDateTime(profile.completedAt)}` : "—"}
            {profile.candidate?.fullName ? ` · ${profile.candidate.fullName}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleOpen()}
          disabled={opening}
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs text-primary hover:underline"
        >
          {opening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />} Open
        </button>
      </div>
    </div>
  );
}

function SignedCompliancesTab() {
  const [forms, setForms] = useState<EmployeeComplianceQueueRecord[]>([]);
  const [statutoryDocs, setStatutoryDocs] = useState<SignedProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([
      employeesApi.listComplianceQueue().catch(() => {
        toast.error("Could not load signed compliance forms.");
        return [] as EmployeeComplianceQueueRecord[];
      }),
      // Statutory Form 11 / Form 2 / Form F envelopes signed via Documenso live here,
      // not in the contracts list.
      signedProfilesApi.list({ docClass: "compliance", limit: 200 }).catch(() => null),
    ])
      .then(([rows, profilesResp]) => {
        if (!active) return;
        setForms(rows.filter(isComplianceSigned));
        setStatutoryDocs(profilesResp?.data ?? []);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? forms.filter((f) =>
        [f.employeeName, f.employeeCode, f.formTitle, f.formType].some((v) =>
          String(v ?? "").toLowerCase().includes(q),
        ),
      )
    : forms;
  const filteredStatutory = q
    ? statutoryDocs.filter((p) =>
        [p.recipientName, p.recipientEmail, p.templateTitle, p.candidate?.fullName].some((v) =>
          String(v ?? "").toLowerCase().includes(q),
        ),
      )
    : statutoryDocs;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Signed Compliances</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Compliance forms employees have signed, including the statutory Form 11, Form 2, and Form F documents.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search employee or form…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 rounded-xl pl-9 text-sm"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : filtered.length === 0 && filteredStatutory.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No signed compliance forms yet.</p>
        ) : (
          <div className="space-y-5">
            {filteredStatutory.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Statutory Forms — Form 11 / Form 2 / Form F ({filteredStatutory.length})
                </p>
                <div className="space-y-3">
                  {filteredStatutory.map((profile) => (
                    <StatutoryProfileRow key={profile.id} profile={profile} />
                  ))}
                </div>
              </div>
            )}
            {filtered.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Compliance Form Submissions ({filtered.length})
                </p>
                <div className="space-y-3">
                  {filtered.map((form) => (
                    <ComplianceRow key={form.id} form={form} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SignedContractsPage() {
  const [profiles, setProfiles] = useState<SignedProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncState, setSyncState] = useState<ProfileSyncState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [jobRuns, setJobRuns] = useState<SyncJobRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  const loadJobRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const runs = await documensoApi.getProfileJobRuns(50);
      setJobRuns(runs);
    } catch {
      // non-critical
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setPage(1);
    }, 350);
  };

  const loadData = useCallback(async (p: number, q: string) => {
    setLoading(true);
    try {
      const [profilesResp, stateResp] = await Promise.all([
        signedProfilesApi.list({ page: p, limit: PAGE_SIZE, q: q || undefined }),
        signedProfilesApi.getSyncState().catch(() => null),
      ]);
      setProfiles(profilesResp.data);
      setTotal(profilesResp.total);
      if (stateResp) setSyncState(stateResp);
    } catch {
      toast.error("Failed to load signed contracts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData(page, debouncedSearch);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [page, debouncedSearch, loadData]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await signedProfilesApi.triggerSync();
      toast.success("Sync started — will automatically process all contracts", { duration: 4000 });
      setTimeout(() => loadData(page, debouncedSearch), 3000);
    } catch {
      toast.error("Failed to trigger sync");
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    toast.info("Importing all contracts from Documenso — this may take up to 15 minutes for 12,000+ docs…", { duration: 8000 });
    try {
      const result = await signedProfilesApi.syncAll();
      toast.success(result.message, { duration: 10000 });
      loadData(1, debouncedSearch);
      setPage(1);
    } catch {
      toast.error("Sync all failed — check server logs");
    } finally {
      setSyncing(false);
    }
  };

  const handleEnrichFields = async () => {
    setSyncing(true);
    toast.info("Fetching field values for 200 profiles — takes ~1 min…", { duration: 5000 });
    try {
      const result = await signedProfilesApi.enrichFields();
      toast.success(result.message, { duration: 8000 });
      loadData(page, debouncedSearch);
    } catch {
      toast.error("Field enrichment failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleReset = async () => {
    try {
      await signedProfilesApi.resetSync();
      toast.success("Sync reset — next run starts from page 1");
      loadData(page, debouncedSearch);
    } catch {
      toast.error("Failed to reset");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await signedProfilesApi.exportCsv({
        q: debouncedSearch || undefined,
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export CSV");
    } finally {
      setExporting(false);
    }
  };

  const isRunning = syncState?.syncStatus === "running";
  const isDone = syncState?.syncStatus === "completed";
  const nextPage = (syncState?.lastDocumentId ?? 0) + 1;

  return (
    <div className="space-y-4 overflow-x-hidden px-4 py-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start justify-between gap-3 sm:items-center">
          <div className="flex min-w-0 items-start gap-3 sm:items-center">
          <FileCheck className="mt-1 h-6 w-6 shrink-0 text-muted-foreground sm:mt-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">Signed Contracts</h1>
            <p className="text-sm text-muted-foreground">
              All Documenso completed contracts with extracted candidate data
            </p>
          </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full sm:hidden"
                  aria-label="Signed contracts actions"
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60 rounded-xl">
              <DropdownMenuItem className="gap-2 text-xs" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Export CSV
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-xs" onClick={handleReset}>
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-xs" onClick={handleSyncAll} disabled={syncing || isRunning}>
                {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                Sync All Contracts
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-xs" onClick={handleEnrichFields} disabled={syncing}>
                <RefreshCw className="h-3.5 w-3.5" />
                Fetch Field Values
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-xs" onClick={handleSync} disabled={syncing || isRunning}>
                {syncing || isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudDownload className="h-3.5 w-3.5" />}
                {isRunning ? "Syncing..."
                  : isDone ? "Re-sync"
                  : syncState?.lastDocumentId ? `Continue (p.${nextPage})`
                  : "Start Sync"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="hidden w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Download className="h-4 w-4" />
            }
            Export CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset} className="gap-2">
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleSyncAll}
            disabled={syncing || isRunning}
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
            Sync All Contracts
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleEnrichFields}
            disabled={syncing}
          >
            <RefreshCw className="h-4 w-4" />
            Fetch Field Values
          </Button>
          <Button
            size="sm"
            className="gap-2"
            onClick={handleSync}
            disabled={syncing || isRunning}
          >
            {syncing || isRunning
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <CloudDownload className="h-4 w-4" />
            }
            {isRunning ? "Syncing…"
              : isDone ? "Re-sync"
              : syncState?.lastDocumentId ? `Continue (p.${nextPage})`
              : "Start Sync"
            }
          </Button>
        </div>
      </div>

      {syncState && (
        <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm sm:flex sm:flex-wrap sm:items-center sm:gap-4 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground">Sync:</span>
            <Badge
              variant={isRunning ? "secondary" : isDone ? "default" : "outline"}
              className="text-xs"
            >
              {syncState.syncStatus}
            </Badge>
          </div>
          <div>
            <span className="text-muted-foreground">Profiles in DB: </span>
            <span className="font-medium">{total.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Documents processed: </span>
            <span className="font-medium">{syncState.documentsProcessed.toLocaleString()}</span>
          </div>
          {syncState.lastSyncedAt && (
            <div>
              <span className="text-muted-foreground">Last run: </span>
              <span>{formatDateTime(syncState.lastSyncedAt)}</span>
            </div>
          )}
          {!isDone && syncState.lastDocumentId && (
            <div className="text-muted-foreground text-xs">
              (Continue from page {nextPage} to fetch more)
            </div>
          )}
        </div>
      )}

      <Tabs defaultValue="documents" onValueChange={(v) => { if (v === "cron") void loadJobRuns(); }}>
        <TabsList className="grid h-auto w-full grid-cols-3 sm:inline-grid sm:w-auto">
          <TabsTrigger value="documents" className="gap-1.5 text-xs sm:text-sm">
            <FileCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="sm:hidden">Contracts</span>
            <span className="hidden sm:inline">Signed Contracts</span>
          </TabsTrigger>
          <TabsTrigger value="compliances" className="gap-1.5 text-xs sm:text-sm">
            <Users className="h-3.5 w-3.5 shrink-0" />
            <span className="sm:hidden">Compliances</span>
            <span className="hidden sm:inline">Signed Compliances</span>
          </TabsTrigger>
          <TabsTrigger value="cron" className="gap-1.5 text-xs sm:text-sm">
            <Timer className="h-3.5 w-3.5 shrink-0" />
            <span className="sm:hidden">History</span>
            <span className="hidden sm:inline">Cron History</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="documents" className="mt-4">
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <CardTitle className="text-sm">
              {total.toLocaleString()} signed contracts
            </CardTitle>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search name, email, template…"
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="h-9 w-full pl-8 text-sm sm:h-8 sm:w-64"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadData(page, debouncedSearch)}
                className="h-8 w-8 p-0"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : profiles.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3 text-center">
              <FileCheck className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {total === 0
                  ? "No profiles yet. Click \"Start Sync\" to pull signed contracts from Documenso."
                  : "No results match your search."}
              </p>
            </div>
          ) : (
            <>
            <div className="space-y-3 sm:hidden">
              {profiles.map((p) => (
                <ProfileMobileCard key={p.id} profile={p} />
              ))}
            </div>
            <div className="hidden w-full overflow-x-auto sm:block">
              <table className="w-full min-w-[760px] text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Candidate</th>
                    <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Template</th>
                    <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Signed At</th>
                    <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Fields</th>
                    <th className="px-4 py-2 text-xs font-medium text-muted-foreground">HRMS</th>
                    <th className="px-4 py-2 text-xs font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <ProfileRow key={p.id} profile={p} />
                  ))}
                </tbody>
              </table>
            </div>
            </>
          )}

          {totalPages > 1 && (
            <>
              <Separator />
              <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Page {page} of {totalPages} · {total.toLocaleString()} total
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* ── Cron History tab ──────────────────────────────────────────── */}
        <TabsContent value="compliances" className="mt-4">
          <SignedCompliancesTab />
        </TabsContent>

        <TabsContent value="cron" className="mt-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-0">
              <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Signed Profiles Sync</p>
                  <p className="text-xs text-muted-foreground">
                    Runs every 6 hours via Celery Beat · fast bulk import from Documenso list API
                  </p>
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
                  <p className="text-xs">Click &quot;Sync&quot; or &quot;Sync All&quot; to trigger a run, or wait for the 6-hour cron.</p>
                </div>
              ) : (
                <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Started</th>
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Status</th>
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Trigger</th>
                      <th className="px-4 py-2 text-right font-medium text-xs text-muted-foreground">Imported</th>
                      <th className="px-4 py-2 text-right font-medium text-xs text-muted-foreground">Errors</th>
                      <th className="px-4 py-2 text-right font-medium text-xs text-muted-foreground">Duration</th>
                      <th className="px-4 py-2 text-left font-medium text-xs text-muted-foreground">Details</th>
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
                            {run.status === "running" && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                            {run.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-xs capitalize text-muted-foreground">{run.trigger}</td>
                        <td className="px-4 py-2.5 text-xs text-right font-medium">{run.documentsProcessed.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-xs text-right text-muted-foreground">{run.errors || "—"}</td>
                        <td className="px-4 py-2.5 text-xs text-right text-muted-foreground">
                          {run.durationSeconds != null ? `${run.durationSeconds}s` : "—"}
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
    </div>
  );
}

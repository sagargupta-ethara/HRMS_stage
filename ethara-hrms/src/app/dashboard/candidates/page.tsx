"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle, BarChart2, CalendarDays, CheckCircle2,
  ChevronLeft, ChevronRight, Clock, Download, Eye,
  Loader2, MoreHorizontal, PauseCircle, Pencil, Plus, Search,
  RefreshCw, Send, TrendingUp, Trash2, Upload, UserCheck, UserX, Users, X,
} from "lucide-react";
import { APP_TIME_ZONE, cn, formatCurrentDateLabel, formatLabel, getInitials, hasAssignedRole, SOURCE_LABELS, STAGE_LABELS, timeAgo } from "@/lib/utils";
import type { CandidateStage, Role, SourceType, User } from "@/types";
import { useCandidates, usePositions } from "@/lib/queries";
import { assessmentPlatformApi, candidatesApi, escalationsApi } from "@/lib/api";
import type { ApBulkAssessmentBypassResult, CandidateFilters } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

const PIPELINE_STAGES: { key: CandidateStage; short: string; label: string }[] = [
  { key: "new_application", short: "Applied", label: "Applied" },
  { key: "resume_shortlisted", short: "Shortlisted", label: "Shortlisted" },
  { key: "evaluation_assigned", short: "Eval", label: "Evaluation" },
  { key: "selection_form_sent", short: "Submission", label: "Submission" },
  { key: "contract_sent", short: "Contract", label: "Contract" },
  { key: "compliance_verified", short: "Compliance", label: "Compliance" },
  { key: "it_email_created", short: "Email ID", label: "Email ID" },
  { key: "onboarding_completed", short: "Done", label: "Onboarded" },
];

// Bucket the 22 candidate stages into the 8 granular pipeline cards. "Applied"
// counts every early-funnel applicant (the previous version only counted
// screening-pending, so new_application/source_tagged/resume_uploaded fell off
// and the card read 0). Onboarding is split into Contract / Compliance / Email ID
// / Onboarded so the late funnel is precise.
const JOURNEY_STAGE_GROUPS: Record<string, CandidateStage[]> = {
  new_application: ["new_application", "source_tagged", "resume_uploaded", "resume_screening_pending"],
  resume_shortlisted: ["resume_shortlisted"],
  evaluation_assigned: ["evaluation_assigned", "evaluation_in_progress", "evaluation_passed", "evaluation_failed"],
  selection_form_sent: ["selection_form_sent", "selection_form_submitted", "selection_form_validated"],
  contract_sent: ["contract_sent", "contract_signed"],
  compliance_verified: ["statutory_forms_sent", "statutory_forms_submitted", "compliance_verified"],
  it_email_created: ["it_email_created", "welcome_mail_sent", "induction_completed"],
  onboarding_completed: ["onboarding_completed"],
};

const DISPLAY_STAGE_ALIASES: Partial<Record<CandidateStage, CandidateStage>> = {
  resume_rejected: "new_application",
};

const STAGE_BADGE_VISUALS: Record<CandidateStage, { badge: string; dot: string }> = {
  new_application: { badge: "border-slate-300/25 bg-slate-400/10 text-slate-200", dot: "bg-slate-300" },
  source_tagged: { badge: "border-sky-300/30 bg-sky-400/10 text-sky-200", dot: "bg-sky-300" },
  resume_uploaded: { badge: "border-blue-300/30 bg-blue-400/10 text-blue-200", dot: "bg-blue-300" },
  resume_screening_pending: { badge: "border-amber-300/35 bg-amber-400/10 text-amber-200", dot: "bg-amber-300" },
  resume_shortlisted: { badge: "border-emerald-300/35 bg-emerald-400/10 text-emerald-200", dot: "bg-emerald-300" },
  resume_rejected: { badge: "border-red-300/35 bg-red-500/10 text-red-200", dot: "bg-red-300" },
  evaluation_assigned: { badge: "border-violet-300/35 bg-violet-400/10 text-violet-200", dot: "bg-violet-300" },
  evaluation_in_progress: { badge: "border-purple-300/35 bg-purple-400/10 text-purple-200", dot: "bg-purple-300" },
  evaluation_passed: { badge: "border-green-300/35 bg-green-400/10 text-green-200", dot: "bg-green-300" },
  evaluation_failed: { badge: "border-red-300/35 bg-red-500/10 text-red-200", dot: "bg-red-300" },
  selection_form_sent: { badge: "border-indigo-300/35 bg-indigo-400/10 text-indigo-200", dot: "bg-indigo-300" },
  selection_form_submitted: { badge: "border-teal-300/35 bg-teal-400/10 text-teal-200", dot: "bg-teal-300" },
  selection_form_validated: { badge: "border-cyan-300/35 bg-cyan-400/10 text-cyan-200", dot: "bg-cyan-300" },
  contract_sent: { badge: "border-orange-300/35 bg-orange-400/10 text-orange-200", dot: "bg-orange-300" },
  contract_signed: { badge: "border-lime-300/35 bg-lime-400/10 text-lime-200", dot: "bg-lime-300" },
  induction_completed: { badge: "border-emerald-300/35 bg-emerald-400/10 text-emerald-200", dot: "bg-emerald-300" },
  it_email_created: { badge: "border-blue-300/35 bg-blue-400/10 text-blue-200", dot: "bg-blue-300" },
  welcome_mail_sent: { badge: "border-pink-300/35 bg-pink-400/10 text-pink-200", dot: "bg-pink-300" },
  statutory_forms_sent: { badge: "border-fuchsia-300/40 bg-fuchsia-400/10 text-fuchsia-200", dot: "bg-fuchsia-300" },
  statutory_forms_submitted: { badge: "border-violet-300/40 bg-violet-400/10 text-violet-200", dot: "bg-violet-300" },
  compliance_verified: { badge: "border-green-300/40 bg-green-400/10 text-green-200", dot: "bg-green-300" },
  onboarding_completed: { badge: "border-emerald-300/45 bg-emerald-400/15 text-emerald-100", dot: "bg-emerald-300" },
};

function getStageBadgeVisual(stage: string) {
  return STAGE_BADGE_VISUALS[stage as CandidateStage] ?? {
    badge: "border-white/15 bg-white/10 text-slate-200",
    dot: "bg-slate-300",
  };
}

type SourceTab = "all" | "direct_application" | "vendor" | "internal_hiring" | "lateral_hiring" | "employee_referral" | "blacklisted";

const FULL_CANDIDATE_DETAIL_ROLES = new Set<Role>(["super_admin", "admin", "hr", "ta"]);

function hasFullCandidateDetailAccess(user?: Pick<User, "role" | "roles"> | null): boolean {
  return hasAssignedRole(user, [...FULL_CANDIDATE_DETAIL_ROLES]);
}

function canOpenCandidateDetail(candidate: Record<string, unknown>, user?: Pick<User, "role" | "roles"> | null): boolean {
  if (typeof candidate.canOpenDetail === "boolean") return candidate.canOpenDetail;
  return hasAssignedRole(user, ["vendor", "employee_referrer"]) || hasFullCandidateDetailAccess(user);
}

const SOURCE_TABS: { key: SourceTab; label: string }[] = [
  { key: "all", label: "Overall" },
  { key: "direct_application", label: "Direct Application" },
  { key: "vendor", label: "Vendor" },
  { key: "internal_hiring", label: "Internal" },
  { key: "lateral_hiring", label: "Lateral" },
  { key: "employee_referral", label: "Employee Referral" },
  { key: "blacklisted", label: "Blacklisted" },
];

function daysSince(dateStr: string): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// Map any candidate stage to the PIPELINE_STAGES bucket key it belongs to, so in-between
// stages (e.g. resume_shortlisted, contract_signed) resolve to their journey step for
// progress highlighting and ordering instead of falling off the pipeline.
function normalizeStageForDisplay(stage: string): CandidateStage {
  const alias = DISPLAY_STAGE_ALIASES[stage as CandidateStage];
  if (alias) return alias;
  for (const [key, members] of Object.entries(JOURNEY_STAGE_GROUPS)) {
    if (members.includes(stage as CandidateStage)) return key as CandidateStage;
  }
  return stage as CandidateStage;
}

// Returns the pipeline display index (against PIPELINE_STAGES which has the merged Evaluation entry)
function pipelineStageIndex(stage: string): number {
  const normalized = normalizeStageForDisplay(stage);
  return PIPELINE_STAGES.findIndex((s) => s.key === normalized);
}

function stageFilterParam(stage?: string | null): string | undefined {
  if (!stage || stage === "all") return undefined;
  return (JOURNEY_STAGE_GROUPS[stage] ?? [stage as CandidateStage]).join(",");
}

// Journey cards count candidates cumulatively (everyone who has reached at least
// this stage), so drilling into a card must resolve to the same set: this stage's
// bucket plus every later bucket — not just whoever is parked here right now.
function cumulativeStageParam(stage?: string | null): string | undefined {
  if (!stage || stage === "all") return undefined;
  const startIndex = PIPELINE_STAGES.findIndex((s) => s.key === stage);
  if (startIndex < 0) return stageFilterParam(stage);
  const stages = PIPELINE_STAGES.slice(startIndex).flatMap((s) => JOURNEY_STAGE_GROUPS[s.key] ?? [s.key]);
  return stages.length ? stages.join(",") : undefined;
}

// "Done" for a stage = candidates who completed it and moved to a LATER bucket.
// The final bucket (Onboarded) has no later bucket: being parked there IS done.
function doneStageParam(stage?: string | null): string | undefined {
  if (!stage || stage === "all") return undefined;
  const index = PIPELINE_STAGES.findIndex((s) => s.key === stage);
  if (index < 0) return stageFilterParam(stage);
  if (index === PIPELINE_STAGES.length - 1) return stageFilterParam(stage);
  return cumulativeStageParam(PIPELINE_STAGES[index + 1].key);
}

function dateRangeLabel(fromDate: string, toDate: string): string {
  if (!fromDate && !toDate) {
    return formatCurrentDateLabel({ day: "2-digit", month: "short", year: "numeric" });
  }
  const format = (value: string) =>
    new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: APP_TIME_ZONE,
    }).format(new Date(`${value}T00:00:00Z`));
  if (fromDate && toDate) return `${format(fromDate)} - ${format(toDate)}`;
  if (fromDate) return `From ${format(fromDate)}`;
  return `To ${format(toDate)}`;
}

function urgencyClass(days: number, stage: string): "green" | "yellow" | "red" {
  const rejected = ["resume_rejected", "evaluation_failed"].includes(stage);
  if (rejected) return "red";
  if (days <= 3) return "green";
  if (days <= 7) return "yellow";
  return "red";
}

function exportCandidatesCSV(candidates: Record<string, unknown>[]) {
  if (!candidates.length) { toast.error("No candidate data to export."); return; }
  const headers = ["Name", "Email", "Candidate Code", "Employee Code", "Source", "Position", "Stage", "Status", "Priority", "Days", "Created"];
  const rows = candidates.map((c) => [
    String(c.fullName ?? ""), String(c.personalEmail ?? ""), String(c.candidateCode ?? ""), String(c.employeeCode ?? ""),
    SOURCE_LABELS[String(c.sourceType ?? "") as SourceType] ?? formatLabel(String(c.sourceType ?? "")),
    String((c.position as Record<string, unknown>)?.title ?? ""),
    STAGE_LABELS[c.currentStage as CandidateStage] ?? formatLabel(String(c.currentStage ?? "")),
    String(c.currentStatus ?? ""), String(c.priorityScore ?? ""),
    String(daysSince(String(c.createdAt ?? ""))),
    c.createdAt ? new Date(String(c.createdAt)).toLocaleDateString("en-IN") : "",
  ]);
  const csv = [headers, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `candidates_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Exported ${candidates.length} candidates.`);
}

function MiniProgressBar({ currentStage }: { currentStage: string }) {
  const idx = pipelineStageIndex(currentStage);
  const total = PIPELINE_STAGES.length;
  const current = Math.min(Math.max(idx + 1, 0), total);
  const currentLabel = idx >= 0 ? PIPELINE_STAGES[idx]?.label : undefined;
  return (
    <div
      className="flex items-center gap-2"
      title={currentLabel ? `Stage ${current}/${total}: ${currentLabel}` : `Stage ${current}/${total}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-0.5">
        {PIPELINE_STAGES.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-2 flex-1 rounded-full transition-all",
              i < idx ? "bg-primary" : i === idx ? "bg-primary/70" : "bg-muted"
            )}
          />
        ))}
      </div>
      <span className="shrink-0 text-[10px] font-semibold tabular-nums text-muted-foreground">
        {current}/{total}
      </span>
    </div>
  );
}

type CandidateDetailPanelProps = {
  candidate: Record<string, unknown>;
  onClose: () => void;
  canEditName?: boolean;
  onEditName?: (candidate: Record<string, unknown>) => void;
};

function CandidateDetailPanel({ candidate, onClose, canEditName = false, onEditName }: CandidateDetailPanelProps) {
  const [activeSection, setActiveSection] = useState<"overview" | "timeline">("overview");
  const id = String(candidate.id ?? "");

  // Lock background scroll while the detail panel is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  const currentStage = String(candidate.currentStage ?? "");
  const days = daysSince(String(candidate.createdAt ?? ""));
  const urg = urgencyClass(days, currentStage);

  const sections = ["overview", "timeline"] as const;

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start overflow-hidden"
      onClick={onClose}
    >
      <div className="hidden flex-1 sm:block" />
      <div
        className="h-[100dvh] w-full max-w-md shadow-2xl flex flex-col overflow-hidden"
        style={{
          background: "rgba(11,11,18,0.99)",
          backdropFilter: "blur(28px)",
          borderLeft: "1px solid rgba(144,141,206,0.18)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid rgba(144,141,206,0.14)" }}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback
                className="text-sm font-bold"
                style={{ background: "rgba(237,0,237,0.15)", color: "#ED00ED" }}
              >
                {getInitials(String(candidate.fullName ?? ""))}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-semibold" style={{ color: "#C5CBE8" }}>{String(candidate.fullName ?? "")}</p>
              <p className="truncate text-xs" style={{ color: "rgba(197,203,232,0.50)" }}>{String(candidate.candidateCode ?? "")}</p>
              {Boolean(candidate.employeeCode) && (
                <p className="truncate font-mono text-[10px]" style={{ color: "rgba(197,203,232,0.42)" }}>{String(candidate.employeeCode)}</p>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {canEditName && (
              <button
                onClick={() => onEditName?.(candidate)}
                className="rounded-lg p-1.5 transition-colors hover:bg-white/10"
                aria-label="Edit candidate name"
              >
                <Pencil className="h-4 w-4" style={{ color: "rgba(197,203,232,0.60)" }} />
              </button>
            )}
            <button onClick={onClose} className="rounded-lg p-1.5 transition-colors hover:bg-white/10">
              <X className="h-4 w-4" style={{ color: "rgba(197,203,232,0.50)" }} />
            </button>
          </div>
        </div>

        <div
          className="flex gap-1 overflow-x-auto px-3 pt-3 shrink-0 sm:px-5"
          style={{ borderBottom: "1px solid rgba(144,141,206,0.10)" }}
        >
          {sections.map((s) => (
            <button
              key={s}
              onClick={() => setActiveSection(s)}
              className={cn(
                "shrink-0 px-3 py-1.5 text-xs font-medium capitalize rounded-t-lg border-b-2 transition-colors",
                activeSection === s
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="space-y-5 p-4 sm:p-5">
            {activeSection === "overview" && (
              <>
                <div
                  className="rounded-xl p-4 space-y-3"
                  style={{ background: "rgba(144,141,206,0.06)", border: "1px solid rgba(144,141,206,0.12)" }}
                >
                  <div className="grid grid-cols-1 gap-3 text-sm min-[380px]:grid-cols-2">
                    <InfoRow label="Position" value={String((candidate.position as Record<string, unknown>)?.title ?? "—")} />
                    <InfoRow label="Employee Code" value={String(candidate.employeeCode ?? "—")} />
                    <InfoRow label="Source" value={SOURCE_LABELS[String(candidate.sourceType ?? "") as SourceType] ?? formatLabel(String(candidate.sourceType ?? "—"))} />
                    <InfoRow label="Applied" value={candidate.createdAt ? timeAgo(String(candidate.createdAt)) : "—"} />
                    <InfoRow label="Last Updated" value={candidate.updatedAt ? timeAgo(String(candidate.updatedAt)) : "—"} />
                    <InfoRow label="Days in Stage" value={`${days}d`} />
                    <InfoRow
                      label="Status"
                      value={
                        <span className={cn(
                          "text-xs font-semibold px-1.5 py-0.5 rounded-full",
                          urg === "green" ? "text-emerald-400 bg-emerald-400/10" :
                          urg === "yellow" ? "text-amber-400 bg-amber-400/10" :
                          "text-red-400 bg-red-400/10"
                        )}>
                          {urg === "green" ? "On Track" : urg === "yellow" ? "At Risk" : "Overdue"}
                        </span>
                      }
                    />
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "rgba(197,203,232,0.40)" }}>Pipeline Progress</p>
                  <div className="space-y-2">
                    {PIPELINE_STAGES.map((s, i) => {
                      const cur = pipelineStageIndex(currentStage);
                      const sIdx = pipelineStageIndex(s.key);
                      const isDone = cur >= 0 && sIdx < cur;
                      const isActive = cur >= 0 && sIdx === cur;
                      return (
                        <div key={s.key} className="flex min-w-0 items-center gap-3">
                          <div className={cn(
                            "h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-[9px] font-bold",
                            isDone ? "bg-primary text-white" :
                            isActive ? "border-2 border-primary text-primary" :
                            "border border-border text-muted-foreground"
                          )}>
                            {isDone ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                          </div>
                          <p className={cn(
                            "min-w-0 break-words text-xs",
                            isActive ? "text-primary font-semibold" :
                            isDone ? "text-muted-foreground" : "text-muted-foreground"
                          )}>
                            {s.label}
                          </p>
                          {isActive && (
                            <span className="ml-auto text-[10px] font-medium" style={{ color: "rgba(197,203,232,0.40)" }}>{days}d</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              </>
            )}

            {activeSection === "timeline" && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "rgba(197,203,232,0.40)" }}>Stage Timeline</p>
                <div className="space-y-3">
                  {PIPELINE_STAGES.map((s, i) => {
                    const cur = pipelineStageIndex(currentStage);
                    const sIdx = pipelineStageIndex(s.key);
                    const isDone = cur >= 0 && sIdx <= cur;
                    const isCurrentEntry = cur >= 0 && sIdx === cur;
                    return (
                      <div key={s.key} className="flex items-start gap-3">
                        <div className="flex flex-col items-center">
                          <div className={cn(
                            "h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-[9px]",
                            isDone ? "bg-primary" : "border border-border"
                          )}>
                            {isDone ? <CheckCircle2 className="h-3 w-3 text-white" /> : (
                              <span className="text-muted-foreground">{i + 1}</span>
                            )}
                          </div>
                          {i < PIPELINE_STAGES.length - 1 && (
                            <div className={cn("w-px mt-1 h-5", isDone ? "bg-primary/40" : "bg-border")} />
                          )}
                        </div>
                        <div className="pb-3">
                          <p className={cn("text-xs font-medium", isDone ? "text-foreground" : "text-muted-foreground")}>{s.label}</p>
                          {isCurrentEntry && (
                            <p className="text-[10px] text-primary mt-0.5">Current · {days}d</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        </ScrollArea>

        <div className="px-5 py-4 shrink-0" style={{ borderTop: "1px solid rgba(144,141,206,0.14)" }}>
          <Link href={`/dashboard/candidates/${id}`}>
            <Button className="w-full rounded-xl text-xs gap-1.5">
              <Eye className="h-3.5 w-3.5" /> Open Full Profile
            </Button>
          </Link>
        </div>
      </div>
    </div>,
    document.body
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide" style={{ color: "rgba(197,203,232,0.40)" }}>{label}</p>
      <div className="mt-0.5 text-xs font-medium" style={{ color: "#C5CBE8" }}>{value}</div>
    </div>
  );
}

const VALID_SOURCE_TABS = new Set<string>(["all", "direct_application", "vendor", "internal_hiring", "lateral_hiring", "employee_referral", "blacklisted"]);

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatCardCount(value: number) {
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return safeValue >= 1000 ? COMPACT_NUMBER_FORMATTER.format(safeValue) : String(safeValue);
}

export default function CandidatesListPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { user } = useAuth();
  const canManageCandidates = hasFullCandidateDetailAccess(user);
  const isVendor = user?.role === "vendor" && !canManageCandidates;
  const canEditCandidateName = hasAssignedRole(user, ["super_admin", "admin", "hr"]);
  const canBackfillEmployeeCodes = canEditCandidateName;
  const canSubmitCandidate = canManageCandidates || hasAssignedRole(user, ["vendor", "employee_referrer"]);
  const searchParams = useSearchParams();
  const candidateListRef = useRef<HTMLDivElement | null>(null);
  const bulkBypassInputRef = useRef<HTMLInputElement | null>(null);

  const initialTab = (): SourceTab => {
    const tab = searchParams.get("tab") ?? "";
    return VALID_SOURCE_TABS.has(tab) ? (tab as SourceTab) : "all";
  };

  const [activeTab, setActiveTab] = useState<SourceTab>(initialTab);
  const [viewTab, setViewTab] = useState<"all" | "my_actions" | "overdue" | "escalated" | "following">("all");
  const [journeyStageFilter, setJourneyStageFilter] = useState<string | null>(null);
  // When a journey card is selected, the list below splits into the members still
  // pending AT the stage, the ones done with it (moved to a later stage), or the
  // full historical set who ever reached it.
  const [journeySegment, setJourneySegment] = useState<"pending" | "done" | "all">("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [vendorFilter, setVendorFilter] = useState("all");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [dateDialogOpen, setDateDialogOpen] = useState(false);
  const [draftCreatedFrom, setDraftCreatedFrom] = useState("");
  const [draftCreatedTo, setDraftCreatedTo] = useState("");
  const [sortBy] = useState<"createdAt" | "fullName" | "priorityScore">("createdAt");
  const [sortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const perPage = 10;
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [blacklistId, setBlacklistId] = useState<string | null>(null);
  const [blacklistReason, setBlacklistReason] = useState("");
  const [acting, setActing] = useState<string | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Record<string, unknown> | null>(null);
  const [nameEditCandidate, setNameEditCandidate] = useState<Record<string, unknown> | null>(null);
  const [nameEditValue, setNameEditValue] = useState("");
  const [isSavingName, setIsSavingName] = useState(false);
  const [isBackfillingEmployeeCodes, setIsBackfillingEmployeeCodes] = useState(false);
  const [bulkBypassOpen, setBulkBypassOpen] = useState(false);
  const [bulkBypassFile, setBulkBypassFile] = useState<File | null>(null);
  const [bulkBypassResult, setBulkBypassResult] = useState<ApBulkAssessmentBypassResult | null>(null);
  const [isBulkBypassing, setIsBulkBypassing] = useState(false);
  const [escalatedIds, setEscalatedIds] = useState<Set<string>>(new Set());

  const { data: positionsData } = usePositions();
  const positions = Array.isArray(positionsData) ? positionsData : positionsData?.data ?? [];
  const positionOptions = (positions as { id: string; title: string; department?: string }[]).map((p) => ({
    value: p.id,
    label: `${p.title}${p.department ? ` · ${p.department}` : ""}`,
  }));
  const selectedPositionLabel = positionFilter === "all"
    ? "All Roles"
    : positionOptions.find((position) => position.value === positionFilter)?.label ?? "Job Title";
  const selectedStageLabel = stageFilter === "all"
    ? "All Stages"
    : PIPELINE_STAGES.find((stage) => stage.key === stageFilter)?.label
      ?? STAGE_LABELS[stageFilter as CandidateStage]
      ?? "Stage";

  const effectiveTab: SourceTab = isVendor ? "vendor" : activeTab;
  const visibleTabs = isVendor ? [{ key: "vendor" as SourceTab, label: "My Candidates" }] : SOURCE_TABS;

  const effectiveStage = journeyStageFilter ?? (stageFilter !== "all" ? stageFilter : undefined);
  // A journey-card selection resolves to the segment the user picked: "pending" = parked
  // at this stage bucket right now, "done" = completed it (at a later bucket), "all" =
  // everyone who ever reached the stage (past + present). The standalone stage dropdown
  // still filters to that exact stage bucket.
  const effectiveStageParam = journeyStageFilter
    ? (journeySegment === "pending"
        ? stageFilterParam(journeyStageFilter)
        : journeySegment === "done"
          ? doneStageParam(journeyStageFilter)
          : cumulativeStageParam(journeyStageFilter))
    : stageFilterParam(effectiveStage);

  const dateFilterParams = {
    createdFrom: createdFrom || undefined,
    createdTo: createdTo || undefined,
  };
  const selectedDateLabel = dateRangeLabel(createdFrom, createdTo);

  const queryParams: CandidateFilters = effectiveTab === "blacklisted"
    ? { search: searchQuery || undefined, blacklisted: true, page, limit: perPage, sortBy, sortDir, ...dateFilterParams }
    : {
        search: searchQuery || undefined,
        // The "Overall" tab aggregates every source, so it sends no sourceType.
        sourceType: effectiveTab === "all" ? undefined : effectiveTab,
        stage: effectiveStageParam,
        positionId: positionFilter !== "all" ? positionFilter : undefined,
        ...dateFilterParams,
        page,
        limit: perPage,
        sortBy,
        sortDir,
      };

  const { data: apiData, isLoading } = useCandidates(queryParams);
  const allCandidates = apiData?.data ?? [];
  const total = apiData?.total ?? 0;
  const totalPages = apiData?.totalPages ?? 1;

  const rawCandidates = allCandidates;

  const afterVendorFilter = effectiveTab === "vendor" && vendorFilter !== "all" && !isVendor
    ? rawCandidates.filter((c: Record<string, unknown>) => String(c.vendorId ?? "") === vendorFilter)
    : rawCandidates;

  const paginated = useMemo(() => {
    let list = afterVendorFilter as Record<string, unknown>[];
    if (viewTab === "overdue") list = list.filter((c) => daysSince(String(c.createdAt ?? "")) > 7);
    if (viewTab === "escalated") list = list.filter((c) => escalatedIds.has(String(c.id ?? "")));
    return list;
  }, [afterVendorFilter, viewTab, escalatedIds]);

  const { data: allForJourney } = useCandidates({
    sourceType: effectiveTab === "blacklisted" || effectiveTab === "all" ? undefined : effectiveTab,
    positionId: positionFilter !== "all" ? positionFilter : undefined,
    blacklisted: effectiveTab === "blacklisted" ? true : undefined,
    ...dateFilterParams,
    // High cap so old records (the onboarded cohort is the oldest) are never cut off the
    // funnel by pagination — the journey must count every candidate, not the newest page.
    limit: 2000,
  });
  const { data: convertedForCount, isLoading: isConvertedCountLoading } = useCandidates({
    sourceType: effectiveTab === "blacklisted" || effectiveTab === "all" ? undefined : effectiveTab,
    positionId: positionFilter !== "all" ? positionFilter : undefined,
    blacklisted: effectiveTab === "blacklisted" ? true : undefined,
    ...dateFilterParams,
    stage: "onboarding_completed",
    page: 1,
    limit: 1,
  });
  const journeyCandidates = useMemo(() => allForJourney?.data ?? [], [allForJourney?.data]);
  const journeyTotal = allForJourney?.total ?? journeyCandidates.length;

  const journeyStageMap = useMemo(() => {
    const map: Record<string, { count: number; pending: number; done: number; avgDays: number }> = {};
    // Cumulative funnel: a candidate that reached a given stage necessarily passed every
    // earlier one (the pipeline gates bucket-by-bucket). Per card: `pending` = parked at
    // the stage right now, `done` = completed it (moved to a later bucket; for the final
    // Onboarded bucket being there IS done), `count` = everyone who reached the stage.
    const reached = (journeyCandidates as Record<string, unknown>[]).map((c) => ({
      index: pipelineStageIndex(String(c.currentStage ?? "")),
      days: daysSince(String(c.createdAt ?? "")),
    }));
    const lastIndex = PIPELINE_STAGES.length - 1;
    PIPELINE_STAGES.forEach((s, i) => {
      const passed = reached.filter((r) => r.index >= i);
      const atStage = reached.filter((r) => r.index === i).length;
      const avgDays = passed.length > 0
        ? Math.round(passed.reduce((sum, r) => sum + r.days, 0) / passed.length)
        : 0;
      map[s.key] = {
        count: passed.length,
        pending: i === lastIndex ? 0 : atStage,
        done: i === lastIndex ? atStage : passed.length - atStage,
        avgDays,
      };
    });
    return map;
  }, [journeyCandidates]);

  const journeyPeakCount = useMemo(
    () => Math.max(1, ...PIPELINE_STAGES.map((stage) => journeyStageMap[stage.key]?.count ?? 0)),
    [journeyStageMap]
  );
  const convertedTotal = convertedForCount?.total ?? journeyStageMap.onboarding_completed?.count ?? 0;
  const isConvertedView = effectiveStageParam === "onboarding_completed";

  useEffect(() => {
    escalationsApi.list({ status: "open" }).then((data) => {
      const arr = Array.isArray(data) ? data : [];
      const ids = new Set<string>();
      arr.forEach((e: { candidateId?: string }) => { if (e.candidateId) ids.add(e.candidateId); });
      setEscalatedIds(ids);
    }).catch(() => {});
  }, []);

  const kpis = useMemo(() => {
    const all = journeyCandidates as Record<string, unknown>[];
    const active = all.filter((c) => !["resume_rejected", "evaluation_failed"].includes(String(c.currentStage ?? ""))).length;
    const evalPending = all.filter((c) => ["evaluation_assigned", "evaluation_in_progress"].includes(String(c.currentStage ?? ""))).length;
    const offersSent = all.filter((c) => ["selection_form_sent", "selection_form_validated"].includes(String(c.currentStage ?? ""))).length;
    const escalated = escalatedIds.size;
    const piScheduled = all.filter((c) => c.currentStage === "selection_form_sent").length;
    return { total: all.length, active, evalPending, offersSent, escalated, piScheduled, converted: convertedTotal };
  }, [journeyCandidates, escalatedIds, convertedTotal]);

  const scrollToCandidateList = useCallback(() => {
    window.setTimeout(() => {
      candidateListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, []);

  const handleKpiClick = useCallback((target: "total" | "active" | "eval" | "offers" | "converted" | "escalated" | "pi") => {
    setPage(1);
    if (target !== "escalated") setViewTab("all");
    if (target === "eval") {
      setStageFilter("all");
      setJourneyStageFilter("evaluation_assigned");
      setJourneySegment("pending");
    } else if (target === "offers" || target === "pi") {
      setStageFilter("all");
      setJourneyStageFilter("selection_form_sent");
      setJourneySegment("pending");
    } else if (target === "converted") {
      if (!isVendor) setActiveTab("all");
      setStageFilter("all");
      setJourneyStageFilter("onboarding_completed");
      setJourneySegment("all");
    } else {
      setStageFilter("all");
      setJourneyStageFilter(null);
    }
    if (target === "escalated") {
      setViewTab("escalated");
      setStageFilter("all");
      setJourneyStageFilter(null);
    }
    scrollToCandidateList();
  }, [isVendor, scrollToCandidateList]);

  const openDateDialog = useCallback(() => {
    setDraftCreatedFrom(createdFrom);
    setDraftCreatedTo(createdTo);
    setDateDialogOpen(true);
  }, [createdFrom, createdTo]);

  const applyDateRange = useCallback(() => {
    if (draftCreatedFrom && draftCreatedTo && draftCreatedTo < draftCreatedFrom) {
      toast.error("To date must be on or after From date.");
      return;
    }
    setCreatedFrom(draftCreatedFrom);
    setCreatedTo(draftCreatedTo);
    setPage(1);
    setDateDialogOpen(false);
  }, [draftCreatedFrom, draftCreatedTo]);

  const clearDateRange = useCallback(() => {
    setDraftCreatedFrom("");
    setDraftCreatedTo("");
    setCreatedFrom("");
    setCreatedTo("");
    setPage(1);
    setDateDialogOpen(false);
  }, []);

  const openNameEdit = useCallback((candidate: Record<string, unknown>) => {
    setNameEditCandidate(candidate);
    setNameEditValue(String(candidate.fullName ?? ""));
  }, []);

  const vendorOptions = Array.from(
    new Map(
      (allCandidates as Record<string, unknown>[])
        .filter((c) => c.vendorId && c.vendor)
        .map((c) => [String(c.vendorId), String((c.vendor as Record<string, unknown>)?.name ?? c.vendorId)])
    ).entries()
  ).map(([value, label]) => ({ value, label }));
  const selectedVendorLabel = vendorFilter === "all"
    ? "All Vendors"
    : vendorOptions.find((vendor) => vendor.value === vendorFilter)?.label ?? "Vendor";

  const handleHold = async (id: string, name: string) => {
    setActing(id);
    try {
      await candidatesApi.update(id, { currentStatus: "On Hold", priorityScore: 0 });
      toast.success(`${name} placed on hold.`);
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch { toast.error("Failed to update candidate status."); }
    finally { setActing(null); }
  };

  const handleRemove = async (id: string, name: string) => {
    setActing(id);
    try {
      await candidatesApi.remove(id);
      toast.success(`${name} removed from pipeline.`);
      setConfirmRemoveId(null);
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch { toast.error("Failed to remove candidate."); }
    finally { setActing(null); }
  };

  const handleBlacklist = async (id: string, name: string) => {
    if (!blacklistReason.trim()) { toast.error("Please provide a reason."); return; }
    setActing(id);
    try {
      await candidatesApi.update(id, { currentStatus: "Blacklisted", isReapplicationBlocked: true, blacklistReason: blacklistReason.trim() });
      toast.success(`${name} blacklisted.`);
      setBlacklistId(null);
      setBlacklistReason("");
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch { toast.error("Failed to blacklist candidate."); }
    finally { setActing(null); }
  };

  const handleUnblacklist = async (id: string, name: string) => {
    setActing(id);
    try {
      await candidatesApi.update(id, { isReapplicationBlocked: false });
      toast.success(`${name} removed from blacklist.`);
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch {
      toast.error("Failed to remove candidate from blacklist.");
    } finally {
      setActing(null);
    }
  };

  const handleSaveCandidateName = async () => {
    if (!nameEditCandidate) return;
    const candidateId = String(nameEditCandidate.id ?? "");
    const nextName = nameEditValue.trim();
    if (!candidateId) {
      toast.error("Candidate record is missing an id.");
      return;
    }
    if (!nextName) {
      toast.error("Please enter the member name.");
      return;
    }
    setIsSavingName(true);
    try {
      await candidatesApi.update(candidateId, { fullName: nextName });
      toast.success("Member name updated.");
      setSelectedCandidate((current) => (
        current && String(current.id ?? "") === candidateId
          ? { ...current, fullName: nextName }
          : current
      ));
      setNameEditCandidate(null);
      setNameEditValue("");
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch {
      toast.error("Failed to update member name.");
    } finally {
      setIsSavingName(false);
    }
  };

  const handleExport = useCallback(async () => {
    toast.info("Preparing export…");
    try {
      // Server-side export — includes signed, openable links to each candidate's
      // uploaded documents (resume, Aadhaar, others).
      const blob = await candidatesApi.exportCsv({
        sourceType: effectiveTab !== "blacklisted" && effectiveTab !== "all" ? effectiveTab : undefined,
        stage: stageFilterParam(stageFilter),
        positionId: positionFilter !== "all" ? positionFilter : undefined,
        createdFrom: createdFrom || undefined,
        createdTo: createdTo || undefined,
        blacklisted: effectiveTab === "blacklisted" ? true : undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `candidates_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Export ready — document links open directly.");
    } catch {
      // Fall back to the client-side export (no document links) if the server
      // export is unavailable.
      try {
        const result = await candidatesApi.list({
          sourceType: effectiveTab !== "blacklisted" && effectiveTab !== "all" ? effectiveTab : undefined,
          stage: stageFilterParam(stageFilter),
          positionId: positionFilter !== "all" ? positionFilter : undefined,
          createdFrom: createdFrom || undefined,
          createdTo: createdTo || undefined,
          blacklisted: effectiveTab === "blacklisted" ? true : undefined,
          limit: 2000,
          sortBy,
          sortDir,
        });
        exportCandidatesCSV(result.data ?? []);
      } catch { toast.error("Export failed."); }
    }
  }, [createdFrom, createdTo, effectiveTab, positionFilter, sortBy, sortDir, stageFilter]);

  const handleBackfillEmployeeCodes = useCallback(async () => {
    setIsBackfillingEmployeeCodes(true);
    try {
      const result = await candidatesApi.backfillSignedEmployeeCodes();
      toast.success(result.message);
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (error) {
      const apiError = error as { response?: { data?: { detail?: string } } };
      toast.error(apiError.response?.data?.detail || "Could not sync employee codes.");
    } finally {
      setIsBackfillingEmployeeCodes(false);
    }
  }, [qc]);

  const handleBulkBypassUpload = useCallback(async () => {
    if (!bulkBypassFile) {
      toast.error("Choose a CSV file first.");
      return;
    }
    setIsBulkBypassing(true);
    try {
      const result = await assessmentPlatformApi.bulkBypassCandidates(bulkBypassFile);
      setBulkBypassResult(result);
      toast.success(`${result.advanced} candidates moved to Selection Form.`);
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (error) {
      const apiError = error as { response?: { data?: { detail?: unknown } } };
      const detail = apiError.response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Bulk bypass failed.");
    } finally {
      setIsBulkBypassing(false);
    }
  }, [bulkBypassFile, qc]);

  return (
    <div className="min-w-0 max-w-full space-y-5 overflow-x-hidden animate-fade-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start justify-between gap-3 sm:block">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#C5CBE8" }}>
              {isVendor ? "My Candidates" : "Candidates"}
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "rgba(197,203,232,0.50)" }}>
              Operational hiring pipeline · {total} total
            </p>
          </div>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 shrink-0 rounded-full sm:hidden"
                  aria-label="Candidate actions"
                />
              }
            >
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl">
              <DropdownMenuItem className="gap-2 text-xs" onClick={handleExport}>
                <Download className="h-3.5 w-3.5" /> Export CSV
              </DropdownMenuItem>
              {canBackfillEmployeeCodes && (
                <DropdownMenuItem
                  className="gap-2 text-xs"
                  onClick={() => void handleBackfillEmployeeCodes()}
                  disabled={isBackfillingEmployeeCodes}
                >
                  {isBackfillingEmployeeCodes ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sync Codes
                </DropdownMenuItem>
              )}
              {canManageCandidates && (
                <DropdownMenuItem className="gap-2 text-xs" onClick={() => setBulkBypassOpen(true)}>
                  <Upload className="h-3.5 w-3.5" /> Bulk Bypass
                </DropdownMenuItem>
              )}
              {!isVendor && (
                <DropdownMenuItem className="gap-2 text-xs" onClick={openDateDialog}>
                  <CalendarDays className="h-3.5 w-3.5" />
                  {selectedDateLabel}
                </DropdownMenuItem>
              )}
              {canSubmitCandidate && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="gap-2 text-xs" onClick={() => router.push("/dashboard/candidates/new")}>
                    <Plus className="h-3.5 w-3.5" /> {isVendor ? "Submit Candidate" : "Add Candidate"}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="hidden w-full flex-col gap-2 min-[420px]:flex-row min-[420px]:flex-wrap sm:flex sm:w-auto sm:items-center">
          <Button variant="outline" size="sm" className="w-full rounded-xl text-xs gap-1.5 min-[420px]:w-auto" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
          {canBackfillEmployeeCodes && (
            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-xl text-xs gap-1.5 min-[420px]:w-auto"
              onClick={() => void handleBackfillEmployeeCodes()}
              disabled={isBackfillingEmployeeCodes}
            >
              {isBackfillingEmployeeCodes ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Sync Codes
            </Button>
          )}
          {canManageCandidates && (
            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-xl text-xs gap-1.5 min-[420px]:w-auto"
              onClick={() => setBulkBypassOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" />
              Bulk Bypass
            </Button>
          )}
          {!isVendor && (
            <Button variant="outline" size="sm" className="w-full rounded-xl text-xs gap-1.5 min-[420px]:w-auto" onClick={openDateDialog}>
              <CalendarDays className="h-3.5 w-3.5" />
              {selectedDateLabel}
            </Button>
          )}
          {canSubmitCandidate && (
            <Link href="/dashboard/candidates/new" className="w-full min-[420px]:w-auto">
              <Button size="sm" className="w-full rounded-xl text-xs gap-1.5 min-[420px]:w-auto">
                <Plus className="h-3.5 w-3.5" /> {isVendor ? "Submit Candidate" : "Add Candidate"}
              </Button>
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 xl:grid-cols-7">
        {[
          { label: "Total", value: kpis.total, icon: Users, color: "text-primary", bg: "bg-primary/10", target: "total" as const },
          { label: "Active", value: kpis.active, icon: UserCheck, color: "text-emerald-400", bg: "bg-emerald-400/10", target: "active" as const },
          { label: "Eval Pending", value: kpis.evalPending, icon: Clock, color: "text-amber-400", bg: "bg-amber-400/10", target: "eval" as const },
          { label: "Offers Sent", value: kpis.offersSent, icon: Send, color: "text-blue-400", bg: "bg-blue-400/10", target: "offers" as const },
          { label: "Converted", value: kpis.converted, icon: CheckCircle2, color: "text-cyan-300", bg: "bg-cyan-300/10", target: "converted" as const, loading: isConvertedCountLoading },
          { label: "Escalated", value: kpis.escalated, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-400/10", target: "escalated" as const },
          { label: "PI Scheduled", value: kpis.piScheduled, icon: TrendingUp, color: "text-purple-400", bg: "bg-purple-400/10", target: "pi" as const },
        ].map((k) => {
          const displayValue = (k.loading ?? isLoading) ? "—" : formatCardCount(Number(k.value ?? 0));
          return (
            <button
              type="button"
              key={k.label}
              onClick={() => handleKpiClick(k.target)}
              className="relative min-w-0 overflow-hidden rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
              aria-label={`Show ${k.label.toLowerCase()} candidates`}
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="whitespace-nowrap text-[10px] font-semibold" style={{ color: "rgba(197,203,232,0.45)" }}>{k.label}</p>
                  <p className="mt-1 truncate text-2xl font-bold tabular-nums" title={String(k.value)} style={{ color: "#C5CBE8" }}>{displayValue}</p>
                </div>
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-xl shrink-0", k.bg)}>
                  <k.icon className={cn("h-4 w-4", k.color)} />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
      >
        <div className="flex flex-col gap-3 px-5 pt-4 pb-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>Pipeline Journey</p>
            </div>
            <p className="text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>
              Done = completed the stage and moved ahead · Total = everyone who has ever reached it
              (past + present) · pending members are flagged on each stage. Click a card to list its
              pending, done, or all-time members.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {journeyStageFilter && (
              <Badge variant="outline" className="rounded-full border-primary/30 bg-primary/10 text-[10px] text-primary">
                Viewing: {PIPELINE_STAGES.find((stage) => stage.key === journeyStageFilter)?.label ?? STAGE_LABELS[journeyStageFilter as CandidateStage] ?? formatLabel(journeyStageFilter)}
              </Badge>
            )}
            <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 text-[10px]" style={{ color: "rgba(197,203,232,0.60)" }}>
              {journeyTotal > journeyCandidates.length
                ? `${journeyCandidates.length} of ${journeyTotal} in journey`
                : `${journeyTotal} in journey`}
            </Badge>
          </div>
        </div>

        <div className="px-4 pb-5 sm:px-5">
          <div className="flex gap-2.5 overflow-x-auto pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {PIPELINE_STAGES.map((stage, index) => {
              const info = journeyStageMap[stage.key] ?? { count: 0, pending: 0, done: 0, avgDays: 0 };
              const isActive = journeyStageFilter === stage.key;
              const fillWidth = info.count > 0 ? Math.max((info.count / journeyPeakCount) * 100, 12) : 0;
              return (
                <button
                  key={stage.key}
                  onClick={() => {
                    setJourneyStageFilter(isActive ? null : stage.key);
                    // Land on the segment that has people in it: pending first (actionable),
                    // else done (e.g. the Onboarded card has no pending members).
                    setJourneySegment(info.pending > 0 ? "pending" : "done");
                    setPage(1);
                  }}
                  className={cn(
                    "group relative flex min-h-[138px] w-[10.75rem] shrink-0 flex-col overflow-hidden rounded-2xl border px-3.5 py-3 text-left transition-all xl:w-[11rem]",
                    isActive
                      ? "border-primary/40 bg-primary/10 shadow-[0_0_0_1px_rgba(237,0,237,0.14)]"
                      : "border-white/10 bg-white/[0.03] hover:border-primary/20 hover:bg-white/[0.05]"
                  )}
                >
                  <div
                    className="pointer-events-none absolute inset-0 opacity-80"
                    style={{
                      background: isActive
                        ? "radial-gradient(circle at top right, rgba(237,0,237,0.12) 0%, transparent 56%)"
                        : "radial-gradient(circle at top right, rgba(144,141,206,0.10) 0%, transparent 56%)",
                    }}
                  />
                  {/* Step label is pinned to the card corner so it sits at the exact same
                      spot on every card regardless of how wide the stage pill renders. */}
                  <span className="absolute right-3.5 top-3 z-10 whitespace-nowrap text-[10px]" style={{ color: isActive ? "#ED00ED" : "rgba(197,203,232,0.35)" }}>
                    Step {index + 1}
                  </span>
                  <div className="relative flex min-w-0 items-center pr-12">
                    <span
                      className={cn(
                        "min-w-0 truncate rounded-full px-2 py-0.5 text-[8px] font-semibold sm:text-[9px]",
                        isActive ? "bg-primary/15 text-primary" : "bg-white/5 text-muted-foreground"
                      )}
                    >
                      {stage.short}
                    </span>
                  </div>

                  <div className="relative mt-3">
                    <p className="text-xs font-semibold leading-snug" style={{ color: "#C5CBE8" }}>
                      {stage.label}
                    </p>
                    {info.pending > 0 ? (
                      <span className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        <Clock className="h-2.5 w-2.5" />
                        <span className="truncate">{formatCardCount(info.pending)} pending</span>
                      </span>
                    ) : (
                      <p className="mt-1 text-[10px]" style={{ color: "rgba(197,203,232,0.42)" }}>
                        No pending members
                      </p>
                    )}
                  </div>

                  <div className="relative mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.9fr)] gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[9px]" style={{ color: "rgba(197,203,232,0.34)" }}>
                        Done
                      </p>
                      <p className="mt-1 truncate text-xl font-bold leading-none tabular-nums" title={String(info.done)} style={{ color: isActive ? "#ED00ED" : "#C5CBE8" }}>
                        {formatCardCount(info.done)}
                      </p>
                    </div>
                    <div className="min-w-0 text-center">
                      <p className="truncate text-[9px]" style={{ color: "rgba(197,203,232,0.34)" }}>
                        Total
                      </p>
                      <p className="mt-1 truncate text-base font-semibold leading-none tabular-nums" title={String(info.count)} style={{ color: "#C5CBE8" }}>
                        {formatCardCount(info.count)}
                      </p>
                    </div>
                    <div className="min-w-0 text-right">
                      <p className="truncate text-[9px]" style={{ color: "rgba(197,203,232,0.34)" }}>
                        Avg. Days
                      </p>
                      <p className="mt-1 truncate text-base font-semibold leading-none tabular-nums" style={{ color: "#C5CBE8" }}>
                        {info.avgDays > 0 ? `${info.avgDays}d` : "—"}
                      </p>
                    </div>
                  </div>

                  <div className="relative mt-3">
                    <div className="h-1.5 rounded-full bg-white/5">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          isActive ? "bg-gradient-to-r from-fuchsia-500 to-violet-400" : "bg-gradient-to-r from-primary/70 to-sky-400/70"
                        )}
                        style={{ width: `${fillWidth}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {journeyStageFilter && (() => {
            const info = journeyStageMap[journeyStageFilter] ?? { count: 0, pending: 0, done: 0, avgDays: 0 };
            return (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setJourneySegment("pending"); setPage(1); }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                      journeySegment === "pending"
                        ? "border-amber-400/50 bg-amber-500/15 text-amber-300"
                        : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-amber-400/30"
                    )}
                  >
                    Pending at this stage ({info.pending})
                  </button>
                  <button
                    onClick={() => { setJourneySegment("done"); setPage(1); }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                      journeySegment === "done"
                        ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-300"
                        : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-emerald-400/30"
                    )}
                  >
                    Done / moved ahead ({info.done})
                  </button>
                  <button
                    onClick={() => { setJourneySegment("all"); setPage(1); }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                      journeySegment === "all"
                        ? "border-sky-400/50 bg-sky-500/15 text-sky-300"
                        : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-sky-400/30"
                    )}
                  >
                    All reached ({info.count})
                  </button>
                </div>
                <button
                  className="text-xs flex items-center gap-1 transition-colors"
                  style={{ color: "rgba(197,203,232,0.50)" }}
                  onClick={() => { setJourneyStageFilter(null); setPage(1); }}
                >
                  Clear filter <X className="h-3 w-3" />
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {!isVendor && (
        <div className="flex items-center gap-1 overflow-x-auto" style={{ borderBottom: "1px solid rgba(144,141,206,0.12)" }}>
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setPage(1); setSearchQuery(""); setStageFilter("all"); setPositionFilter("all"); setJourneyStageFilter(null); }}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0",
                effectiveTab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {t.key === "blacklisted" && <Badge variant="destructive" className="text-[9px] h-4 px-1.5">HR</Badge>}
            </button>
          ))}
        </div>
      )}

      <div
        ref={candidateListRef}
        className="rounded-2xl p-4"
        style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, code..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
              className="pl-9 h-9 rounded-xl text-sm"
            />
          </div>

          <Select value={positionFilter} onValueChange={(v) => { setPositionFilter(v ?? "all"); setPage(1); }}>
            <SelectTrigger className="h-9 w-full rounded-xl text-xs sm:min-w-56 sm:max-w-80">
              <SelectValue placeholder="Job Title">
                {(value) => {
                  if (!value) return "Job Title";
                  return selectedPositionLabel;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-[min(28rem,calc(100vw-2rem))]">
              <SelectItem value="all" label="All Roles">All Roles</SelectItem>
              {positionOptions.map((p) => <SelectItem key={p.value} value={p.value} label={p.label}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={stageFilter} onValueChange={(v) => { setStageFilter(v ?? "all"); setJourneyStageFilter(null); setPage(1); }}>
            <SelectTrigger className="h-9 w-full rounded-xl text-xs sm:min-w-44 sm:max-w-56">
              <SelectValue placeholder="Stage">
                {(value) => {
                  if (!value) return "Stage";
                  return selectedStageLabel;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-[min(18rem,calc(100vw-2rem))]">
              <SelectItem value="all" label="All Stages">All Stages</SelectItem>
              {PIPELINE_STAGES.map((s) => <SelectItem key={s.key} value={s.key} label={s.label}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>

          {effectiveTab === "vendor" && !isVendor && (
            <Select value={vendorFilter} onValueChange={(v) => { setVendorFilter(v ?? "all"); setPage(1); }}>
              <SelectTrigger className="w-full sm:w-36 h-9 rounded-xl text-xs">
                <SelectValue placeholder="Vendor">
                  {(value) => {
                    if (!value) return "Vendor";
                    return selectedVendorLabel;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="w-[min(22rem,calc(100vw-2rem))]">
                <SelectItem value="all" label="All Vendors">All Vendors</SelectItem>
                {vendorOptions.map((v) => <SelectItem key={v.value} value={v.value} label={v.label}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          <div className="flex w-full items-center justify-start gap-1 sm:ml-auto sm:w-auto sm:justify-end">
            <Tabs value={viewTab} onValueChange={(v) => setViewTab(v as typeof viewTab)}>
              <TabsList className="h-8 rounded-xl">
                <TabsTrigger value="all" className="text-xs px-2 rounded-lg">All</TabsTrigger>
                <TabsTrigger value="overdue" className="text-xs px-2 rounded-lg">Overdue</TabsTrigger>
                <TabsTrigger value="escalated" className="text-xs px-2 rounded-lg">Escalated</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {isConvertedView && (
            <div className="flex w-full min-w-0 items-center">
              <Badge variant="outline" className="gap-1.5 rounded-full border-cyan-300/30 bg-cyan-300/10 text-[11px] text-cyan-200">
                <CheckCircle2 className="h-3 w-3" />
                Converted to employees · {total} {total === 1 ? "member" : "members"}
              </Badge>
            </div>
          )}
        </div>
      </div>

      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
      >
        <div className="block p-3 sm:hidden">
          {isLoading ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
              <p className="text-sm">Loading candidates...</p>
            </div>
          ) : paginated.length === 0 ? (
            <div className="flex min-h-40 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <Users className="h-10 w-10 opacity-20" />
              <p className="font-medium">No candidates found</p>
              <p className="text-xs">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="space-y-3">
              {paginated.map((c: Record<string, unknown>) => {
                const days = daysSince(String(c.createdAt ?? ""));
                const urg = urgencyClass(days, String(c.currentStage ?? ""));
                const isEscalated = escalatedIds.has(String(c.id ?? ""));
                const isConverted = String(c.currentStage ?? "") === "onboarding_completed";
                const resumeScore = Number(c.resumeScore ?? 0);
                const evaluator = (c.evaluations as { evaluator?: { name: string }; completedAt?: string }[] | undefined)
                  ?.find((e) => !e.completedAt)?.evaluator?.name
                  ?? (c.evaluator as { name?: string } | undefined)?.name;
                const stageKey = String(c.currentStage ?? "");
                const stageLabel = STAGE_LABELS[stageKey as CandidateStage] ?? formatLabel(stageKey);
                const stageVisual = getStageBadgeVisual(stageKey);
                const roleLabel = String((c.position as Record<string, unknown>)?.title ?? c.positionTitle ?? "—");
                const canOpen = canOpenCandidateDetail(c, user);

                return (
                  <button
                    key={String(c.id)}
                    type="button"
                    disabled={!canOpen}
                    className={cn(
                      "w-full rounded-xl p-3 text-left transition-colors disabled:cursor-default disabled:opacity-100",
                      canOpen && "hover:bg-white/[0.03]"
                    )}
                    style={{ background: "rgba(144,141,206,0.06)", border: "1px solid rgba(144,141,206,0.14)" }}
                    onClick={() => { if (canOpen) setSelectedCandidate(c); }}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="relative shrink-0">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback
                            className="text-xs font-bold"
                            style={{ background: "rgba(237,0,237,0.15)", color: "#ED00ED" }}
                          >
                            {getInitials(String(c.fullName ?? ""))}
                          </AvatarFallback>
                        </Avatar>
                        <div
                          className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2",
                            urg === "green" ? "bg-emerald-400" : urg === "yellow" ? "bg-amber-400" : "bg-red-400"
                          )}
                          style={{ borderColor: "rgba(11,11,18,0.99)" }}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <p className="min-w-0 break-words text-xs font-semibold" style={{ color: "#C5CBE8" }}>
                            {String(c.fullName ?? "")}
                          </p>
                          {Boolean(c.isDuplicate) && <Badge variant="destructive" className="h-4 px-1 text-[9px]">DUP</Badge>}
                          {isEscalated && <Badge variant="outline" className="h-4 px-1 text-[9px] text-red-400 border-red-400/30">!</Badge>}
                          {isConverted && (
                            <Badge variant="outline" className="h-4 gap-1 border-cyan-300/30 bg-cyan-300/10 px-1 text-[9px] text-cyan-200">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Employee
                            </Badge>
                          )}
                        </div>
                        <p className="break-all text-[10px]" style={{ color: "rgba(197,203,232,0.42)" }}>
                          {String(c.personalEmail ?? "")}
                        </p>
                        <p className="break-all font-mono text-[9px]" style={{ color: "rgba(197,203,232,0.32)" }}>
                          {String(c.candidateCode ?? "")}
                        </p>
                        {Boolean(c.employeeCode) && (
                          <p className="break-all font-mono text-[9px]" style={{ color: "rgba(197,203,232,0.42)" }}>
                            Employee ID: {String(c.employeeCode)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid min-w-0 grid-cols-1 gap-3">
                      <div className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.35)" }}>
                          Role
                        </p>
                        <p className="break-words text-xs font-medium" style={{ color: "#C5CBE8" }}>
                          {roleLabel}
                        </p>
                        <p className="break-words text-[10px]" style={{ color: "rgba(197,203,232,0.42)" }}>
                          {SOURCE_LABELS[String(c.sourceType ?? "") as SourceType] ?? formatLabel(String(c.sourceType ?? ""))}
                        </p>
                      </div>

                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold leading-tight",
                            stageVisual.badge
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stageVisual.dot)} />
                          <span className="min-w-0 break-words">{stageLabel}</span>
                        </span>
                        <span
                          className={cn(
                            "text-xs font-bold",
                            urg === "green" ? "text-emerald-400" : urg === "yellow" ? "text-amber-400" : "text-red-400"
                          )}
                        >
                          {days}d
                        </span>
                        <span className="text-[10px]" style={{ color: "rgba(197,203,232,0.40)" }}>
                          Score {resumeScore > 0 ? resumeScore : "—"}
                        </span>
                      </div>

                      <MiniProgressBar currentStage={String(c.currentStage ?? "")} />

                      {!isVendor && (
                        <p className="break-words text-[10px]" style={{ color: "rgba(197,203,232,0.48)" }}>
                          Evaluator: {evaluator ?? "—"}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(144,141,206,0.12)", background: "rgba(144,141,206,0.04)" }}>
                {["Candidate", "Role", "Stage", "Progress", "Days", "Score", !isVendor ? "Evaluator" : null, ""].filter(Boolean).map((h) => (
                  <th key={String(h)} className="py-3 px-4 text-left text-[11px] font-semibold uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.40)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                      <p className="text-sm">Loading candidates...</p>
                    </div>
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                      <Users className="h-10 w-10 opacity-20" />
                      <p className="font-medium">No candidates found</p>
                      <p className="text-xs">Try adjusting your filters</p>
                    </div>
                  </td>
                </tr>
              ) : paginated.map((c: Record<string, unknown>) => {
                const days = daysSince(String(c.createdAt ?? ""));
                const urg = urgencyClass(days, String(c.currentStage ?? ""));
                const isEscalated = escalatedIds.has(String(c.id ?? ""));
                const isConverted = String(c.currentStage ?? "") === "onboarding_completed";
                const resumeScore = Number(c.resumeScore ?? 0);
                const evaluator = (c.evaluations as { evaluator?: { name: string }; completedAt?: string }[] | undefined)
                  ?.find((e) => !e.completedAt)?.evaluator?.name
                  ?? (c.evaluator as { name?: string } | undefined)?.name;
                const stageKey = String(c.currentStage ?? "");
                const stageLabel = STAGE_LABELS[stageKey as CandidateStage] ?? formatLabel(stageKey);
                const stageVisual = getStageBadgeVisual(stageKey);
                const canOpen = canOpenCandidateDetail(c, user);

                return (
                  <tr
                    key={String(c.id)}
                    className={cn("transition-colors group", canOpen ? "cursor-pointer" : "cursor-default")}
                    style={{ borderBottom: "1px solid rgba(144,141,206,0.08)" }}
                    onClick={() => { if (canOpen) setSelectedCandidate(c); }}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="relative shrink-0">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback
                              className="text-xs font-bold"
                              style={{ background: "rgba(237,0,237,0.15)", color: "#ED00ED" }}
                            >
                              {getInitials(String(c.fullName ?? ""))}
                            </AvatarFallback>
                          </Avatar>
                          <div className={cn(
                            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2",
                            urg === "green" ? "bg-emerald-400" : urg === "yellow" ? "bg-amber-400" : "bg-red-400"
                          )} style={{ borderColor: "rgba(11,11,18,0.99)" }} />
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-xs font-semibold" style={{ color: "#C5CBE8" }}>{String(c.fullName ?? "")}</p>
                            {Boolean(c.isDuplicate) && <Badge variant="destructive" className="text-[9px] px-1 py-0 h-3">DUP</Badge>}
                            {isEscalated && <Badge variant="outline" className="text-[9px] px-1 py-0 h-3 text-red-400 border-red-400/30">!</Badge>}
                            {isConverted && (
                              <Badge variant="outline" className="h-4 gap-1 border-cyan-300/30 bg-cyan-300/10 px-1 text-[9px] text-cyan-200">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Employee
                              </Badge>
                            )}
                          </div>
                          <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.40)" }}>{String(c.personalEmail ?? "")}</p>
                          <p className="text-[9px] font-mono" style={{ color: "rgba(197,203,232,0.30)" }}>{String(c.candidateCode ?? "")}</p>
                          {Boolean(c.employeeCode) && (
                            <p className="text-[9px] font-mono" style={{ color: "rgba(197,203,232,0.42)" }}>Employee ID: {String(c.employeeCode)}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <p className="text-xs font-medium" style={{ color: "#C5CBE8" }}>
                        {String((c.position as Record<string, unknown>)?.title ?? c.positionTitle ?? "—")}
                      </p>
                      <p className="text-[10px]" style={{ color: "rgba(197,203,232,0.40)" }}>
                        {SOURCE_LABELS[String(c.sourceType ?? "") as SourceType] ?? formatLabel(String(c.sourceType ?? ""))}
                      </p>
                    </td>

                    <td className="py-3 px-4">
                      <span
                        className={cn(
                          "inline-flex max-w-[13rem] items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold leading-tight",
                          stageVisual.badge
                        )}
                      >
                        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stageVisual.dot)} />
                        <span className="truncate">{stageLabel}</span>
                      </span>
                    </td>

                    <td className="py-3 px-4 min-w-[120px]">
                      <MiniProgressBar currentStage={String(c.currentStage ?? "")} />
                    </td>

                    <td className="py-3 px-4">
                      <span className={cn(
                        "text-xs font-bold",
                        urg === "green" ? "text-emerald-400" : urg === "yellow" ? "text-amber-400" : "text-red-400"
                      )}>
                        {days}d
                      </span>
                    </td>

                    <td className="py-3 px-4">
                      {resumeScore > 0 ? (
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-1.5 rounded-full"
                            style={{
                              width: "40px",
                              background: "rgba(144,141,206,0.15)",
                            }}
                          >
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${resumeScore}%`,
                                background: resumeScore >= 70 ? "#22c55e" : resumeScore >= 50 ? "#f59e0b" : "#ef4444",
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold" style={{ color: "#C5CBE8" }}>{resumeScore}</span>
                        </div>
                      ) : (
                        <span className="text-[10px]" style={{ color: "rgba(197,203,232,0.30)" }}>—</span>
                      )}
                    </td>

                    {!isVendor && (
                      <td className="py-3 px-4">
                        <p className="text-xs" style={{ color: "rgba(197,203,232,0.55)" }}>
                          {evaluator ?? "—"}
                        </p>
                      </td>
                    )}

                    <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        {canOpen ? (
                          <button
                            className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                            onClick={(e) => { e.stopPropagation(); setSelectedCandidate(c); }}
                            aria-label="Preview candidate"
                          >
                            <Eye className="h-3.5 w-3.5" style={{ color: "rgba(197,203,232,0.60)" }} />
                          </button>
                        ) : (
                          <Badge variant="outline" className="rounded-full border-white/10 bg-white/5 text-[9px]" style={{ color: "rgba(197,203,232,0.48)" }}>
                            Preview
                          </Badge>
                        )}
                        {canManageCandidates && (
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger
                              render={
                                <button
                                  className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10"
                                  disabled={acting === String(c.id)}
                                />
                              }
                            >
                              {acting === String(c.id)
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "rgba(197,203,232,0.60)" }} />
                                : <MoreHorizontal className="h-3.5 w-3.5" style={{ color: "rgba(197,203,232,0.60)" }} />}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              {canEditCandidateName && (
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => openNameEdit(c)}>
                                  <Pencil className="h-3.5 w-3.5 text-primary" /> Edit member name
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem className="gap-2 text-xs" onClick={() => handleHold(String(c.id), String(c.fullName ?? ""))}>
                                <PauseCircle className="h-3.5 w-3.5 text-warning" /> Put on hold
                              </DropdownMenuItem>
                              {effectiveTab === "blacklisted" ? (
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => handleUnblacklist(String(c.id), String(c.fullName ?? ""))}>
                                  <UserCheck className="h-3.5 w-3.5 text-emerald-400" /> Remove from blacklist
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem className="gap-2 text-xs text-destructive focus:text-destructive" onClick={() => { setBlacklistId(String(c.id)); setBlacklistReason(""); }}>
                                  <UserX className="h-3.5 w-3.5" /> Blacklist member
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="gap-2 text-xs text-destructive focus:text-destructive" onClick={() => setConfirmRemoveId(String(c.id))}>
                                <Trash2 className="h-3.5 w-3.5" /> Remove candidate
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div
            className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            style={{ borderTop: "1px solid rgba(144,141,206,0.10)" }}
          >
            <p className="text-xs" style={{ color: "rgba(197,203,232,0.40)" }}>
              Page {page} of {totalPages} · {total} total
            </p>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => (
                <Button
                  key={i + 1}
                  variant={page === i + 1 ? "default" : "ghost"}
                  size="icon"
                  className="h-7 w-7 text-xs"
                  onClick={() => setPage(i + 1)}
                >
                  {i + 1}
                </Button>
              ))}
              <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => setPage(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6">
        {[
          { label: "A1 Pass Rate", value: journeyCandidates.length > 0 ? `${Math.round((kpis.active / Math.max(journeyCandidates.length, 1)) * 100)}%` : "—", icon: TrendingUp, color: "text-emerald-400" },
          { label: "A2 Pass Rate", value: "—", icon: TrendingUp, color: "text-blue-400" },
          { label: "Eval Pass Rate", value: kpis.evalPending > 0 ? `${Math.round(((kpis.offersSent) / Math.max(kpis.evalPending, 1)) * 100)}%` : "—", icon: UserCheck, color: "text-primary" },
          { label: "PI Conversion", value: kpis.piScheduled > 0 ? `${Math.round(((kpis.offersSent) / Math.max(kpis.piScheduled, 1)) * 100)}%` : "—", icon: BarChart2, color: "text-purple-400" },
          { label: "Avg Eval Time", value: "—", icon: Clock, color: "text-amber-400" },
          { label: "Escalations", value: kpis.escalated, icon: AlertTriangle, color: "text-red-400" },
        ].map((k) => (
          <div
            key={k.label}
            className="min-w-0 rounded-xl p-3 sm:rounded-2xl sm:p-4"
            style={{ background: "rgba(25,24,44,0.85)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
          >
            <div className="mb-3 flex min-w-0 items-start gap-2 sm:mb-2 sm:items-center">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted/40 sm:h-auto sm:w-auto sm:bg-transparent">
                <k.icon className={cn("h-3.5 w-3.5", k.color)} />
              </span>
              <p className="min-w-0 break-words text-[9px] font-semibold uppercase leading-tight tracking-wider sm:text-[10px]" style={{ color: "rgba(197,203,232,0.40)" }}>{k.label}</p>
            </div>
            <p className="break-words text-2xl font-bold leading-none sm:text-xl" style={{ color: "#C5CBE8" }}>{isLoading ? "—" : k.value}</p>
          </div>
        ))}
      </div>

      <Dialog
        open={bulkBypassOpen}
        onOpenChange={(open) => {
          setBulkBypassOpen(open);
          if (!open) {
            setBulkBypassFile(null);
            setBulkBypassResult(null);
            if (bulkBypassInputRef.current) bulkBypassInputRef.current.value = "";
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" /> Bulk bypass assessments
            </DialogTitle>
            <DialogDescription>
              Upload a CSV with candidate email and result. Rows marked Pass move to Selection Form.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              ref={bulkBypassInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                setBulkBypassFile(event.target.files?.[0] ?? null);
                setBulkBypassResult(null);
              }}
            />
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: "#C5CBE8" }}>CSV file</p>
                <p className="mt-1 truncate text-xs" style={{ color: "rgba(197,203,232,0.58)" }}>
                  {bulkBypassFile?.name ?? "No file selected"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="rounded-xl text-xs"
                onClick={() => bulkBypassInputRef.current?.click()}
                disabled={isBulkBypassing}
              >
                Choose CSV
              </Button>
            </div>
            <p className="text-xs" style={{ color: "rgba(197,203,232,0.55)" }}>
              Accepted columns: <span className="font-mono">email,result</span>. The result value should be <span className="font-mono">Pass</span>.
            </p>
            {bulkBypassResult && (
              <div className="space-y-3 rounded-xl border border-border bg-muted/15 p-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Rows</p>
                    <p className="text-lg font-semibold" style={{ color: "#C5CBE8" }}>{bulkBypassResult.processed}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Advanced</p>
                    <p className="text-lg font-semibold text-emerald-300">{bulkBypassResult.advanced}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Needs review</p>
                    <p className="text-lg font-semibold text-amber-300">{bulkBypassResult.failed}</p>
                  </div>
                </div>
                <ScrollArea className="h-56 pr-3">
                  <div className="space-y-2">
                    {bulkBypassResult.results.map((row) => (
                      <div key={`${row.row}-${row.email ?? "row"}`} className="rounded-lg border border-border/70 bg-background/35 p-2.5">
                        <div className="flex min-w-0 items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium" style={{ color: "#C5CBE8" }}>
                              Row {row.row}{row.email ? ` · ${row.email}` : ""}
                            </p>
                            <p className="mt-1 text-xs" style={{ color: "rgba(197,203,232,0.58)" }}>{row.message}</p>
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 rounded-full text-[10px] capitalize",
                              row.status === "advanced"
                                ? "border-emerald-300/35 bg-emerald-400/10 text-emerald-200"
                                : row.status === "updated"
                                  ? "border-sky-300/35 bg-sky-400/10 text-sky-200"
                                  : "border-amber-300/35 bg-amber-400/10 text-amber-200",
                            )}
                          >
                            {row.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl text-xs"
              onClick={() => setBulkBypassOpen(false)}
              disabled={isBulkBypassing}
            >
              Close
            </Button>
            <Button
              className="rounded-xl text-xs"
              disabled={!bulkBypassFile || isBulkBypassing}
              onClick={() => void handleBulkBypassUpload()}
            >
              {isBulkBypassing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Upload and bypass
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!nameEditCandidate}
        onOpenChange={(open) => {
          if (!open) {
            setNameEditCandidate(null);
            setNameEditValue("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" /> Edit member name
            </DialogTitle>
            <DialogDescription>
              Update the candidate name shown across the Admin and HR candidate module.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="candidate-name-edit" className="text-sm font-medium">Member name</label>
            <Input
              id="candidate-name-edit"
              value={nameEditValue}
              onChange={(event) => setNameEditValue(event.target.value)}
              placeholder="Enter member name"
              className="h-10 rounded-xl"
              autoComplete="off"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="rounded-xl text-xs"
              onClick={() => {
                setNameEditCandidate(null);
                setNameEditValue("");
              }}
              disabled={isSavingName}
            >
              Cancel
            </Button>
            <Button
              className="rounded-xl text-xs"
              disabled={!nameEditValue.trim() || isSavingName}
              onClick={handleSaveCandidateName}
            >
              {isSavingName && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save name
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!blacklistId} onOpenChange={(open) => { if (!open) { setBlacklistId(null); setBlacklistReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserX className="h-5 w-5 text-destructive" /> Blacklist candidate?</DialogTitle>
            <DialogDescription>This will remove the candidate from active pipeline and block reapplication.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Reason *</label>
            <textarea
              className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm resize-none focus:outline-none"
              rows={3}
              placeholder="e.g. Misconduct, fake credentials..."
              value={blacklistReason}
              onChange={(e) => setBlacklistReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="rounded-xl text-xs" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              className="rounded-xl text-xs"
              disabled={!blacklistReason.trim() || acting === blacklistId}
              onClick={() => {
                const candidate = paginated.find((c: Record<string, unknown>) => c.id === blacklistId);
                if (candidate && blacklistId) handleBlacklist(blacklistId, String(candidate.fullName ?? ""));
              }}
            >
              {acting === blacklistId && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Blacklist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmRemoveId} onOpenChange={(open) => { if (!open) setConfirmRemoveId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove candidate?</DialogTitle>
            <DialogDescription>This action cannot be undone and will block reapplication.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="rounded-xl text-xs" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              className="rounded-xl text-xs"
              onClick={() => {
                const candidate = paginated.find((c: Record<string, unknown>) => c.id === confirmRemoveId);
                if (candidate && confirmRemoveId) handleRemove(confirmRemoveId, String(candidate.fullName ?? ""));
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedCandidate && (
        <CandidateDetailPanel
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          canEditName={canEditCandidateName}
          onEditName={openNameEdit}
        />
      )}

      <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" /> Candidate date range
            </DialogTitle>
            <DialogDescription>
              Filter this page by candidate application date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">From</p>
              <Input
                type="date"
                value={draftCreatedFrom}
                onChange={(event) => setDraftCreatedFrom(event.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">To</p>
              <Input
                type="date"
                value={draftCreatedTo}
                onChange={(event) => setDraftCreatedTo(event.target.value)}
                className="h-10 rounded-xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-xl text-xs" onClick={clearDateRange}>
              Clear
            </Button>
            <Button className="rounded-xl text-xs" onClick={applyDateRange}>
              Apply Range
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

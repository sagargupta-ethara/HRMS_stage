"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, CalendarDays, CheckCircle2, ChevronDown, ChevronUp,
  Download, ExternalLink, Loader2, RefreshCw, Upload, UserX, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { separationApi, employeesApi } from "@/lib/api";
import type { SeparationRecord, EmployeeRecord } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatDate, formatLabel, hasAssignedRole, timeAgo } from "@/lib/utils";
import { exportToCsv, SEPARATION_EXPORT_COLUMNS } from "@/lib/export";
import { useAuth } from "@/lib/auth-context";

const STATUS_COLOR: Record<string, string> = {
  pending: "border-warning/30 text-warning bg-warning/5",
  manager_approved: "border-info/30 text-info bg-info/5",
  approved: "border-success/30 text-success bg-success/5",
  rejected: "border-destructive/30 text-destructive bg-destructive/5",
  on_hold: "border-muted-foreground/30 text-muted-foreground",
};

type Tab = "resignations" | "terminations";

const RESIGNATION_REASONS = [
  "Personal Reasons",
  "Better Opportunity / Higher Pay",
  "Relocation",
  "Work-Life Balance",
  "Lack of Career Growth",
  "Management / Culture Fit",
  "Health Reasons",
  "Further Studies",
  "Family Commitments",
  "Retirement",
  "Other",
] as const;

const INVOLUNTARY_TYPES = ["termination", "no_show", "absconding"] as const;

const INVOLUNTARY_LABEL: Record<(typeof INVOLUNTARY_TYPES)[number], string> = {
  termination: "Terminated",
  no_show: "No Show",
  absconding: "Absconding",
};

function SeparationCard({
  record,
  onHrAction,
  onClassifyReason,
  onManagerAction,
  onUpdateLwd,
  acting,
  classifying,
  canManageHr,
  canManagerAct,
}: {
  record: SeparationRecord;
  onHrAction: (r: SeparationRecord, action: "approve" | "reject") => void;
  onClassifyReason: (r: SeparationRecord, reason: string) => void;
  onManagerAction: (r: SeparationRecord, action: "approve" | "reject") => void;
  onUpdateLwd: (r: SeparationRecord) => void;
  acting: boolean;
  classifying: boolean;
  canManageHr: boolean;
  canManagerAct: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selectedReason, setSelectedReason] = useState(record.reason ?? "");
  const reasonReady = Boolean(record.reason?.trim());
  const isFinal = ["approved", "rejected"].includes(record.status);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedReason(record.reason ?? "");
  }, [record.reason]);

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div
        className="flex items-start justify-between gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">{record.employeeName ?? "—"}</p>
            <Badge className={cn("text-xs border px-2 py-0", STATUS_COLOR[record.status] ?? "")}>
              {formatLabel(record.status)}
            </Badge>
            {record.separationType === "resignation" && !reasonReady && (
              <Badge variant="outline" className="border-warning/30 bg-warning/5 text-xs text-warning">
                Reason pending HR
              </Badge>
            )}
            {record.separationType !== "resignation" && (
              <Badge variant="destructive" className="text-xs">
                Blacklisted
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {record.employeeCode} · {record.department} · {record.designation}
          </p>
          <p className="text-xs text-muted-foreground">
            {record.etharaEmail}
            {record.personalEmail && ` · ${record.personalEmail}`}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Applied {record.appliedAt ? timeAgo(record.appliedAt) : "—"}
            {record.lastWorkingDay && (
              <span className="ml-2 font-medium text-foreground">
                LWD: {formatDate(record.lastWorkingDay)}
              </span>
            )}
            {record.earlyRelievingRequested && (
              <span className="ml-2 text-warning">· Early relieving requested</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href={`/dashboard/employees/${record.employeeProfileId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> View Profile
          </Link>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border bg-muted/10 p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="font-medium">{record.phone || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Blood Group</p>
              <p className="font-medium">{record.bloodGroup || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Emergency Contact</p>
              <p className="font-medium">{record.emergencyContactName || "—"}</p>
              <p className="text-xs text-muted-foreground">{record.emergencyContactPhone || ""}</p>
            </div>
          </div>

          {record.separationType === "resignation" && canManageHr ? (
            <div className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label className="text-xs">HR reason for resignation</Label>
                  <Select value={selectedReason} onValueChange={(value) => setSelectedReason(value ?? "")}>
                    <SelectTrigger className="h-9 w-full rounded-xl px-3 text-sm">
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      {RESIGNATION_REASONS.map((reason) => (
                        <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  className="h-9 w-full rounded-xl text-xs sm:w-auto"
                  disabled={classifying || !selectedReason || selectedReason === (record.reason ?? "")}
                  onClick={() => onClassifyReason(record, selectedReason)}
                >
                  {classifying && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                  Save Reason
                </Button>
              </div>
              {record.remarks && (
                <div className="mt-3">
                  <p className="mb-1 text-xs text-muted-foreground">Employee remarks</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2 text-sm">{record.remarks}</p>
                </div>
              )}
            </div>
          ) : record.separationType === "resignation" ? (
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground mb-1">HR classified reason</p>
              <p className="text-sm">{record.reason || "Pending HR classification"}</p>
              {record.remarks && (
                <div className="mt-3">
                  <p className="mb-1 text-xs text-muted-foreground">Employee remarks</p>
                  <p className="whitespace-pre-wrap rounded-lg bg-muted/30 px-3 py-2 text-sm">{record.remarks}</p>
                </div>
              )}
            </div>
          ) : record.reason ? (
            <div>
              <p className="text-xs text-muted-foreground mb-1">{record.separationTypeLabel ?? "Involuntary separation"} reason</p>
              <p className="text-sm bg-muted/30 rounded-lg px-3 py-2">{record.reason}</p>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Manager</p>
              <p className="font-medium">{record.managerName || "—"}</p>
              <p className="text-xs text-muted-foreground">{record.managerEmail || ""}</p>
              {record.managerAction && (
                <Badge variant="outline" className="text-xs mt-1">
                  {record.managerAction} {record.managerActionAt ? formatDate(record.managerActionAt) : ""}
                </Badge>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">HR Review</p>
              <p className="font-medium">{record.reviewedBy ? "Reviewed" : "Pending"}</p>
              {record.reviewedAt && <p className="text-xs text-muted-foreground">{formatDate(record.reviewedAt)}</p>}
            </div>
          </div>

          {record.managerRemarks && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Manager remarks</p>
              <p className="text-xs bg-muted/20 rounded-lg px-3 py-2 whitespace-pre-wrap">{record.managerRemarks}</p>
            </div>
          )}

          <Separator />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={() => onUpdateLwd(record)}
            >
              <CalendarDays className="h-3 w-3" />
              {record.lastWorkingDay ? "Update LWD" : "Set LWD"}
            </Button>

            {!isFinal && canManageHr && reasonReady && (
              <>
                <Button size="sm" className="gap-1.5 text-xs" disabled={acting}
                  onClick={() => onHrAction(record, "approve")}>
                  <CheckCircle2 className="h-3 w-3" /> HR Approve
                </Button>
                <Button size="sm" variant="destructive" className="gap-1.5 text-xs" disabled={acting}
                  onClick={() => onHrAction(record, "reject")}>
                  <XCircle className="h-3 w-3" /> HR Reject
                </Button>
              </>
            )}
            {!isFinal && canManagerAct && reasonReady && record.status === "pending" && (
              <>
                <Button size="sm" className="gap-1.5 text-xs" disabled={acting}
                  onClick={() => onManagerAction(record, "approve")}>
                  <CheckCircle2 className="h-3 w-3" /> Manager Approve
                </Button>
                <Button size="sm" variant="destructive" className="gap-1.5 text-xs" disabled={acting}
                  onClick={() => onManagerAction(record, "reject")}>
                  <XCircle className="h-3 w-3" /> Manager Reject
                </Button>
              </>
            )}
            {!isFinal && record.separationType === "resignation" && !reasonReady && (
              <p className="text-xs text-muted-foreground">
                {canManageHr
                  ? "Select and save the HR reason before approval or rejection."
                  : "Waiting for HR to select the resignation reason before manager review."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type BulkTermRow = {
  employeeCode: string;
  employeeEmail: string;
  employeeName: string;
  reason: string;
  effectiveDate: string;
  remarks: string;
};

type BulkTermPreviewRow = BulkTermRow & {
  valid: boolean;
  error: string;
  matchedEmployee: EmployeeRecord | null;
};

function parseBulkTermCsv(text: string): BulkTermRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[\s\-]+/g, "_").replace(/[^a-z_]/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, "").replace(/""/g, '"'));
    const row: Record<string, string> = Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
    return {
      employeeCode: row["employee_code"] ?? row["code"] ?? "",
      employeeEmail: row["employee_email"] ?? row["email"] ?? "",
      employeeName: row["employee_name"] ?? row["name"] ?? "",
      reason: row["termination_reason"] ?? row["reason"] ?? "",
      effectiveDate: row["effective_date"] ?? row["date"] ?? "",
      remarks: row["remarks"] ?? "",
    };
  }).filter((r) => r.employeeCode || r.employeeEmail);
}

export default function SeparationManagementPage() {
  const { user, isLoading: authLoading } = useAuth();
  const isManagerView = hasAssignedRole(user, ["manager"]);
  const canManageHr = hasAssignedRole(user, ["super_admin", "admin", "leadership", "hr", "ta"]);
  const [activeTab, setActiveTab] = useState<Tab>("resignations");
  const [records, setRecords] = useState<SeparationRecord[]>([]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [classifyingId, setClassifyingId] = useState<string | null>(null);

  const [hrDialog, setHrDialog] = useState<{ record: SeparationRecord; action: "approve" | "reject" } | null>(null);
  const [hrRemarks, setHrRemarks] = useState("");
  const [managerDialog, setManagerDialog] = useState<{ record: SeparationRecord; action: "approve" | "reject" } | null>(null);
  const [managerRemarks, setManagerRemarks] = useState("");
  const [managerSuggestedLwd, setManagerSuggestedLwd] = useState("");

  const [lwdDialog, setLwdDialog] = useState<SeparationRecord | null>(null);
  const [newLwd, setNewLwd] = useState("");
  const [lwdRemarks, setLwdRemarks] = useState("");
  const [savingLwd, setSavingLwd] = useState(false);

  const [terminateTarget, setTerminateTarget] = useState<EmployeeRecord | null>(null);
  const [termType, setTermType] = useState<(typeof INVOLUNTARY_TYPES)[number]>("termination");
  const [termReason, setTermReason] = useState("");
  const [termRemarks, setTermRemarks] = useState("");
  const [termDate, setTermDate] = useState("");
  const [terminating, setTerminating] = useState(false);
  const [showTermDialog, setShowTermDialog] = useState(false);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<BulkTermPreviewRow[]>([]);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkDone, setBulkDone] = useState<{ ok: number; failed: number; errors: string[] } | null>(null);
  const bulkFileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (silent = false) => {
    if (authLoading) return;
    if (!user) {
      setIsLoading(false);
      return;
    }
    if (!silent) setIsLoading(true);
    try {
      if (isManagerView) {
        const res = await separationApi.managerInbox();
        setRecords(res);
        setEmployees([]);
      } else {
        const [res, emps] = await Promise.all([separationApi.list(), employeesApi.list()]);
        setRecords(res);
        setEmployees(emps);
      }
    } catch {
      if (!silent) toast.error("Failed to load separation data.");
    } finally {
      setIsLoading(false);
    }
  }, [authLoading, isManagerView, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const resignations = records.filter((r) => r.separationType === "resignation");
  const terminations = records.filter((r) => INVOLUNTARY_TYPES.includes(r.separationType as (typeof INVOLUNTARY_TYPES)[number]));
  const visible = activeTab === "resignations" ? resignations : terminations;

  const handleClassifyReason = async (record: SeparationRecord, reason: string) => {
    setClassifyingId(record.id);
    try {
      await separationApi.classifyReason(record.id, { reason });
      toast.success("Resignation reason saved.");
      void load(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to save resignation reason.");
    } finally {
      setClassifyingId(null);
    }
  };

  const handleHRAction = async () => {
    if (!hrDialog) return;
    setActing(true);
    try {
      await separationApi.hrAction(hrDialog.record.id, { action: hrDialog.action, remarks: hrRemarks || undefined });
      toast.success(`Resignation ${hrDialog.action === "approve" ? "approved" : "rejected"}.`);
      setHrDialog(null); setHrRemarks("");
      void load(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Action failed.");
    } finally { setActing(false); }
  };

  const handleManagerAction = async () => {
    if (!managerDialog) return;
    setActing(true);
    try {
      await separationApi.managerAction(managerDialog.record.id, {
        action: managerDialog.action,
        remarks: managerRemarks || undefined,
        suggested_lwd: managerSuggestedLwd || undefined,
      });
      toast.success(`Resignation ${managerDialog.action === "approve" ? "approved" : "rejected"}.`);
      setManagerDialog(null);
      setManagerRemarks("");
      setManagerSuggestedLwd("");
      void load(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Action failed.");
    } finally {
      setActing(false);
    }
  };

  const handleUpdateLwd = async () => {
    if (!lwdDialog || !newLwd) { toast.error("Select a date first"); return; }
    setSavingLwd(true);
    try {
      await separationApi.updateLwd(lwdDialog.id, newLwd, lwdRemarks || undefined);
      toast.success("Last Working Day updated");
      setLwdDialog(null); setNewLwd(""); setLwdRemarks("");
      void load(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to update LWD");
    } finally { setSavingLwd(false); }
  };

  const handleTerminate = async () => {
    if (!terminateTarget || !termReason || !termDate) { toast.error("Reason and effective date are required."); return; }
    setTerminating(true);
    try {
      await separationApi.terminate({
        employeeProfileId: terminateTarget.id,
        reason: termReason,
        remarks: termRemarks || undefined,
        effectiveDate: new Date(termDate).toISOString(),
        separationType: termType,
      });
      toast.success(`${terminateTarget.name} marked as ${INVOLUNTARY_LABEL[termType]}. Access deactivation initiated.`);
      setShowTermDialog(false); setTerminateTarget(null); setTermType("termination"); setTermReason(""); setTermRemarks(""); setTermDate("");
      void load(true);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Termination failed.");
    } finally { setTerminating(false); }
  };

  const handleBulkFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const parsed = parseBulkTermCsv(text);
      if (!parsed.length) { toast.error("No valid rows found. Check CSV format."); return; }
      const preview: BulkTermPreviewRow[] = parsed.map((row) => {
        const matched = employees.find(
          (emp) =>
            (row.employeeCode && emp.employeeCode?.toLowerCase() === row.employeeCode.toLowerCase()) ||
            (row.employeeEmail && emp.etharaEmail?.toLowerCase() === row.employeeEmail.toLowerCase()) ||
            (row.employeeEmail && emp.personalEmail?.toLowerCase() === row.employeeEmail.toLowerCase())
        );
        let error = "";
        if (!matched) error = "Employee not found";
        else if (!matched.isActive) error = "Employee already inactive";
        else if (!row.reason.trim()) error = "Reason is required";
        else if (!row.effectiveDate.trim()) error = "Effective date is required";
        else {
          const d = new Date(row.effectiveDate);
          if (isNaN(d.getTime())) error = "Invalid effective date format";
        }
        return { ...row, valid: !error, error, matchedEmployee: matched ?? null };
      });
      setBulkPreview(preview);
      setBulkDone(null);
      if (bulkFileRef.current) bulkFileRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const handleBulkSubmit = async () => {
    const valid = bulkPreview.filter((r) => r.valid && r.matchedEmployee);
    if (!valid.length) { toast.error("No valid rows to process."); return; }
    setBulkSubmitting(true);
    let ok = 0;
    const errors: string[] = [];
    for (const row of valid) {
      try {
        await separationApi.terminate({
          employeeProfileId: row.matchedEmployee!.id,
          reason: row.reason,
          remarks: row.remarks || undefined,
          effectiveDate: new Date(row.effectiveDate).toISOString(),
          separationType: "termination",
        });
        ok++;
      } catch (err) {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
        errors.push(`${row.employeeName || row.employeeCode}: ${msg || "Failed"}`);
      }
    }
    setBulkDone({ ok, failed: valid.length - ok, errors });
    setBulkSubmitting(false);
    if (ok > 0) {
      toast.success(`${ok} employee${ok > 1 ? "s" : ""} terminated.`);
      void load(true);
    }
  };

  const exportFailedRows = () => {
    const failed = bulkPreview.filter((r) => !r.valid);
    if (!failed.length) return;
    const csv = [
      "Employee Code,Employee Email,Employee Name,Reason,Effective Date,Remarks,Error",
      ...failed.map((r) => `"${r.employeeCode}","${r.employeeEmail}","${r.employeeName}","${r.reason}","${r.effectiveDate}","${r.remarks}","${r.error}"`),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "failed_terminations.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const stats = {
    pending: resignations.filter((r) => r.status === "pending").length,
    managerApproved: resignations.filter((r) => r.status === "manager_approved").length,
    approved: resignations.filter((r) => r.status === "approved").length,
    rejected: resignations.filter((r) => r.status === "rejected").length,
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Separation Management</h1>
          <p className="text-muted-foreground text-sm">
            {isManagerView
              ? "Review resignation requests for your reporting team"
              : "Manage resignations, approvals, and involuntary separations"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1.5" onClick={() => void load()}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl text-xs gap-1.5"
            onClick={() => exportToCsv(records as unknown as Record<string, unknown>[], SEPARATION_EXPORT_COLUMNS, `separation_export_${new Date().toISOString().slice(0, 10)}`)}
          >
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          {canManageHr && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="rounded-xl text-xs gap-1.5"
                onClick={() => { setBulkPreview([]); setBulkDone(null); setBulkOpen(true); }}
              >
                <Upload className="h-3.5 w-3.5" /> Bulk Terminate
              </Button>
              <Button size="sm" variant="destructive" className="rounded-xl text-xs gap-1.5" onClick={() => setShowTermDialog(true)}>
                <UserX className="h-3.5 w-3.5" /> Mark Involuntary
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Pending Manager", value: stats.pending, color: "text-warning" },
          { label: isManagerView ? "Approved By Manager" : "Manager Approved", value: stats.managerApproved, color: "text-info" },
          { label: "HR Approved", value: stats.approved, color: "text-success" },
          { label: "Rejected", value: stats.rejected, color: "text-destructive" },
        ].map((s) => (
          <Card key={s.label} className="border-0 shadow-sm">
            <CardContent className="pt-4">
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {(["resignations", "terminations"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize",
              activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === "resignations" ? "Resignations" : "Blacklisted / Involuntary"} ({tab === "resignations" ? resignations.length : terminations.length})
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium text-muted-foreground">No {activeTab} found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <SeparationCard
              key={r.id}
              record={r}
              onHrAction={(rec, action) => { setHrDialog({ record: rec, action }); setHrRemarks(""); }}
              onClassifyReason={handleClassifyReason}
              onManagerAction={(rec, action) => {
                setManagerDialog({ record: rec, action });
                setManagerRemarks("");
                setManagerSuggestedLwd(rec.lastWorkingDay ? rec.lastWorkingDay.substring(0, 10) : "");
              }}
              onUpdateLwd={(rec) => { setLwdDialog(rec); setNewLwd(rec.lastWorkingDay ? rec.lastWorkingDay.substring(0, 10) : ""); setLwdRemarks(""); }}
              acting={acting}
              classifying={classifyingId === r.id}
              canManageHr={canManageHr}
              canManagerAct={isManagerView}
            />
          ))}
        </div>
      )}

      <Dialog open={!!hrDialog} onOpenChange={(o) => { if (!o) { setHrDialog(null); setHrRemarks(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>HR {hrDialog?.action === "approve" ? "Approve" : "Reject"} Resignation</DialogTitle></DialogHeader>
          {hrDialog && (
            <div className="space-y-3 py-2">
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <p className="font-medium">{hrDialog.record.employeeName}</p>
                <p className="text-xs text-muted-foreground">{hrDialog.record.department} · LWD: {hrDialog.record.lastWorkingDay ? formatDate(hrDialog.record.lastWorkingDay) : "TBD"}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">HR Remarks (optional)</Label>
                <Textarea placeholder="Add remarks…" value={hrRemarks} onChange={(e) => setHrRemarks(e.target.value)} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setHrDialog(null)} disabled={acting}>Cancel</Button>
            <Button onClick={handleHRAction} disabled={acting} variant={hrDialog?.action === "reject" ? "destructive" : "default"} className="gap-2">
              {acting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm {hrDialog?.action === "approve" ? "Approval" : "Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!managerDialog} onOpenChange={(o) => { if (!o) { setManagerDialog(null); setManagerRemarks(""); setManagerSuggestedLwd(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Manager {managerDialog?.action === "approve" ? "Approve" : "Reject"} Resignation</DialogTitle>
          </DialogHeader>
          {managerDialog && (
            <div className="space-y-3 py-2">
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <p className="font-medium">{managerDialog.record.employeeName}</p>
                <p className="text-xs text-muted-foreground">
                  {managerDialog.record.department || "—"} · LWD: {managerDialog.record.lastWorkingDay ? formatDate(managerDialog.record.lastWorkingDay) : "TBD"}
                </p>
                {managerDialog.record.reason && (
                  <p className="mt-1 text-xs text-muted-foreground">Reason: {managerDialog.record.reason}</p>
                )}
              </div>
              {managerDialog.action === "approve" && (
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> Suggested Last Working Day</Label>
                  <DatePicker value={managerSuggestedLwd} onChange={setManagerSuggestedLwd} />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Manager Remarks (optional)</Label>
                <Textarea placeholder="Add remarks..." value={managerRemarks} onChange={(e) => setManagerRemarks(e.target.value)} rows={3} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setManagerDialog(null)} disabled={acting}>Cancel</Button>
            <Button
              onClick={handleManagerAction}
              disabled={acting}
              variant={managerDialog?.action === "reject" ? "destructive" : "default"}
              className="gap-2"
            >
              {acting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm {managerDialog?.action === "approve" ? "Approval" : "Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!lwdDialog} onOpenChange={(o) => { if (!o) { setLwdDialog(null); setNewLwd(""); setLwdRemarks(""); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Update Last Working Day</DialogTitle></DialogHeader>
          {lwdDialog && (
            <div className="space-y-3 py-2">
              <div className="rounded-xl bg-muted/40 p-3 text-sm">
                <p className="font-medium">{lwdDialog.employeeName}</p>
                <p className="text-xs text-muted-foreground">Current LWD: {lwdDialog.lastWorkingDay ? formatDate(lwdDialog.lastWorkingDay) : "Not set"}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" /> New Last Working Day</Label>
                <DatePicker value={newLwd} onChange={setNewLwd} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Reason for change (optional)</Label>
                <Textarea placeholder="Add reason…" value={lwdRemarks} onChange={(e) => setLwdRemarks(e.target.value)} rows={2} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLwdDialog(null)} disabled={savingLwd}>Cancel</Button>
            <Button onClick={handleUpdateLwd} disabled={savingLwd || !newLwd} className="gap-2">
              {savingLwd && <Loader2 className="h-4 w-4 animate-spin" />}
              Update LWD
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTermDialog} onOpenChange={(o) => { if (!o) setShowTermDialog(false); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="flex items-center gap-2 text-destructive"><UserX className="h-5 w-5" /> Mark Employee Involuntary</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs">Outcome</Label>
              <Select value={termType} onValueChange={(value) => setTermType((value as typeof termType) || "termination")}>
                <SelectTrigger className="h-9 w-full rounded-xl px-3 text-sm">
                  <SelectValue placeholder="Select outcome" />
                </SelectTrigger>
                <SelectContent>
                  {INVOLUNTARY_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{INVOLUNTARY_LABEL[type]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Select Employee</Label>
              <Select
                value={terminateTarget?.id ?? ""}
                onValueChange={(v) => setTerminateTarget(employees.find((x) => x.id === v) ?? null)}
              >
                <SelectTrigger className="h-9 w-full rounded-xl px-3 text-sm">
                  <SelectValue placeholder="Select employee…" />
                </SelectTrigger>
                <SelectContent>
                  {employees.filter((e) => e.isActive).map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name} ({e.employeeCode ?? e.etharaEmail})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason <span className="text-destructive">*</span></Label>
              <Textarea placeholder={`Reason for ${INVOLUNTARY_LABEL[termType].toLowerCase()}…`} value={termReason} onChange={(e) => setTermReason(e.target.value)} rows={3} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Effective Date <span className="text-destructive">*</span></Label>
              <DatePicker value={termDate} onChange={setTermDate} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Additional Remarks</Label>
              <Textarea placeholder="Optional remarks…" value={termRemarks} onChange={(e) => setTermRemarks(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTermDialog(false)} disabled={terminating}>Cancel</Button>
            <Button variant="destructive" onClick={handleTerminate} disabled={terminating || !terminateTarget || !termReason || !termDate} className="gap-2">
              {terminating && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm {INVOLUNTARY_LABEL[termType]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <input ref={bulkFileRef} type="file" accept=".csv" className="hidden" onChange={handleBulkFile} />

      <Dialog open={bulkOpen} onOpenChange={(o) => { if (!o) { setBulkPreview([]); setBulkDone(null); } setBulkOpen(o); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Upload className="h-5 w-5" /> Bulk Terminate Employees
            </DialogTitle>
          </DialogHeader>

          {!bulkPreview.length && !bulkDone ? (
            <div className="space-y-4 py-2">
              <div className="rounded-xl border border-border p-4 space-y-2 text-sm">
                <p className="font-semibold">CSV Format</p>
                <p className="text-xs text-muted-foreground">Required columns (case-insensitive, comma-separated):</p>
                <code className="block text-xs bg-muted/40 rounded-lg px-3 py-2 font-mono">
                  employee_code, employee_email, employee_name, termination_reason, effective_date, remarks
                </code>
                <p className="text-[10px] text-muted-foreground">
                  effective_date format: YYYY-MM-DD or DD/MM/YYYY · remarks is optional
                </p>
              </div>
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-border p-8 text-center">
                <Upload className="h-8 w-8 text-muted-foreground opacity-40" />
                <p className="text-sm font-medium text-muted-foreground">Upload CSV file to preview before terminating</p>
                <Button size="sm" className="rounded-xl text-xs" onClick={() => bulkFileRef.current?.click()}>
                  Choose CSV File
                </Button>
              </div>
            </div>
          ) : bulkDone ? (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-success/30 bg-success/5 p-4 text-center">
                  <p className="text-2xl font-bold text-success">{bulkDone.ok}</p>
                  <p className="text-xs text-muted-foreground mt-1">Terminated</p>
                </div>
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
                  <p className="text-2xl font-bold text-destructive">{bulkDone.failed}</p>
                  <p className="text-xs text-muted-foreground mt-1">Failed</p>
                </div>
              </div>
              {bulkDone.errors.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-destructive">Errors:</p>
                  <ul className="space-y-1 max-h-40 overflow-y-auto text-xs text-muted-foreground">
                    {bulkDone.errors.map((e, i) => <li key={i} className="rounded bg-destructive/5 px-2 py-1">{e}</li>)}
                  </ul>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => { setBulkPreview([]); setBulkDone(null); }}>
                  Upload Another
                </Button>
                <Button size="sm" className="rounded-xl text-xs" onClick={() => setBulkOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex gap-3 text-sm">
                  <span className="text-success font-semibold">{bulkPreview.filter((r) => r.valid).length} valid</span>
                  <span className="text-destructive font-semibold">{bulkPreview.filter((r) => !r.valid).length} invalid</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="rounded-xl text-xs gap-1" onClick={exportFailedRows} disabled={!bulkPreview.filter((r) => !r.valid).length}>
                    <Download className="h-3 w-3" /> Export Invalid
                  </Button>
                  <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => bulkFileRef.current?.click()}>
                    Re-upload
                  </Button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      {["Code", "Email", "Name", "Reason", "Effective Date", "Status"].map((h) => (
                        <th key={h} className="py-2 px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bulkPreview.map((row, i) => (
                      <tr key={i} className={cn("border-b border-border/40", !row.valid && "bg-destructive/5")}>
                        <td className="py-2 px-3 font-mono">{row.employeeCode || "—"}</td>
                        <td className="py-2 px-3 truncate max-w-[120px]">{row.employeeEmail || "—"}</td>
                        <td className="py-2 px-3">{row.employeeName || row.matchedEmployee?.name || "—"}</td>
                        <td className="py-2 px-3 truncate max-w-[150px]">{row.reason || "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap">{row.effectiveDate || "—"}</td>
                        <td className="py-2 px-3">
                          {row.valid
                            ? <span className="inline-flex items-center gap-1 text-success font-semibold"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" />Valid</span>
                            : <span className="text-destructive text-[10px]">{row.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <DialogFooter>
                <Button variant="outline" size="sm" className="rounded-xl text-xs" onClick={() => setBulkPreview([])}>Cancel</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  className="rounded-xl text-xs gap-1.5"
                  disabled={bulkSubmitting || !bulkPreview.filter((r) => r.valid).length}
                  onClick={handleBulkSubmit}
                >
                  {bulkSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Terminate {bulkPreview.filter((r) => r.valid).length} Employee{bulkPreview.filter((r) => r.valid).length !== 1 ? "s" : ""}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

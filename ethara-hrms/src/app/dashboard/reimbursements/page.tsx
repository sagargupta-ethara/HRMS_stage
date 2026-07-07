"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDate, formatDateTime, formatLabel, hasAssignedRole } from "@/lib/utils";
import {
  projectsApi,
  reimbursementsApi,
  type ProjectOption,
  type ReimbursementConfig,
  type ReimbursementRequest,
} from "@/lib/api";
import type { Role } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Loader2,
  Pencil,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  WalletCards,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const DEFAULT_CONFIG: ReimbursementConfig = {
  categories: [
    "Urgent Project Purchases",
    "Food & Logistics",
    "Transportation",
    "Other",
  ],
  approvalRules: "Reporting manager approval followed by HR/Office admin approval.",
  expenseLimit: null,
  defaultCurrency: "INR",
};

const EDITABLE_STATUSES = new Set(["draft", "missing_information", "returned_by_manager", "returned_by_finance"]);
const REVOCABLE_STATUSES = new Set([
  "draft",
  "missing_information",
  "pending_manager_review",
  "returned_by_manager",
  "manager_approved",
  "returned_by_finance",
  "approved_for_payment",
]);
const DELETABLE_STATUSES = new Set([
  "draft",
  "submitted",
  "missing_information",
  "pending_manager_review",
  "returned_by_manager",
  "returned_by_finance",
  "manager_rejected",
  "finance_rejected",
  "revoked",
]);
const PENDING_STATUSES = new Set(["pending_manager_review", "manager_approved", "pending_hr_review", "pending_leadership_review", "missing_information", "returned_by_manager", "returned_by_hr", "returned_by_leadership", "returned_by_finance"]);
const REJECTED_STATUSES = new Set(["manager_rejected", "hr_rejected", "leadership_rejected", "finance_rejected"]);
const APPROVED_STATUSES = new Set(["approved_for_payment", "paid", "acknowledged"]);

type FormState = {
  employeeName: string;
  employeeId: string;
  department: string;
  projectName: string;
  projectId: string;
  category: string;
  expenseDate: string;
  expenseAmount: string;
  currency: string;
  reason: string;
  paymentMethod: string;
  declarationAccepted: boolean;
  receipt: File | null;
};

type ReviewAction = "approve" | "reject" | "return" | "paid" | "acknowledge";
type ReviewScope = "manager" | "hr" | "leadership" | "finance" | "payment" | "acknowledge";
type ReviewTarget = {
  request: ReimbursementRequest;
  action: ReviewAction;
  scope: ReviewScope;
};

function userIn(user: ReturnType<typeof useAuth>["user"], roles: Role[]): boolean {
  return hasAssignedRole(user, roles);
}

function emptyForm(
  profile: ReturnType<typeof useAuth>["profile"],
  config: ReimbursementConfig,
): FormState {
  const employee = profile?.type === "employee" ? profile : null;
  return {
    employeeName: employee?.fullName ?? "",
    employeeId: employee?.employeeCode ?? "",
    department: employee?.department ?? "",
    projectName: "",
    projectId: "",
    category: config.categories[0] ?? "",
    expenseDate: "",
    expenseAmount: "",
    currency: config.defaultCurrency || "INR",
    reason: "",
    paymentMethod: "",
    declarationAccepted: false,
    receipt: null,
  };
}

function formFromRequest(request: ReimbursementRequest): FormState {
  return {
    employeeName: request.employeeName ?? "",
    employeeId: request.employeeId ?? request.employeeCode ?? "",
    department: request.department ?? "",
    projectName: request.projectName ?? "",
    projectId: (request as { projectId?: string | null }).projectId ?? "",
    category: request.category ?? "",
    expenseDate: request.expenseDate ?? "",
    expenseAmount: request.expenseAmount == null ? "" : String(request.expenseAmount),
    currency: request.currency || "INR",
    reason: request.reason ?? "",
    paymentMethod: request.paymentMethod ?? "",
    declarationAccepted: request.declarationAccepted,
    receipt: null,
  };
}

function toFormData(form: FormState, saveAsDraft: boolean): FormData {
  const payload = new FormData();
  payload.append("employeeName", form.employeeName);
  payload.append("employeeId", form.employeeId);
  payload.append("department", form.department);
  payload.append("projectName", form.projectName);
  payload.append("projectId", form.projectId);
  payload.append("category", form.category);
  payload.append("expenseDate", form.expenseDate);
  payload.append("expenseAmount", form.expenseAmount);
  payload.append("currency", form.currency);
  payload.append("reason", form.reason);
  payload.append("paymentMethod", form.paymentMethod);
  payload.append("declarationAccepted", String(form.declarationAccepted));
  payload.append("saveAsDraft", String(saveAsDraft));
  if (form.receipt) payload.append("receipt", form.receipt);
  return payload;
}

function amountLabel(request: ReimbursementRequest): string {
  if (request.expenseAmount == null) return "—";
  return `${request.currency || "INR"} ${request.expenseAmount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusVariant(statusValue: string): "default" | "secondary" | "outline" | "destructive" {
  if (statusValue === "paid" || statusValue === "approved_for_payment") return "default";
  if (REJECTED_STATUSES.has(statusValue)) return "destructive";
  if (PENDING_STATUSES.has(statusValue)) return "secondary";
  return "outline";
}

function receiptOcrVariant(statusValue?: string | null): "default" | "secondary" | "outline" | "destructive" {
  if (statusValue === "matched") return "default";
  if (statusValue === "mismatch") return "destructive";
  if (statusValue === "needs_review") return "secondary";
  return "outline";
}

function receiptOcrLabel(statusValue?: string | null): string {
  if (statusValue === "matched") return "Amount matched";
  if (statusValue === "mismatch") return "Amount mismatch";
  if (statusValue === "needs_review") return "Needs review";
  if (statusValue === "extracted") return "Extracted";
  return "OCR";
}

function actionTitle(target: ReviewTarget | null): string {
  if (!target) return "Action";
  if (target.action === "paid") return "Mark as Paid";
  if (target.action === "acknowledge") return "Acknowledge Receipt";
  if (target.action === "approve") {
    const byScope: Record<string, string> = {
      manager: "Manager Approval",
      hr: "HR Approval",
      leadership: "Leadership Approval",
    };
    return byScope[target.scope] ?? "Approval";
  }
  if (target.action === "reject") return "Reject Request";
  return "Return for Clarification";
}

function ReceiptOcrSummary({ request, compact = false }: { request: ReimbursementRequest; compact?: boolean }) {
  const ocr = request.receiptOcr;
  if (!ocr) return null;

  const status = ocr.validationStatus || ocr.status || "needs_review";
  const detectedAmount =
    typeof ocr.amount === "number"
      ? `${request.currency || "INR"} ${ocr.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;

  return (
    <div
      className={cn(
        "mt-2 rounded-lg border px-3 py-2 text-xs",
        status === "matched" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        status === "mismatch" && "border-destructive/30 bg-destructive/10 text-destructive",
        status !== "matched" && status !== "mismatch" && "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={receiptOcrVariant(status)} className="text-[10px]">
          {receiptOcrLabel(status)}
        </Badge>
        {detectedAmount && <span>OCR: {detectedAmount}</span>}
        {ocr.vendor && !compact && <span className="truncate">Vendor: {ocr.vendor}</span>}
      </div>
      {(ocr.summary || ocr.validationMessage) && (
        <p className={cn("mt-1 break-words", compact && "line-clamp-2")}>
          {ocr.validationMessage || ocr.summary}
        </p>
      )}
    </div>
  );
}

export default function ReimbursementsPage() {
  const { user, profile } = useAuth();
  const [requests, setRequests] = useState<ReimbursementRequest[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [config, setConfig] = useState<ReimbursementConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ReimbursementRequest | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(profile, DEFAULT_CONFIG));
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [acting, setActing] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: "revoke" | "delete";
    request: ReimbursementRequest;
  } | null>(null);

  const canCreate = profile?.type === "employee";
  const isFinance = userIn(user, ["hr", "office_admin", "admin", "super_admin", "leadership"]);
  const canManagerReview = userIn(user, ["manager", "admin", "super_admin", "leadership"]);
  const canHrReview = userIn(user, ["hr", "admin", "super_admin"]);
  const canLeadershipReview = userIn(user, ["leadership", "admin", "super_admin"]);
  const canPay = userIn(user, ["office_admin", "admin", "super_admin"]);
  const isEmployeeViewer =
    !isFinance && !canManagerReview && !canHrReview && !canLeadershipReview && !canPay;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configData, requestData] = await Promise.all([
        reimbursementsApi.config(),
        reimbursementsApi.list(),
      ]);
      setConfig(configData);
      setRequests(requestData);
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to load reimbursement requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    projectsApi.options().then(setProjectOptions).catch(() => undefined);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!editing && !formOpen) setForm(emptyForm(profile, config));
  }, [profile, config, editing, formOpen]);

  const counts = useMemo(() => {
    return {
      submitted: requests.filter((item) => item.status !== "draft" && item.status !== "revoked").length,
      pending: requests.filter((item) => PENDING_STATUSES.has(item.status)).length,
      approved: requests.filter((item) => APPROVED_STATUSES.has(item.status)).length,
      rejected: requests.filter((item) => REJECTED_STATUSES.has(item.status)).length,
      paid: requests.filter((item) => item.status === "paid").length,
    };
  }, [requests]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(profile, config));
    setFormOpen(true);
  };

  const revokeRequest = async (request: ReimbursementRequest) => {
    setRevokingId(request.id);
    try {
      await reimbursementsApi.revoke(request.id, "Revoked by employee");
      toast.success("Reimbursement request revoked.");
      await load();
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not revoke reimbursement request.");
    } finally {
      setRevokingId(null);
      setConfirmAction(null);
    }
  };

  const deleteRequest = async (request: ReimbursementRequest) => {
    setDeletingId(request.id);
    try {
      await reimbursementsApi.remove(request.id);
      toast.success("Reimbursement request deleted.");
      await load();
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not delete reimbursement request.");
    } finally {
      setDeletingId(null);
      setConfirmAction(null);
    }
  };

  const openEdit = (request: ReimbursementRequest) => {
    setEditing(request);
    setForm(formFromRequest(request));
    setFormOpen(true);
  };

  const saveRequest = async (saveAsDraft: boolean) => {
    setSaving(true);
    try {
      const payload = toFormData(form, saveAsDraft);
      const result = editing
        ? await reimbursementsApi.update(editing.id, payload)
        : await reimbursementsApi.create(payload);
      if (result.status === "missing_information") {
        toast.warning("Saved with missing information.");
      } else {
        toast.success(saveAsDraft ? "Draft saved." : "Reimbursement request submitted.");
      }
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not save reimbursement request.");
    } finally {
      setSaving(false);
    }
  };

  const runAction = async () => {
    if (!reviewTarget) return;
    if ((reviewTarget.action === "reject" || reviewTarget.action === "return") && !reviewComment.trim()) {
      toast.error("Comments are required for return or rejection.");
      return;
    }
    setActing(true);
    try {
      const reviewAction = reviewTarget.action as "approve" | "reject" | "return";
      if (reviewTarget.scope === "manager") {
        await reimbursementsApi.managerAction(reviewTarget.request.id, reviewAction, reviewComment.trim() || undefined);
      } else if (reviewTarget.scope === "hr") {
        await reimbursementsApi.hrAction(reviewTarget.request.id, reviewAction, reviewComment.trim() || undefined);
      } else if (reviewTarget.scope === "leadership") {
        await reimbursementsApi.leadershipAction(reviewTarget.request.id, reviewAction, reviewComment.trim() || undefined);
      } else if (reviewTarget.scope === "finance") {
        await reimbursementsApi.financeAction(reviewTarget.request.id, reviewAction, reviewComment.trim() || undefined);
      } else if (reviewTarget.scope === "acknowledge") {
        await reimbursementsApi.acknowledge(reviewTarget.request.id, reviewComment.trim() || undefined);
      } else {
        await reimbursementsApi.markPaid(reviewTarget.request.id, reviewComment.trim() || undefined);
      }
      toast.success("Reimbursement request updated.");
      setReviewTarget(null);
      setReviewComment("");
      await load();
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Action failed.");
    } finally {
      setActing(false);
    }
  };

  const exportReport = async () => {
    setExporting(true);
    try {
      await reimbursementsApi.downloadExport();
      toast.success("Reimbursement report exported.");
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5 overflow-x-hidden px-4 py-5 sm:p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/40">
            <ReceiptText className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">Reimbursement Requests</h1>
            <p className="text-sm text-muted-foreground">{requests.length} requests</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" size="sm" className="w-full gap-2 sm:w-auto" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {isFinance && (
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 sm:w-auto"
              disabled={exporting}
              onClick={() => void exportReport()}
            >
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export
            </Button>
          )}
          {canCreate && (
            <Button size="sm" className="w-full gap-2 sm:w-auto" onClick={openCreate}>
              <WalletCards className="h-4 w-4" />
              New Request
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[
          { label: "Submitted", value: counts.submitted, icon: Send },
          { label: "Pending", value: counts.pending, icon: Clock },
          { label: "Approved", value: counts.approved, icon: CheckCircle2 },
          { label: "Rejected", value: counts.rejected, icon: XCircle },
          { label: "Paid", value: counts.paid, icon: WalletCards },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="border-border/80">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-2xl font-semibold">{item.value}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.label}</p>
                </div>
                <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-border/80">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center text-sm text-muted-foreground">
              <FileText className="h-8 w-8" />
              No reimbursement requests found.
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 lg:hidden">
                {requests.map((request) => (
                  <div key={request.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">{request.projectName || "Untitled request"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{request.employeeName} · {amountLabel(request)}</p>
                      </div>
                      <Badge variant={statusVariant(request.status)}>{request.statusLabel || formatLabel(request.status)}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <span>{formatDate(request.expenseDate || "")}</span>
                      <span className="truncate">{request.category || "—"}</span>
                      <span>Manager: {request.managerName || "—"}</span>
                      <span>Updated: {formatDateTime(request.updatedAt || request.createdAt || "")}</span>
                    </div>
                    {request.missingFields.length > 0 && (
                      <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
                        Missing: {request.missingFields.join(", ")}
                      </p>
                    )}
                    <ReceiptOcrSummary request={request} />
                    <RequestActions
                      request={request}
                      canEdit={canCreate && profile?.type === "employee" && profile.id === request.employeeProfileId && EDITABLE_STATUSES.has(request.status)}
                      canRevoke={canCreate && profile?.type === "employee" && profile.id === request.employeeProfileId && REVOCABLE_STATUSES.has(request.status)}
                      revoking={revokingId === request.id}
                      canDelete={canCreate && profile?.type === "employee" && profile.id === request.employeeProfileId && DELETABLE_STATUSES.has(request.status)}
                      deleting={deletingId === request.id}
                      canManagerReview={canManagerReview}
                      canHrReview={canHrReview}
                      canLeadershipReview={canLeadershipReview}
                      canPay={canPay}
                      isEmployeeViewer={isEmployeeViewer}
                      onEdit={openEdit}
                      onRevoke={(request) => setConfirmAction({ type: "revoke", request })}
                      onDelete={(request) => setConfirmAction({ type: "delete", request })}
                      onAction={setReviewTarget}
                    />
                    <AuditTrail request={request} />
                  </div>
                ))}
              </div>

              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{request.employeeName}</p>
                            <p className="text-xs text-muted-foreground">{request.employeeId}</p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <p className="truncate">{request.projectName || "—"}</p>
                          {request.receiptFileUrl && (
                            <a
                              href={request.receiptFileUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              {request.receiptFileName || "Receipt"}
                            </a>
                          )}
                          <ReceiptOcrSummary request={request} compact />
                        </TableCell>
                        <TableCell className="max-w-[260px] truncate">{request.category || "—"}</TableCell>
                        <TableCell>{formatDate(request.expenseDate || "")}</TableCell>
                        <TableCell>{amountLabel(request)}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(request.status)}>{request.statusLabel || formatLabel(request.status)}</Badge>
                          {request.missingFields.length > 0 && (
                            <p className="mt-1 max-w-[220px] truncate text-xs text-amber-500">
                              {request.missingFields.join(", ")}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>{request.managerName || "—"}</TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <RequestActions
                              request={request}
                              compact
                              canEdit={canCreate && profile?.type === "employee" && profile.id === request.employeeProfileId && EDITABLE_STATUSES.has(request.status)}
                              canRevoke={canCreate && profile?.type === "employee" && profile.id === request.employeeProfileId && REVOCABLE_STATUSES.has(request.status)}
                              revoking={revokingId === request.id}
                              canDelete={canCreate && profile?.type === "employee" && profile.id === request.employeeProfileId && DELETABLE_STATUSES.has(request.status)}
                              deleting={deletingId === request.id}
                              canManagerReview={canManagerReview}
                              canHrReview={canHrReview}
                              canLeadershipReview={canLeadershipReview}
                              canPay={canPay}
                              isEmployeeViewer={isEmployeeViewer}
                              onEdit={openEdit}
                              onRevoke={(request) => setConfirmAction({ type: "revoke", request })}
                              onDelete={(request) => setConfirmAction({ type: "delete", request })}
                              onAction={setReviewTarget}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Update Reimbursement Request" : "New Reimbursement Request"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Employee Name" required>
              <Input value={form.employeeName} onChange={(event) => setForm((prev) => ({ ...prev, employeeName: event.target.value }))} />
            </Field>
            <Field label="Employee ID" required>
              <Input value={form.employeeId} onChange={(event) => setForm((prev) => ({ ...prev, employeeId: event.target.value }))} />
            </Field>
            <Field label="Department" required>
              <Input value={form.department} onChange={(event) => setForm((prev) => ({ ...prev, department: event.target.value }))} />
            </Field>
            <Field label="Project" required>
              <Select
                value={form.projectId}
                onValueChange={(value) =>
                  setForm((prev) => ({
                    ...prev,
                    projectId: value ?? "",
                    projectName: projectOptions.find((o) => o.id === value)?.internalName ?? prev.projectName,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a project">
                    {(value) => projectOptions.find((o) => o.id === value)?.internalName ?? "Select a project"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.internalName}{option.client ? ` · ${option.client}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Reimbursement Category" required>
              <Select value={form.category} onValueChange={(value) => setForm((prev) => ({ ...prev, category: value ?? "" }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {config.categories.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Expense Date" required>
              <Input type="date" value={form.expenseDate} onChange={(event) => setForm((prev) => ({ ...prev, expenseDate: event.target.value }))} />
            </Field>
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <Field label="Currency" required>
                <Input value={form.currency} onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))} />
              </Field>
              <Field label="Expense Amount" required>
                <Input type="number" min="0" step="0.01" value={form.expenseAmount} onChange={(event) => setForm((prev) => ({ ...prev, expenseAmount: event.target.value }))} />
              </Field>
            </div>
            <Field label="Payment Method" required>
              <Input value={form.paymentMethod} onChange={(event) => setForm((prev) => ({ ...prev, paymentMethod: event.target.value }))} />
            </Field>
            <Field label="Reason for Expense" required className="sm:col-span-2">
              <Textarea rows={3} value={form.reason} onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))} />
            </Field>
            <Field label="Receipt/Invoice Upload" required className="sm:col-span-2">
              <Input type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={(event) => setForm((prev) => ({ ...prev, receipt: event.target.files?.[0] ?? null }))} />
              {editing?.receiptFileName && !form.receipt && (
                <a href={editing.receiptFileUrl || "#"} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                  Current receipt: {editing.receiptFileName}
                </a>
              )}
            </Field>
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 sm:col-span-2">
              <Checkbox
                checked={form.declarationAccepted}
                onCheckedChange={(checked) => setForm((prev) => ({ ...prev, declarationAccepted: checked === true }))}
                className="mt-0.5"
              />
              <span className="text-sm text-muted-foreground">
                I declare that this expense was incurred for official company/project work.
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button variant="secondary" className="gap-2" onClick={() => void saveRequest(true)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
              Save Draft
            </Button>
            <Button className="gap-2" onClick={() => void saveRequest(false)} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reviewTarget} onOpenChange={(open) => { if (!open) { setReviewTarget(null); setReviewComment(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionTitle(reviewTarget)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{reviewTarget?.request.employeeName}</p>
              <p className="text-muted-foreground">{reviewTarget?.request.projectName || "—"} · {reviewTarget ? amountLabel(reviewTarget.request) : "—"}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="review-comment">
                Comments{reviewTarget?.action === "reject" || reviewTarget?.action === "return" ? " *" : ""}
              </Label>
              <Textarea
                id="review-comment"
                rows={4}
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewTarget(null)} disabled={acting}>Cancel</Button>
            <Button
              variant={reviewTarget?.action === "reject" ? "destructive" : "default"}
              className="gap-2"
              onClick={() => void runAction()}
              disabled={acting}
            >
              {acting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        title={confirmAction?.type === "delete" ? "Delete reimbursement request?" : "Revoke reimbursement request?"}
        description={
          confirmAction?.type === "delete"
            ? "This will permanently remove the reimbursement request from your dashboard."
            : "This will revoke the reimbursement request and stop the current approval workflow."
        }
        confirmLabel={confirmAction?.type === "delete" ? "Delete" : "Revoke"}
        destructive
        loading={
          Boolean(confirmAction?.type === "delete" && deletingId === confirmAction.request.id) ||
          Boolean(confirmAction?.type === "revoke" && revokingId === confirmAction.request.id)
        }
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        onConfirm={() => {
          if (!confirmAction) return;
          if (confirmAction.type === "delete") void deleteRequest(confirmAction.request);
          else void revokeRequest(confirmAction.request);
        }}
      />
    </div>
  );
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label>
        {label}{required ? " *" : ""}
      </Label>
      {children}
    </div>
  );
}

function RequestActions({
  request,
  canEdit,
  canRevoke,
  revoking,
  canDelete,
  deleting,
  canManagerReview,
  canHrReview,
  canLeadershipReview,
  canPay,
  isEmployeeViewer,
  compact = false,
  onEdit,
  onRevoke,
  onDelete,
  onAction,
}: {
  request: ReimbursementRequest;
  canEdit: boolean;
  canRevoke: boolean;
  revoking: boolean;
  canDelete: boolean;
  deleting: boolean;
  canManagerReview: boolean;
  canHrReview: boolean;
  canLeadershipReview: boolean;
  canPay: boolean;
  isEmployeeViewer: boolean;
  compact?: boolean;
  onEdit: (request: ReimbursementRequest) => void;
  onRevoke: (request: ReimbursementRequest) => void;
  onDelete: (request: ReimbursementRequest) => void;
  onAction: (target: ReviewTarget) => void;
}) {
  const actions: ReactNode[] = [];
  if (canEdit) {
    actions.push(
      <Button key="edit" size="sm" variant="outline" className="gap-1" onClick={() => onEdit(request)}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>,
    );
  }
  if (canRevoke) {
    actions.push(
      <Button key="revoke" size="sm" variant="destructive" className="gap-1" disabled={revoking} onClick={() => onRevoke(request)}>
        {revoking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        Revoke
      </Button>,
    );
  }
  if (canDelete) {
    actions.push(
      <Button key="delete" size="sm" variant="destructive" className="gap-1" disabled={deleting} onClick={() => onDelete(request)}>
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        Delete
      </Button>,
    );
  }
  if (canManagerReview && request.status === "pending_manager_review") {
    actions.push(
      <Button key="m-approve" size="sm" className="gap-1" onClick={() => onAction({ request, action: "approve", scope: "manager" })}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approve
      </Button>,
      <Button key="m-return" size="sm" variant="outline" className="gap-1" onClick={() => onAction({ request, action: "return", scope: "manager" })}>
        <RotateCcw className="h-3.5 w-3.5" />
        Return
      </Button>,
      <Button key="m-reject" size="sm" variant="destructive" className="gap-1" onClick={() => onAction({ request, action: "reject", scope: "manager" })}>
        <XCircle className="h-3.5 w-3.5" />
        Reject
      </Button>,
    );
  }
  if (canHrReview && (request.status === "pending_hr_review" || request.status === "manager_approved")) {
    actions.push(
      <Button key="hr-approve" size="sm" className="gap-1" onClick={() => onAction({ request, action: "approve", scope: "hr" })}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approve
      </Button>,
      <Button key="hr-return" size="sm" variant="outline" className="gap-1" onClick={() => onAction({ request, action: "return", scope: "hr" })}>
        <RotateCcw className="h-3.5 w-3.5" />
        Return
      </Button>,
      <Button key="hr-reject" size="sm" variant="destructive" className="gap-1" onClick={() => onAction({ request, action: "reject", scope: "hr" })}>
        <XCircle className="h-3.5 w-3.5" />
        Reject
      </Button>,
    );
  }
  if (canLeadershipReview && request.status === "pending_leadership_review") {
    actions.push(
      <Button key="lead-approve" size="sm" className="gap-1" onClick={() => onAction({ request, action: "approve", scope: "leadership" })}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approve
      </Button>,
      <Button key="lead-return" size="sm" variant="outline" className="gap-1" onClick={() => onAction({ request, action: "return", scope: "leadership" })}>
        <RotateCcw className="h-3.5 w-3.5" />
        Return
      </Button>,
      <Button key="lead-reject" size="sm" variant="destructive" className="gap-1" onClick={() => onAction({ request, action: "reject", scope: "leadership" })}>
        <XCircle className="h-3.5 w-3.5" />
        Reject
      </Button>,
    );
  }
  if (canPay && request.status === "approved_for_payment") {
    actions.push(
      <Button key="paid" size="sm" className="gap-1" onClick={() => onAction({ request, action: "paid", scope: "payment" })}>
        <WalletCards className="h-3.5 w-3.5" />
        Mark Paid
      </Button>,
    );
  }
  if (isEmployeeViewer && request.status === "paid") {
    actions.push(
      <Button key="ack" size="sm" className="gap-1" onClick={() => onAction({ request, action: "acknowledge", scope: "acknowledge" })}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Acknowledge
      </Button>,
    );
  }
  if (actions.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className={cn("mt-4 flex flex-wrap gap-2", compact && "mt-0 justify-end")}>
      {actions}
    </div>
  );
}

function AuditTrail({ request }: { request: ReimbursementRequest }) {
  if (!request.auditTrail.length) return null;
  const latest = request.auditTrail.slice(-3).reverse();
  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3">
      {latest.map((entry) => (
        <div key={entry.id} className="flex items-start justify-between gap-3 text-xs">
          <div className="min-w-0">
            <p className="truncate font-medium">{formatLabel(entry.action)}</p>
            {entry.comment && <p className="mt-0.5 break-words text-muted-foreground">{entry.comment}</p>}
          </div>
          <span className="shrink-0 text-muted-foreground">{formatDateTime(entry.createdAt || "")}</span>
        </div>
      ))}
    </div>
  );
}

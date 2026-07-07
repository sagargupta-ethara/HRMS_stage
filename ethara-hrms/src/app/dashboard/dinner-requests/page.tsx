"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDate, formatDateTime, formatLabel, hasAssignedRole } from "@/lib/utils";
import { dinnerRequestsApi, projectsApi, type DinnerRequest, type ProjectOption } from "@/lib/api";
import type { Role } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  UtensilsCrossed,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const EDITABLE_STATUSES = new Set(["draft", "returned"]);
const DELETABLE_STATUSES = new Set(["draft", "returned", "pending_review", "rejected"]);
const REVIEWABLE_STATUS = "pending_review";
const COMPLETABLE_STATUS = "approved";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const REQUESTER_TYPE_OPTIONS = [
  { value: "project_lead", label: "Project Lead" },
  { value: "tpm", label: "TPM" },
] as const;

type FormState = {
  requesterName: string;
  requesterType: string;
  dinnerDate: string;
  projectName: string;
  projectId: string;
  amount: string;
  teamMemberCount: string;
  teamMemberEmails: string;
};

type ReviewTarget = {
  request: DinnerRequest;
  action: "approve" | "reject" | "return" | "complete";
};

function userIn(user: ReturnType<typeof useAuth>["user"], roles: Role[]): boolean {
  return hasAssignedRole(user, roles);
}

function parseEmails(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function rawEmails(value: string): string[] {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function emptyForm(profile: ReturnType<typeof useAuth>["profile"], userName?: string): FormState {
  const employee = profile?.type === "employee" ? profile : null;
  return {
    requesterName: employee?.fullName ?? userName ?? "",
    requesterType: "project_lead",
    dinnerDate: "",
    projectName: "",
    projectId: "",
    amount: "",
    teamMemberCount: "",
    teamMemberEmails: "",
  };
}

function formFromRequest(request: DinnerRequest): FormState {
  return {
    requesterName: request.requesterName,
    requesterType: request.requesterType || "project_lead",
    dinnerDate: request.dinnerDate ?? "",
    projectName: request.projectName ?? "",
    projectId: (request as { projectId?: string | null }).projectId ?? "",
    amount: (request as { amount?: number | null }).amount == null ? "" : String((request as { amount?: number | null }).amount),
    teamMemberCount: request.teamMemberCount == null ? "" : String(request.teamMemberCount),
    teamMemberEmails: (request.teamMemberEmails || []).join("\n"),
  };
}

function payloadFromForm(form: FormState, saveAsDraft: boolean) {
  return {
    requesterName: form.requesterName,
    requesterType: form.requesterType,
    dinnerDate: form.dinnerDate,
    projectName: form.projectName,
    projectId: form.projectId,
    amount: form.amount ? Number(form.amount) : null,
    teamMemberCount: form.teamMemberCount ? Number(form.teamMemberCount) : null,
    teamMemberEmails: parseEmails(form.teamMemberEmails),
    saveAsDraft,
  };
}

function dinnerSubmitError(form: FormState): string | null {
  if (!form.requesterName.trim()) return "Project Lead/TPM Name is required.";
  if (!REQUESTER_TYPE_OPTIONS.some((option) => option.value === form.requesterType)) {
    return "Requester Type is required.";
  }
  if (!form.dinnerDate) return "Date is required.";
  if (!form.projectId.trim()) return "Project is required.";
  const memberCount = Number(form.teamMemberCount);
  if (!Number.isInteger(memberCount) || memberCount <= 0) {
    return "Number of Team Members must be greater than 0.";
  }
  const enteredEmails = rawEmails(form.teamMemberEmails);
  if (enteredEmails.length === 0) return "Team Members' Email IDs are required.";
  const invalidEmails = enteredEmails.filter((email) => !EMAIL_RE.test(email));
  if (invalidEmails.length > 0) return `Invalid email IDs: ${invalidEmails.join(", ")}.`;
  const uniqueEmailCount = parseEmails(form.teamMemberEmails).length;
  if (memberCount !== uniqueEmailCount) {
    return `Number of Team Members must match the email ID count. You entered ${memberCount} members and ${uniqueEmailCount} email IDs.`;
  }
  return null;
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  if (status === "approved" || status === "completed") return "default";
  if (status === "rejected") return "destructive";
  if (status === "pending_review" || status === "returned") return "secondary";
  return "outline";
}

function requesterTypeLabel(value: string): string {
  if (value === "tpm") return "TPM";
  return "Project Lead";
}

function reviewTitle(target: ReviewTarget | null): string {
  if (!target) return "Review Dinner Request";
  if (target.action === "approve") return "Approve Dinner Request";
  if (target.action === "reject") return "Reject Dinner Request";
  if (target.action === "return") return "Return for Clarification";
  return "Mark Dinner Request Completed";
}

export default function DinnerRequestsPage() {
  const { user, profile } = useAuth();
  const [requests, setRequests] = useState<DinnerRequest[]>([]);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DinnerRequest | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyForm(profile, user?.name));
  const [reviewTarget, setReviewTarget] = useState<ReviewTarget | null>(null);
  const [reviewComment, setReviewComment] = useState("");
  const [acting, setActing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DinnerRequest | null>(null);

  const canCreate = userIn(user, ["manager", "leadership", "admin", "super_admin", "hr", "office_admin"]);
  const isReviewer = userIn(user, ["admin", "super_admin", "leadership", "hr", "office_admin"]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await dinnerRequestsApi.list());
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Failed to load dinner requests.");
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
    if (!editing && !formOpen) setForm(emptyForm(profile, user?.name));
  }, [profile, user?.name, editing, formOpen]);

  const counts = useMemo(() => ({
    draft: requests.filter((item) => item.status === "draft").length,
    pending: requests.filter((item) => item.status === "pending_review").length,
    returned: requests.filter((item) => item.status === "returned").length,
    approved: requests.filter((item) => item.status === "approved").length,
    rejected: requests.filter((item) => item.status === "rejected").length,
    completed: requests.filter((item) => item.status === "completed").length,
  }), [requests]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(profile, user?.name));
    setFormOpen(true);
  };

  const openEdit = (request: DinnerRequest) => {
    setEditing(request);
    setForm(formFromRequest(request));
    setFormOpen(true);
  };

  const saveRequest = async (saveAsDraft: boolean) => {
    if (!saveAsDraft) {
      const error = dinnerSubmitError(form);
      if (error) {
        toast.error(error);
        return;
      }
    }
    setSaving(true);
    try {
      const payload = payloadFromForm(form, saveAsDraft);
      const result = editing
        ? await dinnerRequestsApi.update(editing.id, payload)
        : await dinnerRequestsApi.create(payload);
      toast.success(result.status === "draft" ? "Draft saved." : "Dinner request submitted.");
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not save dinner request.");
    } finally {
      setSaving(false);
    }
  };

  const deleteRequest = async (request: DinnerRequest) => {
    setDeletingId(request.id);
    try {
      await dinnerRequestsApi.remove(request.id);
      toast.success("Dinner request deleted.");
      await load();
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Could not delete dinner request.");
    } finally {
      setDeletingId(null);
      setDeleteTarget(null);
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
      if (reviewTarget.action === "complete") {
        await dinnerRequestsApi.complete(reviewTarget.request.id, reviewComment.trim() || undefined);
      } else {
        await dinnerRequestsApi.review(reviewTarget.request.id, reviewTarget.action, reviewComment.trim() || undefined);
      }
      toast.success("Dinner request updated.");
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
      await dinnerRequestsApi.downloadExport();
      toast.success("Dinner request report exported.");
    } catch (error) {
      const msg = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(msg || "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const enteredEmailCount = parseEmails(form.teamMemberEmails).length;
  const enteredMemberCount = Number(form.teamMemberCount);
  const hasCountMismatch =
    Boolean(form.teamMemberCount) &&
    Number.isFinite(enteredMemberCount) &&
    enteredMemberCount > 0 &&
    enteredEmailCount > 0 &&
    enteredMemberCount !== enteredEmailCount;

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
            <UtensilsCrossed className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">Dinner Requests</h1>
            <p className="text-sm text-muted-foreground">{requests.length} requests</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button variant="ghost" size="sm" className="w-full gap-2 sm:w-auto" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {isReviewer && (
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
              <UtensilsCrossed className="h-4 w-4" />
              New Request
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {[
          { label: "Draft", value: counts.draft, icon: Pencil },
          { label: "Pending", value: counts.pending, icon: Clock },
          { label: "Returned", value: counts.returned, icon: RotateCcw },
          { label: "Approved", value: counts.approved, icon: CheckCircle2 },
          { label: "Rejected", value: counts.rejected, icon: XCircle },
          { label: "Completed", value: counts.completed, icon: UtensilsCrossed },
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
              No dinner requests found.
            </div>
          ) : (
            <>
              <div className="space-y-3 p-4 lg:hidden">
                {requests.map((request) => (
                  <div key={request.id} className="rounded-xl border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">{request.projectName || "Untitled request"}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {requesterTypeLabel(request.requesterType)} · {request.requesterName}
                        </p>
                      </div>
                      <Badge variant={statusVariant(request.status)}>{request.statusLabel || formatLabel(request.status)}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <span>{formatDate(request.dinnerDate || "")}</span>
                      <span>{request.teamMemberCount || 0} members</span>
                      <span className="sm:col-span-2">{request.teamMemberEmails.join(", ") || "—"}</span>
                    </div>
                    <RequestActions
                      request={request}
                      userId={user?.id}
                      canCreate={canCreate}
                      isReviewer={isReviewer}
                      deleting={deletingId === request.id}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
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
                      <TableHead>Requester</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reviewer</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{request.requesterName}</p>
                            <p className="text-xs text-muted-foreground">{requesterTypeLabel(request.requesterType)}</p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate">{request.projectName || "—"}</TableCell>
                        <TableCell>{formatDate(request.dinnerDate || "")}</TableCell>
                        <TableCell className="max-w-[260px]">
                          <p>{request.teamMemberCount || 0} members</p>
                          <p className="truncate text-xs text-muted-foreground">{request.teamMemberEmails.join(", ") || "—"}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(request.status)}>{request.statusLabel || formatLabel(request.status)}</Badge>
                        </TableCell>
                        <TableCell>
                          <p>{request.reviewedBy || "—"}</p>
                          {request.reviewerComments && (
                            <p className="max-w-[220px] truncate text-xs text-muted-foreground">{request.reviewerComments}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end">
                            <RequestActions
                              request={request}
                              userId={user?.id}
                              canCreate={canCreate}
                              isReviewer={isReviewer}
                              deleting={deletingId === request.id}
                              compact
                              onEdit={openEdit}
                              onDelete={setDeleteTarget}
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
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Update Dinner Request" : "New Dinner Request"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project Lead/TPM Name" required>
              <Input value={form.requesterName} onChange={(event) => setForm((prev) => ({ ...prev, requesterName: event.target.value }))} />
            </Field>
            <Field label="Requester Type" required>
              <Select value={form.requesterType} onValueChange={(value) => setForm((prev) => ({ ...prev, requesterType: value ?? "project_lead" }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select requester type">
                    {(value) => requesterTypeLabel(String(value))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {REQUESTER_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date" required>
              <Input type="date" value={form.dinnerDate} onChange={(event) => setForm((prev) => ({ ...prev, dinnerDate: event.target.value }))} />
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
            <Field label="Estimated Amount (₹)">
              <Input value={form.amount} inputMode="numeric" onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))} />
            </Field>
            <Field label="Number of Team Members" required>
              <Input
                type="number"
                min="1"
                value={form.teamMemberCount}
                onChange={(event) => setForm((prev) => ({ ...prev, teamMemberCount: event.target.value }))}
              />
            </Field>
            <Field label="Team Members' Email IDs" required className="sm:col-span-2">
              <Textarea
                rows={5}
                value={form.teamMemberEmails}
                onChange={(event) => setForm((prev) => ({ ...prev, teamMemberEmails: event.target.value }))}
                className="resize-none"
              />
              <p className={cn("text-xs", hasCountMismatch ? "text-destructive" : "text-muted-foreground")}>
                {enteredEmailCount} email IDs entered
                {hasCountMismatch ? `; must match ${enteredMemberCount} team members` : ""}
              </p>
            </Field>
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
            <DialogTitle>{reviewTitle(reviewTarget)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{reviewTarget?.request.projectName}</p>
              <p className="text-muted-foreground">
                {reviewTarget ? `${formatDate(reviewTarget.request.dinnerDate || "")} · ${reviewTarget.request.teamMemberCount || 0} members` : "—"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dinner-review-comment">
                Comments{reviewTarget?.action === "reject" || reviewTarget?.action === "return" ? " *" : ""}
              </Label>
              <Textarea
                id="dinner-review-comment"
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
        open={Boolean(deleteTarget)}
        title="Delete dinner request?"
        description="This will permanently remove the dinner request from your dashboard."
        confirmLabel="Delete"
        destructive
        loading={Boolean(deleteTarget && deletingId === deleteTarget.id)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onConfirm={() => {
          if (deleteTarget) void deleteRequest(deleteTarget);
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
  children: React.ReactNode;
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
  userId,
  canCreate,
  isReviewer,
  deleting,
  compact = false,
  onEdit,
  onDelete,
  onAction,
}: {
  request: DinnerRequest;
  userId?: string;
  canCreate: boolean;
  isReviewer: boolean;
  deleting: boolean;
  compact?: boolean;
  onEdit: (request: DinnerRequest) => void;
  onDelete: (request: DinnerRequest) => void;
  onAction: (target: ReviewTarget) => void;
}) {
  const actions: React.ReactNode[] = [];
  const isOwner = request.requesterUserId === userId;
  if (canCreate && request.requesterUserId === userId && EDITABLE_STATUSES.has(request.status)) {
    actions.push(
      <Button key="edit" size="sm" variant="outline" className="gap-1" onClick={() => onEdit(request)}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>,
    );
  }
  if (canCreate && isOwner && DELETABLE_STATUSES.has(request.status)) {
    actions.push(
      <Button key="delete" size="sm" variant="destructive" className="gap-1" disabled={deleting} onClick={() => onDelete(request)}>
        {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        Delete
      </Button>,
    );
  }
  if (isReviewer && request.status === REVIEWABLE_STATUS) {
    actions.push(
      <Button key="approve" size="sm" className="gap-1" onClick={() => onAction({ request, action: "approve" })}>
        <CheckCircle2 className="h-3.5 w-3.5" />
        Approve
      </Button>,
      <Button key="return" size="sm" variant="outline" className="gap-1" onClick={() => onAction({ request, action: "return" })}>
        <RotateCcw className="h-3.5 w-3.5" />
        Return
      </Button>,
      <Button key="reject" size="sm" variant="destructive" className="gap-1" onClick={() => onAction({ request, action: "reject" })}>
        <XCircle className="h-3.5 w-3.5" />
        Reject
      </Button>,
    );
  }
  if (isReviewer && request.status === COMPLETABLE_STATUS) {
    actions.push(
      <Button key="complete" size="sm" className="gap-1" onClick={() => onAction({ request, action: "complete" })}>
        <UtensilsCrossed className="h-3.5 w-3.5" />
        Complete
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

function AuditTrail({ request }: { request: DinnerRequest }) {
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

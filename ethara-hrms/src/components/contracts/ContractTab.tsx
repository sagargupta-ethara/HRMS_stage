"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CheckCircle2, Clock, Download, ExternalLink, FileCheck, Loader2,
  RefreshCw, Send, AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  documensoApi,
  type DocumensoContract,
  type DocumensoContractField,
  type DocumensoTemplate,
  type SendContractPayload,
} from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-errors";
import { cn, formatDateTime, formatLabel } from "@/lib/utils";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  signed: "default",
  sent: "outline",
  viewed: "outline",
  draft: "secondary",
  expired: "destructive",
};

const STATUS_LABEL: Record<string, string> = {
  signed: "Signed",
  sent: "Contract Sent",
  viewed: "Viewed",
  draft: "Draft",
  expired: "Expired / Rejected",
};

function effectiveContractStatus(currentStage: string, status?: string): string {
  if (status && status !== "draft") return status;
  if (currentStage === "contract_signed") return "signed";
  if (currentStage === "contract_sent") return "sent";
  return "draft";
}

function canIssueContract(status: string): boolean {
  // Matches the backend send flow (DRAFT / EXPIRED / CANCELLED are re-sendable) and the
  // Contracts dashboard — so a cancelled/replaced contract can be re-issued from here too.
  return status === "draft" || status === "expired" || status === "cancelled";
}

type Props = {
  candidateId: string;
  candidateName: string;
  currentStage: string;
  initialContract?: DocumensoContract | null;
};

export function ContractTab({ candidateId, candidateName, currentStage, initialContract }: Props) {
  const qc = useQueryClient();
  const [contract, setContract] = useState<DocumensoContract | null>(initialContract ?? null);
  const [fields, setFields] = useState<DocumensoContractField[]>([]);
  const [templates, setTemplates] = useState<DocumensoTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendOpen, setSendOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshingTemplates, setRefreshingTemplates] = useState(false);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [ctcValue, setCtcValue] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const selectedTemplate = templates.find(
    (template) => String(template.templateId) === selectedTemplateId,
  ) ?? null;

  const canSend = ![
    "new_application",
    "source_tagged",
    "resume_uploaded",
    "resume_screening_pending",
    "resume_shortlisted",
    "resume_rejected",
    "evaluation_assigned",
    "evaluation_in_progress",
    "evaluation_failed",
  ].includes(currentStage);
  const contractStatus = effectiveContractStatus(currentStage, contract?.status);
  const canSendContract = canSend && canIssueContract(contractStatus);
  const canReplaceContract = canSend && ["signed", "sent", "viewed"].includes(contractStatus);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [contractData, templateList] = await Promise.allSettled([
        documensoApi.getContract(candidateId),
        documensoApi.listTemplates(),
      ]);

      if (contractData.status === "fulfilled") {
        setContract(contractData.value);
        if (contractData.value?.id) {
          try {
            const f = await documensoApi.getContractFields(candidateId);
            setFields(f);
          } catch {
            setFields([]);
          }
        }
      }
      if (templateList.status === "fulfilled") {
        setTemplates(templateList.value);
        setSelectedTemplateId((current) => current || String(templateList.value[0]?.templateId ?? ""));
      }
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

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

  const handleSendContract = async () => {
    if (!canSendContract) {
      toast.error("This contract is already active. Use the Contracts page to check status.");
      return;
    }
    if (!selectedTemplateId) {
      toast.error("Select a template first");
      return;
    }
    setSending(true);
    try {
      const payload: SendContractPayload = {
        templateId: Number(selectedTemplateId),
        sendImmediately: true,
      };
      if (ctcValue) payload.ctc = Number(ctcValue);
      if (joiningDate) payload.joiningDate = new Date(joiningDate).toISOString();

      const updated = await documensoApi.sendContract(candidateId, payload);
      setContract(updated);
      setSendOpen(false);
      toast.success(`Contract sent to ${candidateName}`);
      qc.invalidateQueries({ queryKey: ["candidate", candidateId] });
      try {
        const f = await documensoApi.getContractFields(candidateId);
        setFields(f);
          } catch {
            setFields([]);
          }
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Failed to send contract"));
    } finally {
      setSending(false);
    }
  };

  const handleReplaceContract = async () => {
    setReplacing(true);
    try {
      await documensoApi.cancelContract(candidateId, {
        force: true,
        reason: "Cancelled to send a replacement contract",
      });
      setReplaceConfirmOpen(false);
      toast.success("Existing contract cancelled — send the replacement now.");
      await loadData();
      qc.invalidateQueries({ queryKey: ["candidate", candidateId] });
      setSendOpen(true);
    } catch (err: unknown) {
      toast.error(apiErrorMessage(err, "Failed to cancel the existing contract"));
    } finally {
      setReplacing(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-0 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">Contract Status</CardTitle>
          {canSendContract && (
            <Button size="sm" onClick={() => setSendOpen(true)} className="gap-2">
              <Send className="h-4 w-4" />
              {contractStatus === "expired" ? "Send Again" : "Send Contract"}
            </Button>
          )}
          {canReplaceContract && (
            <Button size="sm" variant="outline" onClick={() => setReplaceConfirmOpen(true)} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Replace Contract
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {contract ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={STATUS_VARIANT[contract.status] ?? "secondary"}>
                  {STATUS_LABEL[contract.status] ?? formatLabel(contract.status)}
                </Badge>
              </div>

              {contract.ctc && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">CTC</span>
                  <span className="text-sm font-medium">
                    ₹{Number(contract.ctc).toLocaleString("en-IN")}
                  </span>
                </div>
              )}

              {contract.joiningDate && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Joining Date</span>
                  <span className="text-sm font-medium">
                    {formatDateTime(contract.joiningDate)}
                  </span>
                </div>
              )}

              {contract.sentAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Sent
                  </span>
                  <span className="text-sm">{formatDateTime(contract.sentAt)}</span>
                </div>
              )}

              {contract.viewedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <FileCheck className="h-3 w-3" /> Viewed
                  </span>
                  <span className="text-sm">{formatDateTime(contract.viewedAt)}</span>
                </div>
              )}

              {contract.signedAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" /> Signed
                  </span>
                  <span className="text-sm font-medium text-green-600">
                    {formatDateTime(contract.signedAt)}
                  </span>
                </div>
              )}

              <Separator />

              <div className="flex flex-wrap gap-2">
                {contract.signedUrl && contract.status !== "signed" && (
                  <a
                    href={contract.signedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 py-1 text-[0.8rem] font-medium hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Signing Link
                  </a>
                )}
                {contract.signedItems && contract.signedItems.length > 0
                  ? contract.signedItems
                      .filter((item) => item.url)
                      .map((item) => (
                        <a
                          key={item.itemId ?? item.type ?? item.title}
                          href={item.url ?? undefined}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 py-1 text-[0.8rem] font-medium hover:bg-muted transition-colors"
                        >
                          <Download className="h-4 w-4" />
                          {item.title || "Signed document"}
                        </a>
                      ))
                  : contract.pdfUrl && (
                      <a
                        href={contract.pdfUrl}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 py-1 text-[0.8rem] font-medium hover:bg-muted transition-colors"
                      >
                        <Download className="h-4 w-4" />
                        Download Signed PDF
                      </a>
                    )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center py-6 gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No contract yet. Use &ldquo;Send Contract&rdquo; to generate one from a Documenso template.
              </p>
              {!canSend && (
                <p className="text-xs text-muted-foreground">
                  Available after selection form is validated.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {fields.length > 0 && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Extracted Field Values</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Signer</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium text-sm">{f.fieldName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-xs">{f.fieldType}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{f.fieldValue ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{f.recipientEmail ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Contract via Documenso</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Template</Label>
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
              <Select
                value={selectedTemplateId}
                onValueChange={(v) => setSelectedTemplateId(v ?? "")}
              >
                <SelectTrigger className="w-full min-w-0">
                  <SelectValue className="min-w-0 truncate" placeholder="Select contract template…">
                    {(value) => {
                      if (!value) return "Select contract template…";
                      return selectedTemplate?.title ?? String(value);
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent
                  align="start"
                  className="w-auto min-w-[var(--anchor-width)] max-w-[calc(100vw-3rem)]"
                >
                  {templates.length === 0 ? (
                    <SelectItem value="_empty" disabled>
                      No templates cached — click Refresh
                    </SelectItem>
                  ) : (
                    templates.map((t) => (
                      <SelectItem key={t.templateId} value={String(t.templateId)} label={t.title}>
                        {t.title}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ctc">CTC (Annual, optional)</Label>
              <Input
                id="ctc"
                type="number"
                placeholder="e.g. 800000"
                value={ctcValue}
                onChange={(e) => setCtcValue(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="joining">Joining Date (optional)</Label>
              <DatePicker
                id="joining"
                value={joiningDate}
                onChange={(v) => setJoiningDate(v)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              Candidate fields (name, email, phone, position, department) will be pre-filled automatically.
              The signing link will be sent to <strong>{candidateName}&apos;s</strong> registered email.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleSendContract} disabled={sending || !selectedTemplateId || !canSendContract} className="gap-2">
              {sending && <Loader2 className="h-4 w-4 animate-spin" />}
              Send Contract
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replaceConfirmOpen} onOpenChange={setReplaceConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Replace this contract?</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-sm text-muted-foreground">
            <p className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <span>
                This cancels {candidateName}&apos;s current{" "}
                <strong>{STATUS_LABEL[contractStatus] ?? contractStatus}</strong> contract in Documenso
                {contractStatus === "signed" ? ", including the completed signature," : ""} and lets you
                send a new one. This action is logged.
              </span>
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplaceConfirmOpen(false)} disabled={replacing}>
              Keep contract
            </Button>
            <Button variant="destructive" onClick={handleReplaceContract} disabled={replacing} className="gap-2">
              {replacing && <Loader2 className="h-4 w-4 animate-spin" />}
              Cancel &amp; Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

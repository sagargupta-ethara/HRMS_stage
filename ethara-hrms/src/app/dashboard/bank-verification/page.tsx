"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { cn, formatDateTime, hasAssignedRole } from "@/lib/utils";
import {
  bankVerificationApi,
  type BankVerificationRow,
  type BankVerificationStatus,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, FileSpreadsheet, Landmark, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

const STATUS_STYLE: Record<BankVerificationStatus, string> = {
  validated: "bg-success/10 text-success border-success/30",
  pending: "bg-warning/10 text-warning border-warning/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  missing_details: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL: Record<BankVerificationStatus, string> = {
  validated: "Validated",
  pending: "Pending",
  failed: "Failed",
  missing_details: "No bank details",
};

export default function BankVerificationPage() {
  const { user } = useAuth();
  const canManage = hasAssignedRole(user, ["super_admin", "admin", "leadership", "office_admin"]);

  const [rows, setRows] = useState<BankVerificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await bankVerificationApi.list();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Failed to load bank verification list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    bankVerificationApi
      .list()
      .then((data) => { if (active) setRows(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) toast.error("Failed to load bank verification list."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const counts = useMemo(() => {
    const c = { validated: 0, pending: 0, failed: 0, missing_details: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  const handleExport = async () => {
    setExporting(true);
    try {
      await bankVerificationApi.exportSheet(false);
      toast.success("Bank sheet exported. The selected accounts are marked as sent for penny drop.");
      load();
    } catch {
      toast.error("No accounts are pending penny-drop export (all validated or missing bank details).");
    } finally {
      setExporting(false);
    }
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const result = await bankVerificationApi.uploadResults(file);
      const notFound = result.notFound?.length ? ` ${result.notFound.length} email(s) not matched.` : "";
      toast.success(`${result.validated} validated, ${result.failed} failed.${notFound}`);
      load();
    } catch (error: unknown) {
      const detail =
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Failed to process the result sheet.";
      toast.error(typeof detail === "string" ? detail : "Failed to process the result sheet.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Landmark className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Penny Drop / Bank Verification</h1>
            <p className="text-sm text-muted-foreground">
              Verify employee bank accounts via penny drop. Export the bank sheet, run the test, then upload the result sheet.
            </p>
          </div>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setHelpOpen(true)}>
              <FileSpreadsheet className="mr-1.5 h-4 w-4" /> How to upload results
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
              Export bank sheet
            </Button>
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}
              Upload results
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {([
          ["Validated", counts.validated, "text-success"],
          ["Pending", counts.pending, "text-warning"],
          ["Failed", counts.failed, "text-destructive"],
          ["No bank details", counts.missing_details, "text-muted-foreground"],
        ] as const).map(([label, value, tone]) => (
          <Card key={label}>
            <CardContent className="flex flex-col gap-1 py-4">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
              <span className={cn("text-2xl font-semibold", tone)}>{value}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Employees ({rows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No employees found.</p>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="space-y-3 sm:hidden">
                {rows.map((r) => (
                  <div key={r.employeeProfileId} className="rounded-2xl border border-border bg-card/80 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{r.name}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{r.employeeCode} · {r.etharaEmail}</p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0 capitalize", STATUS_STYLE[r.status])}>
                        {STATUS_LABEL[r.status]}
                      </Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="min-w-0 rounded-xl bg-muted/25 px-2.5 py-2">
                        <p className="text-muted-foreground">Bank</p>
                        <div className="mt-0.5 flex items-center gap-1.5 font-medium text-foreground">
                          <span className="truncate">{r.bankName || "—"}</span>
                          {r.isHdfc && (
                            <Badge variant="outline" className="border-primary/30 text-primary">HDFC</Badge>
                          )}
                        </div>
                      </div>
                      <div className="rounded-xl bg-muted/25 px-2.5 py-2">
                        <p className="text-muted-foreground">Account</p>
                        <p className="mt-0.5 font-medium tabular-nums text-foreground">{r.accountLast4 ? `••••${r.accountLast4}` : "—"}</p>
                      </div>
                      <div className="rounded-xl bg-muted/25 px-2.5 py-2">
                        <p className="text-muted-foreground">IFSC</p>
                        <p className="mt-0.5 font-medium text-foreground">{r.ifsc || "—"}</p>
                      </div>
                      <div className="min-w-0 rounded-xl bg-muted/25 px-2.5 py-2">
                        <p className="text-muted-foreground">Remark / Updated</p>
                        {r.remark ? (
                          <p className="mt-0.5 truncate font-medium text-destructive">{r.remark}</p>
                        ) : r.validatedAt ? (
                          <p className="mt-0.5 font-medium text-foreground">Validated {formatDateTime(r.validatedAt)}</p>
                        ) : r.exportedAt ? (
                          <p className="mt-0.5 font-medium text-foreground">Exported {formatDateTime(r.exportedAt)}</p>
                        ) : (
                          <p className="mt-0.5 font-medium text-muted-foreground">—</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden overflow-x-auto sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee</TableHead>
                      <TableHead>Bank</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>IFSC</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Remark / Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.employeeProfileId}>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.employeeCode} · {r.etharaEmail}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="text-sm">{r.bankName || "—"}</span>
                            {r.isHdfc && (
                              <Badge variant="outline" className="border-primary/30 text-primary">HDFC</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {r.accountLast4 ? `••••${r.accountLast4}` : "—"}
                        </TableCell>
                        <TableCell className="text-sm">{r.ifsc || "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("capitalize", STATUS_STYLE[r.status])}>
                            {STATUS_LABEL[r.status]}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          {r.remark && <div className="truncate text-xs text-destructive">{r.remark}</div>}
                          {r.validatedAt && (
                            <div className="text-xs text-muted-foreground">Validated {formatDateTime(r.validatedAt)}</div>
                          )}
                          {!r.validatedAt && r.exportedAt && (
                            <div className="text-xs text-muted-foreground">Exported {formatDateTime(r.exportedAt)}</div>
                          )}
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

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How to upload penny-drop results</DialogTitle>
            <DialogDescription>
              Upload a CSV with three columns. Match each employee by their Ethara email. Status accepts Pass/Fail.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Remark</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-xs">jane.doe@ethara.ai</TableCell>
                  <TableCell className="text-xs text-success">Pass</TableCell>
                  <TableCell className="text-xs text-muted-foreground">—</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="text-xs">john.smith@ethara.ai</TableCell>
                  <TableCell className="text-xs text-destructive">Fail</TableCell>
                  <TableCell className="text-xs">Account number / IFSC mismatch</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            Pass → the employee is marked <strong>Validated</strong>. Fail → marked <strong>Failed</strong> and the
            employee is notified to update their bank details in the Employee Detail Form.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => bankVerificationApi.downloadTemplate()}>
              <Download className="mr-1.5 h-4 w-4" /> Download template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn, formatDate, getInitials, hasAssignedRole, timeAgo } from "@/lib/utils";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  Loader2,
  Mail,
  Briefcase,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Building2,
  Calendar,
  MoreHorizontal,
  Upload,
  UnlockKeyhole,
  UserCheck,
  Users,
  UserX,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  candidateIdCardApi,
  employeesApi,
  type EmployeeBulkUpdateResult,
  type EmployeeExportParams,
  type EmployeeIssueReminderIssue,
  type EmployeeRecord,
} from "@/lib/api";
import { exportToCsv } from "@/lib/export";
import { IdCardStatusUpload } from "@/components/id-cards/status-upload-dialog";
import { useAuth } from "@/lib/auth-context";
import type { Role } from "@/types";
import { toast } from "sonner";

// ── Bulk import types ──────────────────────────────────────────────────────────

type CsvRow = {
  row: number;
  name: string;
  companyEmail: string;
  employeeCode: string;
  personalEmail: string;
  phone: string;
  department: string;
  designation: string;
  gender: string;
  errors: string[];
};

type BulkResult = {
  total: number;
  created: number;
  failed: number;
  results: { name: string; email: string; employeeCode: string }[];
  errors: {
    row: number;
    name: string;
    email: string;
    employeeCode: string;
    errors: string[];
  }[];
};

// ── CSV parsing ────────────────────────────────────────────────────────────────

const TEMPLATE_CSV =
  "name,company_email,employee_code,personal_email,phone,department,designation,gender\n" +
  "Jane Doe,jane.doe@ethara.ai,EMP001,jane@gmail.com,9876543210,Engineering,Software Engineer,female\n" +
  "John Smith,john.smith@ethara.ai,EMP002,john@gmail.com,9123456789,HR,HR Manager,male";

const FULL_EMPLOYEE_DETAIL_ROLES = new Set<Role>(["super_admin", "admin", "hr", "ta"]);

function normHeader(h: string) {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, "_")
    .replace(/[^a-z_]/g, "");
}

function pickCol(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = (row[k] ?? "").trim();
    if (v) return v;
  }
  return "";
}

// RFC 4180-compliant parser: handles quoted fields, embedded commas/newlines,
// and escaped double-quotes ("") so the preview matches the backend's csv reader.
function parseCsvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  // flush trailing field/row (no terminating newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // drop fully-blank rows
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function parseCsv(text: string): CsvRow[] {
  const grid = parseCsvGrid(text);
  if (grid.length < 2) return [];

  const headers = grid[0].map((h) => normHeader(h.trim()));

  return grid
    .slice(1)
    .map((vals, i) => {
      const row: Record<string, string> = Object.fromEntries(
        headers.map((h, j) => [h, (vals[j] ?? "").trim()]),
      );

      const name = pickCol(
        row,
        "name",
        "full_name",
        "fullname",
        "employee_name",
      );
      const companyEmail = pickCol(
        row,
        "company_email",
        "ethara_email",
        "email",
        "work_email",
      );
      const employeeCode = pickCol(
        row,
        "employee_code",
        "emp_code",
        "code",
        "employee_id",
      );
      const personalEmail = pickCol(row, "personal_email", "personal");
      const phone = pickCol(row, "phone", "phone_number", "mobile");
      const department = pickCol(row, "department", "dept", "team");
      const designation = pickCol(
        row,
        "designation",
        "job_title",
        "title",
        "position",
      );
      const gender = pickCol(row, "gender", "sex");

      const errors: string[] = [];
      if (!name) errors.push("Name required");
      if (!companyEmail) errors.push("Company email required");
      else if (!companyEmail.toLowerCase().endsWith("@ethara.ai"))
        errors.push("Must end with @ethara.ai");
      if (!employeeCode) errors.push("Employee code required");

      return {
        row: i + 2,
        name,
        companyEmail,
        employeeCode,
        personalEmail,
        phone,
        department,
        designation,
        gender,
        errors,
      };
    })
    .filter((r) => r.name || r.companyEmail || r.employeeCode);
}

// ── Bulk Import Dialog ─────────────────────────────────────────────────────────

function BulkImportDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"upload" | "preview" | "results">("upload");
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const validRows = rows.filter((r) => r.errors.length === 0);
  const invalidRows = rows.filter((r) => r.errors.length > 0);

  const reset = () => {
    setView("upload");
    setCsvFile(null);
    setRows([]);
    setResult(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      toast.error("Only CSV files are accepted.");
      return;
    }
    setCsvFile(file);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseCsv(text);
      if (!parsed.length) {
        toast.error("No valid rows found in the CSV.");
        return;
      }
      setRows(parsed);
      setView("preview");
    };
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ethara_employee_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async () => {
    if (!csvFile || validRows.length === 0) return;
    setIsSubmitting(true);
    try {
      const data = await employeesApi.bulkRegister(csvFile);
      setResult(data);
      setView("results");
      if (data.created > 0) onSuccess();
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail;
      toast.error(msg || "Bulk import failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) handleClose();
      }}
    >
      <DialogContent className="top-2 max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] translate-y-0 overflow-y-auto border-border bg-background p-4 sm:top-1/2 sm:max-h-[calc(100dvh-3rem)] sm:max-w-3xl sm:-translate-y-1/2">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Bulk Employee Import
          </DialogTitle>
        </DialogHeader>

        {/* ── Upload view ── */}
        {view === "upload" && (
          <div className="space-y-4 sm:space-y-5">
            <p className="text-sm text-muted-foreground">
              Upload a CSV with employee details. Accounts are created
              immediately and each member receives their login credentials by
              email.
            </p>

            <div
              className="relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border p-6 text-center transition-colors hover:border-primary/40 cursor-pointer sm:p-10"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files[0] ?? null);
              }}
            >
              <Upload className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">
                Click to upload or drag & drop
              </p>
              <p className="text-xs text-muted-foreground">
                CSV files only · Max 5 MB
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Required columns
              </p>
              <div className="flex flex-wrap gap-2">
                {["name", "company_email", "employee_code"].map((c) => (
                  <span
                    key={c}
                    className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-mono"
                  >
                    {c}
                  </span>
                ))}
              </div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground pt-1">
                Optional columns
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  "personal_email",
                  "phone",
                  "department",
                  "designation",
                  "gender",
                ].map((c) => (
                  <span
                    key={c}
                    className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-full sm:w-auto"
              onClick={downloadTemplate}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" /> Download Template
            </Button>
          </div>
        )}

        {/* ── Preview view ── */}
        {view === "preview" && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-success/10 text-success border border-success/20">
                <CheckCircle2 className="h-3.5 w-3.5" /> {validRows.length}{" "}
                ready
              </span>
              {invalidRows.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-destructive/10 text-destructive border border-destructive/20">
                  <AlertCircle className="h-3.5 w-3.5" /> {invalidRows.length}{" "}
                  invalid (will be skipped)
                </span>
              )}
              <button
                onClick={reset}
                className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Change file
              </button>
            </div>

            <div className="overflow-auto rounded-xl border border-border max-h-72">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="sticky top-0 bg-muted/60 backdrop-blur-sm">
                  <tr>
                    {[
                      "#",
                      "Name",
                      "Company Email",
                      "Employee Code",
                      "Dept",
                      "Status",
                    ].map((h) => (
                      <th
                        key={h}
                        className="text-left px-3 py-2 font-semibold text-muted-foreground whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((r) => (
                    <tr
                      key={r.row}
                      className={cn(
                        "transition-colors",
                        r.errors.length ? "bg-destructive/5" : "hover:bg-muted/20",
                      )}
                    >
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.row}
                      </td>
                      <td className="px-3 py-2 font-medium max-w-[140px] truncate">
                        {r.name || (
                          <span className="text-destructive italic">
                            missing
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono max-w-[180px] truncate">
                        {r.companyEmail || (
                          <span className="text-destructive italic">
                            missing
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        {r.employeeCode || (
                          <span className="text-destructive italic">
                            missing
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[100px]">
                        {r.department || "—"}
                      </td>
                      <td className="px-3 py-2">
                        {r.errors.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <Check className="h-3 w-3" />
                            Valid
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 text-destructive"
                            title={r.errors.join("; ")}
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {r.errors[0]}
                            {r.errors.length > 1
                              ? ` +${r.errors.length - 1}`
                              : ""}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {validRows.length === 0 ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" /> No valid rows to
                import. Please fix the errors and re-upload.
              </div>
            ) : (
              <div className="rounded-xl border border-success/20 bg-success/5 p-3 flex items-start gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  <strong>{validRows.length}</strong> employee
                  {validRows.length !== 1 ? "s" : ""} will be created and sent
                  login credentials by email.
                  {invalidRows.length > 0 &&
                    ` ${invalidRows.length} invalid row${invalidRows.length !== 1 ? "s" : ""} will be skipped.`}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={reset}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button
                size="sm"
                className="rounded-full"
                onClick={handleSubmit}
                disabled={isSubmitting || validRows.length === 0}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />{" "}
                    Importing…
                  </>
                ) : (
                  <>
                    <Upload className="mr-1.5 h-3.5 w-3.5" /> Import{" "}
                    {validRows.length} Employee
                    {validRows.length !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ── Results view ── */}
        {view === "results" && result && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                {
                  label: "Total Rows",
                  value: result.total,
                  color: "text-foreground",
                },
                {
                  label: "Created",
                  value: result.created,
                  color: "text-success",
                },
                {
                  label: "Failed",
                  value: result.failed,
                  color:
                    result.failed > 0
                      ? "text-destructive"
                      : "text-muted-foreground",
                },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-xl border border-border bg-muted/20 p-3 text-center"
                >
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.label}
                  </p>
                </div>
              ))}
            </div>

            {result.created > 0 && (
              <div className="rounded-xl border border-success/20 bg-success/5 p-3 flex items-start gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {result.created} employee{result.created !== 1 ? "s" : ""}{" "}
                  added successfully. Login credentials have been sent to their
                  company email addresses.
                </span>
              </div>
            )}

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Failed rows
                </p>
                <div className="overflow-auto rounded-xl border border-border max-h-48">
                  <table className="w-full min-w-[480px] text-xs">
                    <thead className="sticky top-0 bg-muted/60">
                      <tr>
                        {["Row", "Name", "Email", "Reason"].map((h) => (
                          <th
                            key={h}
                            className="text-left px-3 py-2 font-semibold text-muted-foreground"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {result.errors.map((e) => (
                        <tr key={e.row} className="bg-destructive/5">
                          <td className="px-3 py-2 text-muted-foreground">
                            {e.row}
                          </td>
                          <td className="px-3 py-2 font-medium">
                            {e.name || "—"}
                          </td>
                          <td className="px-3 py-2 font-mono truncate max-w-[160px]">
                            {e.email || "—"}
                          </td>
                          <td className="px-3 py-2 text-destructive">
                            {e.errors.join("; ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-1">
              <Button size="sm" className="rounded-full" onClick={handleClose}>
                Done
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Bulk Update Dialog ─────────────────────────────────────────────────────────

function BulkUpdateDialog({ open, onClose, onSuccess }: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<EmployeeBulkUpdateResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const res = await employeesApi.bulkUpdate(file);
      setResult(res);
      toast.success(`${res.updated} employee${res.updated === 1 ? "" : "s"} updated · ${res.rejected} rejected.`);
      if (res.updated > 0) onSuccess();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error(detail || "Bulk update failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setResult(null); onClose(); } }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Upload className="h-4 w-4 text-primary" /> Bulk Update Employees
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Update Department, Designation, Date of Joining, Vendor, Work Mode, or Employee Code for existing employees. Identify each row by
            Employee Code or Email — blank cells are left unchanged.
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left">
                  {["Employee Code", "Email", "Department", "Designation", "Date of Joining", "Vendor", "Work Mode", "New Employee Code"].map((header) => (
                    <th key={header} className="whitespace-nowrap px-3 py-2 font-semibold">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/60">
                  <td className="px-3 py-1.5">GRP1001</td><td className="px-3 py-1.5"></td>
                  <td className="px-3 py-1.5">Operations - Generalist</td>
                  <td className="px-3 py-1.5">Associate - LLM Post Training</td>
                  <td className="px-3 py-1.5">2026-06-16</td>
                  <td className="px-3 py-1.5">Ethara AI</td>
                  <td className="px-3 py-1.5">Hybrid</td>
                  <td className="px-3 py-1.5"></td>
                </tr>
                <tr>
                  <td className="px-3 py-1.5"></td><td className="px-3 py-1.5">employee@ethara.ai</td>
                  <td className="px-3 py-1.5">Engineering</td>
                  <td className="px-3 py-1.5">Software Engineer</td>
                  <td className="px-3 py-1.5">16/06/2026</td>
                  <td className="px-3 py-1.5">Ethara AI</td>
                  <td className="px-3 py-1.5">Remote</td>
                  <td className="px-3 py-1.5">GRP1003</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Date of Joining accepts YYYY-MM-DD, DD/MM/YYYY, or DD-Mon-YYYY. Vendor and Work Mode accept text values. New Employee Code must follow the GRPXXXX format with no spaces and must not already be in use.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl text-xs gap-1.5"
              onClick={() => void employeesApi.downloadBulkUpdateTemplate()}
            >
              <Download className="h-3.5 w-3.5" /> Download Template
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
            <Button size="sm" className="rounded-xl text-xs gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Choose CSV & Upload
            </Button>
          </div>
          {result && (
            <div className="space-y-1.5 rounded-xl border border-border p-3">
              <p className="text-xs font-semibold">
                {result.updated} updated ·{" "}
                <span className={cn(result.rejected > 0 && "text-destructive")}>{result.rejected} rejected</span>
              </p>
              {result.results.filter((r) => r.status === "rejected").slice(0, 8).map((r) => (
                <p key={r.row} className="text-[11px] text-destructive">Row {r.row} ({r.identifier}): {r.reason}</p>
              ))}
              {result.results.filter((r) => r.status === "updated").slice(0, 5).map((r) => (
                <p key={`u-${r.row}`} className="text-[11px] text-muted-foreground">Row {r.row} ({r.identifier}): {r.reason}</p>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Tab = "all" | "active" | "pending_activation" | "offboarded";
type SortOption = "joining_desc" | "joining_asc" | "created_desc" | "name_asc";
type EmployeeIssueFilter = EmployeeIssueReminderIssue | "aadhaar_needs_review";
type IssueFilter = "all" | EmployeeIssueFilter;
type EmployeeLifecycle = Exclude<Tab, "all">;
const EMPLOYEE_PAGE_SIZE = 20;
const DEFAULT_SORT: SortOption = "joining_desc";
const ISSUE_FILTER_LABELS: Record<IssueFilter, string> = {
  all: "All Issues",
  selection_form_pending: "Detail Form Pending",
  aadhaar_needs_review: "Aadhaar Review Queue",
  aadhaar_not_submitted: "Aadhaar Not Submitted",
};
const SORT_LABELS: Record<SortOption, string> = {
  joining_desc: "Joining Date: Newest",
  joining_asc: "Joining Date: Oldest",
  created_desc: "Recently Registered",
  name_asc: "Name: A to Z",
};
const REMINDER_ISSUE_LABELS: Record<EmployeeIssueReminderIssue, string> = {
  selection_form_pending: "detail form",
  aadhaar_not_submitted: "Aadhaar upload",
};
const OFFBOARDED_STATUS_TERMS = [
  "offboard",
  "resign",
  "terminated",
  "termination",
  "no show",
  "no_show",
  "abscond",
  "blacklist",
  "separated",
  "inactive",
];
const AADHAAR_OK_STATUSES = new Set([
  "complete",
  "completed",
  "extracted",
  "matched",
  "approved",
  "pass",
  "passed",
  "selection form",
  "success",
  "valid",
  "verified",
]);
const AADHAAR_REVIEW_STATUSES = new Set([
  "failed",
  "invalid",
  "mismatch",
  "needs correction",
  "needs review",
  "rejected",
]);

const LIFECYCLE_META: Record<EmployeeLifecycle, { label: string; badgeClass: string }> = {
  active: {
    label: "Active",
    badgeClass: "text-success border-success/30",
  },
  pending_activation: {
    label: "Pending Activation",
    badgeClass: "text-warning border-warning/30",
  },
  offboarded: {
    label: "Offboarded",
    badgeClass: "text-destructive border-destructive/30",
  },
};
const PENDING_REGISTRATION_STATUSES = new Set([
  "account_activation_pending",
  "candidate_onboarding_pending",
  "imported_pending",
  "needs_repair",
]);

function normalizedText(value?: string | null) {
  return String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
}

function normalizedFilterValue(value?: string | null) {
  return normalizedText(value).replace(/\s+/g, " ");
}

function filterValuesMatch(left?: string | null, right?: string | null) {
  return normalizedFilterValue(left) === normalizedFilterValue(right);
}

function isPendingActivationEmployee(employee: EmployeeRecord) {
  const registrationStatus = normalizedText(employee.registrationStatus).replace(/\s+/g, "_");
  return (
    !employee.isActive ||
    employee.accessLevel === "imported" ||
    PENDING_REGISTRATION_STATUSES.has(registrationStatus) ||
    !employee.userId
  );
}

function hasOffboardedStatus(employee: EmployeeRecord) {
  const status = normalizedText(employee.employmentStatus);
  return OFFBOARDED_STATUS_TERMS.some((term) => status.includes(normalizedText(term)));
}

function employeeLifecycle(employee: EmployeeRecord): EmployeeLifecycle {
  if (hasOffboardedStatus(employee)) return "offboarded";
  if (isPendingActivationEmployee(employee)) return "pending_activation";
  return "active";
}

function employeeSelectionFormPending(employee: EmployeeRecord) {
  return (
    employeeLifecycle(employee) === "active" &&
    normalizedText(employee.selectionFormStatus) !== "submitted"
  );
}

function employeeAadhaarNeedsReview(employee: EmployeeRecord) {
  const statuses = [
    normalizedText(employee.aadhaarValidationStatus),
    normalizedText(employee.aadhaarOcrStatus),
  ].filter(Boolean);
  if (statuses.some((status) => AADHAAR_OK_STATUSES.has(status))) return false;
  return statuses.some((status) => AADHAAR_REVIEW_STATUSES.has(status));
}

function employeeAadhaarNotSubmitted(employee: EmployeeRecord) {
  const status = normalizedText(employee.aadhaarOcrStatus ?? employee.aadhaarValidationStatus);
  return (
    !employee.aadhaarPath &&
    !employee.aadhaarLast4 &&
    (!status || status === "not submitted")
  );
}

function employeeMatchesIssue(employee: EmployeeRecord, issue: EmployeeIssueFilter) {
  if (issue === "selection_form_pending") return employeeSelectionFormPending(employee);
  if (issue === "aadhaar_needs_review") return employeeAadhaarNeedsReview(employee);
  return employeeAadhaarNotSubmitted(employee);
}

function employeeMatchesIssueFilter(employee: EmployeeRecord, issueFilter: IssueFilter) {
  return issueFilter === "all" || employeeMatchesIssue(employee, issueFilter);
}

function isSelectableEmployee(employee: EmployeeRecord) {
  return employee.accessLevel !== "imported" && !employee.id.startsWith("import:");
}

function preferredReminderIssue(
  employee: EmployeeRecord,
  issueFilter: IssueFilter,
): EmployeeIssueReminderIssue | null {
  if (
    issueFilter !== "all" &&
    issueFilter !== "aadhaar_needs_review" &&
    employeeMatchesIssue(employee, issueFilter)
  ) {
    return issueFilter;
  }
  if (employeeSelectionFormPending(employee)) return "selection_form_pending";
  if (employeeAadhaarNotSubmitted(employee)) return "aadhaar_not_submitted";
  return null;
}

function readableStatus(value?: string | null) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function aadhaarBadgeMeta(employee: EmployeeRecord) {
  if (employeeAadhaarNeedsReview(employee)) {
    return { label: "Needs review", className: "text-warning border-warning/25" };
  }
  if (employeeAadhaarNotSubmitted(employee)) {
    return { label: "Not submitted", className: "text-muted-foreground border-border" };
  }
  const statuses = [
    normalizedText(employee.aadhaarValidationStatus),
    normalizedText(employee.aadhaarOcrStatus),
  ].filter(Boolean);
  if (statuses.some((status) => AADHAAR_OK_STATUSES.has(status))) {
    return { label: "Verified", className: "text-success border-success/25" };
  }
  if (employee.aadhaarPath || employee.aadhaarLast4 || statuses.length) {
    return { label: "Uploaded", className: "text-info border-info/25" };
  }
  return null;
}

function getDateTime(value?: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function getDateInputTime(value: string, endOfDay = false) {
  if (!value) return null;
  const time = Date.parse(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`);
  return Number.isFinite(time) ? time : null;
}

function compareNullableDates(a: number | null, b: number | null, direction: "asc" | "desc") {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction === "asc" ? a - b : b - a;
}

function emptyMessageForTab(tab: Tab) {
  switch (tab) {
    case "active":
      return "Active employees appear here after HR activates their accounts.";
    case "pending_activation":
      return "Employees waiting for account activation appear here.";
    case "offboarded":
      return "Offboarded employees appear here after separation or account deactivation.";
    default:
      return "No employees match the current view.";
  }
}

async function getExportErrorMessage(error: unknown, fallback: string): Promise<string> {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (data instanceof Blob) {
    const text = await data.text();
    if (!text.trim()) return fallback;
    try {
      const parsed = JSON.parse(text) as { detail?: string; message?: string };
      return parsed.detail ?? parsed.message ?? fallback;
    } catch {
      return text.slice(0, 240);
    }
  }
  if (typeof data === "string" && data.trim()) return data;
  if (data && typeof data === "object") {
    const parsed = data as { detail?: string; message?: string };
    return parsed.detail ?? parsed.message ?? fallback;
  }
  return fallback;
}

export default function EmployeesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canOpenEmployeeDetails = hasAssignedRole(user, [...FULL_EMPLOYEE_DETAIL_ROLES]);
  const canExportEmployeeUsers = canOpenEmployeeDetails || hasAssignedRole(user, ["it_team"]);
  const canManageEmployeeEditAccess = canOpenEmployeeDetails || hasAssignedRole(user, ["it_team"]);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [workModeFilter, setWorkModeFilter] = useState("all");
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [joiningFrom, setJoiningFrom] = useState("");
  const [joiningTo, setJoiningTo] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>(DEFAULT_SORT);
  const [activeTab, setActiveTab] = useState<Tab>("active");
  const [page, setPage] = useState(1);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [idCardStatusOpen, setIdCardStatusOpen] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAccessLoading, setBulkAccessLoading] = useState<"enable" | "disable" | null>(null);
  const [isCsvExporting, setIsCsvExporting] = useState(false);
  const [isStatusExporting, setIsStatusExporting] = useState(false);
  const [isPackageExporting, setIsPackageExporting] = useState(false);
  const [isIdCardExporting, setIsIdCardExporting] = useState(false);
  const [isSendingPendingReminders, setIsSendingPendingReminders] = useState(false);
  const [issueReminderLoading, setIssueReminderLoading] = useState<string | null>(null);

  const fetchEmployees = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const data = await employeesApi.list();
      setEmployees(data);
      setSelectedIds((current) => new Set([...current].filter((id) => data.some((employee) => employee.id === id))));
    } catch {
      if (!silent) toast.error("Failed to load employees.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchEmployees(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchEmployees]);

  const handleRefresh = () => {
    void fetchEmployees(true);
    qc.invalidateQueries({ queryKey: ["employees"] });
  };

  const currentExportParams = useMemo<EmployeeExportParams>(() => {
    const params: EmployeeExportParams = {
      lifecycle: activeTab,
      sortBy,
    };
    const trimmedSearch = search.trim();
    if (trimmedSearch) params.search = trimmedSearch;
    if (departmentFilter !== "all") params.department = departmentFilter;
    if (workModeFilter !== "all") params.workMode = workModeFilter;
    if (issueFilter !== "all") params.issue = issueFilter;
    if (joiningFrom) params.joiningFrom = joiningFrom;
    if (joiningTo) params.joiningTo = joiningTo;
    return params;
  }, [
    activeTab,
    departmentFilter,
    issueFilter,
    joiningFrom,
    joiningTo,
    search,
    sortBy,
    workModeFilter,
  ]);

  const selectedExportParams = useMemo<EmployeeExportParams>(() => {
    if (!selectionMode || selectedIds.size === 0) return currentExportParams;
    return {
      ...currentExportParams,
      employeeIds: [...selectedIds].join(","),
    };
  }, [currentExportParams, selectedIds, selectionMode]);

  const currentExportSlug = activeTab.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const selectedExportLabel = selectionMode && selectedIds.size > 0
    ? `${selectedIds.size} selected`
    : "current view";

  const handleExport = useCallback(async () => {
    setIsCsvExporting(true);
    toast.info(`Preparing ${selectedExportLabel} export...`);
    try {
      const blob = canOpenEmployeeDetails
        ? await employeesApi.exportCsv(selectedExportParams)
        : await employeesApi.exportUsersCsv(selectedExportParams);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employees_${selectionMode && selectedIds.size > 0 ? "selected" : currentExportSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(canOpenEmployeeDetails ? "Export ready — document links open directly." : "User details export ready.");
    } catch (error) {
      toast.error(await getExportErrorMessage(error, "Export failed."));
    } finally {
      setIsCsvExporting(false);
    }
  }, [canOpenEmployeeDetails, currentExportSlug, selectedExportLabel, selectedExportParams, selectedIds.size, selectionMode]);

  const handleStatusExport = useCallback(async () => {
    setIsStatusExporting(true);
    toast.info(`Preparing ${selectedExportLabel} status export...`);
    try {
      const blob = await employeesApi.exportStatusCsv(selectedExportParams);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employee_status_${selectionMode && selectedIds.size > 0 ? "selected" : currentExportSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Status export ready.");
    } catch (error) {
      toast.error(await getExportErrorMessage(error, "Status export failed."));
    } finally {
      setIsStatusExporting(false);
    }
  }, [currentExportSlug, selectedExportLabel, selectedExportParams, selectedIds.size, selectionMode]);

  const handlePackageExport = useCallback(async () => {
    setIsPackageExporting(true);
    toast.info(`Preparing ${selectedExportLabel} data and documents package...`);
    try {
      const blob = await employeesApi.exportPackage(selectedExportParams);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `employees_package_${selectionMode && selectedIds.size > 0 ? "selected" : currentExportSlug}_${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Employee package export ready.");
    } catch (error) {
      toast.error(await getExportErrorMessage(error, "Employee package export failed."));
    } finally {
      setIsPackageExporting(false);
    }
  }, [currentExportSlug, selectedExportLabel, selectedExportParams, selectedIds.size, selectionMode]);

  const handleIdCardExport = useCallback(async () => {
    setIsIdCardExporting(true);
    toast.info("Preparing ID card export…");
    try {
      const queue = await candidateIdCardApi.listQueue();
      if (queue.length === 0) {
        toast.error("No ID card records to export.");
        return;
      }
      exportToCsv(
        queue.map((item) => ({
          name: item.name ?? item.candidateName,
          employeeId: item.employeeId ?? "",
          emergencyNo: item.emergencyNo ?? "",
          photoUrl: item.photoUrl ?? "",
          bloodGroup: item.bloodGroup ?? "",
        })),
        [
          { key: "name", header: "Name" },
          { key: "employeeId", header: "Employee Code" },
          { key: "emergencyNo", header: "Emergency Contact No" },
          { key: "photoUrl", header: "Passport Size Photo URL" },
          { key: "bloodGroup", header: "Blood Group" },
        ],
        `id_cards_${new Date().toISOString().slice(0, 10)}.csv`,
      );
      toast.success(`Exported ${queue.length} ID card record${queue.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(await getExportErrorMessage(error, "ID card export failed."));
    } finally {
      setIsIdCardExporting(false);
    }
  }, []);

  const handlePendingActivationReminders = useCallback(async () => {
    setIsSendingPendingReminders(true);
    try {
      const result = await employeesApi.sendPendingActivationReminders();
      toast.success(
        `${result.sent} reminder${result.sent === 1 ? "" : "s"} sent.`
        + (result.failed ? ` ${result.failed} failed.` : ""),
      );
      if (result.skipped) {
        toast.info(`${result.skipped} pending row${result.skipped === 1 ? "" : "s"} skipped.`);
      }
    } catch (error) {
      toast.error(await getExportErrorMessage(error, "Could not send reminders."));
    } finally {
      setIsSendingPendingReminders(false);
    }
  }, []);

  const handleIssueReminder = useCallback(async (
    issue: EmployeeIssueReminderIssue,
    employeeIds: string[],
    loadingKey: string,
  ) => {
    const ids = Array.from(new Set(employeeIds.filter(Boolean)));
    if (ids.length === 0) return;
    setIssueReminderLoading(loadingKey);
    try {
      const result = await employeesApi.sendIssueReminders({ employeeIds: ids, issue });
      toast.success(
        `${result.sent} ${REMINDER_ISSUE_LABELS[issue]} reminder${result.sent === 1 ? "" : "s"} sent.`
        + (result.failed ? ` ${result.failed} failed.` : ""),
      );
      if (result.skipped) {
        toast.info(`${result.skipped} selected employee${result.skipped === 1 ? "" : "s"} skipped.`);
      }
      await fetchEmployees(true);
    } catch (error) {
      toast.error(await getExportErrorMessage(error, "Could not send issue reminders."));
    } finally {
      setIssueReminderLoading(null);
    }
  }, [fetchEmployees]);

  const toggleSelected = (employeeId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  const disableSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const updateSelectedEditAccess = async (enabled: boolean) => {
    if (!canManageEmployeeEditAccess) return;
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkAccessLoading(enabled ? "enable" : "disable");
    try {
      const result = await employeesApi.bulkUpdateEditAccess(ids, enabled);
      toast.success(`${result.updated} employee${result.updated === 1 ? "" : "s"} updated.`);
      if (result.missing.length > 0) {
        toast.warning(`${result.missing.length} selected employee${result.missing.length === 1 ? "" : "s"} could not be found.`);
      }
      setSelectedIds(new Set());
      await fetchEmployees(true);
    } catch {
      toast.error("Could not update edit access.");
    } finally {
      setBulkAccessLoading(null);
    }
  };

  const active = employees.filter((e) => employeeLifecycle(e) === "active");
  const pendingActivation = employees.filter((e) => employeeLifecycle(e) === "pending_activation");
  const offboarded = employees.filter((e) => employeeLifecycle(e) === "offboarded");

  const baseList =
    activeTab === "all"
      ? employees
      : activeTab === "active"
        ? active
        : activeTab === "pending_activation"
          ? pendingActivation
          : offboarded;

  const allDepartments = useMemo(
    () =>
      Array.from(
        new Set(employees.map((e) => e.department).filter(Boolean)),
      ) as string[],
    [employees],
  );

  const allWorkModes = useMemo(
    () =>
      Array.from(
        new Set(employees.map((e) => e.workMode).filter(Boolean)),
      ) as string[],
    [employees],
  );

  const joiningFromTime = getDateInputTime(joiningFrom);
  const joiningToTime = getDateInputTime(joiningTo, true);

  const filtered = [...baseList].filter((e) => {
    if (departmentFilter !== "all" && !filterValuesMatch(e.department, departmentFilter))
      return false;
    if (workModeFilter !== "all" && !filterValuesMatch(e.workMode, workModeFilter))
      return false;
    if (!employeeMatchesIssueFilter(e, issueFilter))
      return false;
    const joiningTime = getDateTime(e.dateOfJoining);
    if (joiningFromTime !== null && (joiningTime === null || joiningTime < joiningFromTime))
      return false;
    if (joiningToTime !== null && (joiningTime === null || joiningTime > joiningToTime))
      return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.name.toLowerCase().includes(q) ||
      e.etharaEmail.toLowerCase().includes(q) ||
      (e.personalEmail ?? "").toLowerCase().includes(q) ||
      (e.employeeCode ?? "").toLowerCase().includes(q) ||
      (e.department ?? "").toLowerCase().includes(q) ||
      (e.designation ?? "").toLowerCase().includes(q) ||
      (e.vendor ?? "").toLowerCase().includes(q) ||
      (e.workMode ?? "").toLowerCase().includes(q) ||
      (e.employmentStatus ?? "").toLowerCase().includes(q) ||
      (e.selectionFormStatus ?? "").toLowerCase().includes(q) ||
      (e.aadhaarOcrStatus ?? "").toLowerCase().includes(q) ||
      (e.aadhaarValidationStatus ?? "").toLowerCase().includes(q)
    );
  }).sort((a, b) => {
    if (sortBy === "name_asc") {
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    }
    if (sortBy === "created_desc") {
      return (getDateTime(b.createdAt) ?? 0) - (getDateTime(a.createdAt) ?? 0);
    }
    const dateCompare = compareNullableDates(
      getDateTime(a.dateOfJoining),
      getDateTime(b.dateOfJoining),
      sortBy === "joining_asc" ? "asc" : "desc",
    );
    if (dateCompare !== 0) return dateCompare;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  const totalEmployeePages = Math.max(1, Math.ceil(filtered.length / EMPLOYEE_PAGE_SIZE));
  const currentEmployeePage = Math.min(page, totalEmployeePages);
  const pagedEmployees = filtered.slice(
    (currentEmployeePage - 1) * EMPLOYEE_PAGE_SIZE,
    currentEmployeePage * EMPLOYEE_PAGE_SIZE,
  );
  const selectedCount = selectedIds.size;
  const selectablePagedEmployees = pagedEmployees.filter(isSelectableEmployee);
  const allPagedSelected = selectablePagedEmployees.length > 0 && selectablePagedEmployees.every((employee) => selectedIds.has(employee.id));
  const selectedIssue = issueFilter === "all" ? null : issueFilter;
  const selectedReminderIssue: EmployeeIssueReminderIssue | null =
    selectedIssue && selectedIssue !== "aadhaar_needs_review" ? selectedIssue : null;
  const selectedIssueEmployees = selectedIssue
    ? employees.filter((employee) => selectedIds.has(employee.id) && employeeMatchesIssue(employee, selectedIssue))
    : [];
  const hasRosterControls = Boolean(
    search.trim() ||
    departmentFilter !== "all" ||
    workModeFilter !== "all" ||
    issueFilter !== "all" ||
    joiningFrom ||
    joiningTo ||
    sortBy !== DEFAULT_SORT,
  );
  const togglePagedSelection = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allPagedSelected) {
        selectablePagedEmployees.forEach((employee) => next.delete(employee.id));
      } else {
        selectablePagedEmployees.forEach((employee) => next.add(employee.id));
      }
      return next;
    });
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "all", label: "All Employees", count: employees.length },
    { key: "active", label: "Active Employees", count: active.length },
    { key: "pending_activation", label: "Pending Activation", count: pendingActivation.length },
    { key: "offboarded", label: "Offboarded", count: offboarded.length },
  ];

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Employees
          </h1>
          <p className="text-muted-foreground text-sm">
            All registered Ethara employees
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canExportEmployeeUsers && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 rounded-xl gap-1.5 text-xs"
              onClick={() => void handleExport()}
              disabled={isCsvExporting}
            >
              {isCsvExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {selectionMode && selectedIds.size > 0 ? "Selected Details CSV" : "Current View CSV"}
            </Button>
          )}
          {canOpenEmployeeDetails && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-9 rounded-xl gap-1.5 text-xs"
                onClick={() => void handleStatusExport()}
                disabled={isStatusExporting}
              >
                {isStatusExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}
                {selectionMode && selectedIds.size > 0 ? "Selected Status CSV" : "Current Status CSV"}
              </Button>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  render={
                    <Button size="sm" variant="outline" className="rounded-xl h-9 gap-1.5 text-xs" />
                  }
                >
                  <Package className="h-3.5 w-3.5" /> More Exports
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 rounded-xl">
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    Extra Exports
                  </div>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => void handlePackageExport()}
                    disabled={isPackageExporting}
                  >
                    {isPackageExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Package className="h-3.5 w-3.5" />}
                    Current View Package
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => void handleIdCardExport()}
                    disabled={isIdCardExporting}
                  >
                    {isIdCardExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                    ID Card CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger
                  render={
                    <Button size="sm" variant="outline" className="rounded-xl h-9 gap-1.5 text-xs" />
                  }
                >
                  <MoreHorizontal className="h-3.5 w-3.5" /> Manage
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72 rounded-xl">
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    Import & Update
                  </div>
                  <DropdownMenuItem className="gap-2 text-xs" onClick={() => setBulkOpen(true)}>
                    <FileSpreadsheet className="h-3.5 w-3.5" /> Bulk Import
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2 text-xs" onClick={() => setBulkUpdateOpen(true)}>
                    <Upload className="h-3.5 w-3.5" /> Bulk Update
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    Activation & Forms
                  </div>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => void handlePendingActivationReminders()}
                    disabled={pendingActivation.length === 0 || isSendingPendingReminders}
                  >
                    {isSendingPendingReminders ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mail className="h-3.5 w-3.5" />
                    )}
                    Remind Pending Activation
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2 text-xs" onClick={() => setIdCardStatusOpen(true)}>
                    <CreditCard className="h-3.5 w-3.5" /> Upload ID Card Status
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    Selected Employees
                  </div>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => void updateSelectedEditAccess(true)}
                    disabled={selectedCount === 0 || bulkAccessLoading !== null}
                  >
                    {bulkAccessLoading === "enable" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UnlockKeyhole className="h-3.5 w-3.5" />
                    )}
                    Enable Edit Access
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2 text-xs"
                    onClick={() => void updateSelectedEditAccess(false)}
                    disabled={selectedCount === 0 || bulkAccessLoading !== null}
                  >
                    {bulkAccessLoading === "disable" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <LockKeyhole className="h-3.5 w-3.5" />
                    )}
                    Disable Edit Access
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-border hover:bg-muted/40 transition-colors"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>
      </div>

      {canOpenEmployeeDetails && (
        <BulkImportDialog
          open={bulkOpen}
          onClose={() => setBulkOpen(false)}
          onSuccess={() => {
            void fetchEmployees(true);
            toast.success("Employees imported successfully.");
          }}
        />
      )}

      {canOpenEmployeeDetails && (
        <BulkUpdateDialog
          open={bulkUpdateOpen}
          onClose={() => setBulkUpdateOpen(false)}
          onSuccess={() => {
            void fetchEmployees(true);
          }}
        />
      )}

      {canOpenEmployeeDetails && (
        <IdCardStatusUpload
          open={idCardStatusOpen}
          onOpenChange={setIdCardStatusOpen}
          showTrigger={false}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Total",
            value: employees.length,
            icon: Users,
            color: "text-primary",
          },
          {
            label: "Active",
            value: active.length,
            icon: UserCheck,
            color: "text-success",
          },
          {
            label: "Pending",
            value: pendingActivation.length,
            icon: ShieldCheck,
            color: "text-warning",
          },
          {
            label: "Offboarded",
            value: offboarded.length,
            icon: UserX,
            color: "text-destructive",
          },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <Card key={m.label} className="border-0 shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-muted/40 flex items-center justify-center shrink-0">
                  <Icon className={`h-4 w-4 ${m.color}`} />
                </div>
                <div>
                  <p className={`text-2xl font-bold ${m.color}`}>
                    {isLoading ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      m.value
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="-mx-1 overflow-x-auto">
        <div className="flex min-w-max items-center gap-1 border-b border-border px-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); setPage(1); }}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
                activeTab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5">
                {t.count}
              </Badge>
            </button>
          ))}
        </div>
      </div>

      {canOpenEmployeeDetails && activeTab === "pending_activation" && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs text-warning border-warning/30">
              {pendingActivation.length} pending
            </Badge>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 rounded-lg text-xs"
            disabled={pendingActivation.length === 0 || isSendingPendingReminders}
            onClick={() => void handlePendingActivationReminders()}
          >
            {isSendingPendingReminders ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Mail className="mr-1.5 h-3.5 w-3.5" />
            )}
            Remind All
          </Button>
        </div>
      )}

      <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_minmax(0,2.4fr)] xl:items-start">
        <div className="relative min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, code, department..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="h-10 rounded-xl pl-9 pr-11"
          />
          {hasRosterControls && (
            <button
              type="button"
              aria-label="Clear employee filters"
              title="Clear filters"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              onClick={() => {
                setSearch("");
                setDepartmentFilter("all");
                setWorkModeFilter("all");
                setIssueFilter("all");
                setJoiningFrom("");
                setJoiningTo("");
                setSortBy(DEFAULT_SORT);
                setPage(1);
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
          <Select
            value={departmentFilter}
            onValueChange={(v) => { setDepartmentFilter(v ?? "all"); setPage(1); }}
          >
            <SelectTrigger
              className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none"
              style={{
                background: "rgba(144,141,206,0.07)",
                border: "1px solid rgba(144,141,206,0.20)",
                color: "var(--foreground)",
              }}
            >
              <SelectValue placeholder="All Departments">
                {(value) =>
                  value === "all"
                    ? "All Departments"
                    : String(value ?? "All Departments")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {allDepartments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={workModeFilter}
            onValueChange={(v) => { setWorkModeFilter(v ?? "all"); setPage(1); }}
          >
            <SelectTrigger
              className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none"
              style={{
                background: "rgba(144,141,206,0.07)",
                border: "1px solid rgba(144,141,206,0.20)",
                color: "var(--foreground)",
              }}
            >
              <SelectValue placeholder="All Work Modes">
                {(value) =>
                  value === "all"
                    ? "All Work Modes"
                    : String(value ?? "All Work Modes")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Work Modes</SelectItem>
              {allWorkModes.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={issueFilter}
            onValueChange={(v) => { setIssueFilter((v as IssueFilter) || "all"); setPage(1); }}
          >
            <SelectTrigger
              className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none"
              style={{
                background: "rgba(144,141,206,0.07)",
                border: "1px solid rgba(144,141,206,0.20)",
                color: "var(--foreground)",
              }}
            >
              <SelectValue placeholder="All Issues">
                {(value) => ISSUE_FILTER_LABELS[(value as IssueFilter) || "all"] ?? "All Issues"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(ISSUE_FILTER_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sortBy}
            onValueChange={(v) => { setSortBy((v as SortOption) || DEFAULT_SORT); setPage(1); }}
          >
            <SelectTrigger
              className="h-10 w-full rounded-xl px-3 text-sm focus:outline-none"
              style={{
                background: "rgba(144,141,206,0.07)",
                border: "1px solid rgba(144,141,206,0.20)",
                color: "var(--foreground)",
              }}
            >
              <SelectValue placeholder="Sort Employees">
                {(value) => SORT_LABELS[(value as SortOption) || DEFAULT_SORT] ?? SORT_LABELS[DEFAULT_SORT]}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="joining_desc">{SORT_LABELS.joining_desc}</SelectItem>
              <SelectItem value="joining_asc">{SORT_LABELS.joining_asc}</SelectItem>
              <SelectItem value="created_desc">{SORT_LABELS.created_desc}</SelectItem>
              <SelectItem value="name_asc">{SORT_LABELS.name_asc}</SelectItem>
            </SelectContent>
          </Select>
          <DatePicker
            aria-label="Joined from"
            value={joiningFrom}
            onChange={(value) => { setJoiningFrom(value); setPage(1); }}
            placeholder="Joined From"
            className="h-10 w-full rounded-xl"
            style={{
              background: "rgba(144,141,206,0.07)",
              border: "1px solid rgba(144,141,206,0.20)",
              color: "var(--foreground)",
            }}
          />
          <DatePicker
            aria-label="Joined to"
            value={joiningTo}
            onChange={(value) => { setJoiningTo(value); setPage(1); }}
            placeholder="Joined To"
            className="h-10 w-full rounded-xl"
            style={{
              background: "rgba(144,141,206,0.07)",
              border: "1px solid rgba(144,141,206,0.20)",
              color: "var(--foreground)",
            }}
          />
        </div>
      </div>

      {canManageEmployeeEditAccess && (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/10 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {!selectionMode ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg text-xs"
                onClick={() => {
                  setSelectedIds(new Set());
                  setSelectionMode(true);
                }}
              >
                <Check className="mr-1.5 h-3.5 w-3.5" /> Enable Selection
              </Button>
              <span className="text-xs text-muted-foreground">
                Select employees first, then use Manage for access actions.
              </span>
            </>
          ) : (
            <button
              type="button"
              disabled={selectablePagedEmployees.length === 0}
              onClick={togglePagedSelection}
              className={cn(
                "flex items-center gap-2 rounded-lg px-1.5 py-1 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
                allPagedSelected && "text-primary",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border bg-background transition-colors",
                  allPagedSelected && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {allPagedSelected && <Check className="h-3 w-3" />}
              </span>
              Select visible employees
            </button>
          )}
          {selectionMode && selectedCount > 0 && (
            <Badge variant="outline" className="text-xs">
              {selectedCount} selected
            </Badge>
          )}
        </div>
        <div className="grid gap-2 sm:flex sm:items-center sm:justify-end">
          {selectionMode && canOpenEmployeeDetails && selectedReminderIssue && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={
                selectedIssueEmployees.length === 0 ||
                issueReminderLoading !== null
              }
              onClick={() => {
                void handleIssueReminder(
                  selectedReminderIssue,
                  selectedIssueEmployees.map((employee) => employee.id),
                  "bulk",
                );
              }}
            >
              {issueReminderLoading === "bulk" ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Mail className="mr-1.5 h-3.5 w-3.5" />
              )}
              Send Reminder
            </Button>
          )}
          {selectionMode && selectedCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={bulkAccessLoading !== null}
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </Button>
          )}
          {selectionMode && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg text-xs"
              disabled={bulkAccessLoading !== null || issueReminderLoading !== null}
              onClick={disableSelectionMode}
            >
              Done
            </Button>
          )}
        </div>
      </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-12 text-center">
          <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            No employees found
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {emptyMessageForTab(activeTab)}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {pagedEmployees.map((emp) => {
            const isSelected = selectedIds.has(emp.id);
            const lifecycle = employeeLifecycle(emp);
            const lifecycleMeta = LIFECYCLE_META[lifecycle];
            const canOpenRow = typeof emp.canOpenDetail === "boolean" ? emp.canOpenDetail : canOpenEmployeeDetails;
            const canSelectRow = canManageEmployeeEditAccess && isSelectableEmployee(emp);
            const formPending = employeeSelectionFormPending(emp);
            const aadhaarMeta = aadhaarBadgeMeta(emp);
            const needsAadhaarReview = employeeAadhaarNeedsReview(emp);
            const reminderIssue = canOpenEmployeeDetails ? preferredReminderIssue(emp, issueFilter) : null;
            return (
            <div
              key={emp.id}
              onClick={(event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("[data-employee-select]")) return;
                if (selectionMode) {
                  if (canSelectRow) toggleSelected(emp.id);
                  return;
                }
                if (canOpenRow) router.push(`/dashboard/employees/${emp.id}`);
              }}
              onKeyDown={(event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest("[data-employee-select]")) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  if (selectionMode) {
                    if (canSelectRow) toggleSelected(emp.id);
                    return;
                  }
                  if (canOpenRow) router.push(`/dashboard/employees/${emp.id}`);
                }
              }}
              role={selectionMode ? "checkbox" : canOpenRow ? "button" : undefined}
              aria-checked={selectionMode ? isSelected : undefined}
              tabIndex={selectionMode || canOpenRow ? 0 : -1}
              className={cn(
                "w-full rounded-xl border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40",
                selectionMode
                  ? canSelectRow
                    ? "cursor-pointer hover:bg-muted/30"
                    : "cursor-not-allowed opacity-70"
                  : canOpenRow
                    ? "cursor-pointer hover:bg-muted/30"
                    : "cursor-default",
                isSelected ? "border-primary/50 bg-primary/5" : "border-border",
              )}
            >
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3 sm:items-center">
                  {selectionMode && canManageEmployeeEditAccess && (
                    <button
                      type="button"
                      data-employee-select
                      aria-label={`Select ${emp.name}`}
                      aria-disabled={!canSelectRow}
                      aria-pressed={isSelected}
                      className={cn(
                        "-ml-2 mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-primary-foreground transition-colors hover:bg-muted/40 aria-disabled:cursor-not-allowed aria-disabled:opacity-40 sm:mt-[-0.5rem]",
                      )}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (canSelectRow) toggleSelected(emp.id);
                      }}
                    >
                      <span
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded border border-border bg-background transition-colors",
                          isSelected && "border-primary bg-primary",
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    </button>
                  )}
                  <Avatar className="h-12 w-12 shrink-0 sm:h-10 sm:w-10">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold">
                      {getInitials(emp.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-col items-start gap-1.5 sm:flex-row sm:items-center sm:gap-2">
                      <p className="max-w-full break-words text-sm font-semibold leading-snug sm:truncate">
                        {emp.name}
                      </p>
                      {emp.employeeCode && (
                        <span
                          className="max-w-full break-all rounded px-1.5 py-0.5 font-mono text-[10px]"
                          style={{
                            background: "rgba(144,141,206,0.10)",
                            border: "1px solid rgba(144,141,206,0.20)",
                            color: "#908DCE",
                          }}
                        >
                          {emp.employeeCode}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid min-w-0 gap-1.5 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
                      <span className="flex min-w-0 items-start gap-1 text-xs text-muted-foreground sm:items-center">
                        <Mail className="mt-0.5 h-3 w-3 shrink-0 sm:mt-0" />
                        <span className="min-w-0 break-all sm:max-w-[200px] sm:truncate">
                          {emp.etharaEmail}
                        </span>
                      </span>
                      {emp.department && (
                        <span className="flex min-w-0 items-start gap-1 text-xs text-muted-foreground sm:items-center">
                          <Building2 className="mt-0.5 h-3 w-3 shrink-0 sm:mt-0" />
                          <span className="min-w-0 break-words">
                            {emp.department}
                          </span>
                        </span>
                      )}
                      {emp.designation && (
                        <span className="flex min-w-0 items-start gap-1 text-xs text-muted-foreground sm:items-center">
                          <Briefcase className="mt-0.5 h-3 w-3 shrink-0 sm:mt-0" />
                          <span className="min-w-0 break-words">
                            {emp.designation}
                          </span>
                        </span>
                      )}
                      {emp.workMode && (
                        <span className="text-xs text-muted-foreground">
                          {emp.workMode}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid min-w-0 gap-1 sm:flex sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
                      {emp.personalEmail && (
                        <span className="break-all text-[10px] text-muted-foreground">
                          Personal: {emp.personalEmail}
                        </span>
                      )}
                      {emp.aadhaarLast4 && (
                        <span className="text-[10px] text-muted-foreground">
                          Aadhaar: ****{emp.aadhaarLast4}
                        </span>
                      )}
                      {emp.dateOfBirth && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Calendar className="h-2.5 w-2.5 shrink-0" />
                          DOB: {formatDate(emp.dateOfBirth)}
                        </span>
                      )}
                      {emp.dateOfJoining && (
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Calendar className="h-2.5 w-2.5 shrink-0" />
                          DOJ: {formatDate(emp.dateOfJoining)}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Registered {timeAgo(emp.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5 pl-[60px] sm:flex-col sm:items-end sm:pl-0">
                  <Badge
                    variant="outline"
                    className={cn("text-xs", lifecycleMeta.badgeClass)}
                  >
                    {lifecycleMeta.label}
                  </Badge>
                  {emp.employmentStatus && lifecycle !== "active" && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                      {emp.employmentStatus}
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px]",
                      emp.editAccessEnabled === false
                        ? "text-warning border-warning/30"
                        : "text-success border-success/30",
                    )}
                  >
                    Edit: {emp.editAccessEnabled === false ? "Disabled" : "Enabled"}
                  </Badge>
                  {lifecycle === "active" && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        formPending
                          ? "text-warning border-warning/25"
                          : "text-success border-success/25",
                      )}
                    >
                      Form: {formPending ? "Pending" : readableStatus(emp.selectionFormStatus) || "Submitted"}
                    </Badge>
                  )}
                  {aadhaarMeta && (
                    <Badge
                      variant="outline"
                      className={cn("text-[10px]", aadhaarMeta.className)}
                    >
                      Aadhaar: {aadhaarMeta.label}
                    </Badge>
                  )}
                  {reminderIssue && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-lg px-2 text-[10px]"
                      disabled={issueReminderLoading !== null}
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleIssueReminder(reminderIssue, [emp.id], emp.id);
                      }}
                    >
                      {issueReminderLoading === emp.id ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Mail className="mr-1 h-3 w-3" />
                      )}
                      Remind
                    </Button>
                  )}
                  {canOpenEmployeeDetails && needsAadhaarReview && canOpenRow && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 rounded-lg px-2 text-[10px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        router.push(`/dashboard/employees/${emp.id}`);
                      }}
                    >
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      Review
                    </Button>
                  )}
                  {canOpenRow ? (
                    <span className="inline-flex w-full items-center justify-between gap-1 text-[11px] text-primary sm:w-auto sm:justify-start">
                      View details
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground">
                      Preview only
                    </Badge>
                  )}
                </div>
              </div>
            </div>
            );
          })}
            {totalEmployeePages > 1 && (
              <div className="flex flex-col gap-3 rounded-xl border border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {currentEmployeePage} of {totalEmployeePages} · Showing {pagedEmployees.length} of {filtered.length} employees
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs"
                    disabled={currentEmployeePage === 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg text-xs"
                    disabled={currentEmployeePage === totalEmployeePages}
                    onClick={() => setPage((current) => Math.min(totalEmployeePages, current + 1))}
                  >
                    Next <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
	        </div>
	      )}
    </div>
  );
}

import { formatLabel } from "./utils";

export type ExportColumn = {
  key: string;
  header: string;
  transform?: (value: unknown, row: Record<string, unknown>) => string;
};

function safeStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleDateString("en-IN");
  return String(value);
}

// Characters that, when leading a spreadsheet cell, cause Excel/Sheets/LibreOffice
// to interpret the cell as a formula (CSV/formula injection). Tab (\t) and carriage
// return (\r) are included because some parsers strip surrounding whitespace before
// formula detection.
const FORMULA_TRIGGER_CHARS = ["=", "+", "-", "@", "\t", "\r"];

function escapeCell(value: string): string {
  // Defuse CSV formula injection: if the value begins with a character a spreadsheet
  // would treat as a formula, prefix a single apostrophe so it is rendered as text.
  // Done before quote/comma escaping so the apostrophe lands inside any quoting.
  let safe = value;
  if (safe.length > 0 && FORMULA_TRIGGER_CHARS.includes(safe[0])) {
    safe = `'${safe}`;
  }

  const needsQuoting = safe.includes(",") || safe.includes('"') || safe.includes("\n") || safe.includes("\r");
  if (!needsQuoting) return safe;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Validates a user-supplied post-auth redirect target ("next" param) to prevent
 * open-redirect attacks. Only accepts SAME-SITE absolute paths: the value must
 * start with a single "/" but not "//" (protocol-relative) or "/\" (which some
 * browsers normalise to "//"), and must not contain a scheme/host. Anything else
 * returns null so callers can fall back to a safe default route.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  // Must be an absolute path on this origin.
  if (!next.startsWith("/")) return null;
  // Reject protocol-relative ("//host") and backslash-tricks ("/\host", "/\\host")
  // that browsers can treat as cross-origin destinations.
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  // Defence in depth: a same-site path never contains a scheme separator. This
  // also blocks control characters that could be used to smuggle a host.
  if (/[\\\x00-\x1f]/.test(next) || next.includes("://")) return null;
  return next;
}

export function exportToCsv(
  data: Record<string, unknown>[],
  columns: ExportColumn[],
  filename: string,
): void {
  if (!data.length) return;

  const headerRow = columns.map((c) => escapeCell(c.header)).join(",");
  const dataRows = data.map((row) =>
    columns
      .map((col) => {
        const raw = row[col.key];
        const strValue = col.transform
          ? col.transform(raw, row)
          : safeStr(raw);
        return escapeCell(strValue);
      })
      .join(",")
  );

  const BOM = "\uFEFF";
  const csv = BOM + [headerRow, ...dataRows].join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function labelTransform(value: unknown): string {
  return formatLabel(safeStr(value));
}

export function dateTransform(value: unknown): string {
  if (!value) return "";
  try {
    return new Date(String(value)).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return safeStr(value);
  }
}

export function dateTimeTransform(value: unknown): string {
  if (!value) return "";
  try {
    return new Date(String(value)).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return safeStr(value);
  }
}

export const CANDIDATE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "candidateCode", header: "Candidate Code" },
  { key: "fullName", header: "Full Name" },
  { key: "personalEmail", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "sourceType", header: "Source", transform: labelTransform },
  { key: "currentStage", header: "Stage", transform: labelTransform },
  { key: "currentStatus", header: "Status" },
  { key: "positionTitle", header: "Job Role", transform: (v, row) => safeStr((row.position as Record<string, unknown>)?.title ?? v) },
  { key: "priorityScore", header: "Priority Score" },
  { key: "resumeScore", header: "Resume Score" },
  { key: "createdAt", header: "Applied Date", transform: dateTransform },
  { key: "blacklistReason", header: "Blacklist Reason" },
];

export const EMPLOYEE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "employeeCode", header: "Employee Code" },
  { key: "name", header: "Full Name" },
  { key: "etharaEmail", header: "Ethara Email" },
  { key: "personalEmail", header: "Personal Email" },
  { key: "phone", header: "Phone" },
  { key: "department", header: "Department" },
  { key: "designation", header: "Designation" },
  { key: "dateOfJoining", header: "Date of Joining", transform: dateTransform },
  { key: "vendor", header: "Vendor" },
  { key: "workMode", header: "Work Mode", transform: labelTransform },
  { key: "gender", header: "Gender", transform: labelTransform },
  { key: "isActive", header: "Status", transform: (v) => (v ? "Active" : "Inactive") },
  { key: "createdAt", header: "Created", transform: dateTransform },
];

export const SEPARATION_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "employeeCode", header: "Employee Code" },
  { key: "employeeName", header: "Employee Name" },
  { key: "etharaEmail", header: "Ethara Email" },
  { key: "department", header: "Department" },
  { key: "designation", header: "Designation" },
  { key: "separationType", header: "Type", transform: labelTransform },
  { key: "status", header: "Status", transform: labelTransform },
  { key: "reason", header: "Reason" },
  { key: "lastWorkingDay", header: "Last Working Day", transform: dateTransform },
  { key: "effectiveDate", header: "Effective Date", transform: dateTransform },
  { key: "managerName", header: "Manager" },
  { key: "managerAction", header: "Manager Action", transform: labelTransform },
  { key: "appliedAt", header: "Applied At", transform: dateTransform },
];

export const VENDOR_CANDIDATE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "candidateCode", header: "Candidate Code" },
  { key: "fullName", header: "Full Name" },
  { key: "personalEmail", header: "Email" },
  { key: "phone", header: "Phone" },
  { key: "positionTitle", header: "Job Role", transform: (v, row) => safeStr((row.position as Record<string, unknown>)?.title ?? v) },
  { key: "currentStage", header: "Stage", transform: labelTransform },
  { key: "currentStatus", header: "Status" },
  { key: "resumeScore", header: "Resume Score" },
  { key: "createdAt", header: "Submitted Date", transform: dateTransform },
];

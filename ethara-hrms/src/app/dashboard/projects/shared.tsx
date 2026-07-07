"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const CHART_COLORS = ["#ED00ED", "#908DCE", "#38BDF8", "#22c55e", "#f59e0b", "#ef4444", "#a78bfa", "#34d399"];

export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    background: "rgba(8,8,16,0.96)",
    border: "1px solid rgba(144,141,206,0.22)",
    borderRadius: 10,
    fontSize: 12,
    color: "#C5CBE8",
  },
  itemStyle: { color: "#F8FAFC", fontWeight: 600 },
  labelStyle: { color: "#C5CBE8", fontWeight: 600 },
  cursor: { fill: "rgba(144,141,206,0.06)" },
} as const;

export function fmtMoney(value: number | null | undefined, currency = "INR"): string {
  const n = typeof value === "number" ? value : 0;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString("en-IN")}`;
  }
}

export function fmtCompact(value: number | null | undefined): string {
  const n = typeof value === "number" ? value : 0;
  if (Math.abs(n) >= 1_000_000) return `₹${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export const BUDGET_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_functional_approval: "Pending CTO/COO",
  functional_approved: "CTO/COO Approved",
  pending_leadership_approval: "Pending Leadership",
  approved: "Approved",
  rejected: "Rejected",
};

const BUDGET_STATUS_TONE: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  pending_functional_approval: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  pending_leadership_approval: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  rejected: "bg-red-500/15 text-red-300 border-red-500/30",
};

export function BudgetStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const tone = BUDGET_STATUS_TONE[status] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30";
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium", tone)}>
      {BUDGET_STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function Panel({ title, subtitle, action, children, className }: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("min-w-0 rounded-2xl p-4 sm:p-5", className)}
      style={{ background: "rgba(25,24,44,0.78)", border: "1px solid rgba(144,141,206,0.18)", backdropFilter: "blur(16px)" }}
    >
      {(title || action) && (
        <div className="mb-4 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>{title}</h2>}
            {subtitle && <p className="text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export const TYPE_LABEL: Record<string, string> = { technical: "Technical", generalist: "Generalist" };
export const RFP_LABEL: Record<string, string> = { rfp: "RFP", production: "Production", delivered: "Delivered" };
export const DELIVERY_LABEL: Record<string, string> = { ongoing: "Ongoing", completed: "Completed" };

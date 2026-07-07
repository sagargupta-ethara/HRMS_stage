"use client";

import Link from "next/link";
import type { ElementType, ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type InsightTone = "default" | "success" | "warning" | "danger" | "info";

export type DashboardInsight = {
  label: string;
  value: ReactNode;
  detail: string;
  icon: ElementType;
  tone?: InsightTone;
  href?: string;
  actionLabel?: string;
  progress?: number;
};

const toneClass: Record<InsightTone, string> = {
  default: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-info/15 text-info",
};

function clampProgress(value?: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return undefined;
  return Math.min(100, Math.max(0, value));
}

export function DashboardInsightStrip({
  title,
  subtitle,
  insights,
  className,
}: {
  title: string;
  subtitle?: string;
  insights: DashboardInsight[];
  className?: string;
}) {
  if (insights.length === 0) return null;

  return (
    <section
      className={cn("min-w-0 rounded-2xl p-4 sm:p-5", className)}
      style={{
        background: "rgba(25,24,44,0.78)",
        border: "1px solid rgba(144,141,206,0.18)",
        backdropFilter: "blur(16px)",
      }}
    >
      <div className="mb-4 flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: "#C5CBE8" }}>{title}</h2>
          {subtitle && <p className="text-xs" style={{ color: "rgba(197,203,232,0.45)" }}>{subtitle}</p>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {insights.map((insight) => {
          const Icon = insight.icon;
          const progress = clampProgress(insight.progress);
          const body = (
            <>
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium uppercase tracking-wider" style={{ color: "rgba(197,203,232,0.48)" }}>
                    {insight.label}
                  </p>
                  <div className="mt-1 break-words text-xl font-semibold leading-tight" style={{ color: "#C5CBE8" }}>
                    {insight.value}
                  </div>
                </div>
                <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", toneClass[insight.tone ?? "default"])}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 line-clamp-2 min-h-[2rem] text-xs leading-4" style={{ color: "rgba(197,203,232,0.50)" }}>
                {insight.detail}
              </p>
              {progress !== undefined && (
                <div className="mt-3 h-1.5 rounded-full" style={{ background: "rgba(144,141,206,0.14)" }}>
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${progress}%`,
                      background: insight.tone === "danger"
                        ? "var(--color-destructive)"
                        : insight.tone === "warning"
                          ? "var(--color-warning)"
                          : insight.tone === "success"
                            ? "var(--color-success)"
                            : insight.tone === "info"
                              ? "var(--color-info)"
                              : "var(--color-primary)",
                    }}
                  />
                </div>
              )}
              {insight.href && (
                <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                  {insight.actionLabel ?? "Open"} <ArrowRight className="h-3 w-3" />
                </span>
              )}
            </>
          );

          if (insight.href) {
            return (
              <Link
                key={insight.label}
                href={insight.href}
                className="group min-h-[150px] min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white/[0.05]"
              >
                {body}
              </Link>
            );
          }

          return (
            <div key={insight.label} className="min-h-[150px] min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-4">
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

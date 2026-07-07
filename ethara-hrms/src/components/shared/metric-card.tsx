"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { DashboardMetric } from "@/types";

const colorMap = {
  primary: "from-primary/15 to-primary/5 dark:from-primary/20 dark:to-primary/5",
  success: "from-success/15 to-success/5 dark:from-success/20 dark:to-success/5",
  warning: "from-warning/15 to-warning/5 dark:from-warning/20 dark:to-warning/5",
  destructive: "from-destructive/15 to-destructive/5 dark:from-destructive/20 dark:to-destructive/5",
  info: "from-info/15 to-info/5 dark:from-info/20 dark:to-info/5",
};

const iconColorMap = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
};

const dotColorMap = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
};

interface MetricCardProps {
  metric: DashboardMetric;
  icon: React.ElementType;
  delay?: number;
}

export function MetricCard({ metric, icon: Icon, delay = 0 }: MetricCardProps) {
  const color = metric.color || "primary";

  return (
    <Card
      className={cn(
        "group relative min-w-0 overflow-hidden border-0 shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer",
        "bg-gradient-to-br",
        colorMap[color],
        "hover:-translate-y-0.5"
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {/* Decorative dot */}
      <div className={cn("absolute top-3 right-3 h-2 w-2 rounded-full", dotColorMap[color], "opacity-60")} />

      <CardContent className="p-4 sm:p-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <p className="break-words text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {metric.label}
            </p>
            <p className="break-words text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {metric.value.toLocaleString()}
            </p>
            {metric.change !== undefined && (
              <div className="flex min-w-0 items-start gap-1.5">
                {metric.change > 0 ? (
                  <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                ) : metric.change < 0 ? (
                  <TrendingDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <Minus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className={cn(
                  "min-w-0 break-words text-xs font-medium",
                  metric.change > 0 ? "text-success" : metric.change < 0 ? "text-destructive" : "text-muted-foreground"
                )}>
                  {metric.change > 0 ? "+" : ""}{metric.change}% {metric.changeLabel || "vs last week"}
                </span>
              </div>
            )}
          </div>
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl sm:h-11 sm:w-11", iconColorMap[color])}>
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface MetricGridProps {
  metrics: Array<DashboardMetric & { icon: React.ElementType }>;
  columns?: 2 | 3 | 4 | 5;
}

export function MetricGrid({ metrics, columns = 4 }: MetricGridProps) {
  const gridCols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  };

  return (
    <div className={cn("grid min-w-0 gap-4", gridCols[columns])}>
      {metrics.map((m, i) => (
        <MetricCard key={m.label} metric={m} icon={m.icon} delay={i * 50} />
      ))}
    </div>
  );
}

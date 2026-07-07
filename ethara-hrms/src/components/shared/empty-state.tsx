import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Optional lucide icon shown in a soft circle. */
  icon?: React.ElementType;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional CTA (e.g. a button). */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Consistent empty / zero-data state. Use anywhere a list, table or chart can be
 * empty so the app reads "intentionally empty" instead of "broken/blank".
 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}

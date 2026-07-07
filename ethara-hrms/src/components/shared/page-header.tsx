import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Page title — rendered as the single <h1>. */
  title: React.ReactNode;
  /** Optional supporting line under the title. */
  description?: React.ReactNode;
  /** Optional leading icon (lucide component). */
  icon?: React.ElementType;
  /** Right-aligned actions (buttons, filters). Wraps below the title on mobile. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Standardised page header. Title is always `text-xl font-bold sm:text-2xl`,
 * actions sit beside it on >=sm and wrap below on mobile (so buttons never clip
 * off the right edge — the recurring `flex justify-between` bug). Use on every
 * dashboard page for a consistent heading rhythm.
 */
export function PageHeader({ title, description, icon: Icon, actions, className }: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {title}
          </h1>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

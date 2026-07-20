// Shared presentational primitives (no hooks → usable in server or client
// components). Interactive behaviour is supplied by the caller via props.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { docStatusMeta, recipientStatusMeta } from '@/lib/status';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg';

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 font-semibold',
  secondary: 'bg-panel-2 text-ink hover:bg-edge border border-edge',
  ghost: 'text-ink-dim hover:text-ink hover:bg-panel-2',
  danger: 'bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 border border-rose-500/30',
  outline: 'border border-edge text-ink hover:bg-panel-2',
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-base gap-2 rounded-xl',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap transition disabled:opacity-50 disabled:pointer-events-none',
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-2xl border border-edge bg-panel', className)}>{children}</div>
  );
}

export function Badge({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusPill({ status, kind = 'document' }: { status: string; kind?: 'document' | 'recipient' }) {
  const meta = kind === 'recipient' ? recipientStatusMeta(status) : docStatusMeta(status);
  return (
    <Badge className={meta.className}>
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </Badge>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-edge bg-panel/50 px-6 py-16 text-center">
      {icon && <div className="mb-3 text-ink-dim">{icon}</div>}
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-ink-dim">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Label({ className, children, htmlFor }: { className?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-1.5 block text-xs font-medium text-ink-dim', className)}>
      {children}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-edge bg-panel-2 px-3 text-sm text-ink placeholder:text-ink-dim/60 outline-none transition focus:border-accent/60 focus:ring-1 focus:ring-accent/40',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim/60 outline-none transition focus:border-accent/60 focus:ring-1 focus:ring-accent/40',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-10 w-full appearance-none rounded-lg border border-edge bg-panel-2 px-3 text-sm text-ink outline-none transition focus:border-accent/60 focus:ring-1 focus:ring-accent/40',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

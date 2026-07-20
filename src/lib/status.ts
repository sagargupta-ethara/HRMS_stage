// Display metadata for document + recipient statuses (used by StatusPill).

export interface StatusMeta {
  label: string;
  /** tailwind text + bg classes */
  className: string;
  dot: string;
}

export const DOC_STATUS_META: Record<string, StatusMeta> = {
  draft: { label: 'Draft', className: 'text-ink-dim bg-panel-2 border-edge', dot: 'bg-ink-dim' },
  sent: { label: 'Sent', className: 'text-sky-300 bg-sky-500/10 border-sky-500/30', dot: 'bg-sky-400' },
  viewed: { label: 'Viewed', className: 'text-amber-300 bg-amber-500/10 border-amber-500/30', dot: 'bg-amber-400' },
  partially_signed: { label: 'Partially Signed', className: 'text-violet-300 bg-violet-500/10 border-violet-500/30', dot: 'bg-violet-400' },
  completed: { label: 'Completed', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  rejected: { label: 'Rejected', className: 'text-rose-300 bg-rose-500/10 border-rose-500/30', dot: 'bg-rose-400' },
  error: { label: 'Error', className: 'text-rose-300 bg-rose-500/10 border-rose-500/30', dot: 'bg-rose-400' },
};

export const RECIPIENT_STATUS_META: Record<string, StatusMeta> = {
  pending: { label: 'Pending', className: 'text-ink-dim bg-panel-2 border-edge', dot: 'bg-ink-dim' },
  sent: { label: 'Sent', className: 'text-sky-300 bg-sky-500/10 border-sky-500/30', dot: 'bg-sky-400' },
  viewed: { label: 'Viewed', className: 'text-amber-300 bg-amber-500/10 border-amber-500/30', dot: 'bg-amber-400' },
  signed: { label: 'Signed', className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30', dot: 'bg-emerald-400' },
  rejected: { label: 'Rejected', className: 'text-rose-300 bg-rose-500/10 border-rose-500/30', dot: 'bg-rose-400' },
};

export function docStatusMeta(status: string): StatusMeta {
  return DOC_STATUS_META[status] ?? DOC_STATUS_META.draft;
}

export function recipientStatusMeta(status: string): StatusMeta {
  return RECIPIENT_STATUS_META[status] ?? RECIPIENT_STATUS_META.pending;
}

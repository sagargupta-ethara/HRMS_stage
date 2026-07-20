// Vertical event timeline (newest first — events already arrive sorted by the
// DTO mapper). Each event gets an icon + colour keyed by its type.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { DocumentEventDTO } from '@/lib/types';
import {
  CheckIcon,
  EyeIcon,
  FileIcon,
  SendIcon,
  SignatureIcon,
  XIcon,
} from '@/components/icons';

interface EventMeta {
  label: string;
  icon: (p: { className?: string }) => ReactNode;
  /** dot/ring colour classes */
  ring: string;
  text: string;
}

const EVENT_META: Record<string, EventMeta> = {
  created: { label: 'Created', icon: FileIcon, ring: 'border-edge bg-panel-2 text-ink-dim', text: 'text-ink-dim' },
  sent: { label: 'Sent', icon: SendIcon, ring: 'border-sky-500/30 bg-sky-500/10 text-sky-300', text: 'text-sky-300' },
  viewed: { label: 'Viewed', icon: EyeIcon, ring: 'border-amber-500/30 bg-amber-500/10 text-amber-300', text: 'text-amber-300' },
  signed: { label: 'Signed', icon: SignatureIcon, ring: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', text: 'text-emerald-300' },
  completed: { label: 'Completed', icon: CheckIcon, ring: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300', text: 'text-emerald-300' },
  rejected: { label: 'Rejected', icon: XIcon, ring: 'border-rose-500/30 bg-rose-500/10 text-rose-300', text: 'text-rose-300' },
  error: { label: 'Error', icon: XIcon, ring: 'border-rose-500/30 bg-rose-500/10 text-rose-300', text: 'text-rose-300' },
};

function metaFor(type: string): EventMeta {
  return (
    EVENT_META[type] ?? {
      label: type,
      icon: FileIcon,
      ring: 'border-edge bg-panel-2 text-ink-dim',
      text: 'text-ink-dim',
    }
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function EventTimeline({ events }: { events: DocumentEventDTO[] }) {
  if (events.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-edge bg-panel-2/30 px-4 py-6 text-center text-sm text-ink-dim">
        No events yet.
      </p>
    );
  }

  return (
    <ol className="relative">
      {events.map((e, i) => {
        const meta = metaFor(e.type);
        const Icon = meta.icon;
        const isLast = i === events.length - 1;
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* left rail */}
            <div className="relative flex flex-col items-center">
              <span
                className={cn(
                  'grid h-7 w-7 shrink-0 place-items-center rounded-full border',
                  meta.ring,
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              {!isLast && <span className="mt-1 w-px flex-1 bg-edge" />}
            </div>
            {/* content */}
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn('text-sm font-medium', meta.text)}>{meta.label}</span>
                {e.recipientEmail && (
                  <span className="truncate rounded-full border border-edge bg-panel-2 px-2 py-0.5 text-[11px] text-ink-dim">
                    {e.recipientEmail}
                  </span>
                )}
              </div>
              {e.message && <p className="mt-0.5 text-sm text-ink-dim">{e.message}</p>}
              <p className="mt-0.5 text-[11px] text-ink-dim/70">{formatTime(e.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

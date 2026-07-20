// Documents list row. Presentational + server-safe (no hooks) — the whole row
// links to the document detail page.
import Link from 'next/link';
import { StatusPill } from '@/components/ui';
import { roleDef, colorForIndex } from '@/lib/recipients';
import type { DocumentDTO, DocumentRecipientDTO } from '@/lib/types';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function initials(r: DocumentRecipientDTO): string {
  const base = (r.name || r.email || r.label).trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

function recipientColor(r: DocumentRecipientDTO, i: number): string {
  return roleDef(r.roleKey)?.color ?? colorForIndex(i);
}

export function DocumentRow({ document }: { document: DocumentDTO }) {
  const recipients = document.recipients;
  const shown = recipients.slice(0, 4);
  const extra = recipients.length - shown.length;

  return (
    <Link
      href={`/documents/${document.id}`}
      className="flex flex-col gap-3 rounded-2xl border border-edge bg-panel p-4 transition hover:border-ink-dim/40 hover:bg-panel-2/40 sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold text-ink">{document.title}</h3>
        <p className="truncate text-xs text-ink-dim">
          {document.templateName ? `From ${document.templateName}` : 'Untitled template'}
        </p>
      </div>

      <div className="flex items-center -space-x-2" aria-label={`${recipients.length} recipients`}>
        {shown.map((r, i) => (
          <span
            key={r.id}
            title={`${r.label}: ${r.name || r.email || '—'}`}
            className="grid h-7 w-7 place-items-center rounded-full border border-panel text-[10px] font-semibold text-canvas"
            style={{ backgroundColor: recipientColor(r, i) }}
          >
            {initials(r)}
          </span>
        ))}
        {extra > 0 && (
          <span className="grid h-7 w-7 place-items-center rounded-full border border-panel bg-panel-2 text-[10px] font-semibold text-ink-dim">
            +{extra}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-4 sm:justify-end">
        <span className="text-xs text-ink-dim">Updated {formatWhen(document.updatedAt)}</span>
        <StatusPill status={document.status} kind="document" />
      </div>
    </Link>
  );
}

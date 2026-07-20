// Templates list card. The whole card links to the editor; "Generate" is a
// secondary action. Plain (server-safe) component — no client hooks.

import Link from 'next/link';
import { Badge, StatusPill } from '@/components/ui';
import { FileIcon, SendIcon, UsersIcon } from '@/components/icons';
import type { TemplateSummaryDTO } from '@/lib/types';

const CATEGORY_LABELS: Record<string, string> = {
  offer_letter: 'Offer Letter',
  employment_contract: 'Employment Contract',
  nda: 'NDA',
  other: 'Other',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function TemplateCard({ template }: { template: TemplateSummaryDTO }) {
  const categoryLabel = CATEGORY_LABELS[template.category] ?? template.category;

  return (
    <div className="group relative flex flex-col rounded-2xl border border-edge bg-panel p-4 transition hover:border-ink-dim/40 hover:bg-panel-2/40">
      <Link
        href={`/templates/${template.id}/edit`}
        className="absolute inset-0 rounded-2xl"
        aria-label={`Edit ${template.name}`}
      />

      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel-2 text-ink-dim">
          <FileIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-ink">{template.name}</h3>
          <p className="truncate text-xs text-ink-dim">{template.fileName}</p>
        </div>
        <StatusPill status={template.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge className="border-edge bg-panel-2 text-ink-dim">{categoryLabel}</Badge>
        <Badge className="border-edge bg-panel-2 text-ink-dim">
          <FileIcon className="h-3 w-3" />
          {template.pageCount} page{template.pageCount === 1 ? '' : 's'}
        </Badge>
        <Badge className="border-edge bg-panel-2 text-ink-dim">
          <UsersIcon className="h-3 w-3" />
          {template.recipientCount}
        </Badge>
        <Badge className="border-edge bg-panel-2 text-ink-dim">
          {template.fieldCount} field{template.fieldCount === 1 ? '' : 's'}
        </Badge>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-edge pt-3">
        <span className="text-xs text-ink-dim">
          Updated {formatDate(template.updatedAt)}
        </span>
        <Link
          href={`/templates/${template.id}/generate`}
          className="relative z-10 inline-flex h-8 items-center gap-1.5 rounded-lg border border-edge bg-panel-2 px-3 text-xs text-ink transition hover:bg-edge"
        >
          <SendIcon className="h-3.5 w-3.5" />
          Generate
        </Link>
      </div>
    </div>
  );
}

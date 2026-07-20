// Templates list (server component).
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { toTemplateSummaryDTO } from '@/lib/mappers';
import { EmptyState } from '@/components/ui';
import { FileIcon, PlusIcon } from '@/components/icons';
import { TemplateCard } from '@/components/templates/template-card';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const rows = await prisma.template.findMany({
    include: { _count: { select: { recipients: true, fields: true } } },
    orderBy: { updatedAt: 'desc' },
  });
  const templates = rows.map(toTemplateSummaryDTO);

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Templates</h1>
          <p className="mt-1 text-sm text-ink-dim">
            Reusable PDF templates with recipients and signing fields.
          </p>
        </div>
        <Link
          href="/templates/new"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:brightness-110"
        >
          <PlusIcon className="h-4 w-4" />
          New Template
        </Link>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={<FileIcon className="h-8 w-8" />}
          title="No templates yet"
          description="Upload a PDF to start building your first signing template."
          action={
            <Link
              href="/templates/new"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:brightness-110"
            >
              <PlusIcon className="h-4 w-4" />
              New Template
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => (
            <TemplateCard key={t.id} template={t} />
          ))}
        </div>
      )}
    </div>
  );
}

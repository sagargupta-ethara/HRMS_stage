// Generate-from-template page (server component). Loads the full template and
// mounts the client generate form seeded with sample HRMS data.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { toTemplateDTO } from '@/lib/mappers';
import { SAMPLE_GENERATION_DATA } from '@/lib/prefill';
import { ArrowLeftIcon } from '@/components/icons';
import { GenerateTabs } from '@/components/generate/generate-tabs';

export const dynamic = 'force-dynamic';

export default async function GenerateDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const row = await prisma.template.findUnique({
    where: { id },
    include: { recipients: true, fields: true },
  });
  if (!row) notFound();

  const template = toTemplateDTO(row);

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <div className="mb-6">
        <Link
          href="/templates"
          className="inline-flex items-center gap-1.5 text-sm text-ink-dim transition hover:text-ink"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to templates
        </Link>
        <h1 className="mt-3 text-2xl font-semibold text-ink">
          Generate document from “{template.name}”
        </h1>
        <p className="mt-1 text-sm text-ink-dim">
          Fill in the candidate &amp; HR details — bound fields are prefilled and the
          document is sent for signing.
        </p>
      </div>

      <GenerateTabs template={template} initialData={SAMPLE_GENERATION_DATA} />
    </div>
  );
}

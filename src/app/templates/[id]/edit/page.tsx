// Template editor page (server component). Loads the full template and mounts
// the client-side builder, which fills the viewport below the top nav.
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { toTemplateDTO } from '@/lib/mappers';
import { templateFileUrl } from '@/lib/api-client';
import { TemplateBuilder } from '@/components/builder/template-builder';

export const dynamic = 'force-dynamic';

export default async function EditTemplatePage({
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
    <div className="h-[calc(100vh-3.5rem)]">
      <TemplateBuilder template={template} fileUrl={templateFileUrl(id)} />
    </div>
  );
}

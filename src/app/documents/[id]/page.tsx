// Document detail page (server component). Loads the document with recipients,
// events and template, then mounts the interactive detail view.
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { toDocumentDTO } from '@/lib/mappers';
import { DocumentDetail } from '@/components/documents/document-detail';

export const dynamic = 'force-dynamic';

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const row = await prisma.document.findUnique({
    where: { id },
    include: {
      recipients: true,
      events: true,
      template: { select: { name: true } },
    },
  });
  if (!row) notFound();

  const document = toDocumentDTO(row);

  return <DocumentDetail initialDocument={document} />;
}

// Documents list (server component). Generated document instances with live
// status fed by Documenso webhooks (or mock simulation).
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { toDocumentDTO } from '@/lib/mappers';
import { EmptyState } from '@/components/ui';
import { SendIcon } from '@/components/icons';
import { DocumentRow } from '@/components/documents/document-row';

export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const rows = await prisma.document.findMany({
    include: {
      recipients: true,
      events: true,
      template: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  const documents = rows.map(toDocumentDTO);

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink">Documents</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Generated documents and their live signing status.
        </p>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          icon={<SendIcon className="h-8 w-8" />}
          title="No documents yet"
          description="Generate a document from one of your templates to send it for signing."
          action={
            <Link
              href="/templates"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink transition hover:brightness-110"
            >
              <SendIcon className="h-4 w-4" />
              Go to templates
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {documents.map((d) => (
            <DocumentRow key={d.id} document={d} />
          ))}
        </div>
      )}
    </div>
  );
}

// /api/templates/[id]/file — stream the stored template PDF inline.
import { prisma } from '@/lib/prisma';
import { readPdf } from '@/lib/storage';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const template = await prisma.template.findUnique({ where: { id } });
    if (!template) {
      return Response.json({ error: 'Template not found' }, { status: 404 });
    }

    const buf = await readPdf(template.storageKey);
    // Sanitize the user-supplied filename so quotes/control chars can't break or
    // inject the Content-Disposition header.
    const safeFilename = (template.fileName || 'document.pdf').replace(/[^\w.\- ]+/g, '_');
    // Buffer -> Uint8Array keeps TS happy about the BodyInit type.
    return new Response(new Uint8Array(buf) as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeFilename}"`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
      },
    });
  } catch (err) {
    console.error('[GET /api/templates/:id/file]', err);
    return Response.json({ error: 'Failed to read template file' }, { status: 500 });
  }
}

// /api/documents/[id] — single document detail.
import { getDocumentDTO } from '@/lib/documents';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const document = await getDocumentDTO(id);
    if (!document) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }
    return Response.json({ document });
  } catch (err) {
    console.error('[GET /api/documents/:id]', err);
    return Response.json({ error: 'Failed to load document' }, { status: 500 });
  }
}

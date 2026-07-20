// POST /api/templates/[id]/publish — push this template to Documenso as a
// reusable TEMPLATE envelope (PDF + recipients + positioned fields). Stores the
// returned Documenso ids so documents can later be generated via /envelope/use.
// Sends NO emails.
import { publishTemplateToDocumenso } from '@/lib/documents';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const template = await publishTemplateToDocumenso(id);
    return Response.json({ template });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to publish template';
    if (/not found/i.test(message)) {
      return Response.json({ error: message }, { status: 404 });
    }
    if (/at least one field/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    console.error('[POST /api/templates/[id]/publish]', err);
    // Surface Documenso API errors so the UI can show what went wrong.
    return Response.json({ error: message }, { status: 502 });
  }
}

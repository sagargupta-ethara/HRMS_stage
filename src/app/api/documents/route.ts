// /api/documents — generate (create + optionally send) and list documents.
import { generateDocumentSchema } from '@/lib/validation';
import { createDocumentFromTemplate, listDocuments } from '@/lib/documents';

// POST: generate a document from a template for one candidate.
export async function POST(req: Request) {
  try {
    const json = (await req.json().catch(() => null)) as
      | (Record<string, unknown> & { templateId?: unknown })
      | null;

    const templateId = typeof json?.templateId === 'string' ? json.templateId : '';
    if (!templateId) {
      return Response.json({ error: 'templateId is required' }, { status: 400 });
    }

    const parsed = generateDocumentSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      );
    }
    const { title, data, recipientOverrides, send } = parsed.data;

    const document = await createDocumentFromTemplate({
      templateId,
      title,
      data,
      recipientOverrides,
      send,
    });
    return Response.json({ document }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate document';
    if (/not found/i.test(message)) {
      return Response.json({ error: message }, { status: 404 });
    }
    if (/missing email/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    console.error('[POST /api/documents]', err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// GET: list all documents (newest first).
export async function GET() {
  try {
    return Response.json({ documents: await listDocuments() });
  } catch (err) {
    console.error('[GET /api/documents]', err);
    return Response.json({ error: 'Failed to list documents' }, { status: 500 });
  }
}

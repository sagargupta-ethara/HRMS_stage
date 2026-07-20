// POST /api/documents/bulk — generate (and optionally send) one document per
// candidate row. Used by the CSV bulk-send flow. One bad row does not abort the
// batch; each result reports its own status/error.
import { bulkGenerateSchema } from '@/lib/validation';
import { bulkGenerateDocuments } from '@/lib/documents';

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = bulkGenerateSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid payload' },
        { status: 400 },
      );
    }
    const { templateId, candidates, send } = parsed.data;
    const { results } = await bulkGenerateDocuments({ templateId, candidates, send });

    const ok = results.filter((r) => !r.error).length;
    return Response.json(
      { results, summary: { total: results.length, ok, failed: results.length - ok } },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to generate documents';
    console.error('[POST /api/documents/bulk]', err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// /api/documents/[id]/simulate — drive webhook state transitions in mock mode.
// This lets the UI exercise the full signing lifecycle without a real Documenso.
import { isMockMode } from '@/lib/documenso';
import { applyWebhookEvent } from '@/lib/documents';

type RouteContext = { params: Promise<{ id: string }> };

const ALLOWED_EVENTS = ['sent', 'viewed', 'signed', 'completed', 'rejected'] as const;

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const { id } = await params;

    if (!isMockMode()) {
      return Response.json(
        { error: 'Simulation is only available in mock mode' },
        { status: 403 },
      );
    }

    const body = (await req.json().catch(() => null)) as
      | { event?: unknown; recipientEmail?: unknown }
      | null;

    const event = typeof body?.event === 'string' ? body.event : '';
    if (!ALLOWED_EVENTS.includes(event as (typeof ALLOWED_EVENTS)[number])) {
      return Response.json({ error: 'Invalid event' }, { status: 400 });
    }
    const recipientEmail =
      typeof body?.recipientEmail === 'string' ? body.recipientEmail : undefined;

    const document = await applyWebhookEvent({
      documentId: id,
      event,
      recipientEmail,
      rawPayload: { simulated: true },
    });
    if (!document) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }
    return Response.json({ document });
  } catch (err) {
    console.error('[POST /api/documents/:id/simulate]', err);
    return Response.json({ error: 'Failed to simulate event' }, { status: 500 });
  }
}

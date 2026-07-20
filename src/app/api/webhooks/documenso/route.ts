// /api/webhooks/documenso — inbound Documenso webhook receiver.
// Returns 200 even when no document matches (so Documenso doesn't retry forever);
// the only non-200 path is an invalid secret (401).
import { verifyWebhook } from '@/lib/documenso';
import { applyWebhookEvent } from '@/lib/documents';

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord {
  return v && typeof v === 'object' ? (v as JsonRecord) : {};
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();

    let parsed: unknown;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch (e) {
      console.error('[webhook] invalid JSON body', e);
      // Ack with ok:false so Documenso doesn't hammer retries on a bad payload.
      return Response.json({ ok: false }, { status: 200 });
    }

    const secret = req.headers.get('x-documenso-secret');
    if (!verifyWebhook(secret)) {
      return Response.json({ error: 'Invalid webhook secret' }, { status: 401 });
    }

    const body = asRecord(parsed);
    const event = typeof body.event === 'string' ? body.event : '';
    const payload = asRecord(body.payload ?? body.data ?? body);

    const idCandidate = payload.id ?? payload.documentId;
    const documensoDocumentId =
      typeof idCandidate === 'string' || typeof idCandidate === 'number'
        ? String(idCandidate) || undefined
        : undefined;
    const externalId = typeof payload.externalId === 'string' ? payload.externalId : undefined;
    const recipient = asRecord(payload.recipient);
    const recipientEmail = typeof recipient.email === 'string' ? recipient.email : undefined;

    const document = await applyWebhookEvent({
      documensoDocumentId,
      externalId,
      event,
      recipientEmail,
      rawPayload: parsed,
    });

    if (!document) {
      console.warn('[webhook] no matching document', {
        documensoDocumentId,
        externalId,
        event,
      });
    }

    return Response.json({ ok: true });
  } catch (err) {
    // Always ack to avoid retry storms; surface the error in logs.
    console.error('[webhook] handler error', err);
    return Response.json({ ok: false }, { status: 200 });
  }
}

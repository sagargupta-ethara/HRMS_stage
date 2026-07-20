// Server-ONLY Documenso integration. The `server-only` import makes the build
// fail if any of this is ever pulled into a client bundle — that's the
// guardrail ensuring DOCUMENSO_API_KEY can never leak to the browser.
import 'server-only';

import type { DocumentStatus } from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
export function documensoConfig() {
  const rawUrl = (process.env.DOCUMENSO_API_URL ?? '').replace(/\/+$/, '');
  // Accept either an origin ("https://app.documenso.com") or a full API base
  // ("https://app.documenso.com/api/v2"). Normalise to both forms.
  const apiBase = rawUrl
    ? /\/api\/v\d+$/.test(rawUrl)
      ? rawUrl
      : `${rawUrl}/api/v2`
    : '';
  const appOrigin = apiBase.replace(/\/api\/v\d+$/, '');
  const method = (process.env.DOCUMENSO_DISTRIBUTION_METHOD ?? 'EMAIL').toUpperCase();
  return {
    apiUrl: rawUrl,
    apiBase,
    appOrigin,
    apiKey: process.env.DOCUMENSO_API_KEY ?? '',
    webhookSecret: process.env.DOCUMENSO_WEBHOOK_SECRET ?? '',
    appBaseUrl: (process.env.APP_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
    distributionMethod: method === 'NONE' ? 'NONE' : 'EMAIL',
  };
}

/** Mock mode is active whenever we lack a URL or key — the app stays runnable. */
export function isMockMode(): boolean {
  const { apiBase, apiKey } = documensoConfig();
  return !apiBase || !apiKey;
}

// ---------------------------------------------------------------------------
// Public shapes (stable — the API layer depends on these)
// ---------------------------------------------------------------------------
export interface DocumensoRecipientInput {
  roleKey: string;
  name: string;
  email: string;
  signingOrder: number;
}

export interface DocumensoFieldInput {
  /** links the field to a recipient by email */
  recipientEmail: string;
  /** Documenso FieldType, e.g. SIGNATURE | TEXT | DATE | NUMBER | DROPDOWN */
  type: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
  /** prefilled value for text-like fields */
  value?: string;
  /** dropdown / radio choices */
  options?: string[];
  /** value is fixed (signer cannot edit) */
  fixed?: boolean;
}

export interface DocumensoCreateInput {
  /** our Document.id — set as Documenso externalId for webhook correlation */
  externalId: string;
  title: string;
  fileName: string;
  pdf: Buffer;
  recipients: DocumensoRecipientInput[];
  fields: DocumensoFieldInput[];
}

export interface DocumensoCreateResult {
  mock: boolean;
  documensoDocumentId: string;
  signingFlowUrl?: string;
  recipients: Array<{
    email: string;
    documensoRecipientId: string;
    signingUrl?: string;
  }>;
}

// ---- Template publish + use (the primary, template-based flow) ------------

export interface PublishRecipientInput {
  roleKey: string;
  name: string;
  /** placeholder email — template recipients are placeholders, real contacts
   *  are supplied later by /envelope/use */
  email: string;
  signingOrder: number;
  isSigner: boolean;
}

export interface PublishFieldInput {
  /** our TemplateField.id — used to map back the assigned Documenso field id */
  localId: string;
  recipientRoleKey: string;
  /** already-resolved Documenso FieldType (TEXT | NUMBER | SIGNATURE | ...) */
  documensoType: string;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  required: boolean;
  fixed: boolean;
  options?: string[];
}

export interface PublishTemplateInput {
  title: string;
  fileName: string;
  pdf: Buffer;
  recipients: PublishRecipientInput[];
  fields: PublishFieldInput[];
}

export interface PublishTemplateResult {
  mock: boolean;
  documensoTemplateId: string;
  /** roleKey -> Documenso recipient id */
  recipientIdByRole: Record<string, string>;
  /** our field id -> Documenso field id */
  fieldIdByLocalId: Record<string, string>;
}

export type UsePrefillType = 'text' | 'number' | 'date' | 'dropdown' | 'checkbox' | 'radio';

export interface UseTemplateRecipientInput {
  documensoRecipientId: string;
  name: string;
  email: string;
  signingOrder: number;
}

export interface UseTemplatePrefillInput {
  documensoFieldId: string;
  type: UsePrefillType;
  value: string;
}

export interface UseTemplateInput {
  documensoTemplateId: string;
  externalId: string;
  title: string;
  recipients: UseTemplateRecipientInput[];
  prefillFields: UseTemplatePrefillInput[];
  /** create the document AND email signers (subject to DISTRIBUTION_METHOD) */
  distribute: boolean;
}

export interface UseTemplateResult {
  mock: boolean;
  documensoDocumentId: string;
  signingFlowUrl?: string;
  recipients: Array<{ email: string; documensoRecipientId: string; signingUrl?: string }>;
}

export interface DocumensoClient {
  readonly mock: boolean;
  createAndSend(input: DocumensoCreateInput): Promise<DocumensoCreateResult>;
  /** Publish a reusable TEMPLATE envelope to Documenso. */
  publishTemplate(input: PublishTemplateInput): Promise<PublishTemplateResult>;
  /** Instantiate + prefill + distribute a document from a published template. */
  useTemplate(input: UseTemplateInput): Promise<UseTemplateResult>;
}

// ---------------------------------------------------------------------------
// Mock client — generates ids, logs the payload, returns deterministic-ish data.
// Webhook events are then driven from the document detail UI (Simulate buttons),
// which POST realistic payloads to /api/webhooks/documenso.
// ---------------------------------------------------------------------------
class MockDocumensoClient implements DocumensoClient {
  readonly mock = true;

  async createAndSend(input: DocumensoCreateInput): Promise<DocumensoCreateResult> {
    const docId = `mock_${input.externalId.slice(-8)}`;
    console.info(
      `[documenso:mock] createAndSend "${input.title}" — ${input.recipients.length} recipient(s), ${input.fields.length} field(s), pdf ${input.pdf.byteLength}B`,
    );
    const { appBaseUrl } = documensoConfig();
    return {
      mock: true,
      documensoDocumentId: docId,
      signingFlowUrl: `${appBaseUrl}/documents`,
      recipients: input.recipients.map((r, i) => ({
        email: r.email,
        documensoRecipientId: `mock_r_${i + 1}`,
        signingUrl: `${appBaseUrl}/documents`,
      })),
    };
  }

  async publishTemplate(input: PublishTemplateInput): Promise<PublishTemplateResult> {
    console.info(
      `[documenso:mock] publishTemplate "${input.title}" — ${input.recipients.length} recipient(s), ${input.fields.length} field(s)`,
    );
    return {
      mock: true,
      documensoTemplateId: `mock_tpl_${Math.abs(hashString(input.title)).toString(36)}`,
      recipientIdByRole: Object.fromEntries(
        input.recipients.map((r, i) => [r.roleKey, `mock_tr_${i + 1}`]),
      ),
      fieldIdByLocalId: Object.fromEntries(
        input.fields.map((f, i) => [f.localId, `mock_tf_${i + 1}`]),
      ),
    };
  }

  async useTemplate(input: UseTemplateInput): Promise<UseTemplateResult> {
    const { appBaseUrl } = documensoConfig();
    console.info(
      `[documenso:mock] useTemplate ${input.documensoTemplateId} -> "${input.title}" (${input.recipients.length} recipient(s), ${input.prefillFields.length} prefill)`,
    );
    return {
      mock: true,
      documensoDocumentId: `mock_${input.externalId.slice(-8)}`,
      signingFlowUrl: `${appBaseUrl}/documents`,
      recipients: input.recipients.map((r) => ({
        email: r.email,
        documensoRecipientId: r.documensoRecipientId,
        signingUrl: `${appBaseUrl}/documents`,
      })),
    };
  }
}

/** Tiny deterministic hash so mock ids are stable per title (no Math.random). */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ---------------------------------------------------------------------------
// Real client — targets the Documenso v2 ("envelope") REST API.
//
// Flow (verified against https://app.documenso.com/api/v2/openapi.json):
//   1. POST /envelope/create        (multipart: payload JSON + the PDF file)
//   2. GET  /envelope/{id}          (read back recipient ids + envelope item id)
//   3. POST /envelope/field/create-many   (positioned fields, coords are 0..100%)
//   4. POST /envelope/distribute    (send for signing — EMAIL or NONE)
//
// Auth is `Authorization: api_xxx` (the raw token, NOT a Bearer prefix).
// ---------------------------------------------------------------------------
type EnvelopeDetail = {
  id: string;
  externalId?: string | null;
  directLink?: { token?: string } | null;
  recipients?: Array<{ id: number; email: string; name?: string; token?: string }>;
  envelopeItems?: Array<{ id: string }>;
};

class RealDocumensoClient implements DocumensoClient {
  readonly mock = false;
  private base: string;
  private appOrigin: string;
  private apiKey: string;

  constructor(base: string, appOrigin: string, apiKey: string) {
    this.base = base;
    this.appOrigin = appOrigin;
    this.apiKey = apiKey;
  }

  private authHeaders(): Record<string, string> {
    // The Documenso API token already carries its `api_` prefix and is sent
    // verbatim as the Authorization header value.
    return { Authorization: this.apiKey };
  }

  private async jsonApi<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    return this.handle<T>(path, res);
  }

  private async getApi<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'GET',
      headers: this.authHeaders(),
      cache: 'no-store',
    });
    return this.handle<T>(path, res);
  }

  private async handle<T>(path: string, res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Documenso ${path} failed: ${res.status} ${res.statusText} ${text.slice(0, 400)}`,
      );
    }
    return (await res.json()) as T;
  }

  async createAndSend(input: DocumensoCreateInput): Promise<DocumensoCreateResult> {
    const { distributionMethod } = documensoConfig();

    // Which recipients actually have fields? Those are SIGNERs; the rest CC.
    const emailsWithFields = new Set(
      input.fields.map((f) => f.recipientEmail.toLowerCase()),
    );

    // 1) Create the envelope (DOCUMENT) with recipients + the PDF, in one
    //    multipart request.
    const payload = {
      title: input.title,
      type: 'DOCUMENT' as const,
      externalId: input.externalId,
      recipients: input.recipients.map((r) => ({
        name: r.name,
        email: r.email,
        role: emailsWithFields.has(r.email.toLowerCase()) ? 'SIGNER' : 'CC',
        signingOrder: r.signingOrder,
      })),
    };

    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    form.append(
      'files',
      new Blob([new Uint8Array(input.pdf)], { type: 'application/pdf' }),
      input.fileName || 'document.pdf',
    );

    const createRes = await fetch(`${this.base}/envelope/create`, {
      method: 'POST',
      headers: this.authHeaders(), // let fetch set the multipart boundary
      body: form,
      cache: 'no-store',
    });
    const { id: envelopeId } = await this.handle<{ id: string }>(
      '/envelope/create',
      createRes,
    );

    // 2) Read the envelope back to map recipient ids (by email) + the item id.
    const detail = await this.getApi<EnvelopeDetail>(`/envelope/${envelopeId}`);
    const recById = new Map<string, { id: number; token?: string }>();
    for (const r of detail.recipients ?? []) {
      recById.set(r.email.toLowerCase(), { id: r.id, token: r.token });
    }
    const envelopeItemId = detail.envelopeItems?.[0]?.id;

    // 3) Add positioned fields. Coordinates pass through unchanged (0..100%).
    const data = input.fields
      .map((f) => {
        const rec = recById.get(f.recipientEmail.toLowerCase());
        if (!rec) return null;
        const { type, fieldMeta } = mapV2Field(f);
        return {
          recipientId: rec.id,
          ...(envelopeItemId ? { envelopeItemId } : {}),
          type,
          page: f.page,
          positionX: clampPct(f.xPct),
          positionY: clampPct(f.yPct),
          width: clampPct(f.widthPct),
          height: clampPct(f.heightPct),
          fieldMeta,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (data.length > 0) {
      await this.jsonApi('/envelope/field/create-many', { envelopeId, data });
    }

    // 4) Distribute for signing.
    await this.jsonApi('/envelope/distribute', {
      envelopeId,
      meta: {
        subject: input.title,
        message: 'Please review and sign your document.',
        distributionMethod,
      },
    });

    return {
      mock: false,
      documensoDocumentId: envelopeId,
      signingFlowUrl: `${this.appOrigin}/documents`,
      recipients: (detail.recipients ?? []).map((r) => ({
        email: r.email,
        documensoRecipientId: String(r.id),
        signingUrl: r.token ? `${this.appOrigin}/sign/${r.token}` : undefined,
      })),
    };
  }

  async publishTemplate(input: PublishTemplateInput): Promise<PublishTemplateResult> {
    // 1) Create a reusable TEMPLATE envelope with placeholder recipients + PDF.
    const payload = {
      title: input.title,
      type: 'TEMPLATE' as const,
      recipients: input.recipients.map((r) => ({
        name: r.name,
        email: r.email,
        role: r.isSigner ? 'SIGNER' : 'CC',
        signingOrder: r.signingOrder,
      })),
    };
    const form = new FormData();
    form.append('payload', JSON.stringify(payload));
    form.append(
      'files',
      new Blob([new Uint8Array(input.pdf)], { type: 'application/pdf' }),
      input.fileName || 'template.pdf',
    );
    const createRes = await fetch(`${this.base}/envelope/create`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: form,
      cache: 'no-store',
    });
    const { id: templateId } = await this.handle<{ id: string }>('/envelope/create', createRes);

    // 2) Read back recipient ids (by placeholder email) + the envelope item id.
    const detail = await this.getApi<EnvelopeDetail>(`/envelope/${templateId}`);
    const recIdByEmail = new Map<string, number>();
    for (const r of detail.recipients ?? []) recIdByEmail.set(r.email.toLowerCase(), r.id);
    const envelopeItemId = detail.envelopeItems?.[0]?.id;

    const recipientIdByRole: Record<string, string> = {};
    for (const r of input.recipients) {
      const id = recIdByEmail.get(r.email.toLowerCase());
      if (id != null) recipientIdByRole[r.roleKey] = String(id);
    }

    // 3) Add positioned fields, in input order so we can map ids back.
    const orderedFields = input.fields.filter((f) => recipientIdByRole[f.recipientRoleKey] != null);
    const data = orderedFields.map((f) => ({
      recipientId: Number(recipientIdByRole[f.recipientRoleKey]),
      ...(envelopeItemId ? { envelopeItemId } : {}),
      type: f.documensoType,
      page: f.page,
      positionX: clampPct(f.xPct),
      positionY: clampPct(f.yPct),
      width: clampPct(f.widthPct),
      height: clampPct(f.heightPct),
      fieldMeta: publishFieldMeta(f),
    }));

    const fieldIdByLocalId: Record<string, string> = {};
    if (data.length > 0) {
      const res = await this.jsonApi<{ data: Array<{ id: number | string }> }>(
        '/envelope/field/create-many',
        { envelopeId: templateId, data },
      );
      const created = res.data ?? [];
      // Response preserves input order — zip back to our local field ids.
      orderedFields.forEach((f, i) => {
        const made = created[i];
        if (made?.id != null) fieldIdByLocalId[f.localId] = String(made.id);
      });
    }

    return { mock: false, documensoTemplateId: templateId, recipientIdByRole, fieldIdByLocalId };
  }

  async useTemplate(input: UseTemplateInput): Promise<UseTemplateResult> {
    const { distributionMethod } = documensoConfig();
    const res = await this.jsonApi<{
      id: string;
      recipients?: Array<{ id: number | string; email: string; token?: string }>;
    }>('/envelope/use', {
      payload: {
        envelopeId: input.documensoTemplateId,
        externalId: input.externalId,
        recipients: input.recipients.map((r) => ({
          id: Number(r.documensoRecipientId),
          email: r.email,
          name: r.name,
          signingOrder: r.signingOrder,
        })),
        prefillFields: input.prefillFields.map((p) => ({
          id: Number(p.documensoFieldId),
          type: p.type,
          value: p.value,
        })),
        distributeDocument: input.distribute,
        override: { title: input.title, distributionMethod },
      },
    });

    return {
      mock: false,
      documensoDocumentId: String(res.id),
      signingFlowUrl: `${this.appOrigin}/documents`,
      recipients: (res.recipients ?? []).map((r) => ({
        email: r.email,
        documensoRecipientId: String(r.id),
        signingUrl: r.token ? `${this.appOrigin}/sign/${r.token}` : undefined,
      })),
    };
  }
}

/** fieldMeta for a TEMPLATE field (no value — values come at /envelope/use time). */
function publishFieldMeta(f: PublishFieldInput): Record<string, unknown> {
  const metaType = f.documensoType.toLowerCase();
  const base: Record<string, unknown> = { type: metaType, required: f.required, readOnly: f.fixed };
  if (metaType === 'dropdown' || metaType === 'radio') {
    base.values = (f.options ?? []).map((v, i) =>
      metaType === 'radio' ? { id: i, checked: false, value: v } : { value: v },
    );
  } else if (metaType === 'checkbox') {
    base.values = (f.options && f.options.length ? f.options : ['Yes']).map((v, i) => ({
      id: i,
      checked: false,
      value: v,
    }));
  }
  return base;
}

function clampPct(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Map our generic field (already carrying a Documenso FieldType + optional
 * prefilled value) to a v2 `{ type, fieldMeta }`. Prefilled NAME/EMAIL/DATE/
 * INITIALS values are emitted as read-only TEXT so the value actually renders
 * (those native types don't accept a literal value on field creation).
 */
function mapV2Field(f: DocumensoFieldInput): {
  type: string;
  fieldMeta: Record<string, unknown>;
} {
  const t = f.type.toUpperCase();
  const hasValue = f.value !== undefined && f.value !== '';
  const base = { required: f.required, readOnly: f.fixed ?? Boolean(hasValue) };

  if (hasValue && (t === 'NAME' || t === 'EMAIL' || t === 'DATE' || t === 'TEXT' || t === 'INITIALS')) {
    return { type: 'TEXT', fieldMeta: { type: 'text', text: String(f.value), ...base } };
  }

  switch (t) {
    case 'NUMBER':
      return {
        type: 'NUMBER',
        fieldMeta: { type: 'number', ...(hasValue ? { value: String(f.value) } : {}), ...base },
      };
    case 'DROPDOWN':
      return {
        type: 'DROPDOWN',
        fieldMeta: {
          type: 'dropdown',
          values: (f.options ?? []).map((v) => ({ value: v })),
          ...(hasValue ? { defaultValue: String(f.value) } : {}),
          ...base,
        },
      };
    case 'RADIO':
      return {
        type: 'RADIO',
        fieldMeta: {
          type: 'radio',
          values: (f.options ?? ['Option 1']).map((v, i) => ({ id: i, checked: false, value: v })),
          ...base,
        },
      };
    case 'CHECKBOX':
      return {
        type: 'CHECKBOX',
        fieldMeta: {
          type: 'checkbox',
          values: (f.options && f.options.length ? f.options : ['Yes']).map((v, i) => ({
            id: i,
            checked: false,
            value: v,
          })),
          ...base,
        },
      };
    case 'SIGNATURE':
      return { type: 'SIGNATURE', fieldMeta: { type: 'signature', ...base } };
    case 'INITIALS':
      return { type: 'INITIALS', fieldMeta: { type: 'initials', ...base } };
    case 'NAME':
      return { type: 'NAME', fieldMeta: { type: 'name', ...base } };
    case 'EMAIL':
      return { type: 'EMAIL', fieldMeta: { type: 'email', ...base } };
    case 'DATE':
      return { type: 'DATE', fieldMeta: { type: 'date', ...base } };
    case 'TEXT':
    default:
      return {
        type: 'TEXT',
        fieldMeta: { type: 'text', ...(hasValue ? { text: String(f.value) } : {}), ...base },
      };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
export function getDocumensoClient(): DocumensoClient {
  const { apiBase, appOrigin, apiKey } = documensoConfig();
  if (!apiBase || !apiKey) return new MockDocumensoClient();
  return new RealDocumensoClient(apiBase, appOrigin, apiKey);
}

// ---------------------------------------------------------------------------
// Webhook helpers
// ---------------------------------------------------------------------------
export type NormalizedEvent =
  | 'created'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'completed'
  | 'rejected'
  | 'error';

/** Accepts "DOCUMENT_OPENED", "document.opened", "opened", etc. */
export function normalizeDocumensoEvent(event: string): NormalizedEvent | null {
  const key = event.trim().toUpperCase().replace(/[.\s-]/g, '_').replace(/^DOCUMENT_/, '');
  switch (key) {
    case 'CREATED':
      return 'created';
    case 'SENT':
    case 'PENDING':
      return 'sent';
    case 'OPENED':
    case 'VIEWED':
      return 'viewed';
    case 'SIGNED':
    case 'RECIPIENT_SIGNED':
      return 'signed';
    case 'COMPLETED':
      return 'completed';
    case 'REJECTED':
      return 'rejected';
    case 'CANCELLED':
    case 'CANCELED':
      return 'error';
    default:
      return null;
  }
}

/** Document-level status implied by an event (null = no status change). */
export function documentStatusForEvent(ev: NormalizedEvent): DocumentStatus | null {
  switch (ev) {
    case 'sent':
      return 'sent';
    case 'viewed':
      return 'viewed';
    case 'signed':
      return 'partially_signed';
    case 'completed':
      return 'completed';
    case 'rejected':
      return 'rejected';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

/**
 * Verify an inbound webhook. Documenso sends the configured secret in the
 * `X-Documenso-Secret` header.
 *
 * Security: fail-OPEN only in mock mode (so the Simulate buttons work out of the
 * box). In real mode a secret is REQUIRED — if `DOCUMENSO_WEBHOOK_SECRET` is
 * unset we reject, otherwise a forged request could flip any document's status.
 */
export function verifyWebhook(headerSecret: string | null): boolean {
  if (isMockMode()) return true;
  const { webhookSecret } = documensoConfig();
  if (!webhookSecret) {
    console.warn(
      '[documenso] Rejecting webhook: real mode but DOCUMENSO_WEBHOOK_SECRET is not set.',
    );
    return false;
  }
  return headerSecret === webhookSecret;
}

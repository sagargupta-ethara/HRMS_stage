// Server-only document orchestration. Routes stay thin and delegate the
// template -> Documenso wiring (contact resolution, field prefill, send,
// webhook state transitions) to the helpers below.
import 'server-only';

import { Prisma } from '@prisma/client';

import { prisma } from './prisma';
import { readPdf } from './storage';
import { fieldDef } from './fields';
import { contactForRole, getPath, resolveToken, type GenerationData } from './prefill';
import { parseJson, toDocumentDTO, toTemplateDTO } from './mappers';
import type { DocumentDTO, FieldMeta, FieldType, TemplateDTO } from './types';
import {
  getDocumensoClient,
  normalizeDocumensoEvent,
  documentStatusForEvent,
  type DocumensoFieldInput,
  type DocumensoRecipientInput,
  type DocumensoCreateResult,
  type UseTemplateResult,
  type UsePrefillType,
  type NormalizedEvent,
} from './documenso';

// Map an HRMS field type (+ whether it's prefill-bound) to the Documenso field
// type used when PUBLISHING the template, and the prefill type used at /use
// time. Prefilled NAME/EMAIL/DATE/TEXT/INITIALS become read-only TEXT so the
// resolved value renders; NUMBER stays NUMBER, choice fields keep their kind.
function documensoFieldKind(
  type: FieldType,
  hasPrefill: boolean,
): { publishType: string; prefillType?: UsePrefillType } {
  if (hasPrefill) {
    switch (type) {
      case 'number':
        return { publishType: 'NUMBER', prefillType: 'number' };
      case 'dropdown':
        return { publishType: 'DROPDOWN', prefillType: 'dropdown' };
      case 'checkbox':
        return { publishType: 'CHECKBOX', prefillType: 'checkbox' };
      case 'radio':
        return { publishType: 'RADIO', prefillType: 'radio' };
      default:
        return { publishType: 'TEXT', prefillType: 'text' };
    }
  }
  return { publishType: fieldDef(type).documensoType };
}

// Shared include used everywhere we hydrate a Document into a DTO.
const documentInclude = {
  recipients: true,
  events: true,
  template: { select: { name: true } },
} satisfies Prisma.DocumentInclude;

type DocumentWithRelations = Prisma.DocumentGetPayload<{ include: typeof documentInclude }>;

/** Return the first value that is present and not blank/whitespace. */
function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (v != null && v.trim() !== '') return v;
  }
  return '';
}

/** Human-readable message for an audit-log event. */
function eventMessage(ev: NormalizedEvent, recipientEmail?: string): string {
  switch (ev) {
    case 'created':
      return 'Document created.';
    case 'sent':
      return 'Document sent for signing.';
    case 'viewed':
      return recipientEmail ? `${recipientEmail} viewed the document.` : 'Document viewed.';
    case 'signed':
      return recipientEmail ? `${recipientEmail} signed the document.` : 'Document signed.';
    case 'completed':
      return 'All recipients signed — document completed.';
    case 'rejected':
      return recipientEmail ? `${recipientEmail} rejected the document.` : 'Document rejected.';
    case 'error':
      return 'Document was cancelled or errored.';
    default:
      return 'Document event.';
  }
}

// ---------------------------------------------------------------------------
// Create + (optionally) send a document from a template.
// ---------------------------------------------------------------------------
export async function createDocumentFromTemplate(input: {
  templateId: string;
  title?: string;
  data: GenerationData;
  recipientOverrides?: Record<string, { name?: string; email?: string }>;
  send?: boolean;
}): Promise<DocumentDTO> {
  const { templateId, data, recipientOverrides, send } = input;

  const template = await prisma.template.findUnique({
    where: { id: templateId },
    include: { recipients: true, fields: true },
  });
  if (!template) throw new Error('Template not found');

  // Recipient ids that have at least one placed field — these MUST be reachable.
  const recipientsWithFields = new Set(template.fields.map((f) => f.recipientId));

  // Resolve each template recipient's signer contact:
  // override -> generation data -> recipient defaults (per-field fallback).
  const resolved = template.recipients.map((r) => {
    const override = recipientOverrides?.[r.roleKey];
    const fromData = contactForRole(r.roleKey, data);
    // An explicitly provided override (key present) is authoritative — including
    // an intentional blank — matching the generate form's live preview. Only when
    // the override omits a field do we fall back to data → recipient default.
    const name =
      override?.name !== undefined ? override.name : firstNonEmpty(fromData.name, r.defaultName);
    const email =
      override?.email !== undefined ? override.email : firstNonEmpty(fromData.email, r.defaultEmail);
    return { recipient: r, name, email };
  });

  // A recipient with assigned fields must have a non-empty email.
  for (const res of resolved) {
    if (recipientsWithFields.has(res.recipient.id) && !res.email) {
      throw new Error(`Missing email for recipient "${res.recipient.label}"`);
    }
  }

  const emailByRecipientId = new Map(resolved.map((r) => [r.recipient.id, r.email]));

  // Resolve a field's prefilled value. NUMBER fields send the RAW numeric value
  // (not a currency-formatted string); everything else uses the formatted token.
  const fieldValue = (f: (typeof template.fields)[number]): string => {
    const meta = parseJson<FieldMeta | null>(f.meta, null);
    if (!f.prefillKey) return meta?.defaultValue ?? '';
    if (f.type === 'number') {
      const raw = getPath(data, f.prefillKey);
      return raw == null ? '' : String(raw);
    }
    return resolveToken(f.prefillKey, data);
  };

  // From-scratch Documenso field payload (used ONLY when the template has not
  // been published to Documenso). Fields whose recipient has no email are skipped.
  const documensoFields: DocumensoFieldInput[] = [];
  for (const f of template.fields) {
    const email = emailByRecipientId.get(f.recipientId);
    if (!email) continue;
    const meta = parseJson<FieldMeta | null>(f.meta, null);
    documensoFields.push({
      recipientEmail: email,
      type: fieldDef(f.type as FieldType).documensoType,
      page: f.page,
      xPct: f.xPct,
      yPct: f.yPct,
      widthPct: f.widthPct,
      heightPct: f.heightPct,
      required: f.required,
      value: fieldValue(f),
      options: meta?.options?.map((o) => o.value),
      // Prefilled or explicitly read-only fields are fixed (signer can't edit).
      fixed: Boolean(f.prefillKey) || meta?.readOnly === true,
    });
  }

  const title = input.title || `${template.name} — ${data.candidate.fullName}`;

  // Persist the draft document, its recipients and a 'created' event.
  const created = await prisma.document.create({
    data: {
      templateId: template.id,
      title,
      status: 'draft',
      prefillData: JSON.stringify(data),
      recipients: {
        create: resolved.map((r) => ({
          roleKey: r.recipient.roleKey,
          label: r.recipient.label,
          name: r.name,
          email: r.email,
          status: 'pending',
          signingOrder: r.recipient.signingOrder,
        })),
      },
      events: {
        create: { type: 'created', message: eventMessage('created'), payload: '{}' },
      },
    },
    include: documentInclude,
  });

  // Draft-only: stop here without touching Documenso.
  if (send === false) {
    return toDocumentDTO(created);
  }

  try {
    let result: DocumensoCreateResult | UseTemplateResult;

    if (template.documensoTemplateId) {
      // PRIMARY path: instantiate + prefill + distribute from the published
      // Documenso TEMPLATE via /envelope/use.
      const useRecipients = resolved
        .filter((r) => r.email && r.recipient.documensoRecipientId)
        .map((r) => ({
          documensoRecipientId: r.recipient.documensoRecipientId as string,
          name: r.name || r.email,
          email: r.email,
          signingOrder: r.recipient.signingOrder,
        }));
      const prefillFields = template.fields
        .filter((f) => f.prefillKey && f.documensoFieldId)
        .map((f) => ({
          documensoFieldId: f.documensoFieldId as string,
          type: documensoFieldKind(f.type as FieldType, true).prefillType ?? 'text',
          value: fieldValue(f),
        }));
      result = await getDocumensoClient().useTemplate({
        documensoTemplateId: template.documensoTemplateId,
        externalId: created.id,
        title,
        recipients: useRecipients,
        prefillFields,
        distribute: true,
      });
    } else {
      // FALLBACK: build a one-off document from scratch (template not published).
      const documensoRecipients: DocumensoRecipientInput[] = resolved
        .filter((r) => r.email)
        .map((r) => ({
          roleKey: r.recipient.roleKey,
          name: r.name || r.email,
          email: r.email,
          signingOrder: r.recipient.signingOrder,
        }));
      const pdf = await readPdf(template.storageKey);
      result = await getDocumensoClient().createAndSend({
        externalId: created.id,
        title,
        fileName: template.fileName,
        pdf,
        recipients: documensoRecipients,
        fields: documensoFields,
      });
    }

    // Map Documenso recipient ids back to ours by email (case-insensitive).
    const documensoIdByEmail = new Map(
      result.recipients.map((r) => [r.email.toLowerCase(), r.documensoRecipientId]),
    );

    await prisma.$transaction(async (tx) => {
      await tx.document.update({
        where: { id: created.id },
        data: {
          documensoDocumentId: result.documensoDocumentId,
          signingFlowUrl: result.signingFlowUrl ?? null,
          status: 'sent',
        },
      });
      for (const r of created.recipients) {
        if (!r.email) continue; // passive recipient, nothing was sent
        await tx.documentRecipient.update({
          where: { id: r.id },
          data: {
            status: 'sent',
            documensoRecipientId: documensoIdByEmail.get(r.email.toLowerCase()) ?? null,
          },
        });
      }
      await tx.documentEvent.create({
        data: {
          documentId: created.id,
          type: 'sent',
          message: result.mock
            ? 'Document sent via Documenso (mock mode).'
            : 'Document sent via Documenso.',
          payload: '{}',
        },
      });
    });
  } catch (err) {
    // Leave a clear trail on the document, then surface the failure.
    const message = err instanceof Error ? err.message : 'Failed to send document.';
    await prisma.document.update({ where: { id: created.id }, data: { status: 'error' } }).catch(() => {});
    await prisma.documentEvent
      .create({ data: { documentId: created.id, type: 'error', message, payload: '{}' } })
      .catch(() => {});
    throw err;
  }

  const final = await prisma.document.findUnique({ where: { id: created.id }, include: documentInclude });
  return toDocumentDTO(final!);
}

// ---------------------------------------------------------------------------
// Apply an inbound (or simulated) Documenso event to a document.
// ---------------------------------------------------------------------------
export async function applyWebhookEvent(args: {
  documensoDocumentId?: string;
  externalId?: string;
  documentId?: string;
  event: string;
  recipientEmail?: string;
  rawPayload?: unknown;
}): Promise<DocumentDTO | null> {
  // Locate the document: our id, then Documenso id, then externalId (== our id).
  let doc: DocumentWithRelations | null = null;
  if (args.documentId) {
    doc = await prisma.document.findUnique({ where: { id: args.documentId }, include: documentInclude });
  }
  if (!doc && args.documensoDocumentId) {
    doc = await prisma.document.findFirst({
      where: { documensoDocumentId: args.documensoDocumentId },
      include: documentInclude,
    });
  }
  if (!doc && args.externalId) {
    doc = await prisma.document.findUnique({ where: { id: args.externalId }, include: documentInclude });
  }
  if (!doc) return null;

  const document = doc; // narrowed, non-null for closures below
  const normalized = normalizeDocumensoEvent(args.event);

  // Unrecognised event: still record it for the audit trail, no state change.
  if (!normalized) {
    await prisma.documentEvent.create({
      data: {
        documentId: document.id,
        type: args.event || 'unknown',
        recipientEmail: args.recipientEmail ?? null,
        message: `Unhandled event: ${args.event}`,
        payload: JSON.stringify(args.rawPayload ?? {}),
      },
    });
    return getDocumentDTO(document.id);
  }

  // Status is monotonic: progress events (sent→viewed→partially_signed→
  // completed) only ever advance, never regress, so out-of-order webhooks (e.g.
  // a second recipient's `viewed` arriving after the first one's `signed`) can't
  // pull the document backwards. rejected/error are terminal and win unless the
  // document is already completed/rejected.
  const terminal = document.status === 'completed' || document.status === 'rejected';
  const newStatus = documentStatusForEvent(normalized);
  const rank: Record<string, number> = {
    draft: 0,
    sent: 1,
    viewed: 2,
    partially_signed: 3,
    completed: 4,
  };
  const isRegression =
    newStatus != null &&
    normalized !== 'rejected' &&
    normalized !== 'error' &&
    (rank[newStatus] ?? 0) <= (rank[document.status] ?? 0);

  await prisma.$transaction(async (tx) => {
    if (!terminal && newStatus && !isRegression) {
      await tx.document.update({
        where: { id: document.id },
        data:
          normalized === 'completed'
            ? { status: newStatus, completedAt: new Date() }
            : { status: newStatus },
      });
      // Completing the document marks every recipient as signed.
      if (normalized === 'completed') {
        await tx.documentRecipient.updateMany({
          where: { documentId: document.id },
          data: { status: 'signed', signedAt: new Date() },
        });
      }
    }

    // Recipient-level transition (match email case-insensitively).
    if (
      args.recipientEmail &&
      (normalized === 'viewed' || normalized === 'signed' || normalized === 'rejected')
    ) {
      const target = document.recipients.find(
        (r) => r.email.toLowerCase() === args.recipientEmail!.toLowerCase(),
      );
      if (target) {
        await tx.documentRecipient.update({
          where: { id: target.id },
          data:
            normalized === 'viewed'
              ? { status: 'viewed' }
              : normalized === 'signed'
                ? { status: 'signed', signedAt: new Date() }
                : { status: 'rejected' },
        });
      }
    }

    await tx.documentEvent.create({
      data: {
        documentId: document.id,
        type: normalized,
        recipientEmail: args.recipientEmail ?? null,
        message: eventMessage(normalized, args.recipientEmail),
        payload: JSON.stringify(args.rawPayload ?? {}),
      },
    });
  });

  return getDocumentDTO(document.id);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export async function listDocuments(): Promise<DocumentDTO[]> {
  const docs = await prisma.document.findMany({
    orderBy: { createdAt: 'desc' },
    include: documentInclude,
  });
  return docs.map(toDocumentDTO);
}

export async function getDocumentDTO(id: string): Promise<DocumentDTO | null> {
  const doc = await prisma.document.findUnique({ where: { id }, include: documentInclude });
  return doc ? toDocumentDTO(doc) : null;
}

// ---------------------------------------------------------------------------
// Publish a template to Documenso as a reusable TEMPLATE envelope, and store
// the returned Documenso ids so documents can later be generated via /use.
// ---------------------------------------------------------------------------
export async function publishTemplateToDocumenso(templateId: string): Promise<TemplateDTO> {
  const template = await prisma.template.findUnique({
    where: { id: templateId },
    include: { recipients: true, fields: true },
  });
  if (!template) throw new Error('Template not found');
  if (template.fields.length === 0) {
    throw new Error('Add at least one field before publishing to Documenso.');
  }

  // Recipients that own ≥1 field become Documenso template signers (placeholder
  // emails — real contacts are supplied per-document at /envelope/use time).
  const recIdsWithFields = new Set(template.fields.map((f) => f.recipientId));
  const roleByRecipientId = new Map(template.recipients.map((r) => [r.id, r.roleKey]));

  const pubRecipients = template.recipients
    .filter((r) => recIdsWithFields.has(r.id))
    .map((r) => ({
      roleKey: r.roleKey,
      name: r.label,
      email: firstNonEmpty(r.defaultEmail, `${r.roleKey}@template.example.com`),
      signingOrder: r.signingOrder,
      isSigner: true,
    }));

  const pubFields = template.fields
    .filter((f) => recIdsWithFields.has(f.recipientId))
    .map((f) => {
      const meta = parseJson<FieldMeta | null>(f.meta, null);
      const kind = documensoFieldKind(f.type as FieldType, Boolean(f.prefillKey));
      return {
        localId: f.id,
        recipientRoleKey: roleByRecipientId.get(f.recipientId) as string,
        documensoType: kind.publishType,
        page: f.page,
        xPct: f.xPct,
        yPct: f.yPct,
        widthPct: f.widthPct,
        heightPct: f.heightPct,
        required: f.required,
        fixed: Boolean(f.prefillKey) || meta?.readOnly === true,
        options: meta?.options?.map((o) => o.value),
      };
    });

  const pdf = await readPdf(template.storageKey);
  const result = await getDocumensoClient().publishTemplate({
    title: template.name,
    fileName: template.fileName,
    pdf,
    recipients: pubRecipients,
    fields: pubFields,
  });

  await prisma.$transaction(async (tx) => {
    await tx.template.update({
      where: { id: template.id },
      data: {
        documensoTemplateId: result.documensoTemplateId,
        documensoSyncedAt: new Date(),
        status: 'published',
      },
    });
    for (const r of template.recipients) {
      const id = result.recipientIdByRole[r.roleKey];
      if (id) {
        await tx.templateRecipient.update({ where: { id: r.id }, data: { documensoRecipientId: id } });
      }
    }
    for (const f of template.fields) {
      const id = result.fieldIdByLocalId[f.id];
      if (id) {
        await tx.templateField.update({ where: { id: f.id }, data: { documensoFieldId: id } });
      }
    }
  });

  const updated = await prisma.template.findUnique({
    where: { id: template.id },
    include: { recipients: true, fields: true },
  });
  return toTemplateDTO(updated!);
}

// ---------------------------------------------------------------------------
// Bulk: generate (and optionally send) one document per candidate row. One bad
// row never aborts the batch — each result carries its own status/error.
// ---------------------------------------------------------------------------
export interface BulkCandidate {
  data: GenerationData;
  title?: string;
  recipientOverrides?: Record<string, { name?: string; email?: string }>;
}

export interface BulkResultRow {
  index: number;
  documentId?: string;
  title?: string;
  status?: string;
  candidateName?: string;
  error?: string;
}

export async function bulkGenerateDocuments(input: {
  templateId: string;
  candidates: BulkCandidate[];
  send?: boolean;
}): Promise<{ results: BulkResultRow[] }> {
  const results: BulkResultRow[] = [];
  for (let i = 0; i < input.candidates.length; i++) {
    const c = input.candidates[i];
    const candidateName = c.data?.candidate?.fullName;
    try {
      const doc = await createDocumentFromTemplate({
        templateId: input.templateId,
        data: c.data,
        title: c.title,
        recipientOverrides: c.recipientOverrides,
        send: input.send,
      });
      results.push({ index: i, documentId: doc.id, title: doc.title, status: doc.status, candidateName });
    } catch (err) {
      results.push({
        index: i,
        candidateName,
        error: err instanceof Error ? err.message : 'Failed to generate document.',
      });
    }
  }
  return { results };
}

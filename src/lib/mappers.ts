// Pure mapping helpers: Prisma rows -> shared DTOs (src/lib/types.ts).
import type {
  Template,
  TemplateRecipient,
  TemplateField,
  Document as DocumentRow,
  DocumentRecipient,
  DocumentEvent,
} from '@prisma/client';
import type {
  FieldDTO,
  FieldMeta,
  FieldType,
  RecipientDTO,
  TemplateDTO,
  TemplateSummaryDTO,
  DocumentDTO,
  DocumentRecipientDTO,
  DocumentEventDTO,
} from './types';
import { isMockMode } from './documenso';

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toRecipientDTO(r: TemplateRecipient): RecipientDTO {
  return {
    id: r.id,
    roleKey: r.roleKey,
    label: r.label,
    defaultName: r.defaultName,
    defaultEmail: r.defaultEmail,
    signingOrder: r.signingOrder,
    color: r.color,
  };
}

export function toFieldDTO(f: TemplateField): FieldDTO {
  return {
    id: f.id,
    type: f.type as FieldType,
    label: f.label,
    required: f.required,
    page: f.page,
    xPct: f.xPct,
    yPct: f.yPct,
    widthPct: f.widthPct,
    heightPct: f.heightPct,
    recipientId: f.recipientId,
    prefillKey: f.prefillKey,
    meta: parseJson<FieldMeta | null>(f.meta, null),
  };
}

export function toTemplateDTO(
  t: Template & { recipients: TemplateRecipient[]; fields: TemplateField[] },
): TemplateDTO {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    status: t.status,
    fileName: t.fileName,
    pageCount: t.pageCount,
    fileSize: t.fileSize,
    documensoTemplateId: t.documensoTemplateId,
    documensoSyncedAt: t.documensoSyncedAt ? t.documensoSyncedAt.toISOString() : null,
    recipients: [...t.recipients]
      .sort((a, b) => a.signingOrder - b.signingOrder)
      .map(toRecipientDTO),
    fields: t.fields.map(toFieldDTO),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toTemplateSummaryDTO(
  t: Template & { _count?: { recipients: number; fields: number } },
): TemplateSummaryDTO {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    status: t.status,
    fileName: t.fileName,
    pageCount: t.pageCount,
    recipientCount: t._count?.recipients ?? 0,
    fieldCount: t._count?.fields ?? 0,
    publishedToDocumenso: Boolean(t.documensoTemplateId),
    updatedAt: t.updatedAt.toISOString(),
  };
}

export function toDocumentRecipientDTO(r: DocumentRecipient): DocumentRecipientDTO {
  return {
    id: r.id,
    roleKey: r.roleKey,
    label: r.label,
    name: r.name,
    email: r.email,
    status: r.status,
    signingOrder: r.signingOrder,
    documensoRecipientId: r.documensoRecipientId,
    signedAt: r.signedAt ? r.signedAt.toISOString() : null,
  };
}

export function toDocumentEventDTO(e: DocumentEvent): DocumentEventDTO {
  return {
    id: e.id,
    type: e.type,
    recipientEmail: e.recipientEmail,
    message: e.message,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toDocumentDTO(
  d: DocumentRow & {
    recipients: DocumentRecipient[];
    events: DocumentEvent[];
    template?: { name: string } | null;
  },
): DocumentDTO {
  return {
    id: d.id,
    templateId: d.templateId,
    templateName: d.template?.name ?? null,
    title: d.title,
    status: d.status,
    prefillData: parseJson<Record<string, unknown>>(d.prefillData, {}),
    documensoDocumentId: d.documensoDocumentId,
    signingFlowUrl: d.signingFlowUrl,
    // Mock is a property of the environment, not of whether this doc was sent —
    // a real-mode draft is NOT mock (so the mock Simulate controls stay hidden).
    isMock: isMockMode(),
    recipients: [...d.recipients]
      .sort((a, b) => a.signingOrder - b.signingOrder)
      .map(toDocumentRecipientDTO),
    events: [...d.events]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(toDocumentEventDTO),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
  };
}

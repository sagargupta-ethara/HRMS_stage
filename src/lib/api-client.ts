// Browser-side API client. Only ever talks to our OWN Next.js route handlers —
// never to Documenso directly — so no API key ever reaches this code.
import type {
  DocumentDTO,
  SaveTemplatePayload,
  TemplateDTO,
} from './types';
import type { GenerationData } from './prefill';

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      (body && (body.error || body.message)) || `Request failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
  }
  return body as T;
}

/**
 * Create a template by uploading one or more PDFs. Multiple files are merged
 * (in the given order) into a single combined template document server-side.
 * Returns the new template id plus the resolved page/source counts.
 */
export async function createTemplate(
  files: File | File[],
  meta: { name: string; category?: string },
): Promise<{ id: string; pageCount?: number; sourceCount?: number }> {
  const list = Array.isArray(files) ? files : [files];
  const form = new FormData();
  for (const file of list) form.append('file', file);
  form.append('name', meta.name);
  if (meta.category) form.append('category', meta.category);
  const res = await fetch('/api/templates', { method: 'POST', body: form });
  return jsonOrThrow<{ id: string; pageCount?: number; sourceCount?: number }>(res);
}

export async function saveTemplate(
  id: string,
  payload: SaveTemplatePayload,
): Promise<{ template: TemplateDTO }> {
  const res = await fetch(`/api/templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return jsonOrThrow<{ template: TemplateDTO }>(res);
}

export async function deleteTemplate(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
  return jsonOrThrow<{ ok: true }>(res);
}

export interface GenerateDocumentBody {
  templateId: string;
  title?: string;
  data: GenerationData;
  recipientOverrides?: Record<string, { name?: string; email?: string }>;
  send?: boolean;
}

export async function generateDocument(
  body: GenerateDocumentBody,
): Promise<{ document: DocumentDTO }> {
  const res = await fetch('/api/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<{ document: DocumentDTO }>(res);
}

/** Publish a template to Documenso as a reusable TEMPLATE envelope (no emails). */
export async function publishTemplate(id: string): Promise<{ template: TemplateDTO }> {
  const res = await fetch(`/api/templates/${id}/publish`, { method: 'POST' });
  return jsonOrThrow<{ template: TemplateDTO }>(res);
}

export interface BulkCandidateInput {
  title?: string;
  data: GenerationData;
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

/** Generate (and optionally send) one document per candidate row. */
export async function bulkGenerate(body: {
  templateId: string;
  candidates: BulkCandidateInput[];
  send?: boolean;
}): Promise<{ results: BulkResultRow[]; summary: { total: number; ok: number; failed: number } }> {
  const res = await fetch('/api/documents/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<{ results: BulkResultRow[]; summary: { total: number; ok: number; failed: number } }>(res);
}

/** Mock-mode helper that drives the webhook handler from the UI. */
export async function simulateEvent(
  documentId: string,
  event: 'sent' | 'viewed' | 'signed' | 'completed' | 'rejected',
  recipientEmail?: string,
): Promise<{ document: DocumentDTO }> {
  const res = await fetch(`/api/documents/${documentId}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, recipientEmail }),
  });
  return jsonOrThrow<{ document: DocumentDTO }>(res);
}

/** URL the PDF viewer fetches the raw template PDF from. */
export function templateFileUrl(id: string): string {
  return `/api/templates/${id}/file`;
}

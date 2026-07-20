// Shared DTOs used across server (API / route handlers) and client (builder UI).
// Geometry is always percentages (0..100) of the page box.

export type FieldType =
  | 'signature'
  | 'initials'
  | 'name'
  | 'email'
  | 'date'
  | 'text'
  | 'number'
  | 'checkbox'
  | 'dropdown'
  | 'radio';

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldMeta {
  placeholder?: string;
  defaultValue?: string;
  /** dropdown / radio choices */
  options?: FieldOption[];
  fontSize?: number;
  /** value is fixed (e.g. prefilled, signer cannot edit) */
  readOnly?: boolean;
}

export interface FieldDTO {
  /** db cuid, or a `tmp_*` id for unsaved fields in the builder */
  id: string;
  type: FieldType;
  label?: string | null;
  required: boolean;
  page: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  /** references RecipientDTO.id */
  recipientId: string;
  /** dot-path into the generation data, e.g. "candidate.fullName" */
  prefillKey?: string | null;
  meta?: FieldMeta | null;
}

export interface RecipientDTO {
  id: string;
  roleKey: string;
  label: string;
  defaultName?: string | null;
  defaultEmail?: string | null;
  signingOrder: number;
  color: string;
}

export interface TemplateDTO {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  status: string;
  fileName: string;
  pageCount: number;
  fileSize: number;
  /** set once published to Documenso as a reusable template envelope */
  documensoTemplateId?: string | null;
  documensoSyncedAt?: string | null;
  recipients: RecipientDTO[];
  fields: FieldDTO[];
  createdAt?: string;
  updatedAt?: string;
}

export interface TemplateSummaryDTO {
  id: string;
  name: string;
  category: string;
  status: string;
  fileName: string;
  pageCount: number;
  recipientCount: number;
  fieldCount: number;
  publishedToDocumenso: boolean;
  updatedAt: string;
}

// ---- Documents (generated instances) -------------------------------------

export type DocumentStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'partially_signed'
  | 'completed'
  | 'rejected'
  | 'error';

export interface DocumentRecipientDTO {
  id: string;
  roleKey: string;
  label: string;
  name: string;
  email: string;
  status: string;
  signingOrder: number;
  documensoRecipientId?: string | null;
  signedAt?: string | null;
}

export interface DocumentEventDTO {
  id: string;
  type: string;
  recipientEmail?: string | null;
  message?: string | null;
  createdAt: string;
}

export interface DocumentDTO {
  id: string;
  templateId?: string | null;
  templateName?: string | null;
  title: string;
  status: DocumentStatus | string;
  prefillData: Record<string, unknown>;
  documensoDocumentId?: string | null;
  signingFlowUrl?: string | null;
  isMock: boolean;
  recipients: DocumentRecipientDTO[];
  events: DocumentEventDTO[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

// ---- Save payload (builder -> PUT /api/templates/:id) ---------------------

export interface SaveTemplatePayload {
  name: string;
  description?: string | null;
  category: string;
  status?: string;
  pageCount: number;
  recipients: Array<{
    id: string;
    roleKey: string;
    label: string;
    defaultName?: string | null;
    defaultEmail?: string | null;
    signingOrder: number;
    color: string;
  }>;
  fields: Array<{
    id: string;
    type: FieldType;
    label?: string | null;
    required: boolean;
    page: number;
    xPct: number;
    yPct: number;
    widthPct: number;
    heightPct: number;
    recipientId: string;
    prefillKey?: string | null;
    meta?: FieldMeta | null;
  }>;
}

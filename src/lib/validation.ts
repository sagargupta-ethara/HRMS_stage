import { z } from 'zod';

const fieldTypeEnum = z.enum([
  'signature',
  'initials',
  'name',
  'email',
  'date',
  'text',
  'number',
  'checkbox',
  'dropdown',
  'radio',
]);

const pct = z.number().min(0).max(100);

const fieldMetaSchema = z
  .object({
    placeholder: z.string().optional(),
    defaultValue: z.string().optional(),
    options: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .optional(),
    fontSize: z.number().optional(),
    readOnly: z.boolean().optional(),
  })
  .nullable()
  .optional();

export const saveTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().min(1).max(60),
  status: z.enum(['draft', 'published']).optional(),
  pageCount: z.number().int().min(1).max(500),
  recipients: z
    .array(
      z.object({
        id: z.string(),
        roleKey: z.string().min(1),
        label: z.string().min(1),
        defaultName: z.string().nullable().optional(),
        defaultEmail: z.string().email().or(z.literal('')).nullable().optional(),
        signingOrder: z.number().int().min(1),
        color: z.string(),
      }),
    )
    .min(1, 'Add at least one recipient'),
  fields: z.array(
    z.object({
      id: z.string(),
      type: fieldTypeEnum,
      label: z.string().nullable().optional(),
      required: z.boolean(),
      page: z.number().int().min(1),
      xPct: pct,
      yPct: pct,
      widthPct: z.number().min(0.5).max(100),
      heightPct: z.number().min(0.5).max(100),
      recipientId: z.string().min(1),
      prefillKey: z.string().nullable().optional(),
      meta: fieldMetaSchema,
    }),
  ),
});

export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;

// Generation data submitted from the "Generate document" form.
const generationDataSchema = z.object({
  candidate: z.object({
    fullName: z.string().min(1),
    firstName: z.string().optional(),
    email: z.string().email(),
    phone: z.string().optional(),
    role: z.string().min(1),
    department: z.string().optional(),
    employmentType: z.string().optional(),
    joiningDate: z.string().optional(),
    workLocation: z.string().optional(),
    annualSalary: z.number().optional(),
    monthlySalary: z.number().optional(),
    salaryInWords: z.string().optional(),
    currency: z.string().optional(),
    probationMonths: z.number().optional(),
    noticePeriodDays: z.number().optional(),
  }),
  manager: z.object({
    name: z.string().optional(),
    email: z.string().email().or(z.literal('')).optional(),
    title: z.string().optional(),
  }),
  hr: z.object({
    name: z.string().optional(),
    email: z.string().email().or(z.literal('')).optional(),
  }),
  signatory: z.object({
    name: z.string().optional(),
    email: z.string().email().or(z.literal('')).optional(),
    title: z.string().optional(),
  }),
  company: z.object({
    name: z.string().optional(),
    address: z.string().optional(),
  }),
  offer: z.object({
    date: z.string().optional(),
    expiryDate: z.string().optional(),
    referenceNo: z.string().optional(),
  }),
});

export const generateDocumentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  data: generationDataSchema,
  // Per-recipient overrides (name/email) keyed by recipient roleKey.
  recipientOverrides: z
    .record(
      z.string(),
      z.object({ name: z.string().optional(), email: z.string().optional() }),
    )
    .optional(),
  // If true and Documenso is configured, send immediately; else create as draft.
  send: z.boolean().optional().default(true),
});

export type GenerateDocumentInput = z.infer<typeof generateDocumentSchema>;

// Bulk generation: one document per candidate row (e.g. parsed from CSV).
export const bulkGenerateSchema = z.object({
  templateId: z.string().min(1),
  send: z.boolean().optional().default(true),
  candidates: z
    .array(
      z.object({
        title: z.string().max(200).optional(),
        data: generationDataSchema,
        recipientOverrides: z
          .record(
            z.string(),
            z.object({ name: z.string().optional(), email: z.string().optional() }),
          )
          .optional(),
      }),
    )
    .min(1, 'Add at least one candidate')
    .max(500, 'Up to 500 candidates per batch'),
});

export type BulkGenerateInput = z.infer<typeof bulkGenerateSchema>;

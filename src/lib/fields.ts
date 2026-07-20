import type { FieldType } from './types';

export interface FieldTypeDef {
  type: FieldType;
  label: string;
  /** simple glyph for the palette; the UI may render a nicer SVG by `type` */
  glyph: string;
  /** accent colour for this field kind */
  color: string;
  /** default placement size, percent of page */
  defaultWidthPct: number;
  defaultHeightPct: number;
  /** can be bound to HRMS generation data */
  prefillable: boolean;
  /** dropdown / radio carry an options list */
  hasOptions: boolean;
  description: string;
  /** identifier sent to Documenso's API (FieldType enum) */
  documensoType: string;
}

// Order mirrors Documenso's "Add Fields" palette.
export const FIELD_TYPES: FieldTypeDef[] = [
  {
    type: 'signature',
    label: 'Signature',
    glyph: '✍️',
    color: '#6ee06e',
    defaultWidthPct: 22,
    defaultHeightPct: 7,
    prefillable: false,
    hasOptions: false,
    description: 'Drawn or typed signature, captured at signing time.',
    documensoType: 'SIGNATURE',
  },
  {
    type: 'initials',
    label: 'Initials',
    glyph: '🔡',
    color: '#22d3ee',
    defaultWidthPct: 8,
    defaultHeightPct: 5,
    prefillable: false,
    hasOptions: false,
    description: 'Signer initials.',
    documensoType: 'INITIALS',
  },
  {
    type: 'name',
    label: 'Name',
    glyph: '🪪',
    color: '#38bdf8',
    defaultWidthPct: 26,
    defaultHeightPct: 4.5,
    prefillable: true,
    hasOptions: false,
    description: 'Full name — auto-filled from recipient or HRMS data.',
    documensoType: 'NAME',
  },
  {
    type: 'email',
    label: 'Email',
    glyph: '✉️',
    color: '#818cf8',
    defaultWidthPct: 26,
    defaultHeightPct: 4.5,
    prefillable: true,
    hasOptions: false,
    description: 'Email address — auto-filled from recipient or HRMS data.',
    documensoType: 'EMAIL',
  },
  {
    type: 'date',
    label: 'Date',
    glyph: '📅',
    color: '#f59e0b',
    defaultWidthPct: 16,
    defaultHeightPct: 4.5,
    prefillable: true,
    hasOptions: false,
    description: 'Date — signing date, or prefilled (e.g. joining date).',
    documensoType: 'DATE',
  },
  {
    type: 'text',
    label: 'Text',
    glyph: '🅣',
    color: '#a3a3a3',
    defaultWidthPct: 26,
    defaultHeightPct: 4.5,
    prefillable: true,
    hasOptions: false,
    description: 'Free text — prefill from HRMS or collect at signing.',
    documensoType: 'TEXT',
  },
  {
    type: 'number',
    label: 'Number',
    glyph: '#️⃣',
    color: '#34d399',
    defaultWidthPct: 14,
    defaultHeightPct: 4.5,
    prefillable: true,
    hasOptions: false,
    description: 'Numeric value — e.g. salary, CTC, notice period.',
    documensoType: 'NUMBER',
  },
  {
    type: 'checkbox',
    label: 'Checkbox',
    glyph: '☑️',
    color: '#fb7185',
    defaultWidthPct: 4,
    defaultHeightPct: 3,
    prefillable: false,
    hasOptions: false,
    description: 'Single checkbox — acknowledgements, opt-ins.',
    documensoType: 'CHECKBOX',
  },
  {
    type: 'dropdown',
    label: 'Dropdown',
    glyph: '🔽',
    color: '#c084fc',
    defaultWidthPct: 22,
    defaultHeightPct: 4.5,
    prefillable: true,
    hasOptions: true,
    description: 'Select one option from a list.',
    documensoType: 'DROPDOWN',
  },
  {
    type: 'radio',
    label: 'Radio',
    glyph: '🔘',
    color: '#f472b6',
    defaultWidthPct: 18,
    defaultHeightPct: 8,
    prefillable: false,
    hasOptions: true,
    description: 'Choose one from a set of radio options.',
    documensoType: 'RADIO',
  },
];

export const FIELD_TYPE_MAP: Record<FieldType, FieldTypeDef> = Object.fromEntries(
  FIELD_TYPES.map((f) => [f.type, f]),
) as Record<FieldType, FieldTypeDef>;

export function fieldDef(type: FieldType): FieldTypeDef {
  return FIELD_TYPE_MAP[type] ?? FIELD_TYPE_MAP.text;
}

/** Default human label for a freshly placed field. */
export function defaultFieldLabel(type: FieldType): string {
  return fieldDef(type).label;
}

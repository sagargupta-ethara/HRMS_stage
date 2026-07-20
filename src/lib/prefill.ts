// HRMS generation data + the catalog of "prefill tokens" a template field can
// bind to. When a document is generated, each field's `prefillKey` is resolved
// against a GenerationData object and the formatted value is pushed into
// Documenso (or shown in the document preview).

export interface GenerationData {
  candidate: {
    fullName: string;
    firstName?: string;
    email: string;
    phone?: string;
    role: string;
    department?: string;
    employmentType?: string; // Full-time | Contract | Intern
    joiningDate?: string; // ISO date
    workLocation?: string;
    annualSalary?: number;
    monthlySalary?: number;
    salaryInWords?: string;
    currency?: string; // INR | USD | ...
    probationMonths?: number;
    noticePeriodDays?: number;
  };
  manager: { name?: string; email?: string; title?: string };
  hr: { name?: string; email?: string };
  signatory: { name?: string; email?: string; title?: string };
  company: { name?: string; address?: string };
  offer: { date?: string; expiryDate?: string; referenceNo?: string };
}

export type PrefillGroup =
  | 'Candidate'
  | 'Compensation'
  | 'Manager'
  | 'HR'
  | 'Signatory'
  | 'Company'
  | 'Offer';

export type TokenKind = 'text' | 'date' | 'currency' | 'number';

export interface PrefillToken {
  key: string; // dot-path into GenerationData
  label: string;
  group: PrefillGroup;
  kind: TokenKind;
  example: string;
}

export const PREFILL_TOKENS: PrefillToken[] = [
  { key: 'candidate.fullName', label: 'Candidate Full Name', group: 'Candidate', kind: 'text', example: 'Priya Sharma' },
  { key: 'candidate.firstName', label: 'Candidate First Name', group: 'Candidate', kind: 'text', example: 'Priya' },
  { key: 'candidate.email', label: 'Candidate Email', group: 'Candidate', kind: 'text', example: 'priya@example.com' },
  { key: 'candidate.phone', label: 'Candidate Phone', group: 'Candidate', kind: 'text', example: '+91 98xxxxxx00' },
  { key: 'candidate.role', label: 'Role / Job Title', group: 'Candidate', kind: 'text', example: 'Software Engineer' },
  { key: 'candidate.department', label: 'Department', group: 'Candidate', kind: 'text', example: 'Engineering' },
  { key: 'candidate.employmentType', label: 'Employment Type', group: 'Candidate', kind: 'text', example: 'Full-time' },
  { key: 'candidate.workLocation', label: 'Work Location', group: 'Candidate', kind: 'text', example: 'Bengaluru' },
  { key: 'candidate.joiningDate', label: 'Joining Date', group: 'Candidate', kind: 'date', example: '2026-07-15' },
  { key: 'candidate.probationMonths', label: 'Probation (months)', group: 'Candidate', kind: 'number', example: '6' },
  { key: 'candidate.noticePeriodDays', label: 'Notice Period (days)', group: 'Candidate', kind: 'number', example: '60' },

  { key: 'candidate.annualSalary', label: 'Annual Salary / CTC', group: 'Compensation', kind: 'currency', example: '₹18,00,000' },
  { key: 'candidate.monthlySalary', label: 'Monthly Salary', group: 'Compensation', kind: 'currency', example: '₹1,50,000' },
  { key: 'candidate.salaryInWords', label: 'Salary In Words', group: 'Compensation', kind: 'text', example: 'Eighteen Lakhs' },

  { key: 'manager.name', label: 'Manager Name', group: 'Manager', kind: 'text', example: 'Rahul Verma' },
  { key: 'manager.email', label: 'Manager Email', group: 'Manager', kind: 'text', example: 'rahul@example.com' },
  { key: 'manager.title', label: 'Manager Title', group: 'Manager', kind: 'text', example: 'Engineering Manager' },

  { key: 'hr.name', label: 'HR Name', group: 'HR', kind: 'text', example: 'Anjali Rao' },
  { key: 'hr.email', label: 'HR Email', group: 'HR', kind: 'text', example: 'hr@example.com' },

  { key: 'signatory.name', label: 'Signatory Name', group: 'Signatory', kind: 'text', example: 'Vikram Singh' },
  { key: 'signatory.email', label: 'Signatory Email', group: 'Signatory', kind: 'text', example: 'director@example.com' },
  { key: 'signatory.title', label: 'Signatory Title', group: 'Signatory', kind: 'text', example: 'Director' },

  { key: 'company.name', label: 'Company Name', group: 'Company', kind: 'text', example: 'Ethara AI' },
  { key: 'company.address', label: 'Company Address', group: 'Company', kind: 'text', example: 'Bengaluru, KA' },

  { key: 'offer.date', label: 'Offer Date', group: 'Offer', kind: 'date', example: '2026-06-28' },
  { key: 'offer.expiryDate', label: 'Offer Expiry', group: 'Offer', kind: 'date', example: '2026-07-05' },
  { key: 'offer.referenceNo', label: 'Reference No.', group: 'Offer', kind: 'text', example: 'OFR-2026-0420' },
];

export const PREFILL_TOKEN_MAP: Record<string, PrefillToken> = Object.fromEntries(
  PREFILL_TOKENS.map((t) => [t.key, t]),
);

/** Read a dot-path from an object without throwing. */
export function getPath(obj: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj);
}

function formatCurrency(value: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return String(value);
  }
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

/** Resolve a single token to a display string given generation data. */
export function resolveToken(key: string, data: GenerationData): string {
  const raw = getPath(data, key);
  if (raw === undefined || raw === null || raw === '') return '';
  const token = PREFILL_TOKEN_MAP[key];
  const currency = data.candidate?.currency ?? 'INR';
  switch (token?.kind) {
    case 'currency':
      return typeof raw === 'number' ? formatCurrency(raw, currency) : String(raw);
    case 'date':
      return formatDate(String(raw));
    case 'number':
      return String(raw);
    default:
      return String(raw);
  }
}

/** Resolve every known token into a flat map of key -> formatted value. */
export function resolveAllTokens(data: GenerationData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of PREFILL_TOKENS) {
    out[token.key] = resolveToken(token.key, data);
  }
  return out;
}

/**
 * Resolve a role's signer contact from generation data.
 * Falls back to recipient defaults handled by the caller.
 */
export function contactForRole(
  roleKey: string,
  data: GenerationData,
): { name?: string; email?: string } {
  switch (roleKey) {
    case 'candidate':
      return { name: data.candidate?.fullName, email: data.candidate?.email };
    case 'hr':
      return { name: data.hr?.name, email: data.hr?.email };
    case 'manager':
      return { name: data.manager?.name, email: data.manager?.email };
    case 'authorized_signatory':
      return { name: data.signatory?.name, email: data.signatory?.email };
    default:
      return {};
  }
}

/** A realistic sample used to seed the generate form. */
export const SAMPLE_GENERATION_DATA: GenerationData = {
  candidate: {
    fullName: 'Priya Sharma',
    firstName: 'Priya',
    email: 'priya.sharma@example.com',
    phone: '+91 98765 43210',
    role: 'Software Engineer',
    department: 'Engineering',
    employmentType: 'Full-time',
    joiningDate: '2026-07-15',
    workLocation: 'Bengaluru',
    annualSalary: 1800000,
    monthlySalary: 150000,
    salaryInWords: 'Eighteen Lakhs Only',
    currency: 'INR',
    probationMonths: 6,
    noticePeriodDays: 60,
  },
  manager: { name: 'Rahul Verma', email: 'rahul.verma@ethara.ai', title: 'Engineering Manager' },
  hr: { name: 'Anjali Rao', email: 'hr.contracts@ethara.ai' },
  signatory: { name: 'Vikram Singh', email: 'director@ethara.ai', title: 'Director' },
  company: { name: 'Ethara AI', address: 'Bengaluru, Karnataka' },
  offer: { date: '2026-06-28', expiryDate: '2026-07-05', referenceNo: 'OFR-2026-0420' },
};

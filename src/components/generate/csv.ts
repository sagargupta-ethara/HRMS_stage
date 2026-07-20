// Pure (non-React) helpers for the bulk-CSV generate flow: a small but correct
// CSV parser, a dot-path setter, number coercion, a header -> prefill-token
// guesser, and a sample-CSV builder. Kept dependency-free.
import {
  PREFILL_TOKENS,
  getPath,
  SAMPLE_GENERATION_DATA,
  type GenerationData,
  type PrefillToken,
} from '@/lib/prefill';

/** Token keys the backend treats as mandatory for every candidate row. */
export const REQUIRED_TOKEN_KEYS = [
  'candidate.fullName',
  'candidate.email',
  'candidate.role',
] as const;

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse CSV text into a 2-D array of strings. Handles:
 *  - quoted fields containing commas and newlines
 *  - escaped quotes inside quoted fields ("")
 *  - CRLF, CR and LF line endings
 *  - a leading UTF-8 BOM
 */
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      endRow();
      if (text[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  // Flush the final field/row (file may not end with a newline).
  endRow();

  return rows;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

/** Returns true when every cell in a row is blank. */
function isBlankRow(row: string[]): boolean {
  return row.every((c) => c.trim() === '');
}

/**
 * Parse CSV text into headers + data rows. Strips fully-blank rows (e.g. a
 * trailing newline). Throws when there is no header row.
 */
export function parseCsvToRecords(text: string): ParsedCsv {
  const all = parseCsv(text).filter((r) => !isBlankRow(r));
  if (all.length === 0) {
    throw new Error('The CSV file is empty.');
  }
  const headers = all[0].map((h) => h.trim());
  const rows = all.slice(1).map((r) => {
    // Normalise ragged rows to the header width.
    const out = headers.map((_, c) => (r[c] ?? '').trim());
    return out;
  });
  return { headers, rows };
}

// ---------------------------------------------------------------------------
// Object helpers
// ---------------------------------------------------------------------------

/** Set a dot-path (e.g. "candidate.annualSalary") on a plain object. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur: Record<string, unknown> = obj;
  for (let k = 0; k < keys.length - 1; k += 1) {
    const key = keys[k];
    const next = cur[key];
    if (next === null || typeof next !== 'object') {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/** Deep clone a GenerationData skeleton (plain JSON, no special types). */
export function cloneGenerationData(base: GenerationData): GenerationData {
  return JSON.parse(JSON.stringify(base)) as GenerationData;
}

/**
 * Coerce a raw CSV cell into a number, stripping currency symbols, thousands
 * separators and stray whitespace. Returns undefined for blank / unparseable.
 */
export function coerceNumber(raw: string): number | undefined {
  if (raw == null) return undefined;
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') {
    return undefined;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

// ---------------------------------------------------------------------------
// Header -> token guessing
// ---------------------------------------------------------------------------

/** Collapse a label/header to comparable form: lowercase, alphanumerics only. */
export function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Extra human synonyms per token (normalized at use). Ordering of PREFILL_TOKENS
// gives candidate fields priority for generic words like "email" / "name".
const SYNONYMS: Record<string, string[]> = {
  'candidate.fullName': ['fullname', 'name', 'candidatename', 'employeename', 'candidate', 'newhire'],
  'candidate.firstName': ['firstname', 'fname', 'givenname'],
  'candidate.email': ['email', 'emailaddress', 'candidateemail', 'mail', 'employeeemail'],
  'candidate.phone': ['phone', 'mobile', 'contact', 'phonenumber', 'contactnumber', 'mobilenumber'],
  'candidate.role': ['role', 'designation', 'jobtitle', 'position', 'title', 'jobrole'],
  'candidate.department': ['department', 'dept', 'team', 'function'],
  'candidate.employmentType': ['employmenttype', 'emptype', 'type', 'engagement'],
  'candidate.workLocation': ['worklocation', 'location', 'office', 'city', 'baselocation'],
  'candidate.joiningDate': ['joiningdate', 'doj', 'startdate', 'dateofjoining', 'joindate'],
  'candidate.probationMonths': ['probation', 'probationmonths', 'probationperiod'],
  'candidate.noticePeriodDays': ['noticeperiod', 'notice', 'noticeperioddays', 'noticedays'],
  'candidate.annualSalary': ['ctc', 'annualsalary', 'annualctc', 'salary', 'package', 'grosssalary', 'annualpackage'],
  'candidate.monthlySalary': ['monthlysalary', 'monthlyctc', 'permonth', 'monthlygross'],
  'candidate.salaryInWords': ['salaryinwords', 'salarywords', 'amountinwords', 'ctcinwords'],
  'manager.name': ['managername', 'manager', 'reportingmanager', 'reportingto', 'linemanager'],
  'manager.email': ['manageremail', 'manageremailaddress', 'reportingmanageremail'],
  'manager.title': ['managertitle', 'managerdesignation'],
  'hr.name': ['hrname', 'hr', 'hrcontact', 'recruiter'],
  'hr.email': ['hremail', 'hremailaddress'],
  'signatory.name': ['signatoryname', 'signatory', 'authorizedsignatory', 'signername'],
  'signatory.email': ['signatoryemail', 'signeremail'],
  'signatory.title': ['signatorytitle', 'signatorydesignation'],
  'company.name': ['companyname', 'company', 'organization', 'organisation', 'employer'],
  'company.address': ['companyaddress', 'address', 'officeaddress'],
  'offer.date': ['offerdate'],
  'offer.expiryDate': ['offerexpiry', 'expirydate', 'offerexpirydate', 'validtill', 'validuntil'],
  'offer.referenceNo': ['referenceno', 'refno', 'reference', 'offerref', 'referencenumber', 'offerid'],
};

/** Every comparable alias for a token (label, key parts, synonyms). */
function aliasesFor(token: PrefillToken): string[] {
  const set = new Set<string>();
  set.add(normalizeHeader(token.label));
  set.add(normalizeHeader(token.key));
  set.add(normalizeHeader(token.key.split('.').slice(-1)[0]));
  for (const s of SYNONYMS[token.key] ?? []) set.add(normalizeHeader(s));
  return [...set].filter(Boolean);
}

// Exact-match index: alias -> first token (earlier tokens win ties).
const EXACT_INDEX: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const t of PREFILL_TOKENS) {
    for (const a of aliasesFor(t)) {
      if (!map.has(a)) map.set(a, t.key);
    }
  }
  return map;
})();

/**
 * Guess the prefill-token key for a CSV header. Returns undefined when nothing
 * is confidently matched (the user can map it manually).
 */
export function guessTokenForHeader(header: string): string | undefined {
  const h = normalizeHeader(header);
  if (!h) return undefined;

  const exact = EXACT_INDEX.get(h);
  if (exact) return exact;

  // Fallback: substring containment, preferring the longest alias match.
  let best: { key: string; len: number } | null = null;
  for (const t of PREFILL_TOKENS) {
    for (const a of aliasesFor(t)) {
      if (a.length < 3) continue;
      if (h.includes(a) || a.includes(h)) {
        if (!best || a.length > best.len) best = { key: t.key, len: a.length };
      }
    }
  }
  return best?.key;
}

/** Auto-map every CSV header to a token key ('' = ignore). */
export function guessMapping(headers: string[]): string[] {
  const used = new Set<string>();
  return headers.map((h) => {
    const guess = guessTokenForHeader(h);
    // Avoid mapping two columns to the same token automatically.
    if (guess && !used.has(guess)) {
      used.add(guess);
      return guess;
    }
    return '';
  });
}

// ---------------------------------------------------------------------------
// Sample CSV
// ---------------------------------------------------------------------------

function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function cellFor(token: PrefillToken, data: GenerationData): string {
  const raw = getPath(data, token.key);
  if (raw === undefined || raw === null) return '';
  return String(raw);
}

/** A realistic two-row sample CSV (raw values, round-trippable through import). */
export function buildSampleCsv(): string {
  const second: GenerationData = {
    ...SAMPLE_GENERATION_DATA,
    candidate: {
      ...SAMPLE_GENERATION_DATA.candidate,
      fullName: 'Arjun Mehta',
      firstName: 'Arjun',
      email: 'arjun.mehta@example.com',
      phone: '+91 99887 11223',
      role: 'Product Designer',
      department: 'Design',
      joiningDate: '2026-08-01',
      workLocation: 'Remote',
      annualSalary: 2400000,
      monthlySalary: 200000,
      salaryInWords: 'Twenty Four Lakhs Only',
    },
  };

  const headerRow = PREFILL_TOKENS.map((t) => t.label);
  const row1 = PREFILL_TOKENS.map((t) => cellFor(t, SAMPLE_GENERATION_DATA));
  const row2 = PREFILL_TOKENS.map((t) => cellFor(t, second));

  return [headerRow, row1, row2]
    .map((r) => r.map(csvEscape).join(','))
    .join('\r\n');
}

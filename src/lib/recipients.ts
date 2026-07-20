// Default signing roles for HR documents. `roleKey` is the stable identifier
// used to wire fields -> recipient and to resolve contact details from the
// generation (candidate) data at document-creation time.

export interface RoleDef {
  roleKey: string;
  label: string;
  color: string;
  signingOrder: number;
  description: string;
  /** dot-path prefix in GenerationData providing this role's name/email */
  contactPath: 'candidate' | 'hr' | 'manager' | 'signatory' | null;
}

export const DEFAULT_ROLES: RoleDef[] = [
  {
    roleKey: 'candidate',
    label: 'Candidate',
    color: '#6ee06e',
    signingOrder: 1,
    description: 'The new hire receiving the offer / contract.',
    contactPath: 'candidate',
  },
  {
    roleKey: 'hr',
    label: 'HR',
    color: '#38bdf8',
    signingOrder: 2,
    description: 'HR representative issuing the document.',
    contactPath: 'hr',
  },
  {
    roleKey: 'manager',
    label: 'Manager',
    color: '#f59e0b',
    signingOrder: 3,
    description: 'Reporting / hiring manager.',
    contactPath: 'manager',
  },
  {
    roleKey: 'authorized_signatory',
    label: 'Authorized Signatory',
    color: '#c084fc',
    signingOrder: 4,
    description: 'Company authorized signatory (e.g. Director).',
    contactPath: 'signatory',
  },
];

export const ROLE_PALETTE = [
  '#6ee06e',
  '#38bdf8',
  '#f59e0b',
  '#c084fc',
  '#fb7185',
  '#34d399',
  '#22d3ee',
  '#f472b6',
];

export function roleDef(roleKey: string): RoleDef | undefined {
  return DEFAULT_ROLES.find((r) => r.roleKey === roleKey);
}

export function colorForIndex(i: number): string {
  return ROLE_PALETTE[i % ROLE_PALETTE.length];
}

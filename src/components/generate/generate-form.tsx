'use client';

// Generate form: collects HRMS generation data, shows a live "what will be
// filled" preview (every bound field resolved against the current form state),
// lets HR override per-recipient signer contacts, then creates + sends the
// document via our own API.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  contactForRole,
  resolveToken,
  PREFILL_TOKEN_MAP,
  type GenerationData,
} from '@/lib/prefill';
import { fieldDef } from '@/lib/fields';
import { generateDocument } from '@/lib/api-client';
import type { FieldDTO, RecipientDTO, TemplateDTO } from '@/lib/types';
import {
  Button,
  Card,
  Input,
  Label,
  Select,
  Spinner,
} from '@/components/ui';
import {
  FileIcon,
  SendIcon,
  SparkleIcon,
  UsersIcon,
} from '@/components/icons';

type ContactOverride = { name?: string; email?: string };

function Section({
  title,
  icon,
  description,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          {icon}
          {title}
        </h2>
        {description && <p className="mt-1 text-xs text-ink-dim">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function FieldRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function GenerateForm({
  template,
  initialData,
}: {
  template: TemplateDTO;
  initialData: GenerationData;
}) {
  const router = useRouter();
  const [data, setData] = useState<GenerationData>(initialData);
  const [overrides, setOverrides] = useState<Record<string, ContactOverride>>({});
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [submitting, setSubmitting] = useState<false | 'send' | 'draft'>(false);
  const [error, setError] = useState<string | null>(null);

  // --- nested-state setters (type-safe, one per section) -------------------
  const setCandidate = (patch: Partial<GenerationData['candidate']>) =>
    setData((d) => ({ ...d, candidate: { ...d.candidate, ...patch } }));
  const setManager = (patch: Partial<GenerationData['manager']>) =>
    setData((d) => ({ ...d, manager: { ...d.manager, ...patch } }));
  const setHr = (patch: Partial<GenerationData['hr']>) =>
    setData((d) => ({ ...d, hr: { ...d.hr, ...patch } }));
  const setSignatory = (patch: Partial<GenerationData['signatory']>) =>
    setData((d) => ({ ...d, signatory: { ...d.signatory, ...patch } }));
  const setCompany = (patch: Partial<GenerationData['company']>) =>
    setData((d) => ({ ...d, company: { ...d.company, ...patch } }));
  const setOffer = (patch: Partial<GenerationData['offer']>) =>
    setData((d) => ({ ...d, offer: { ...d.offer, ...patch } }));

  const num = (v: string): number | undefined => (v === '' ? undefined : Number(v));

  const defaultTitle = `${template.name} — ${data.candidate.fullName || 'Candidate'}`;
  const titleValue = titleEdited ? title : defaultTitle;

  // --- recipient contact resolution (override → data → defaults) -----------
  const recipientsWithFields = useMemo(
    () => new Set(template.fields.map((f) => f.recipientId)),
    [template.fields],
  );

  function effectiveContact(r: RecipientDTO): { name: string; email: string } {
    const fromData = contactForRole(r.roleKey, data);
    const ov = overrides[r.roleKey];
    const name = ov?.name !== undefined ? ov.name : fromData.name ?? r.defaultName ?? '';
    const email =
      ov?.email !== undefined ? ov.email : fromData.email ?? r.defaultEmail ?? '';
    return { name, email };
  }

  const setOverride = (roleKey: string, patch: ContactOverride) =>
    setOverrides((o) => ({ ...o, [roleKey]: { ...o[roleKey], ...patch } }));

  // --- group placed fields by recipient for the preview --------------------
  const fieldsByRecipient = useMemo(() => {
    const map = new Map<string, FieldDTO[]>();
    for (const f of template.fields) {
      const arr = map.get(f.recipientId) ?? [];
      arr.push(f);
      map.set(f.recipientId, arr);
    }
    return map;
  }, [template.fields]);

  const prefilledCount = useMemo(
    () => template.fields.filter((f) => f.prefillKey).length,
    [template.fields],
  );

  async function submit(send: boolean) {
    setError(null);
    setSubmitting(send ? 'send' : 'draft');
    try {
      const finalTitle = (titleEdited ? title.trim() : defaultTitle) || undefined;
      const res = await generateDocument({
        templateId: template.id,
        title: finalTitle,
        data,
        recipientOverrides: overrides,
        send,
      });
      router.push('/documents/' + res.document.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate document.');
      setSubmitting(false);
    }
  }

  const busy = submitting !== false;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* ---- LEFT: form ----------------------------------------------------- */}
      <div className="space-y-6 lg:col-span-2">
        <Section title="Document title" icon={<FileIcon className="h-4 w-4" />}>
          <FieldRow id="doc-title" label="Title">
            <Input
              id="doc-title"
              value={titleValue}
              onChange={(e) => {
                setTitleEdited(true);
                setTitle(e.target.value);
              }}
              placeholder={defaultTitle}
            />
          </FieldRow>
        </Section>

        <Section
          title="Candidate"
          icon={<SparkleIcon className="h-4 w-4" />}
          description="The new hire receiving this document."
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow id="c-fullName" label="Full name">
              <Input
                id="c-fullName"
                value={data.candidate.fullName}
                onChange={(e) => setCandidate({ fullName: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="c-email" label="Email">
              <Input
                id="c-email"
                type="email"
                value={data.candidate.email}
                onChange={(e) => setCandidate({ email: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="c-role" label="Role / Job title">
              <Input
                id="c-role"
                value={data.candidate.role}
                onChange={(e) => setCandidate({ role: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="c-department" label="Department">
              <Input
                id="c-department"
                value={data.candidate.department ?? ''}
                onChange={(e) => setCandidate({ department: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="c-employmentType" label="Employment type">
              <Select
                id="c-employmentType"
                value={data.candidate.employmentType ?? ''}
                onChange={(e) => setCandidate({ employmentType: e.target.value })}
              >
                <option value="">—</option>
                <option value="Full-time">Full-time</option>
                <option value="Contract">Contract</option>
                <option value="Intern">Intern</option>
              </Select>
            </FieldRow>
            <FieldRow id="c-joiningDate" label="Joining date">
              <Input
                id="c-joiningDate"
                type="date"
                value={data.candidate.joiningDate ?? ''}
                onChange={(e) => setCandidate({ joiningDate: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="c-workLocation" label="Work location">
              <Input
                id="c-workLocation"
                value={data.candidate.workLocation ?? ''}
                onChange={(e) => setCandidate({ workLocation: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="c-annualSalary" label="Annual salary / CTC">
              <Input
                id="c-annualSalary"
                type="number"
                value={data.candidate.annualSalary ?? ''}
                onChange={(e) => setCandidate({ annualSalary: num(e.target.value) })}
              />
            </FieldRow>
            <FieldRow id="c-monthlySalary" label="Monthly salary">
              <Input
                id="c-monthlySalary"
                type="number"
                value={data.candidate.monthlySalary ?? ''}
                onChange={(e) => setCandidate({ monthlySalary: num(e.target.value) })}
              />
            </FieldRow>
            <FieldRow id="c-salaryInWords" label="Salary in words">
              <Input
                id="c-salaryInWords"
                value={data.candidate.salaryInWords ?? ''}
                onChange={(e) => setCandidate({ salaryInWords: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="c-probationMonths" label="Probation (months)">
              <Input
                id="c-probationMonths"
                type="number"
                value={data.candidate.probationMonths ?? ''}
                onChange={(e) => setCandidate({ probationMonths: num(e.target.value) })}
              />
            </FieldRow>
            <FieldRow id="c-noticePeriodDays" label="Notice period (days)">
              <Input
                id="c-noticePeriodDays"
                type="number"
                value={data.candidate.noticePeriodDays ?? ''}
                onChange={(e) => setCandidate({ noticePeriodDays: num(e.target.value) })}
              />
            </FieldRow>
          </div>
        </Section>

        <Section title="Manager" icon={<UsersIcon className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow id="m-name" label="Name">
              <Input
                id="m-name"
                value={data.manager.name ?? ''}
                onChange={(e) => setManager({ name: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="m-email" label="Email">
              <Input
                id="m-email"
                type="email"
                value={data.manager.email ?? ''}
                onChange={(e) => setManager({ email: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="m-title" label="Title">
              <Input
                id="m-title"
                value={data.manager.title ?? ''}
                onChange={(e) => setManager({ title: e.target.value })}
              />
            </FieldRow>
          </div>
        </Section>

        <Section title="HR" icon={<UsersIcon className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow id="hr-name" label="Name">
              <Input
                id="hr-name"
                value={data.hr.name ?? ''}
                onChange={(e) => setHr({ name: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="hr-email" label="Email">
              <Input
                id="hr-email"
                type="email"
                value={data.hr.email ?? ''}
                onChange={(e) => setHr({ email: e.target.value })}
              />
            </FieldRow>
          </div>
        </Section>

        <Section title="Authorized Signatory" icon={<UsersIcon className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow id="s-name" label="Name">
              <Input
                id="s-name"
                value={data.signatory.name ?? ''}
                onChange={(e) => setSignatory({ name: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="s-email" label="Email">
              <Input
                id="s-email"
                type="email"
                value={data.signatory.email ?? ''}
                onChange={(e) => setSignatory({ email: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="s-title" label="Title">
              <Input
                id="s-title"
                value={data.signatory.title ?? ''}
                onChange={(e) => setSignatory({ title: e.target.value })}
              />
            </FieldRow>
          </div>
        </Section>

        <Section title="Company" icon={<FileIcon className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldRow id="co-name" label="Name">
              <Input
                id="co-name"
                value={data.company.name ?? ''}
                onChange={(e) => setCompany({ name: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="co-address" label="Address">
              <Input
                id="co-address"
                value={data.company.address ?? ''}
                onChange={(e) => setCompany({ address: e.target.value })}
              />
            </FieldRow>
          </div>
        </Section>

        <Section title="Offer" icon={<FileIcon className="h-4 w-4" />}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <FieldRow id="o-date" label="Offer date">
              <Input
                id="o-date"
                type="date"
                value={data.offer.date ?? ''}
                onChange={(e) => setOffer({ date: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="o-expiryDate" label="Offer expiry">
              <Input
                id="o-expiryDate"
                type="date"
                value={data.offer.expiryDate ?? ''}
                onChange={(e) => setOffer({ expiryDate: e.target.value })}
              />
            </FieldRow>
            <FieldRow id="o-referenceNo" label="Reference no.">
              <Input
                id="o-referenceNo"
                value={data.offer.referenceNo ?? ''}
                onChange={(e) => setOffer({ referenceNo: e.target.value })}
              />
            </FieldRow>
          </div>
        </Section>

        {/* ---- Recipients (editable) --------------------------------------- */}
        <Section
          title="Recipients"
          icon={<UsersIcon className="h-4 w-4" />}
          description="Signer contacts resolved from the data above — edit to override."
        >
          {template.recipients.length === 0 ? (
            <p className="text-sm text-ink-dim">This template has no recipients.</p>
          ) : (
            <div className="space-y-4">
              {template.recipients.map((r) => {
                const contact = effectiveContact(r);
                const hasFields = recipientsWithFields.has(r.id);
                const missingEmail = hasFields && contact.email.trim() === '';
                return (
                  <div key={r.id} className="rounded-xl border border-edge bg-panel-2/40 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="text-sm font-medium text-ink">{r.label}</span>
                      <span className="rounded-full border border-edge bg-panel px-2 py-0.5 text-[11px] text-ink-dim">
                        Order {r.signingOrder}
                      </span>
                      {!hasFields && (
                        <span className="text-[11px] text-ink-dim">· no fields</span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <FieldRow id={`r-${r.id}-name`} label="Name">
                        <Input
                          id={`r-${r.id}-name`}
                          value={contact.name}
                          onChange={(e) => setOverride(r.roleKey, { name: e.target.value })}
                        />
                      </FieldRow>
                      <FieldRow id={`r-${r.id}-email`} label="Email">
                        <Input
                          id={`r-${r.id}-email`}
                          type="email"
                          value={contact.email}
                          onChange={(e) => setOverride(r.roleKey, { email: e.target.value })}
                          className={missingEmail ? 'border-rose-500/50' : undefined}
                        />
                      </FieldRow>
                    </div>
                    {missingEmail && (
                      <p className="mt-2 text-xs text-rose-300">
                        This recipient has assigned fields but no email — they can’t be sent
                        the document.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      {/* ---- RIGHT: live preview + actions --------------------------------- */}
      <div className="lg:col-span-1">
        <div className="space-y-6 lg:sticky lg:top-20">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <SparkleIcon className="h-4 w-4" />
              What will be filled
            </h2>
            <p className="mt-1 text-xs text-ink-dim">
              {prefilledCount} prefilled field{prefilledCount === 1 ? '' : 's'} across{' '}
              {template.recipients.length} recipient
              {template.recipients.length === 1 ? '' : 's'}.
            </p>

            <div className="mt-4 space-y-5">
              {template.recipients.length === 0 && (
                <p className="text-sm text-ink-dim">No recipients to preview.</p>
              )}
              {template.recipients.map((r) => {
                const fields = fieldsByRecipient.get(r.id) ?? [];
                if (fields.length === 0) return null;
                const prefilled = fields.filter((f) => f.prefillKey);
                const collected = fields.filter((f) => !f.prefillKey);
                return (
                  <div key={r.id}>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: r.color }}
                      />
                      <span className="text-xs font-semibold text-ink">{r.label}</span>
                      <span className="text-[11px] text-ink-dim">
                        {fields.length} field{fields.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {prefilled.length > 0 && (
                      <ul className="space-y-1.5">
                        {prefilled.map((f) => {
                          const token = PREFILL_TOKEN_MAP[f.prefillKey!];
                          const fieldLabel = f.label || fieldDef(f.type).label;
                          const value = resolveToken(f.prefillKey!, data);
                          return (
                            <li
                              key={f.id}
                              className="rounded-lg border border-edge bg-panel-2/40 px-3 py-2 text-xs"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-ink-dim">{fieldLabel}</span>
                                <span className="text-[10px] uppercase tracking-wide text-ink-dim/70">
                                  {token?.label ?? f.prefillKey}
                                </span>
                              </div>
                              <div className="mt-0.5 truncate font-medium text-ink">
                                {value || <span className="text-ink-dim/60">— empty —</span>}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    {collected.length > 0 && (
                      <div className="mt-2">
                        <p className="mb-1 text-[11px] text-ink-dim">Collected at signing</p>
                        <div className="flex flex-wrap gap-1.5">
                          {collected.map((f) => (
                            <span
                              key={f.id}
                              className="rounded-full border border-edge bg-panel-2 px-2 py-0.5 text-[11px] text-ink-dim"
                            >
                              {f.label || fieldDef(f.type).label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-5">
            {error && (
              <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button
                variant="primary"
                size="lg"
                disabled={busy}
                onClick={() => submit(true)}
              >
                {submitting === 'send' ? (
                  <>
                    <Spinner /> Generating…
                  </>
                ) : (
                  <>
                    <SendIcon className="h-4 w-4" /> Generate &amp; Send
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => submit(false)}
              >
                {submitting === 'draft' ? (
                  <>
                    <Spinner /> Saving…
                  </>
                ) : (
                  'Generate (draft)'
                )}
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-ink-dim">
              Bound fields are filled from the data above; signatures &amp; other
              non-prefilled fields are collected from signers.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

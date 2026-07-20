'use client';

// Interactive document detail. Seeds from the server-rendered DTO, renders
// recipients / timeline / prefilled-data, and (in mock mode) exposes buttons
// that drive the webhook handler to walk the signing lifecycle in place.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { simulateEvent } from '@/lib/api-client';
import { resolveToken, type GenerationData } from '@/lib/prefill';
import { roleDef, colorForIndex } from '@/lib/recipients';
import type { DocumentDTO } from '@/lib/types';
import { Button, Card, Spinner, StatusPill } from '@/components/ui';
import {
  ArrowLeftIcon,
  CheckIcon,
  EyeIcon,
  LinkIcon,
  SignatureIcon,
  UsersIcon,
  XIcon,
} from '@/components/icons';
import { EventTimeline } from '@/components/documents/event-timeline';

type SimEvent = 'viewed' | 'signed' | 'completed' | 'rejected';

const PREFILL_ROWS: Array<{ label: string; key: string }> = [
  { label: 'Candidate', key: 'candidate.fullName' },
  { label: 'Email', key: 'candidate.email' },
  { label: 'Role', key: 'candidate.role' },
  { label: 'Department', key: 'candidate.department' },
  { label: 'Joining date', key: 'candidate.joiningDate' },
  { label: 'Annual salary', key: 'candidate.annualSalary' },
  { label: 'Company', key: 'company.name' },
  { label: 'Reference no.', key: 'offer.referenceNo' },
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function DocumentDetail({ initialDocument }: { initialDocument: DocumentDTO }) {
  const router = useRouter();
  const [document, setDocument] = useState<DocumentDTO>(initialDocument);
  const [pending, setPending] = useState<SimEvent | null>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [error, setError] = useState<string | null>(null);

  const terminal = document.status === 'completed' || document.status === 'rejected';
  const gd = document.prefillData as unknown as GenerationData;

  const prefillRows = PREFILL_ROWS.map((row) => ({
    label: row.label,
    value: gd ? resolveToken(row.key, gd) : '',
  })).filter((r) => r.value);

  async function run(event: SimEvent, needsRecipient: boolean) {
    setError(null);
    setPending(event);
    try {
      const res = await simulateEvent(
        document.id,
        event,
        needsRecipient && recipientEmail ? recipientEmail : undefined,
      );
      setDocument(res.document);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to simulate event.');
    } finally {
      setPending(null);
    }
  }

  const actions: Array<{
    event: SimEvent;
    label: string;
    icon: typeof EyeIcon;
    variant: 'secondary' | 'primary' | 'danger';
    needsRecipient: boolean;
  }> = [
    { event: 'viewed', label: 'Mark Viewed', icon: EyeIcon, variant: 'secondary', needsRecipient: true },
    { event: 'signed', label: 'Mark Signed', icon: SignatureIcon, variant: 'secondary', needsRecipient: true },
    { event: 'completed', label: 'Mark Completed', icon: CheckIcon, variant: 'primary', needsRecipient: false },
    { event: 'rejected', label: 'Reject', icon: XIcon, variant: 'danger', needsRecipient: true },
  ];

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <Link
        href="/documents"
        className="inline-flex items-center gap-1.5 text-sm text-ink-dim transition hover:text-ink"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to documents
      </Link>

      {/* ---- Header -------------------------------------------------------- */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">{document.title}</h1>
            <StatusPill status={document.status} kind="document" />
          </div>
          <p className="mt-1 text-sm text-ink-dim">
            {document.templateId && document.templateName ? (
              <>
                From{' '}
                <Link
                  href={`/templates/${document.templateId}/edit`}
                  className="text-ink underline-offset-2 hover:underline"
                >
                  {document.templateName}
                </Link>
              </>
            ) : (
              document.templateName ?? 'Untitled template'
            )}
          </p>
          <p className="mt-1 text-xs text-ink-dim">
            Created {formatWhen(document.createdAt)} · Updated {formatWhen(document.updatedAt)}
            {document.completedAt ? ` · Completed ${formatWhen(document.completedAt)}` : ''}
          </p>
        </div>

        {document.signingFlowUrl && (
          <a
            href={document.signingFlowUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-edge bg-panel-2 px-4 text-sm text-ink transition hover:bg-edge"
          >
            <LinkIcon className="h-4 w-4" />
            Open signing flow
          </a>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ---- LEFT: recipients + prefill -------------------------------- */}
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-ink">
              <UsersIcon className="h-4 w-4" />
              Recipients
            </h2>
            <div className="space-y-2">
              {document.recipients.map((r, i) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-panel-2/40 px-3 py-2.5"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: roleDef(r.roleKey)?.color ?? colorForIndex(i) }}
                  />
                  <span className="text-xs font-medium text-ink-dim">{r.label}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{r.name || '—'}</p>
                    <p className="truncate text-xs text-ink-dim">{r.email || 'no email'}</p>
                  </div>
                  <span className="rounded-full border border-edge bg-panel px-2 py-0.5 text-[11px] text-ink-dim">
                    Order {r.signingOrder}
                  </span>
                  <StatusPill status={r.status} kind="recipient" />
                  {r.signedAt && (
                    <span className="text-[11px] text-ink-dim">{formatWhen(r.signedAt)}</span>
                  )}
                </div>
              ))}
              {document.recipients.length === 0 && (
                <p className="text-sm text-ink-dim">No recipients.</p>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Prefilled data</h2>
            {prefillRows.length === 0 ? (
              <p className="text-sm text-ink-dim">No prefilled data captured.</p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {prefillRows.map((row) => (
                  <div key={row.label} className="flex items-baseline justify-between gap-3 border-b border-edge/60 py-1.5">
                    <dt className="text-xs text-ink-dim">{row.label}</dt>
                    <dd className="truncate text-sm font-medium text-ink">{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>

          {/* ---- Mock controls / webhook note --------------------------- */}
          {document.isMock ? (
            <Card className="p-5">
              <h2 className="text-sm font-semibold text-ink">
                Simulate signing events (mock mode)
              </h2>
              <p className="mt-1 text-xs text-ink-dim">
                No real Documenso configured — drive the lifecycle manually.
              </p>

              <div className="mt-4 max-w-xs">
                <label htmlFor="sim-recipient" className="mb-1.5 block text-xs font-medium text-ink-dim">
                  Attribute to recipient (viewed / signed / reject)
                </label>
                <select
                  id="sim-recipient"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                  disabled={terminal || pending !== null}
                  className="h-10 w-full appearance-none rounded-lg border border-edge bg-panel-2 px-3 text-sm text-ink outline-none transition focus:border-accent/60 focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
                >
                  <option value="">Document-level (no recipient)</option>
                  {document.recipients
                    .filter((r) => r.email)
                    .map((r) => (
                      <option key={r.id} value={r.email}>
                        {r.label} — {r.email}
                      </option>
                    ))}
                </select>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {actions.map((a) => {
                  const Icon = a.icon;
                  const isRunning = pending === a.event;
                  return (
                    <Button
                      key={a.event}
                      variant={a.variant}
                      size="sm"
                      disabled={terminal || pending !== null}
                      onClick={() => run(a.event, a.needsRecipient)}
                    >
                      {isRunning ? <Spinner className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                      {a.label}
                    </Button>
                  );
                })}
              </div>

              {terminal && (
                <p className="mt-3 text-[11px] text-ink-dim">
                  This document has reached a terminal status — no further events apply.
                </p>
              )}
              {error && (
                <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {error}
                </p>
              )}
            </Card>
          ) : (
            <Card className="p-5">
              <p className="text-xs text-ink-dim">
                Status updates arrive automatically via Documenso webhooks at{' '}
                <code className="rounded bg-panel-2 px-1.5 py-0.5 text-ink">
                  /api/webhooks/documenso
                </code>
                .
              </p>
            </Card>
          )}
        </div>

        {/* ---- RIGHT: timeline ------------------------------------------- */}
        <div className="lg:col-span-1">
          <Card className="p-5 lg:sticky lg:top-20">
            <h2 className="mb-4 text-sm font-semibold text-ink">Event timeline</h2>
            <EventTimeline events={document.events} />
          </Card>
        </div>
      </div>
    </div>
  );
}

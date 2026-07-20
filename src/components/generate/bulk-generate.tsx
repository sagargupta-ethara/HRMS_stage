'use client';

// Bulk CSV generate: upload a CSV of candidates, map columns -> prefill tokens,
// preview/validate each row, then create + send one document per valid row via
// the bulk API. CSV is parsed entirely client-side (see ./csv.ts).
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  PREFILL_TOKENS,
  PREFILL_TOKEN_MAP,
  getPath,
  type GenerationData,
  type PrefillGroup,
} from '@/lib/prefill';
import type { TemplateDTO } from '@/lib/types';
import { bulkGenerate, type BulkResultRow } from '@/lib/api-client';
import {
  Button,
  Card,
  Badge,
  Label,
  Select,
  Spinner,
  StatusPill,
  EmptyState,
} from '@/components/ui';
import {
  UploadIcon,
  DownloadIcon,
  SendIcon,
  FileIcon,
  CheckIcon,
  XIcon,
  SparkleIcon,
  LinkIcon,
} from '@/components/icons';
import {
  parseCsvToRecords,
  guessMapping,
  setPath,
  coerceNumber,
  cloneGenerationData,
  buildSampleCsv,
  REQUIRED_TOKEN_KEYS,
  type ParsedCsv,
} from './csv';

// ---------------------------------------------------------------------------
// Row building / validation
// ---------------------------------------------------------------------------

interface PreviewRow {
  index: number;
  data: GenerationData;
  candidateName: string;
  valid: boolean;
  missing: string[];
}

function buildPreviewRows(
  parsed: ParsedCsv,
  mapping: string[],
  base: GenerationData,
): PreviewRow[] {
  return parsed.rows.map((cells, index) => {
    const data = cloneGenerationData(base);
    const obj = data as unknown as Record<string, unknown>;

    mapping.forEach((key, col) => {
      if (!key) return;
      const token = PREFILL_TOKEN_MAP[key];
      if (!token) return;
      const cell = cells[col] ?? '';
      const value: unknown =
        token.kind === 'number' || token.kind === 'currency'
          ? coerceNumber(cell)
          : cell;
      setPath(obj, key, value);
    });

    const missing: string[] = [];
    for (const reqKey of REQUIRED_TOKEN_KEYS) {
      const col = mapping.findIndex((m) => m === reqKey);
      const cell = col === -1 ? '' : (cells[col] ?? '');
      if (cell.trim() === '') missing.push(PREFILL_TOKEN_MAP[reqKey].label);
    }

    const candidateName = (data.candidate.fullName ?? '').trim();
    return {
      index,
      data,
      candidateName,
      valid: missing.length === 0,
      missing,
    };
  });
}

// ---------------------------------------------------------------------------
// Token <Select> (grouped by token.group)
// ---------------------------------------------------------------------------

const GROUP_ORDER: PrefillGroup[] = Array.from(
  new Set(PREFILL_TOKENS.map((t) => t.group)),
);

const REQUIRED_SET = new Set<string>(REQUIRED_TOKEN_KEYS);

function TokenSelect({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Ignore —</option>
      {GROUP_ORDER.map((group) => (
        <optgroup key={group} label={group}>
          {PREFILL_TOKENS.filter((t) => t.group === group).map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
              {REQUIRED_SET.has(t.key) ? ' *' : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

function displayValue(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface BulkResult {
  results: BulkResultRow[];
  summary: { total: number; ok: number; failed: number };
}

export function BulkGenerate({
  template,
  initialData,
}: {
  template: TemplateDTO;
  initialData: GenerationData;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);

  const preview = useMemo(
    () => (parsed ? buildPreviewRows(parsed, mapping, initialData) : []),
    [parsed, mapping, initialData],
  );
  const validRows = useMemo(() => preview.filter((r) => r.valid), [preview]);

  // Which mapped token keys to show as preview columns (in token order).
  const mappedColumnKeys = useMemo(
    () => PREFILL_TOKENS.map((t) => t.key).filter((k) => mapping.includes(k)),
    [mapping],
  );

  const requiredStatus = REQUIRED_TOKEN_KEYS.map((key) => ({
    key,
    label: PREFILL_TOKEN_MAP[key].label,
    mapped: mapping.includes(key),
  }));
  const requiredMappedCount = requiredStatus.filter((r) => r.mapped).length;
  const missingRequired = requiredStatus.filter((r) => !r.mapped);

  async function loadFile(file: File) {
    setParseError(null);
    setApiError(null);
    setResult(null);
    try {
      const text = await file.text();
      const records = parseCsvToRecords(text);
      setFileName(file.name);
      setParsed(records);
      setMapping(guessMapping(records.headers));
    } catch (err) {
      setParsed(null);
      setMapping([]);
      setFileName(null);
      setParseError(
        err instanceof Error ? err.message : 'Could not parse the CSV file.',
      );
    }
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (file) void loadFile(file);
  }

  function reset() {
    setParsed(null);
    setMapping([]);
    setFileName(null);
    setParseError(null);
    setApiError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function setColumnMapping(col: number, key: string) {
    setMapping((m) => m.map((v, i) => (i === col ? key : v)));
  }

  function downloadSample() {
    const csv = buildSampleCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-candidates-sample.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function onSend() {
    if (validRows.length === 0) return;
    setApiError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const candidates = validRows.map((r) => ({
        data: r.data,
        title: undefined,
      }));
      const res = await bulkGenerate({
        templateId: template.id,
        candidates,
        send: true,
      });
      setResult(res);
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : 'Bulk generation failed.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ---- 1. Upload --------------------------------------------------- */}
      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <UploadIcon className="h-4 w-4" />
              Upload candidates CSV
            </h2>
            <p className="mt-1 text-xs text-ink-dim">
              One row per candidate. The first row must be the column headers.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={downloadSample} type="button">
            <DownloadIcon className="h-4 w-4" />
            Download sample CSV
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />

        {!parsed ? (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center transition ${
              dragOver
                ? 'border-accent/60 bg-accent/5'
                : 'border-edge bg-panel-2/40 hover:bg-panel-2'
            }`}
          >
            <UploadIcon className="mb-3 h-8 w-8 text-ink-dim" />
            <span className="text-sm font-medium text-ink">
              Drop a .csv here, or click to browse
            </span>
            <span className="mt-1 text-xs text-ink-dim">
              Parsed in your browser — nothing is uploaded until you send.
            </span>
          </button>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-edge bg-panel-2/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <FileIcon className="h-5 w-5 text-ink-dim" />
              <div>
                <div className="text-sm font-medium text-ink">{fileName}</div>
                <div className="text-xs text-ink-dim">
                  {parsed.headers.length} column
                  {parsed.headers.length === 1 ? '' : 's'} · {parsed.rows.length} row
                  {parsed.rows.length === 1 ? '' : 's'}
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={reset} type="button">
              <XIcon className="h-4 w-4" />
              Remove
            </Button>
          </div>
        )}

        {parseError && (
          <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {parseError}
          </p>
        )}
      </Card>

      {parsed && (
        <>
          {/* ---- 2. Column mapping --------------------------------------- */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <SparkleIcon className="h-4 w-4" />
                  Map columns
                </h2>
                <p className="mt-1 text-xs text-ink-dim">
                  We auto-matched your headers. Adjust any mapping below. Tokens
                  marked <span className="text-ink">*</span> are required.
                </p>
              </div>
              <Badge
                className={
                  missingRequired.length === 0
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                }
              >
                {requiredMappedCount} of {REQUIRED_TOKEN_KEYS.length} required mapped
              </Badge>
            </div>

            {missingRequired.length > 0 && (
              <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Map a column to{' '}
                {missingRequired.map((r, i) => (
                  <span key={r.key}>
                    <span className="font-medium text-amber-200">{r.label}</span>
                    {i < missingRequired.length - 1 ? ', ' : ''}
                  </span>
                ))}{' '}
                to be able to send. Rows missing a required value are skipped.
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {parsed.headers.map((header, col) => {
                const sample = parsed.rows[0]?.[col] ?? '';
                return (
                  <div
                    key={`${header}-${col}`}
                    className="rounded-xl border border-edge bg-panel-2/40 p-3"
                  >
                    <Label htmlFor={`map-${col}`}>
                      <span className="truncate text-ink">{header || `Column ${col + 1}`}</span>
                    </Label>
                    {sample && (
                      <p className="mb-2 truncate text-[11px] text-ink-dim/80">
                        e.g. {sample}
                      </p>
                    )}
                    <TokenSelect
                      id={`map-${col}`}
                      value={mapping[col] ?? ''}
                      onChange={(v) => setColumnMapping(col, v)}
                    />
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ---- 3. Preview ---------------------------------------------- */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <FileIcon className="h-4 w-4" />
                Preview
              </h2>
              <Badge
                className={
                  validRows.length === preview.length && preview.length > 0
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-edge bg-panel-2 text-ink-dim'
                }
              >
                {validRows.length} of {preview.length} rows valid
              </Badge>
            </div>

            {preview.length === 0 ? (
              <EmptyState
                icon={<FileIcon className="h-6 w-6" />}
                title="No data rows"
                description="The CSV has headers but no candidate rows."
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-edge">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-edge bg-panel-2/60 text-xs text-ink-dim">
                      <th className="px-3 py-2 font-medium">#</th>
                      {mappedColumnKeys.map((key) => (
                        <th key={key} className="px-3 py-2 font-medium whitespace-nowrap">
                          {PREFILL_TOKEN_MAP[key]?.label ?? key}
                        </th>
                      ))}
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr
                        key={row.index}
                        className={`border-b border-edge/60 last:border-0 ${
                          row.valid ? '' : 'bg-rose-500/5'
                        }`}
                      >
                        <td className="px-3 py-2 text-xs text-ink-dim">{row.index + 1}</td>
                        {mappedColumnKeys.map((key) => (
                          <td key={key} className="px-3 py-2 text-ink whitespace-nowrap">
                            {displayValue(getPath(row.data, key))}
                          </td>
                        ))}
                        <td className="px-3 py-2">
                          {row.valid ? (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-300">
                              <CheckIcon className="h-3.5 w-3.5" /> Valid
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 text-xs text-rose-300"
                              title={`Missing: ${row.missing.join(', ')}`}
                            >
                              <XIcon className="h-3.5 w-3.5" /> Missing {row.missing.join(', ')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ---- 4. Send ------------------------------------------------- */}
          <Card className="p-5">
            {apiError && (
              <p className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {apiError}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-ink-dim">
                {validRows.length > 0
                  ? `Ready to generate & send ${validRows.length} document${
                      validRows.length === 1 ? '' : 's'
                    }.`
                  : 'No valid rows to send yet — fix the mapping or CSV values above.'}
              </p>
              <Button
                variant="primary"
                size="lg"
                type="button"
                disabled={submitting || validRows.length === 0}
                onClick={onSend}
              >
                {submitting ? (
                  <>
                    <Spinner /> Generating…
                  </>
                ) : (
                  <>
                    <SendIcon className="h-4 w-4" /> Generate &amp; Send all (
                    {validRows.length})
                  </>
                )}
              </Button>
            </div>
          </Card>

          {/* ---- Results ------------------------------------------------- */}
          {result && (
            <Card className="p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <CheckIcon className="h-4 w-4" />
                  Results
                </h2>
                <div className="flex items-center gap-2">
                  <Badge className="border-edge bg-panel-2 text-ink-dim">
                    {result.summary.total} total
                  </Badge>
                  <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                    {result.summary.ok} sent
                  </Badge>
                  {result.summary.failed > 0 && (
                    <Badge className="border-rose-500/30 bg-rose-500/10 text-rose-300">
                      {result.summary.failed} failed
                    </Badge>
                  )}
                </div>
              </div>

              <ul className="space-y-2">
                {result.results.map((r) => (
                  <li
                    key={r.index}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-panel-2/40 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">
                        {r.candidateName || r.title || `Row ${r.index + 1}`}
                      </div>
                      {r.error && (
                        <div className="truncate text-xs text-rose-300">{r.error}</div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {r.status ? (
                        <StatusPill status={r.status} />
                      ) : r.error ? (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-300">
                          <XIcon className="h-3.5 w-3.5" /> Failed
                        </span>
                      ) : null}
                      {r.documentId && (
                        <Link
                          href={`/documents/${r.documentId}`}
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          <LinkIcon className="h-3.5 w-3.5" /> View
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-center justify-between gap-3">
                <Link
                  href="/documents"
                  className="text-xs text-accent hover:underline"
                >
                  View all documents →
                </Link>
                <Button variant="secondary" size="sm" type="button" onClick={reset}>
                  Start a new batch
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

'use client';

// Upload one or more PDFs -> (merge them) -> create a draft template -> builder.
// Several PDFs (e.g. offer letter + NDA + policy) are combined, in the listed
// order, into a single template document.

import { useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Button, Card, Input, Label, Select, Spinner } from '@/components/ui';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  FileIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from '@/components/icons';
import { createTemplate } from '@/lib/api-client';

const CATEGORIES = [
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'employment_contract', label: 'Employment Contract' },
  { value: 'nda', label: 'NDA' },
  { value: 'other', label: 'Other' },
];

function stripExt(fileName: string): string {
  return fileName.replace(/\.pdf$/i, '');
}

function isPdfFile(f: File): boolean {
  return f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf');
}

export default function NewTemplatePage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('offer_letter');
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(incoming: FileList | File[] | null) {
    setError(null);
    if (!incoming) return;
    const arr = Array.from(incoming);
    const pdfs = arr.filter(isPdfFile);
    const rejected = arr.length - pdfs.length;
    if (rejected > 0) {
      setError(
        rejected === arr.length
          ? 'Please choose PDF files only.'
          : `Skipped ${rejected} non-PDF file${rejected > 1 ? 's' : ''}.`,
      );
    }
    if (pdfs.length === 0) return;
    setFiles((prev) => {
      // De-duplicate by name+size so re-picking the same file is a no-op.
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const next = [...prev];
      for (const f of pdfs) {
        const key = `${f.name}:${f.size}`;
        if (!seen.has(key)) {
          seen.add(key);
          next.push(f);
        }
      }
      if (!name.trim() && next.length > 0) setName(stripExt(next[0].name));
      return next;
    });
  }

  function removeFile(index: number) {
    setError(null);
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function move(index: number, dir: -1 | 1) {
    setFiles((prev) => {
      const to = index + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function onSubmit() {
    if (files.length === 0) {
      setError('Please choose at least one PDF file.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { id } = await createTemplate(files, {
        name: name.trim() || stripExt(files[0].name),
        category,
      });
      router.push(`/templates/${id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
      setUploading(false);
    }
  }

  const multiple = files.length > 1;

  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Link
        href="/templates"
        className="mb-6 inline-flex items-center gap-2 text-sm text-ink-dim transition hover:text-ink"
      >
        <ArrowLeftIcon className="h-4 w-4" />
        Back to Templates
      </Link>

      <h1 className="text-2xl font-semibold text-ink">New Template</h1>
      <p className="mt-1 text-sm text-ink-dim">
        Upload one PDF, or several (they&rsquo;ll be combined into a single
        template), then place fields in the builder.
      </p>

      <Card className="mt-6 p-6">
        <Label>PDF file{files.length > 1 ? 's' : ''}</Label>
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition',
            dragging
              ? 'border-accent bg-accent/10'
              : 'border-edge bg-panel-2/40 hover:border-ink-dim/50',
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ''; // allow re-picking the same file later
            }}
          />
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-panel-2 text-ink-dim">
            {files.length > 0 ? (
              <PlusIcon className="h-5 w-5" />
            ) : (
              <UploadIcon className="h-5 w-5" />
            )}
          </span>
          <div>
            <p className="font-medium text-ink">
              {files.length > 0
                ? 'Add another PDF'
                : 'Drop PDFs here, or click to browse'}
            </p>
            <p className="text-xs text-ink-dim">
              {files.length > 0
                ? 'Combine multiple contracts into one template'
                : 'One or more PDFs, up to a few MB each'}
            </p>
          </div>
        </div>

        {files.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium text-ink-dim">
                {files.length} file{files.length > 1 ? 's' : ''}
                {multiple ? ' · combined in this order' : ''}
              </p>
              {multiple && (
                <button
                  type="button"
                  onClick={() => {
                    setFiles([]);
                    setError(null);
                  }}
                  className="text-xs text-ink-dim transition hover:text-ink"
                >
                  Clear all
                </button>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}:${f.size}:${i}`}
                  className="flex items-center gap-3 rounded-lg border border-edge bg-panel-2/40 px-3 py-2"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-panel-2 text-xs font-semibold text-accent">
                    {i + 1}
                  </span>
                  <FileIcon className="h-4 w-4 shrink-0 text-ink-dim" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{f.name}</p>
                    <p className="text-xs text-ink-dim">
                      {(f.size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  {multiple && (
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        className="grid h-7 w-7 place-items-center rounded-md text-ink-dim transition hover:text-ink disabled:opacity-30"
                      >
                        <ChevronDownIcon className="h-4 w-4 rotate-180" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={i === files.length - 1}
                        onClick={() => move(i, 1)}
                        className="grid h-7 w-7 place-items-center rounded-md text-ink-dim transition hover:text-ink disabled:opacity-30"
                      >
                        <ChevronDownIcon className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => removeFile(i)}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-dim transition hover:text-rose-400"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <Label htmlFor="tpl-name">Template name</Label>
          <Input
            id="tpl-name"
            value={name}
            placeholder="e.g. Student Onboarding Pack"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="mt-4">
          <Label htmlFor="tpl-category">Category</Label>
          <Select
            id="tpl-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <Link
            href="/templates"
            className="inline-flex h-10 items-center rounded-xl px-4 text-sm text-ink-dim transition hover:text-ink"
          >
            Cancel
          </Link>
          <Button
            variant="primary"
            onClick={onSubmit}
            disabled={uploading || files.length === 0}
          >
            {uploading ? <Spinner /> : <UploadIcon className="h-4 w-4" />}
            {uploading
              ? multiple
                ? 'Combining…'
                : 'Uploading…'
              : 'Create & open builder'}
          </Button>
        </div>
      </Card>
    </div>
  );
}

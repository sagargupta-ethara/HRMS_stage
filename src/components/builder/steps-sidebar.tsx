'use client';

// Left rail of the builder: brand, the three editor steps, live counts, a
// compact document section (category / description) and the Quick Actions.
// Delete uses an inline confirm — never window.confirm.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button, Label, Select, Spinner, Textarea } from '@/components/ui';
import {
  ArrowLeftIcon,
  CheckIcon,
  SendIcon,
  SettingsIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
} from '@/components/icons';
import { deleteTemplate } from '@/lib/api-client';

const CATEGORIES = [
  { value: 'offer_letter', label: 'Offer Letter' },
  { value: 'employment_contract', label: 'Employment Contract' },
  { value: 'nda', label: 'NDA' },
  { value: 'other', label: 'Other' },
];

const STEPS = [
  { key: 'doc', label: 'Document & Recipients', icon: UsersIcon },
  { key: 'fields', label: 'Add Fields', icon: SettingsIcon },
  { key: 'preview', label: 'Preview', icon: CheckIcon },
];

export function StepsSidebar({
  templateId,
  status,
  category,
  description,
  recipientCount,
  fieldCount,
  dirty,
  saving,
  publishedToDocumenso,
  documensoSyncedAt,
  publishing,
  publishError,
  onPublish,
  onSave,
  onCategoryChange,
  onDescriptionChange,
}: {
  templateId: string;
  status: string;
  category: string;
  description: string;
  recipientCount: number;
  fieldCount: number;
  dirty: boolean;
  saving: boolean;
  publishedToDocumenso: boolean;
  documensoSyncedAt: string | null;
  publishing: boolean;
  publishError: string | null;
  onPublish: () => void;
  onSave: () => void;
  onCategoryChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteTemplate(templateId);
      router.push('/templates');
      router.refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete');
      setDeleting(false);
    }
  }

  return (
    <aside className="flex h-full w-[270px] shrink-0 flex-col border-r border-edge bg-panel">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3.5">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm font-bold text-accent-ink">
          H
        </span>
        <span className="font-semibold text-ink">Template Builder</span>
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
            status === 'published'
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-panel-2 text-ink-dim',
          )}
        >
          {status}
        </span>
      </div>

      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-3 py-4">
        <div>
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
            Steps
          </p>
          <ul className="space-y-1">
            {STEPS.map((step) => {
              const active = step.key === 'fields';
              const Icon = step.icon;
              return (
                <li key={step.key}>
                  <div
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm',
                      active
                        ? 'bg-panel-2 text-ink ring-1 ring-edge'
                        : 'text-ink-dim',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {step.label}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 px-1 text-xs text-ink-dim">
            {recipientCount} recipient{recipientCount === 1 ? '' : 's'} ·{' '}
            {fieldCount} field{fieldCount === 1 ? '' : 's'}
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-edge bg-panel-2/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-dim">
            Document
          </p>
          <div>
            <Label htmlFor="tpl-category">Category</Label>
            <Select
              id="tpl-category"
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="tpl-description">Description</Label>
            <Textarea
              id="tpl-description"
              rows={3}
              value={description}
              placeholder="Internal note (optional)"
              onChange={(e) => onDescriptionChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-edge px-3 py-3">
        <div className="mb-1 flex items-center gap-2 px-1 text-xs">
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              dirty ? 'bg-amber-400' : 'bg-emerald-400',
            )}
          />
          <span className="text-ink-dim">
            {dirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
        </div>

        <Button
          variant="primary"
          className="w-full"
          onClick={onSave}
          disabled={saving || publishing}
        >
          {saving ? <Spinner /> : <CheckIcon className="h-4 w-4" />}
          Save Template
        </Button>

        <div className="space-y-1.5 rounded-xl border border-edge bg-panel-2/40 p-2.5">
          <div className="flex items-center gap-2 px-0.5 text-xs">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                publishedToDocumenso ? 'bg-emerald-400' : 'bg-ink-dim',
              )}
            />
            <span className="text-ink-dim">
              {publishedToDocumenso ? 'Synced to Documenso' : 'Not on Documenso yet'}
            </span>
          </div>
          {publishError && <p className="px-0.5 text-xs text-rose-300">{publishError}</p>}
          <Button
            variant={publishedToDocumenso ? 'outline' : 'secondary'}
            className="w-full"
            onClick={onPublish}
            disabled={publishing || saving}
          >
            {publishing ? <Spinner /> : <UploadIcon className="h-4 w-4" />}
            {publishedToDocumenso ? 'Re-publish to Documenso' : 'Publish to Documenso'}
          </Button>
          {publishedToDocumenso && documensoSyncedAt && (
            <p className="px-0.5 text-[10px] text-ink-dim">
              Last synced {new Date(documensoSyncedAt).toLocaleString()}
            </p>
          )}
        </div>

        <Link
          href={`/templates/${templateId}/generate`}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-edge bg-panel-2 text-sm text-ink transition hover:bg-edge"
        >
          <SendIcon className="h-4 w-4" />
          Generate Document
        </Link>

        <Link
          href="/templates"
          className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm text-ink-dim transition hover:text-ink"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Back to Templates
        </Link>

        {confirming ? (
          <div className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2.5">
            <p className="text-xs text-rose-200">
              Delete this template permanently?
            </p>
            {deleteError && (
              <p className="text-xs text-rose-300">{deleteError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                className="flex-1"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? <Spinner /> : <TrashIcon className="h-4 w-4" />}
                Delete
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
            onClick={() => setConfirming(true)}
          >
            <TrashIcon className="h-4 w-4" />
            Delete Template
          </Button>
        )}
      </div>
    </aside>
  );
}

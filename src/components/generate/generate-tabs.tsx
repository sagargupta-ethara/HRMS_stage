'use client';

// Tabbed shell for the generate page: "Single" reuses the existing per-candidate
// form unchanged; "Bulk (CSV)" mounts the CSV upload / map / send flow.
import { useState } from 'react';
import { cn } from '@/lib/cn';
import type { GenerationData } from '@/lib/prefill';
import type { TemplateDTO } from '@/lib/types';
import { GenerateForm } from '@/components/generate/generate-form';
import { BulkGenerate } from '@/components/generate/bulk-generate';
import { SparkleIcon, UsersIcon } from '@/components/icons';

type Tab = 'single' | 'bulk';

export function GenerateTabs({
  template,
  initialData,
}: {
  template: TemplateDTO;
  initialData: GenerationData;
}) {
  const [tab, setTab] = useState<Tab>('single');

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'single', label: 'Single', icon: <SparkleIcon className="h-4 w-4" /> },
    { id: 'bulk', label: 'Bulk (CSV)', icon: <UsersIcon className="h-4 w-4" /> },
  ];

  return (
    <div className="space-y-6">
      {!template.documensoTemplateId && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-300">
          This template isn&apos;t published to Documenso yet — documents will be
          built from scratch. Publish it from the editor for template-based
          sending.
        </p>
      )}

      <div
        role="tablist"
        aria-label="Generation mode"
        className="inline-flex rounded-xl border border-edge bg-panel-2 p-1"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition',
              tab === t.id
                ? 'bg-accent text-accent-ink'
                : 'text-ink-dim hover:text-ink',
            )}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'single' ? (
        <GenerateForm template={template} initialData={initialData} />
      ) : (
        <BulkGenerate template={template} initialData={initialData} />
      )}
    </div>
  );
}

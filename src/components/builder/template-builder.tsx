'use client';

// The 3-pane template editor (mirrors Documenso): left steps rail, centre PDF
// canvas with draggable field overlays, right palette / properties / recipients.
//
// All field geometry is stored as PERCENTAGES of the page box (xPct/yPct are the
// top-left corner). Placement converts a click position inside the page overlay
// to percentages; drag/resize convert pixel deltas to percentages using the
// page's rendered pixel size — everything is clamped to keep fields on-page.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { cn } from '@/lib/cn';
import { Button, Input, Spinner } from '@/components/ui';
import { CheckIcon, XIcon } from '@/components/icons';
import { PdfDocumentView, type PageRenderContext } from '@/components/pdf/pdf-document-view';
import { saveTemplate, publishTemplate } from '@/lib/api-client';
import { defaultFieldLabel, fieldDef } from '@/lib/fields';
import { colorForIndex, DEFAULT_ROLES } from '@/lib/recipients';
import type {
  FieldDTO,
  FieldType,
  RecipientDTO,
  SaveTemplatePayload,
  TemplateDTO,
} from '@/lib/types';
import { StepsSidebar } from './steps-sidebar';
import { FieldPalette } from './field-palette';
import { FieldProperties } from './field-properties';
import { RecipientsPanel } from './recipients-panel';
import { FieldBox } from './field-box';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function TemplateBuilder({
  template,
  fileUrl,
}: {
  template: TemplateDTO;
  fileUrl: string;
}) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [category, setCategory] = useState(template.category);
  const [status, setStatus] = useState(template.status);
  const [recipients, setRecipients] = useState<RecipientDTO[]>(template.recipients);
  const [fields, setFields] = useState<FieldDTO[]>(template.fields);

  const [selectedRecipientId, setSelectedRecipientId] = useState<string>(
    template.recipients[0]?.id ?? '',
  );
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<FieldType | null>(null);
  const [rightTab, setRightTab] = useState<'fields' | 'recipients'>('fields');

  const [pageCount, setPageCount] = useState(template.pageCount);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  const [documensoTemplateId, setDocumensoTemplateId] = useState<string | null>(
    template.documensoTemplateId ?? null,
  );
  const [documensoSyncedAt, setDocumensoSyncedAt] = useState<string | null>(
    template.documensoSyncedAt ?? null,
  );
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const idCounter = useRef(0);

  const selectedField = useMemo(
    () => fields.find((f) => f.id === selectedFieldId) ?? null,
    [fields, selectedFieldId],
  );

  const markDirty = useCallback(() => {
    setDirty(true);
    setSavedTick(false);
  }, []);

  // ---- field handlers ----------------------------------------------------

  const selectField = useCallback((id: string | null) => {
    setSelectedFieldId(id);
    if (id) setActiveTool(null);
  }, []);

  const updateField = useCallback(
    (id: string, patch: Partial<FieldDTO>) => {
      setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
      markDirty();
    },
    [markDirty],
  );

  const removeField = useCallback(
    (id: string) => {
      setFields((prev) => prev.filter((f) => f.id !== id));
      setSelectedFieldId((cur) => (cur === id ? null : cur));
      markDirty();
    },
    [markDirty],
  );

  const addField = useCallback(
    (type: FieldType, page: number, xPct: number, yPct: number) => {
      const def = fieldDef(type);
      const id = `tmp_${Date.now()}_${idCounter.current++}`;
      const newField: FieldDTO = {
        id,
        type,
        label: defaultFieldLabel(type),
        required: true,
        page,
        xPct,
        yPct,
        widthPct: def.defaultWidthPct,
        heightPct: def.defaultHeightPct,
        recipientId: selectedRecipientId,
        prefillKey: null,
        meta: def.hasOptions
          ? {
              options: [
                { label: 'Option 1', value: 'option_1' },
                { label: 'Option 2', value: 'option_2' },
              ],
            }
          : null,
      };
      setFields((prev) => [...prev, newField]);
      setActiveTool(null);
      setSelectedFieldId(id);
      setRightTab('fields');
      markDirty();
    },
    [selectedRecipientId, markDirty],
  );

  const armTool = useCallback((type: FieldType) => {
    setSelectedFieldId(null);
    setActiveTool((prev) => (prev === type ? null : type));
  }, []);

  // ---- recipient handlers ------------------------------------------------

  const updateRecipient = useCallback(
    (id: string, patch: Partial<RecipientDTO>) => {
      setRecipients((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...patch } : r)),
      );
      markDirty();
    },
    [markDirty],
  );

  const addRecipient = useCallback(() => {
    setRecipients((prev) => {
      const used = new Set(prev.map((r) => r.roleKey));
      const preset = DEFAULT_ROLES.find((d) => !used.has(d.roleKey));
      const index = prev.length;
      let roleKey: string;
      let label: string;
      let color: string;
      if (preset) {
        roleKey = preset.roleKey;
        label = preset.label;
        color = preset.color;
      } else {
        let n = 1;
        while (used.has(`custom_${n}`)) n += 1;
        roleKey = `custom_${n}`;
        label = `Recipient ${index + 1}`;
        color = colorForIndex(index);
      }
      const signingOrder =
        prev.reduce((max, r) => Math.max(max, r.signingOrder), 0) + 1;
      const next: RecipientDTO = {
        id: `tmp_rec_${Date.now()}_${idCounter.current++}`,
        roleKey,
        label,
        defaultName: null,
        defaultEmail: null,
        signingOrder,
        color,
      };
      return [...prev, next];
    });
    markDirty();
  }, [markDirty]);

  const removeRecipient = useCallback(
    (id: string): string | null => {
      if (fields.some((f) => f.recipientId === id)) {
        return 'This recipient still has fields. Delete or reassign them first.';
      }
      if (recipients.length <= 1) {
        return 'A template needs at least one recipient.';
      }
      setRecipients((prev) => prev.filter((r) => r.id !== id));
      setSelectedRecipientId((cur) =>
        cur === id ? recipients.find((r) => r.id !== id)?.id ?? '' : cur,
      );
      markDirty();
      return null;
    },
    [fields, recipients, markDirty],
  );

  // ---- save --------------------------------------------------------------

  const buildPayload = useCallback(
    (nextStatus: string): SaveTemplatePayload => ({
      name: name.trim() || template.fileName,
      description: description.trim() || null,
      category,
      status: nextStatus,
      pageCount,
      recipients: recipients.map((r) => ({
        id: r.id,
        roleKey: r.roleKey,
        label: r.label,
        defaultName: r.defaultName ?? null,
        defaultEmail: r.defaultEmail ?? null,
        signingOrder: r.signingOrder,
        color: r.color,
      })),
      fields: fields.map((f) => ({
        id: f.id,
        type: f.type,
        label: f.label ?? null,
        required: f.required,
        page: f.page,
        xPct: f.xPct,
        yPct: f.yPct,
        widthPct: f.widthPct,
        heightPct: f.heightPct,
        recipientId: f.recipientId,
        prefillKey: f.prefillKey ?? null,
        meta: f.meta ?? null,
      })),
    }),
    [name, description, category, pageCount, recipients, fields, template.fileName],
  );

  // Adopt server state (ids, status, Documenso sync) after a save/publish so
  // subsequent operations are stable.
  const adoptSaved = useCallback((saved: TemplateDTO, prevRoleKey?: string) => {
    setRecipients(saved.recipients);
    setFields(saved.fields);
    setName(saved.name);
    setDescription(saved.description ?? '');
    setCategory(saved.category);
    setStatus(saved.status);
    setPageCount(saved.pageCount);
    setDocumensoTemplateId(saved.documensoTemplateId ?? null);
    setDocumensoSyncedAt(saved.documensoSyncedAt ?? null);
    const nextSel =
      saved.recipients.find((r) => r.roleKey === prevRoleKey) ?? saved.recipients[0];
    setSelectedRecipientId(nextSel?.id ?? '');
    setSelectedFieldId(null);
  }, []);

  const handleSave = useCallback(
    async (publish: boolean) => {
      setSaving(true);
      setSaveError(null);
      const nextStatus = publish ? 'published' : status;
      const prevRoleKey = recipients.find((r) => r.id === selectedRecipientId)?.roleKey;
      try {
        const { template: saved } = await saveTemplate(template.id, buildPayload(nextStatus));
        adoptSaved(saved, prevRoleKey);
        setDirty(false);
        setSavedTick(true);
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save');
      } finally {
        setSaving(false);
      }
    },
    [status, recipients, selectedRecipientId, template.id, buildPayload, adoptSaved],
  );

  // Publish to Documenso: persist the latest layout, then create/update the
  // reusable TEMPLATE envelope. Sends no emails.
  const handlePublish = useCallback(async () => {
    setPublishing(true);
    setPublishError(null);
    setSaveError(null);
    const prevRoleKey = recipients.find((r) => r.id === selectedRecipientId)?.roleKey;
    try {
      const { template: saved } = await saveTemplate(template.id, buildPayload('published'));
      adoptSaved(saved, prevRoleKey);
      setDirty(false);
      setSavedTick(true);
      const { template: published } = await publishTemplate(template.id);
      adoptSaved(published, prevRoleKey);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Failed to publish to Documenso');
    } finally {
      setPublishing(false);
    }
  }, [recipients, selectedRecipientId, template.id, buildPayload, adoptSaved]);

  // ---- keyboard ----------------------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFieldId) {
        e.preventDefault();
        removeField(selectedFieldId);
      } else if (e.key === 'Escape') {
        setActiveTool(null);
        setSelectedFieldId(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedFieldId, removeField]);

  // ---- overlay -----------------------------------------------------------

  const renderOverlay = useCallback(
    (ctx: PageRenderContext) => (
      <PageOverlay
        ctx={ctx}
        fields={fields}
        recipients={recipients}
        activeTool={activeTool}
        selectedFieldId={selectedFieldId}
        onPlace={addField}
        onSelect={selectField}
        onChangeField={updateField}
        onRemoveField={removeField}
      />
    ),
    [
      fields,
      recipients,
      activeTool,
      selectedFieldId,
      addField,
      selectField,
      updateField,
      removeField,
    ],
  );

  const activeDef = activeTool ? fieldDef(activeTool) : null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas">
      <StepsSidebar
        templateId={template.id}
        status={status}
        category={category}
        description={description}
        recipientCount={recipients.length}
        fieldCount={fields.length}
        dirty={dirty}
        saving={saving}
        publishedToDocumenso={Boolean(documensoTemplateId)}
        documensoSyncedAt={documensoSyncedAt}
        publishing={publishing}
        publishError={publishError}
        onPublish={handlePublish}
        onSave={() => handleSave(false)}
        onCategoryChange={(v) => {
          setCategory(v);
          markDirty();
        }}
        onDescriptionChange={(v) => {
          setDescription(v);
          markDirty();
        }}
      />

      {/* Centre: toolbar + scrollable PDF canvas */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-edge bg-panel px-4 py-2.5">
          <Input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              markDirty();
            }}
            placeholder="Template name"
            className="h-9 max-w-md font-medium"
          />
          <span className="flex items-center gap-1.5 text-xs text-ink-dim">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                dirty ? 'bg-amber-400' : 'bg-emerald-400',
              )}
            />
            {dirty ? 'Unsaved' : savedTick ? 'Saved' : 'Up to date'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {saveError && (
              <span className="max-w-[14rem] truncate text-xs text-rose-300">
                {saveError}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleSave(true)}
              disabled={saving}
            >
              Save &amp; Publish
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleSave(false)}
              disabled={saving}
            >
              {saving ? <Spinner /> : <CheckIcon className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </div>

        {activeDef && (
          <div className="flex items-center gap-2 border-b border-edge bg-accent/10 px-4 py-1.5 text-xs text-ink">
            <span aria-hidden>{activeDef.glyph}</span>
            Placing <strong>{activeDef.label}</strong> — click on the page to drop
            it.
            <button
              type="button"
              onClick={() => setActiveTool(null)}
              className="ml-auto inline-flex items-center gap-1 text-ink-dim hover:text-ink"
            >
              <XIcon className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        )}

        <div
          className="scroll-thin flex-1 overflow-auto bg-canvas px-6 py-8"
          onMouseDown={(e: ReactMouseEvent) => {
            if (e.target === e.currentTarget) selectField(null);
          }}
        >
          <div className="mx-auto w-full max-w-[880px]">
            <PdfDocumentView
              url={fileUrl}
              onNumPages={setPageCount}
              renderPageOverlay={renderOverlay}
            />
          </div>
        </div>
      </div>

      {/* Right: palette / properties / recipients */}
      <div className="flex w-[320px] shrink-0 flex-col border-l border-edge bg-panel">
        {selectedField ? (
          <FieldProperties
            field={selectedField}
            recipients={recipients}
            onChange={updateField}
            onRemove={removeField}
            onClose={() => setSelectedFieldId(null)}
          />
        ) : rightTab === 'recipients' ? (
          <RecipientsPanel
            recipients={recipients}
            fields={fields}
            onChange={updateRecipient}
            onAdd={addRecipient}
            onRemove={removeRecipient}
            onClose={() => setRightTab('fields')}
          />
        ) : (
          <FieldPalette
            recipients={recipients}
            selectedRecipientId={selectedRecipientId}
            onSelectRecipient={setSelectedRecipientId}
            activeTool={activeTool}
            onArm={armTool}
            onManageRecipients={() => setRightTab('recipients')}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One page's overlay layer: handles click-to-place + hosts the field boxes.
// ---------------------------------------------------------------------------
function PageOverlay({
  ctx,
  fields,
  recipients,
  activeTool,
  selectedFieldId,
  onPlace,
  onSelect,
  onChangeField,
  onRemoveField,
}: {
  ctx: PageRenderContext;
  fields: FieldDTO[];
  recipients: RecipientDTO[];
  activeTool: FieldType | null;
  selectedFieldId: string | null;
  onPlace: (type: FieldType, page: number, xPct: number, yPct: number) => void;
  onSelect: (id: string | null) => void;
  onChangeField: (id: string, patch: Partial<FieldDTO>) => void;
  onRemoveField: (id: string) => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const { pageNumber, width, height } = ctx;
  const pageFields = fields.filter((f) => f.page === pageNumber);

  function onLayerClick(e: ReactMouseEvent) {
    if (!activeTool) {
      if (e.target === e.currentTarget) onSelect(null);
      return;
    }
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const def = fieldDef(activeTool);
    const xPct = clamp(
      ((e.clientX - rect.left) / rect.width) * 100 - def.defaultWidthPct / 2,
      0,
      100 - def.defaultWidthPct,
    );
    const yPct = clamp(
      ((e.clientY - rect.top) / rect.height) * 100 - def.defaultHeightPct / 2,
      0,
      100 - def.defaultHeightPct,
    );
    onPlace(activeTool, pageNumber, xPct, yPct);
  }

  function colorFor(recipientId: string): string {
    return recipients.find((r) => r.id === recipientId)?.color ?? '#6ee06e';
  }

  return (
    <div
      ref={layerRef}
      onClick={onLayerClick}
      className={cn(
        'absolute inset-0',
        activeTool && 'cursor-crosshair placement-grid',
      )}
    >
      {pageFields.map((f) => (
        <FieldBox
          key={f.id}
          field={f}
          recipientColor={colorFor(f.recipientId)}
          pageWidthPx={width}
          pageHeightPx={height}
          selected={f.id === selectedFieldId}
          placing={!!activeTool}
          onSelect={() => onSelect(f.id)}
          onChange={(patch) => onChangeField(f.id, patch)}
          onRemove={() => onRemoveField(f.id)}
        />
      ))}
    </div>
  );
}

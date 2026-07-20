'use client';

// Right-panel view shown when a field is selected: edit its label, required
// flag, owning recipient, prefill binding and (for dropdown/radio) options.

import { useMemo } from 'react';
import { cn } from '@/lib/cn';
import { Button, Input, Label, Select } from '@/components/ui';
import { ArrowLeftIcon, TrashIcon } from '@/components/icons';
import { fieldDef } from '@/lib/fields';
import { PREFILL_TOKENS, type PrefillToken } from '@/lib/prefill';
import type { FieldDTO, FieldOption, RecipientDTO } from '@/lib/types';

export function FieldProperties({
  field,
  recipients,
  onChange,
  onRemove,
  onClose,
}: {
  field: FieldDTO;
  recipients: RecipientDTO[];
  onChange: (id: string, patch: Partial<FieldDTO>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const def = fieldDef(field.type);

  const groupedTokens = useMemo(() => {
    const map = new Map<string, PrefillToken[]>();
    for (const t of PREFILL_TOKENS) {
      const list = map.get(t.group) ?? [];
      list.push(t);
      map.set(t.group, list);
    }
    return Array.from(map.entries());
  }, []);

  const options: FieldOption[] = field.meta?.options ?? [];

  function setOptions(next: FieldOption[]) {
    onChange(field.id, { meta: { ...(field.meta ?? {}), options: next } });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="px-2">
          <ArrowLeftIcon className="h-4 w-4" />
          Fields
        </Button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-sm">
          <span aria-hidden>{def.glyph}</span>
          <span className="font-semibold text-ink">{def.label}</span>
        </span>
      </div>

      <div className="scroll-thin flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <div>
          <Label htmlFor="field-label">Label</Label>
          <Input
            id="field-label"
            value={field.label ?? ''}
            placeholder={def.label}
            onChange={(e) => onChange(field.id, { label: e.target.value })}
          />
          <p className="mt-1.5 text-xs text-ink-dim">{def.description}</p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-edge bg-panel-2 px-3 py-2">
          <span className="text-sm text-ink">Required</span>
          <button
            type="button"
            role="switch"
            aria-checked={field.required}
            onClick={() => onChange(field.id, { required: !field.required })}
            className={cn(
              'relative h-5 w-9 rounded-full transition',
              field.required ? 'bg-accent' : 'bg-edge',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition',
                field.required ? 'left-[18px]' : 'left-0.5',
              )}
            />
          </button>
        </div>

        <div>
          <Label htmlFor="field-recipient">Recipient</Label>
          <Select
            id="field-recipient"
            value={field.recipientId}
            onChange={(e) => onChange(field.id, { recipientId: e.target.value })}
          >
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>

        {def.prefillable && (
          <div>
            <Label htmlFor="field-prefill">Prefill from HRMS data</Label>
            <Select
              id="field-prefill"
              value={field.prefillKey ?? ''}
              onChange={(e) =>
                onChange(field.id, { prefillKey: e.target.value || null })
              }
            >
              <option value="">— None (collected at signing) —</option>
              {groupedTokens.map(([group, tokens]) => (
                <optgroup key={group} label={group}>
                  {tokens.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
        )}

        {def.hasOptions && (
          <div>
            <Label>Options</Label>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={opt.label}
                    placeholder="Label"
                    className="h-9"
                    onChange={(e) => {
                      const next = [...options];
                      next[i] = { ...opt, label: e.target.value };
                      setOptions(next);
                    }}
                  />
                  <Input
                    value={opt.value}
                    placeholder="value"
                    className="h-9"
                    onChange={(e) => {
                      const next = [...options];
                      next[i] = { ...opt, value: e.target.value };
                      setOptions(next);
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="px-2"
                    aria-label="Remove option"
                    onClick={() => setOptions(options.filter((_, j) => j !== i))}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => {
                const n = options.length + 1;
                setOptions([
                  ...options,
                  { label: `Option ${n}`, value: `option_${n}` },
                ]);
              }}
            >
              Add option
            </Button>
          </div>
        )}
      </div>

      <div className="border-t border-edge px-4 py-3">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => onRemove(field.id)}
        >
          <TrashIcon className="h-4 w-4" />
          Delete field
        </Button>
      </div>
    </div>
  );
}

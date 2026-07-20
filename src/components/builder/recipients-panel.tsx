'use client';

// Right-panel "Recipients" view: add / edit / remove signing roles. A recipient
// that still owns fields cannot be removed (the user must delete/reassign those
// fields first) — surfaced inline, never via a browser dialog.

import { useState } from 'react';
import { Button, Input, Label, Select } from '@/components/ui';
import { ArrowLeftIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { DEFAULT_ROLES } from '@/lib/recipients';
import type { FieldDTO, RecipientDTO } from '@/lib/types';

export function RecipientsPanel({
  recipients,
  fields,
  onChange,
  onAdd,
  onRemove,
  onClose,
}: {
  recipients: RecipientDTO[];
  fields: FieldDTO[];
  onChange: (id: string, patch: Partial<RecipientDTO>) => void;
  onAdd: () => void;
  onRemove: (id: string) => string | null; // returns an error message, or null on success
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  function fieldCount(recipientId: string): number {
    return fields.filter((f) => f.recipientId === recipientId).length;
  }

  function handleRemove(id: string) {
    const message = onRemove(id);
    setError(message);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
        <Button variant="ghost" size="sm" onClick={onClose} className="px-2">
          <ArrowLeftIcon className="h-4 w-4" />
          Fields
        </Button>
        <span className="ml-auto text-sm font-semibold text-ink">Recipients</span>
      </div>

      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {error && (
          <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error}
          </p>
        )}

        {recipients.map((r, index) => {
          const count = fieldCount(r.id);
          return (
            <div
              key={r.id}
              className="space-y-2.5 rounded-xl border border-edge bg-panel-2 p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/30"
                  style={{ backgroundColor: r.color }}
                />
                <Input
                  value={r.label}
                  placeholder="Label"
                  className="h-9"
                  onChange={(e) => onChange(r.id, { label: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-2"
                  aria-label="Remove recipient"
                  onClick={() => handleRemove(r.id)}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>

              <div>
                <Label htmlFor={`rec-role-${r.id}`}>Role</Label>
                <Select
                  id={`rec-role-${r.id}`}
                  className="h-9"
                  value={r.roleKey}
                  onChange={(e) => {
                    const preset = DEFAULT_ROLES.find(
                      (d) => d.roleKey === e.target.value,
                    );
                    if (preset) {
                      onChange(r.id, {
                        roleKey: preset.roleKey,
                        label: preset.label,
                        color: preset.color,
                      });
                    }
                  }}
                >
                  {DEFAULT_ROLES.map((d) => {
                    const takenByOther = recipients.some(
                      (o) => o.id !== r.id && o.roleKey === d.roleKey,
                    );
                    return (
                      <option key={d.roleKey} value={d.roleKey} disabled={takenByOther}>
                        {d.label}
                        {takenByOther ? ' (in use)' : ''}
                      </option>
                    );
                  })}
                  {!DEFAULT_ROLES.some((d) => d.roleKey === r.roleKey) && (
                    <option value={r.roleKey}>Custom · {r.roleKey}</option>
                  )}
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor={`rec-name-${r.id}`}>Default name</Label>
                  <Input
                    id={`rec-name-${r.id}`}
                    className="h-9"
                    value={r.defaultName ?? ''}
                    placeholder="Optional"
                    onChange={(e) =>
                      onChange(r.id, { defaultName: e.target.value || null })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`rec-order-${r.id}`}>Signing order</Label>
                  <Input
                    id={`rec-order-${r.id}`}
                    type="number"
                    min={1}
                    className="h-9"
                    value={r.signingOrder}
                    onChange={(e) =>
                      onChange(r.id, {
                        signingOrder: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                </div>
              </div>

              <div>
                <Label htmlFor={`rec-email-${r.id}`}>Default email</Label>
                <Input
                  id={`rec-email-${r.id}`}
                  type="email"
                  className="h-9"
                  value={r.defaultEmail ?? ''}
                  placeholder="Optional fixed signer"
                  onChange={(e) =>
                    onChange(r.id, { defaultEmail: e.target.value || null })
                  }
                />
              </div>

              <p className="text-xs text-ink-dim">
                {count} field{count === 1 ? '' : 's'} · recipient {index + 1}
              </p>
            </div>
          );
        })}
      </div>

      <div className="border-t border-edge px-4 py-3">
        <Button variant="outline" size="sm" className="w-full" onClick={onAdd}>
          <PlusIcon className="h-4 w-4" />
          Add recipient
        </Button>
      </div>
    </div>
  );
}

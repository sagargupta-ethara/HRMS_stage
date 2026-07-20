'use client';

// Right-panel default view: pick the recipient that newly placed fields are
// assigned to, then arm a field type from the palette to drop it on the page.

import { cn } from '@/lib/cn';
import { Button, Label, Select } from '@/components/ui';
import { UsersIcon } from '@/components/icons';
import { FIELD_TYPES } from '@/lib/fields';
import type { FieldType, RecipientDTO } from '@/lib/types';

export function FieldPalette({
  recipients,
  selectedRecipientId,
  onSelectRecipient,
  activeTool,
  onArm,
  onManageRecipients,
}: {
  recipients: RecipientDTO[];
  selectedRecipientId: string;
  onSelectRecipient: (id: string) => void;
  activeTool: FieldType | null;
  onArm: (type: FieldType) => void;
  onManageRecipients: () => void;
}) {
  const current = recipients.find((r) => r.id === selectedRecipientId);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-edge px-4 py-4">
        <Label htmlFor="palette-recipient">Selected Recipient</Label>
        <div className="relative">
          <span
            className="pointer-events-none absolute left-3 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full ring-1 ring-black/30"
            style={{ backgroundColor: current?.color ?? '#666' }}
          />
          <Select
            id="palette-recipient"
            className="pl-7"
            value={selectedRecipientId}
            onChange={(e) => onSelectRecipient(e.target.value)}
          >
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </Select>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start px-2"
          onClick={onManageRecipients}
        >
          <UsersIcon className="h-4 w-4" />
          Manage recipients
        </Button>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-4 py-4">
        <Label>Add Fields</Label>
        <p className="mb-3 -mt-1 text-xs text-ink-dim">
          Pick a field, then click on the page to place it.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {FIELD_TYPES.map((f) => {
            const armed = activeTool === f.type;
            return (
              <button
                key={f.type}
                type="button"
                onClick={() => onArm(f.type)}
                title={f.description}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition',
                  armed
                    ? 'border-accent bg-accent/10 text-ink ring-1 ring-accent/50'
                    : 'border-edge bg-panel-2 text-ink-dim hover:border-edge hover:bg-edge hover:text-ink',
                )}
              >
                <span
                  className="grid h-7 w-7 place-items-center rounded-lg text-base"
                  style={{ backgroundColor: `${f.color}22`, color: f.color }}
                  aria-hidden
                >
                  {f.glyph}
                </span>
                <span className="text-xs font-medium">{f.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

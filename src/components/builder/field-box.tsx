'use client';

// A single placed field drawn over a PDF page. Self-positions from its
// percentage geometry, supports pointer-drag to MOVE and a bottom-right handle
// to RESIZE. All geometry stays in 0..100 percentages and is clamped so the
// field can never leave the page box.

import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@/lib/cn';
import { fieldDef } from '@/lib/fields';
import type { FieldDTO } from '@/lib/types';

const MIN_W = 3; // percent
const MIN_H = 2; // percent

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** `#rrggbb` -> `rgba(r,g,b,a)` (colours in this app are always 6-digit hex). */
function rgba(hex: string, alpha: number): string {
  const m = hex.replace('#', '');
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

type GeometryPatch = Partial<
  Pick<FieldDTO, 'xPct' | 'yPct' | 'widthPct' | 'heightPct'>
>;

interface DragState {
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  /** becomes true only once the pointer moves past DRAG_THRESHOLD_PX */
  active: boolean;
}

// A plain click carries a few pixels of jitter; don't treat that as a drag
// (which would nudge the field and mark the template dirty on mere selection).
const DRAG_THRESHOLD_PX = 3;

export function FieldBox({
  field,
  recipientColor,
  pageWidthPx,
  pageHeightPx,
  selected,
  placing,
  onSelect,
  onChange,
  onRemove,
}: {
  field: FieldDTO;
  recipientColor: string;
  pageWidthPx: number;
  pageHeightPx: number;
  selected: boolean;
  /** while a palette tool is armed, fields ignore pointers so clicks place new ones */
  placing: boolean;
  onSelect: () => void;
  onChange: (patch: GeometryPatch) => void;
  onRemove: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const def = fieldDef(field.type);
  const label = field.label || def.label;

  function begin(mode: 'move' | 'resize', e: ReactPointerEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    drag.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origX: field.xPct,
      origY: field.yPct,
      origW: field.widthPct,
      origH: field.heightPct,
      active: false,
    };
    bodyRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    // Ignore sub-threshold jitter so a click selects without moving the field.
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.active = true;
    }
    const dxPct = ((e.clientX - d.startX) / pageWidthPx) * 100;
    const dyPct = ((e.clientY - d.startY) / pageHeightPx) * 100;
    if (d.mode === 'move') {
      onChange({
        xPct: clamp(d.origX + dxPct, 0, 100 - d.origW),
        yPct: clamp(d.origY + dyPct, 0, 100 - d.origH),
      });
    } else {
      onChange({
        widthPct: clamp(d.origW + dxPct, MIN_W, 100 - d.origX),
        heightPct: clamp(d.origH + dyPct, MIN_H, 100 - d.origY),
      });
    }
  }

  function endDrag(e: ReactPointerEvent) {
    if (!drag.current) return;
    drag.current = null;
    bodyRef.current?.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      ref={bodyRef}
      data-field-id={field.id}
      onPointerDown={(e) => begin('move', e)}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={cn(
        'group absolute flex select-none items-center justify-center rounded-[3px] text-center',
        placing ? 'pointer-events-none' : 'cursor-move',
      )}
      style={{
        left: `${field.xPct}%`,
        top: `${field.yPct}%`,
        width: `${field.widthPct}%`,
        height: `${field.heightPct}%`,
        backgroundColor: rgba(recipientColor, 0.14),
        border: `1.5px ${selected ? 'solid' : 'dashed'} ${recipientColor}`,
        boxShadow: selected ? `0 0 0 2px ${rgba(recipientColor, 0.9)}` : undefined,
      }}
    >
      <span
        className="pointer-events-none flex items-center gap-1 overflow-hidden px-1 text-[10px] font-semibold leading-none"
        style={{ color: recipientColor }}
      >
        <span className="truncate">{label}</span>
        {field.prefillKey && <span title={`Prefill: ${field.prefillKey}`}>🔗</span>}
      </span>

      {/* Delete button — on hover or when selected */}
      <button
        type="button"
        aria-label="Remove field"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className={cn(
          'absolute -right-2 -top-2 hidden h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[11px] font-bold text-white shadow group-hover:flex',
          selected && 'flex',
        )}
      >
        ×
      </button>

      {/* Resize handle — only when selected */}
      {selected && (
        <span
          onPointerDown={(e) => begin('resize', e)}
          className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white/70"
          style={{ backgroundColor: recipientColor }}
        />
      )}
    </div>
  );
}

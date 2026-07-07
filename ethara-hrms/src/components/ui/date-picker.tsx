"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Custom calendar date picker — a drop-in replacement for the native
 * `<input type="date">` so the date dialog matches the app theme instead of
 * the browser's default OS picker.
 *
 * The value contract mirrors the native input: `value`/`onChange` use an
 * ISO `YYYY-MM-DD` string (empty string = no value), so existing form state
 * wired to a native date input can switch over with no other changes.
 */

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Parse an ISO `YYYY-MM-DD` string as a LOCAL date (no timezone shift). */
function parseISO(value: string | undefined | null): Date | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatDisplay(d: Date): string {
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export interface DatePickerProps {
  value?: string
  onChange?: (value: string) => void
  /** ISO `YYYY-MM-DD` lower bound (inclusive). */
  min?: string
  /** ISO `YYYY-MM-DD` upper bound (inclusive). */
  max?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  name?: string
  className?: string
  style?: React.CSSProperties
  "aria-invalid"?: boolean
  onBlur?: () => void
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Select date",
  disabled,
  id,
  name,
  className,
  style,
  onBlur,
  ...rest
}: DatePickerProps) {
  const selected = parseISO(value)
  const minDate = parseISO(min)
  const maxDate = parseISO(max)
  const [open, setOpen] = React.useState(false)
  // Month currently shown in the grid (defaults to the selected date / today).
  const [view, setView] = React.useState<Date>(() => selected ?? new Date())

  const year = view.getFullYear()
  const month = view.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()
  const currentYear = today.getFullYear()
  // Bound the year picker to the field's range when given (e.g. a Date of Birth
  // passes `max={today}` so future years never appear). Without bounds, default
  // to a sane window instead of 1900..+10, and always include the viewed year.
  const firstYear = Math.min(minDate?.getFullYear() ?? currentYear - 100, year)
  const lastYear = Math.max(maxDate?.getFullYear() ?? currentYear + 10, year)
  // Most recent first — for past-dated fields (birth dates) the useful years sit
  // near the top instead of after a long scroll.
  const years = Array.from({ length: lastYear - firstYear + 1 }, (_, index) => lastYear - index)

  const cells: (Date | null)[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d))

  function isDisabled(d: Date): boolean {
    if (minDate && d < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())) return true
    if (maxDate && d > new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate())) return true
    return false
  }

  function pick(d: Date) {
    if (isDisabled(d)) return
    onChange?.(toISO(d))
    setOpen(false)
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setView(selected ?? new Date())
        setOpen(next)
        if (!next) onBlur?.()
      }}
    >
      <PopoverPrimitive.Trigger
        id={id}
        name={name}
        disabled={disabled}
        data-slot="date-picker-trigger"
        data-placeholder={selected ? undefined : ""}
        aria-invalid={rest["aria-invalid"]}
        className={cn(
          "flex h-10 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-input bg-transparent px-3 text-sm transition-colors outline-none select-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
          "data-placeholder:text-muted-foreground",
          className
        )}
        style={style}
      >
        <span className={cn(!selected && "text-muted-foreground")}>
          {selected ? formatDisplay(selected) : placeholder}
        </span>
        <CalendarIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner sideOffset={6} align="start" className="isolate z-50 outline-none">
          <PopoverPrimitive.Popup
            data-slot="date-picker-popup"
            className={cn(
              "z-50 w-[18rem] origin-(--transform-origin) rounded-xl bg-popover p-3 text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            )}
          >
            {/* Month/year header with direct selectors and navigation */}
            <div className="mb-2 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => setView(new Date(year, month - 1, 1))}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <ChevronLeftIcon className="size-4" />
              </button>
              <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_88px] gap-1.5">
                <Select
                  value={String(month)}
                  onValueChange={(next) => {
                    if (next != null) setView(new Date(year, Number(next), 1))
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Month"
                    className="h-8 w-full justify-between rounded-md px-2 text-xs font-semibold"
                  >
                    <SelectValue>{(v) => MONTHS[Number(v)] ?? MONTHS[month]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {MONTHS.map((label, index) => (
                      <SelectItem key={label} value={String(index)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(year)}
                  onValueChange={(next) => {
                    if (next != null) setView(new Date(Number(next), month, 1))
                  }}
                >
                  <SelectTrigger
                    size="sm"
                    aria-label="Year"
                    className="h-8 w-full justify-between rounded-md px-2 text-xs font-semibold"
                  >
                    <SelectValue>{(v) => String(v ?? year)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent className="max-h-56">
                    {years.map((optionYear) => (
                      <SelectItem key={optionYear} value={String(optionYear)}>
                        {optionYear}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => setView(new Date(year, month + 1, 1))}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <ChevronRightIcon className="size-4" />
              </button>
            </div>

            {/* Weekday header */}
            <div className="grid grid-cols-7 gap-0.5">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="flex h-7 items-center justify-center text-xs font-medium text-muted-foreground"
                >
                  {w}
                </div>
              ))}
            </div>

            {/* Day grid */}
            <div className="mt-0.5 grid grid-cols-7 gap-0.5">
              {cells.map((d, i) => {
                if (!d) return <div key={`e${i}`} className="size-9" />
                const isSelected = selected ? sameDay(d, selected) : false
                const isToday = sameDay(d, today)
                const disabledDay = isDisabled(d)
                return (
                  <button
                    key={toISO(d)}
                    type="button"
                    disabled={disabledDay}
                    onClick={() => pick(d)}
                    aria-pressed={isSelected}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-lg text-sm transition-colors",
                      "hover:bg-accent hover:text-accent-foreground",
                      "disabled:pointer-events-none disabled:opacity-30",
                      isSelected &&
                        "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      !isSelected && isToday && "ring-1 ring-primary/50"
                    )}
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>

            {/* Footer actions */}
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!isDisabled(today)) pick(today)
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange?.("")
                  setOpen(false)
                }}
                className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                Clear
              </button>
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

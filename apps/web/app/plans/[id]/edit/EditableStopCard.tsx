'use client';
// M3 editable stop row. A controlled mirror of the read-only StopCard: text
// inputs for name + start time, a textarea for what-to-do, number inputs for
// minutes + cost, a remove button and a visual drag handle (the Reorder wiring
// lives in ItineraryEditor). Tier-1 shell chrome, lowercase, a11y-labelled.
import { GripVertical, X } from 'lucide-react';
import type { Stop } from '@/lib/itinerary-types';

const fieldClass =
  'w-full rounded-2xl border border-shell-ink/15 bg-white/70 px-3 py-2 font-body text-sm text-shell-ink placeholder:text-shell-ink/35 focus:border-shell-accent/60 focus:outline-none focus:ring-2 focus:ring-shell-accent/20';

const labelClass = 'mb-1 block font-body text-[12px] lowercase tracking-[0.04em] text-shell-ink/55';

export function EditableStopCard({
  stop,
  index,
  onPatch,
  onRemove,
}: {
  stop: Stop;
  index: number;
  onPatch: (i: number, patch: Partial<Stop>) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="rounded-3xl border border-shell-ink/10 bg-shell-base p-4 shadow-fun">
      <div className="flex items-start gap-3">
        <span
          className="mt-2 shrink-0 cursor-grab text-shell-ink/40 active:cursor-grabbing"
          aria-hidden
        >
          <GripVertical className="h-5 w-5" />
        </span>

        <div className="flex-1 space-y-3">
          <div>
            <label className={labelClass} htmlFor={`stop-name-${index}`}>name</label>
            <input
              id={`stop-name-${index}`}
              aria-label="name"
              value={stop.place_name}
              onChange={(e) => onPatch(index, { place_name: e.target.value })}
              placeholder="where to"
              className={fieldClass}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass} htmlFor={`stop-time-${index}`}>start time</label>
              <input
                id={`stop-time-${index}`}
                aria-label="start time"
                value={stop.start_time}
                onChange={(e) => onPatch(index, { start_time: e.target.value })}
                placeholder="18:00"
                className={fieldClass}
              />
            </div>
            <div className="w-24">
              <label className={labelClass} htmlFor={`stop-mins-${index}`}>minutes</label>
              <input
                id={`stop-mins-${index}`}
                aria-label="minutes"
                type="number"
                min={0}
                inputMode="numeric"
                value={stop.duration_min}
                onChange={(e) => onPatch(index, { duration_min: Number(e.target.value) })}
                className={fieldClass}
              />
            </div>
            <div className="w-24">
              <label className={labelClass} htmlFor={`stop-cost-${index}`}>cost</label>
              <input
                id={`stop-cost-${index}`}
                aria-label="cost"
                type="number"
                min={0}
                inputMode="decimal"
                value={stop.estimated_cost_pp}
                onChange={(e) => onPatch(index, { estimated_cost_pp: Number(e.target.value) })}
                className={fieldClass}
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor={`stop-do-${index}`}>what to do</label>
            <textarea
              id={`stop-do-${index}`}
              aria-label="what to do"
              value={stop.what_to_do ?? ''}
              onChange={(e) => onPatch(index, { what_to_do: e.target.value })}
              placeholder="the move here"
              rows={2}
              className={`${fieldClass} resize-none`}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label="remove stop"
          className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-shell-ink/50 transition hover:bg-shell-ink/10 hover:text-shell-ink"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

'use client';
// M3 editable stop row. A controlled mirror of the read-only StopCard: text
// inputs for name + start time, a textarea for what-to-do, number inputs for
// minutes + cost, a remove button and a visual drag handle (the Reorder wiring
// lives in ItineraryEditor). Tier-1 shell chrome, lowercase, a11y-labelled.
import { useCallback, useState } from 'react';
import { GripVertical, MapPin, X } from 'lucide-react';
import type { Stop } from '@/lib/itinerary-types';
import { stopSummary } from '@/lib/itinerary/edit';
import { StopPhotoPicker } from './StopPhotoPicker';
import { CustomVenueSearch } from './CustomVenueSearch';

// Auto-grow a textarea to fit its content (no inner scroll/clipping).
function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

const fieldClass =
  'w-full rounded-2xl border border-shell-ink/15 bg-white/70 px-3 py-2 font-body text-sm text-shell-ink placeholder:text-shell-ink/35 focus:border-shell-accent/60 focus:outline-none focus:ring-2 focus:ring-shell-accent/20';

const labelClass = 'mb-1 block font-body text-[12px] lowercase tracking-[0.04em] text-shell-ink/55';

export function EditableStopCard({
  stop,
  index,
  onPatch,
  onRemove,
  itineraryId,
}: {
  stop: Stop;
  index: number;
  itineraryId: string;
  onPatch: (i: number, patch: Partial<Stop>) => void;
  onRemove: (i: number) => void;
}) {
  // Ref callback sizes the "what to do" textarea on first render so existing
  // long content isn't clipped; onInput keeps it growing while typing.
  const whatToDoRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) autoGrow(el);
  }, []);

  // Inline location search (reuses the /api/places/search proxy via
  // CustomVenueSearch). Picking a result patches location fields onto the stop.
  const [locating, setLocating] = useState(false);
  const locationLabel = stop.address || stop.neighborhood || null;

  function handlePickLocation(result: Stop) {
    const patch: Partial<Stop> = {
      address: result.address ?? null,
      lat: result.lat ?? null,
      lng: result.lng ?? null,
    };
    if (result.neighborhood) patch.neighborhood = result.neighborhood;
    if (result.place_id) patch.place_id = result.place_id;
    if (result.place_slug) patch.place_slug = result.place_slug;
    if (result.google_place_id) patch.google_place_id = result.google_place_id;
    onPatch(index, patch);
    setLocating(false);
  }

  const summary = stopSummary(stop);

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

          {/* location row — shows the stop's place (address > neighborhood),
              with an inline place search to set or change it. Picking writes
              address/coords/ids onto the stop so map links + RouteMap work for
              custom stops. Re-searching overwrites; no clear needed. */}
          <div>
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-shell-ink/40" aria-hidden />
              <p className="min-w-0 truncate font-body text-[12px] text-shell-ink/55">
                {locationLabel ?? 'no location yet'}
              </p>
              <button
                type="button"
                onClick={() => setLocating((v) => !v)}
                className="shrink-0 font-body text-[12px] lowercase text-shell-accent underline underline-offset-2 transition hover:opacity-80"
              >
                {locating ? 'close' : locationLabel ? 'change' : 'set location'}
              </button>
            </div>
            {locating && (
              <div className="mt-2">
                <CustomVenueSearch onAdd={handlePickLocation} actionLabel="use this place" />
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelClass} htmlFor={`stop-time-${index}`}>starts at</label>
              <input
                id={`stop-time-${index}`}
                aria-label="starts at"
                value={stop.start_time}
                onChange={(e) => onPatch(index, { start_time: e.target.value })}
                placeholder="18:00"
                className={fieldClass}
              />
            </div>
            <div className="w-24">
              <label className={labelClass} htmlFor={`stop-mins-${index}`}>how long</label>
              <div className="relative">
                <input
                  id={`stop-mins-${index}`}
                  aria-label="how long"
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={stop.duration_min}
                  onChange={(e) => onPatch(index, { duration_min: Number(e.target.value) })}
                  className={`${fieldClass} pr-10`}
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-body text-[12px] text-shell-ink/45"
                >
                  min
                </span>
              </div>
            </div>
            <div className="w-24">
              <label className={labelClass} htmlFor={`stop-cost-${index}`}>$ per person</label>
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-body text-[12px] text-shell-ink/45"
                >
                  $
                </span>
                <input
                  id={`stop-cost-${index}`}
                  aria-label="$ per person"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={stop.estimated_cost_pp}
                  onChange={(e) => onPatch(index, { estimated_cost_pp: Number(e.target.value) })}
                  className={`${fieldClass} pl-7`}
                />
              </div>
            </div>
          </div>

          {summary && (
            <p className="font-body text-[12px] text-shell-ink/55">{summary}</p>
          )}

          <div>
            <label className={labelClass} htmlFor={`stop-do-${index}`}>what to do</label>
            <textarea
              id={`stop-do-${index}`}
              aria-label="what to do"
              value={stop.what_to_do ?? ''}
              ref={whatToDoRef}
              onChange={(e) => onPatch(index, { what_to_do: e.target.value })}
              onInput={(e) => autoGrow(e.currentTarget)}
              placeholder="the move here"
              rows={2}
              className={`${fieldClass} resize-none overflow-hidden`}
            />
          </div>

          <StopPhotoPicker
            itineraryId={itineraryId}
            index={index}
            photoUrl={stop.photo_url}
            onChange={(url) => onPatch(index, { photo_url: url })}
          />
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

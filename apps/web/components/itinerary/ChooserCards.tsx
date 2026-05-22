'use client';

// Image-first 3-card chooser shown above the active itinerary detail view
// on the in-flow /plan results page. Click a card to switch which itinerary
// is detailed below.

import Image from 'next/image';
import { cn } from '@/lib/cn';
import { coverImageFor } from '@/lib/place-image';
import type { Itinerary } from '@/lib/itinerary-types';

// Badge color mapping for differentiation labels. "Our pick" keeps the gold
// treatment; the rest get distinct, muted tones so all three cards read as
// differentiated at a glance.
const LABEL_STYLES: Record<string, { bg: string; text: string }> = {
  'Most ambitious': { bg: 'bg-violet-500/95', text: 'text-white' },
  'Best value':     { bg: 'bg-emerald-500/95', text: 'text-white' },
  'Quickest':       { bg: 'bg-sky-500/95',     text: 'text-white' },
  'Our pick':       { bg: 'bg-amber-400/95',   text: 'text-amber-950' },
};

export function ChooserCards({
  itineraries,
  activeIdx,
  onPick,
  labels,
}: {
  itineraries: Itinerary[];
  activeIdx: number;
  onPick: (i: number) => void;
  labels?: string[];
}) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
      {itineraries.map((it, i) => {
        const cover = coverImageFor(it.stops, { itineraryCover: it.cover_image_url });
        const isActive = i === activeIdx;
        const totalHr = Math.round((it.total_duration_min / 60) * 10) / 10;
        const label = labels?.[i] ?? (i === 0 ? 'Our pick' : null);
        const labelStyle = label ? (LABEL_STYLES[label] ?? LABEL_STYLES['Our pick']) : null;

        return (
          <button
            key={it.id ?? i}
            type="button"
            onClick={() => onPick(i)}
            className={cn(
              'group flex flex-col rounded-card border-2 p-3 text-left transition-all',
              isActive
                ? 'border-accent bg-surface'
                : 'border-transparent hover:border-border',
            )}
          >
            {/* Image carries only the right-stack badges. Template name moves
                below as an eyebrow so long names can never collide. */}
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card bg-surface">
              <Image
                src={cover}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.02]"
              />
              <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
                {label && labelStyle && (
                  <span className={cn(
                    'inline-flex items-center gap-1 rounded-pill px-2.5 py-1 text-[11px] font-semibold tracking-wide backdrop-blur-sm shadow-sm',
                    labelStyle.bg,
                    labelStyle.text,
                  )}>
                    {label === 'Our pick' && <span aria-hidden>★</span>}
                    {label}
                  </span>
                )}
              </div>
            </div>

            {/* Title block — template eyebrow + title + meta + why_it_works preview. */}
            <div className="mt-3 px-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
                {it.template_name}
              </p>
              <h3 className="mt-1 font-display text-lg font-semibold leading-tight text-text md:text-xl">
                {it.title}
              </h3>
              <p className="mt-1.5 text-xs text-muted [font-variant-numeric:tabular-nums]">
                <span className="text-text">${Math.round(it.total_cost_pp)}</span>
                <span className="mx-1.5 text-border">·</span>
                <span>{totalHr} hr</span>
                <span className="mx-1.5 text-border">·</span>
                <span>{it.stops.length} stops</span>
              </p>
              {it.why_it_works && (
                <p className="mt-2.5 line-clamp-2 text-sm leading-snug text-secondary">
                  {it.why_it_works}
                </p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

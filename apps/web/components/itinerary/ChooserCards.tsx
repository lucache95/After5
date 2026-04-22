'use client';

// Image-first 3-card chooser shown above the active itinerary detail view
// on the in-flow /plan results page. Click a card to switch which itinerary
// is detailed below.

import Image from 'next/image';
import { cn } from '@/lib/cn';
import { coverImageFor } from '@/lib/place-image';
import type { Itinerary } from '@/lib/itinerary-types';

export function ChooserCards({
  itineraries,
  activeIdx,
  onPick,
}: {
  itineraries: Itinerary[];
  activeIdx: number;
  onPick: (i: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
      {itineraries.map((it, i) => {
        const cover = coverImageFor(it.stops);
        const isActive = i === activeIdx;
        const totalHr = Math.round((it.total_duration_min / 60) * 10) / 10;

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
                {i === 0 && (
                  <span className="inline-flex items-center gap-1 rounded-pill bg-amber-400/95 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-amber-950 backdrop-blur-sm shadow-sm">
                    <span aria-hidden>★</span> Our pick
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-500/95 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white backdrop-blur-sm shadow-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/90" /> Custom built for you
                </span>
              </div>
            </div>

            {/* Title block — template eyebrow + title + meta. */}
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
            </div>
          </button>
        );
      })}
    </div>
  );
}

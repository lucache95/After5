'use client';

// Image-first 3-card chooser shown above the active itinerary detail view
// on the in-flow /plan results page. Click a card to switch which itinerary
// is detailed below.

import Image from 'next/image';
import { cn } from '@/lib/cn';
import { imageForStop } from '@/lib/place-image';
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
        const cover = it.stops[0]
          ? imageForStop({
              photo_url: it.stops[0].photo_url,
              place_type: it.stops[0].place_type,
            })
          : '/places/place-walk.jpg';
        const isActive = i === activeIdx;
        const totalHr = Math.round((it.total_duration_min / 60) * 10) / 10;

        return (
          <button
            key={it.id ?? i}
            type="button"
            onClick={() => onPick(i)}
            className={cn(
              'group flex flex-col text-left transition-transform',
              isActive ? 'translate-y-0' : 'hover:-translate-y-0.5',
            )}
          >
            <div
              className={cn(
                'relative aspect-[4/3] w-full overflow-hidden rounded-card border-2 bg-surface transition-colors',
                isActive ? 'border-accent' : 'border-transparent',
              )}
            >
              <Image
                src={cover}
                alt=""
                fill
                sizes="(max-width: 768px) 100vw, 33vw"
                className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.02]"
              />
              <div
                aria-hidden
                className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent"
              />
              <div className="absolute left-4 top-4">
                <span className="rounded-pill bg-white/95 px-2.5 py-1 text-[11px] font-medium tracking-wide text-text backdrop-blur-sm">
                  {it.template_name}
                </span>
              </div>
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <h3 className="font-display text-lg font-semibold leading-tight md:text-xl">
                  {it.title}
                </h3>
                <p className="mt-1.5 text-xs text-white/85 [font-variant-numeric:tabular-nums]">
                  ${Math.round(it.total_cost_pp)} <span className="text-white/55">·</span>{' '}
                  {totalHr} hr <span className="text-white/55">·</span> {it.stops.length} stops
                </p>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Full itinerary detail view: hero + story + map + rich stop cards + actions.
// Shared between the in-flow /plan results page and the public /plan/i/[id] page
// so they stay visually identical and any change ripples to both.

import { ItineraryHero } from './ItineraryHero';
import { ItineraryMap } from './ItineraryMap';
import { StopCard } from './StopCard';
import { ItineraryActions } from './ItineraryActions';
import { ModifierCard } from './ModifierCard';
import { TIMEZONE_LABEL } from '@/lib/format';
import type { Itinerary } from '@/lib/itinerary-types';

export function ItineraryView({ itinerary }: { itinerary: Itinerary }) {
  return (
    <article>
      <ItineraryHero itinerary={itinerary} />

      <div className="mx-auto max-w-content px-6 py-16 md:px-10 md:py-20">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-[1fr_320px] md:gap-16">
          <div>
            {/* Story */}
            {itinerary.why_it_works && (
              <p className="max-w-prose text-lg leading-relaxed text-secondary md:text-xl">
                {itinerary.why_it_works}
              </p>
            )}

            {/* Wow-Factor — sits between the story and the route so it sets
                the tone before the user starts scanning stops. */}
            {itinerary.modifier && (
              <div className="mt-12">
                <ModifierCard modifier={itinerary.modifier} />
              </div>
            )}

            {/* Map */}
            <div className="mt-12">
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                The route
              </p>
              <ItineraryMap stops={itinerary.stops} />
            </div>

            {/* Timeline */}
            <div className="mt-16">
              <p className="mb-6 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                Timeline · {TIMEZONE_LABEL}
              </p>
              <ol className="space-y-10">
                {itinerary.stops.map((s, i) => (
                  <StopCard
                    key={s.place_id}
                    stop={s}
                    index={i}
                    isLast={i === itinerary.stops.length - 1}
                  />
                ))}
              </ol>
            </div>
          </div>

          {/* Side rail */}
          <aside className="md:sticky md:top-8 md:self-start">
            <div className="rounded-card border border-border bg-surface p-6 md:p-7">
              <div className="mb-6 flex flex-wrap gap-2">
                {itinerary.vibe.map((v) => (
                  <span
                    key={v}
                    className="rounded-pill border border-border bg-background px-3 py-1 text-xs text-secondary"
                  >
                    {v}
                  </span>
                ))}
              </div>
              <ItineraryActions itinerary={itinerary} />
            </div>
          </aside>
        </div>
      </div>
    </article>
  );
}

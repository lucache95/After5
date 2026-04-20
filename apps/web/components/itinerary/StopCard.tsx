import Image from 'next/image';
import { MapPin, Lightbulb, ExternalLink, Info } from 'lucide-react';
import { imageForStop } from '@/lib/place-image';
import { to12h } from '@/lib/format';
import type { Stop } from '@/lib/itinerary-types';

// Editorial stop card — image-first, then heading, then story, then chips.
// Used inside the timeline ol on the detail page.

export function StopCard({
  stop,
  index,
  isLast,
}: {
  stop: Stop;
  index: number;
  isLast: boolean;
}) {
  const img = imageForStop({ photo_url: stop.photo_url, place_type: stop.place_type });
  const directionsUrl = stop.lat && stop.lng
    ? `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.place_name + ', Kelowna BC')}`;
  // Google search gives users hours, reviews, website, menus — everything
  // they'd want to check before committing to a stop. Until we curate per-place
  // website columns this is the fastest path to "see all the info."
  const moreInfoUrl = `https://www.google.com/search?q=${encodeURIComponent(stop.place_name + ' Kelowna')}`;

  return (
    <li className="relative">
      {/* Vertical connector line behind the number */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[19px] top-12 hidden h-[calc(100%+40px)] w-px bg-border md:block"
        />
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[40px_1fr]">
        {/* Number indicator */}
        <div className="hidden md:block">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background font-display text-sm font-semibold text-text [font-variant-numeric:tabular-nums]">
            {index + 1}
          </div>
        </div>

        <article className="overflow-hidden rounded-card border border-border bg-background">
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-surface">
            <Image
              src={img}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 760px"
              className="object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-3/5 bg-gradient-to-t from-black/95 via-black/75 to-transparent"
            />
            <div className="absolute left-5 top-5 flex items-center gap-2">
              <span className="rounded-pill bg-white/95 px-3 py-1 text-xs font-medium text-text backdrop-blur-sm md:hidden">
                #{index + 1}
              </span>
              <span className="rounded-pill bg-white/95 px-3 py-1 text-xs font-medium text-text backdrop-blur-sm">
                {to12h(stop.start_time)}
              </span>
            </div>
            <div className="absolute bottom-4 left-5 right-5 text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.45)]">
              <h3 className="font-display text-xl font-semibold leading-tight md:text-2xl">
                {stop.place_name}
              </h3>
              {(stop.neighborhood || stop.place_type) && (
                <p className="mt-1 text-xs text-white/90">
                  {[stop.neighborhood, stop.place_type?.replace(/_/g, ' ')]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
            </div>
          </div>

          <div className="px-6 py-6 md:px-7 md:py-7">
            {stop.what_to_do && (
              <p className="text-base text-secondary md:text-lg">{stop.what_to_do}</p>
            )}

            {stop.local_insight && (
              <div className="mt-5 flex gap-3 rounded border border-accent/30 bg-accent-soft/60 px-4 py-3">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2} />
                <p className="text-sm leading-relaxed text-text">{stop.local_insight}</p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted [font-variant-numeric:tabular-nums]">
              <span>
                <span className="text-text">{stop.duration_min} min</span>
              </span>
              <span aria-hidden className="text-border">·</span>
              <span>
                {stop.estimated_cost_pp > 0 ? `$${Math.round(stop.estimated_cost_pp)} pp` : 'Free'}
              </span>
              {!isLast && stop.drive_to_next_min !== undefined && stop.drive_to_next_min > 0 && (
                <>
                  <span aria-hidden className="text-border">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
                    {stop.drive_to_next_min} min to next
                  </span>
                </>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={moreInfoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-background px-4 py-2 text-sm text-text transition-colors hover:border-text/40"
              >
                <Info className="h-3.5 w-3.5" strokeWidth={2} />
                More info
              </a>
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-pill border border-border bg-background px-4 py-2 text-sm text-text transition-colors hover:border-text/40"
              >
                <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
                Directions
              </a>
              {stop.reservation_required && (
                <a
                  href={stop.reservation_url ?? moreInfoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-pill bg-text px-4 py-2 text-sm text-background transition-opacity hover:opacity-85"
                >
                  Book — required
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
                </a>
              )}
            </div>
          </div>
        </article>
      </div>
    </li>
  );
}

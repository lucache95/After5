import Image from 'next/image';
import Link from 'next/link';
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
  fromHref,
}: {
  stop: Stop;
  index: number;
  isLast: boolean;
  /** When set, place links carry ?from=<href> so the place page shows a
   *  back-link to the originating plan. */
  fromHref?: string;
}) {
  const img = imageForStop({ photo_url: stop.photo_url, place_type: stop.place_type });
  const placeHref = stop.place_slug
    ? `/places/${stop.place_slug}${fromHref ? `?from=${encodeURIComponent(fromHref)}` : ''}`
    : '';
  // Always query by name (with city qualifier) so the map opens with the
  // venue card — hours, reviews, photos. Bare coords just drop a pin and
  // skip all of that. Lat/lng goes into the URL as a tiebreaker for
  // ambiguous names (mostly redundant since "X, Kelowna BC" is specific).
  const nameQuery = encodeURIComponent(`${stop.place_name}, Kelowna BC`);
  const directionsUrl = `https://www.google.com/maps/search/?api=1&query=${nameQuery}`;
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
          className="absolute left-[19px] top-12 hidden h-[calc(100%+40px)] w-px bg-shell-ink/15 md:block"
        />
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[40px_1fr]">
        {/* Number indicator */}
        <div className="hidden md:block">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-shell-accent font-heading text-sm font-semibold text-white [font-variant-numeric:tabular-nums]">
            {index + 1}
          </div>
        </div>

        <article className="overflow-hidden rounded-3xl border border-shell-ink/10 bg-shell-base shadow-fun">
          {/* Image — only the time pill overlays. Title moved BELOW so it
              never fights the photo for contrast. */}
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-shell-pink">
            <Image
              src={img}
              alt=""
              fill
              sizes="(max-width: 768px) 100vw, 760px"
              className="object-cover"
            />
            <div className="absolute left-4 top-4 flex items-center gap-2">
              <span className="rounded-full bg-shell-accent px-3 py-1 font-body text-xs font-semibold text-white backdrop-blur-sm md:hidden">
                #{index + 1}
              </span>
              <span className="rounded-full bg-white/95 px-3 py-1 font-body text-xs font-medium lowercase text-shell-ink backdrop-blur-sm">
                {to12h(stop.start_time).toLowerCase()}
              </span>
            </div>
          </div>

          <div className="px-6 py-6 md:px-7 md:py-7">
            {/* Title at the forefront — clean text on background, always readable. */}
            {stop.place_slug ? (
              <Link
                href={placeHref}
                className="group/title block transition-colors"
              >
                <h3 className="font-heading text-xl lowercase leading-tight text-shell-ink md:text-2xl group-hover/title:text-shell-accent">
                  {stop.place_name?.toLowerCase()}
                </h3>
              </Link>
            ) : (
              <h3 className="font-heading text-xl lowercase leading-tight text-shell-ink md:text-2xl">
                {stop.place_name?.toLowerCase()}
              </h3>
            )}
            {(stop.neighborhood || stop.place_type) && (
              <p className="mt-1.5 font-body text-xs lowercase tracking-[0.12em] text-shell-ink/55">
                {[stop.neighborhood, stop.place_type?.replace(/_/g, ' ')]
                  .filter(Boolean)
                  .join(' · ')
                  .toLowerCase()}
              </p>
            )}

            {stop.what_to_do && (
              <p className="mt-5 font-body text-base text-shell-ink/75 md:text-lg">{stop.what_to_do}</p>
            )}

            {stop.local_insight && (
              <div className="mt-5 flex gap-3 rounded-2xl bg-shell-pink px-4 py-3">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-shell-accent" strokeWidth={2} />
                <p className="font-body text-sm leading-relaxed text-shell-ink">{stop.local_insight}</p>
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 font-body text-sm lowercase text-shell-ink/60 [font-variant-numeric:tabular-nums]">
              <span>
                <span className="text-shell-ink">{stop.duration_min} min</span>
              </span>
              <span aria-hidden className="text-shell-ink/30">·</span>
              <span>
                {stop.estimated_cost_pp > 0 ? `$${Math.round(stop.estimated_cost_pp)} pp` : 'free'}
              </span>
              {!isLast && stop.drive_to_next_min !== undefined && stop.drive_to_next_min > 0 && (
                <>
                  <span aria-hidden className="text-shell-ink/30">·</span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
                    {stop.drive_to_next_min} min to next
                  </span>
                </>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {stop.place_slug ? (
                <Link
                  href={placeHref}
                  className="inline-flex items-center gap-1.5 rounded-full border border-shell-ink/15 bg-shell-base px-4 py-2 font-body text-sm lowercase text-shell-ink transition-colors hover:border-shell-accent/50"
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={2} />
                  about this spot
                </Link>
              ) : (
                <a
                  href={moreInfoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full border border-shell-ink/15 bg-shell-base px-4 py-2 font-body text-sm lowercase text-shell-ink transition-colors hover:border-shell-accent/50"
                >
                  <Info className="h-3.5 w-3.5" strokeWidth={2} />
                  more info
                </a>
              )}
              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-shell-ink/15 bg-shell-base px-4 py-2 font-body text-sm lowercase text-shell-ink transition-colors hover:border-shell-accent/50"
              >
                <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
                directions
              </a>
              {stop.reservation_required && (
                <a
                  href={stop.reservation_url ?? moreInfoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-full bg-shell-accent px-4 py-2 font-body text-sm lowercase text-white transition-opacity hover:opacity-85"
                >
                  book — required
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

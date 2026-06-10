// Full itinerary detail view: gallery hero + title + story + map + stops + sticky aside.
// Shared between the in-flow /plan results page and the public /dates/[slug] page
// so they stay visually identical and any change ripples to both.
//
// Airbnb-style structure:
//   1. Photo grid hero at top (1 big + up to 4 tiles)
//   2. Title + meta + action chips below the gallery
//   3. Two-column body: content (story / map / timeline) + sticky right rail

import { ItineraryGalleryHero } from './ItineraryGalleryHero';
import { ItineraryMap } from './ItineraryMap';
import { StopCard } from './StopCard';
import { ItineraryActions } from './ItineraryActions';
import { ModifierCard } from './ModifierCard';
import { AnchorNav } from './AnchorNav';
import { CuratorCard } from './CuratorCard';
import { SavePlanButton } from './SavePlanButton';
import { ThingsToKnow } from './ThingsToKnow';
import { SimilarPlans } from './SimilarPlans';
import { Polaroid } from '@/components/Polaroid';
import { coverImageFor } from '@/lib/place-image';
import { TIMEZONE_LABEL } from '@/lib/format';
import type { Itinerary } from '@/lib/itinerary-types';
import type { ItineraryStats } from '@/lib/itinerary-stats';
import type { SimilarPlanCard } from '@/lib/itinerary-similar';

export function ItineraryView({
  itinerary,
  stats,
  similar,
  fromHref,
}: {
  itinerary: Itinerary;
  stats?: ItineraryStats;
  similar?: SimilarPlanCard[];
  /** Path of the page rendering this view (e.g. /dates/abc-123) — passed
   *  through to StopCard so /places/* links carry a back-link query param. */
  fromHref?: string;
}) {
  const totalHr = Math.round((itinerary.total_duration_min / 60) * 10) / 10;

  return (
    <article>
      <ItineraryGalleryHero stops={itinerary.stops} />

      {/* Title + meta block — sits between the gallery and the two-column body.
          Mirrors Airbnb's "Entire chalet · 6 guests · 2 bedrooms" treatment.
          Floating polaroid accent on the right ties this surface to the
          /login + /account brand language. */}
      <header className="mx-auto max-w-content px-6 pt-8 md:px-10 md:pt-10">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-[1fr_auto] md:items-start md:gap-12">
          <div className="min-w-0">
            {itinerary.template_name && (
              <p className="mb-3 font-body text-[11px] font-medium lowercase tracking-[0.22em] text-shell-ink/55">
                {itinerary.template_name.toLowerCase()}
              </p>
            )}
            <h1 className="font-heading text-4xl lowercase leading-[1.02] text-shell-ink md:text-5xl lg:text-[56px]">
              {itinerary.title?.toLowerCase()}
            </h1>
            {itinerary.hook && (
              <p className="mt-5 max-w-prose font-body text-lg leading-relaxed text-shell-ink/75 md:text-xl">
                {itinerary.hook}
              </p>
            )}
          </div>

          {/* Polaroid accent — uses the wow-stop cover. Hidden on mobile to
              keep the title block scannable. */}
          <div className="hidden shrink-0 self-start md:block">
            <Polaroid
              src={coverImageFor(itinerary.stops, { itineraryCover: itinerary.cover_image_url })}
              alt={itinerary.title}
              label="tonight"
              size="md"
              rotation={5}
              tone="dating"
            />
          </div>
        </div>

        {/* Compact meta row — cost · duration · stops · vibes */}
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 font-body text-sm lowercase text-shell-ink/70 [font-variant-numeric:tabular-nums]">
          <span className="font-semibold text-shell-ink">${Math.round(itinerary.total_cost_pp)}</span>
          <span className="text-shell-ink/30">·</span>
          <span>{totalHr} hr</span>
          <span className="text-shell-ink/30">·</span>
          <span>{itinerary.stops.length} stops</span>
          {itinerary.vibe.length > 0 && (
            <>
              <span className="text-shell-ink/30">·</span>
              <div className="inline-flex flex-wrap items-center gap-1.5">
                {itinerary.vibe.slice(0, 3).map((v) => (
                  <span
                    key={v}
                    className="rounded-full bg-shell-pink px-2.5 py-0.5 font-body text-[11px] font-semibold lowercase text-shell-ink"
                  >
                    {v.toLowerCase()}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Aggregate review chips — Airbnb-style social proof. Only render
            when we actually have signal (≥3 feedbacks). Order: guest favourite
            badge first if earned, then star score, then would-do %, then top stop. */}
        {stats && stats.reviewCount >= 3 && (
          <div className="mt-5 flex flex-wrap items-center gap-2 font-body lowercase">
            {stats.isGuestFavourite && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-shell-accent px-3 py-1 text-[11px] font-semibold tracking-wide text-white">
                <span aria-hidden>★</span>
                crowd favourite
              </span>
            )}
            {stats.qualityScore !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-shell-pink px-3 py-1 text-[11px] font-semibold tracking-wide text-shell-ink [font-variant-numeric:tabular-nums]">
                <span aria-hidden className="text-shell-accent">★</span>
                {stats.qualityScore.toFixed(1)} · {stats.reviewCount} {stats.reviewCount === 1 ? 'review' : 'reviews'}
              </span>
            )}
            {stats.wouldDoPct !== null && stats.wouldDoPct >= 75 && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-shell-pink px-3 py-1 text-[11px] font-semibold tracking-wide text-shell-ink [font-variant-numeric:tabular-nums]">
                {stats.wouldDoPct}% would do this
              </span>
            )}
            {stats.topStop && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-shell-pink px-3 py-1 text-[11px] font-semibold tracking-wide text-shell-ink">
                top stop · {stats.topStop.toLowerCase()}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="mx-auto max-w-content px-6 pt-4 pb-12 md:px-10 md:pt-8 md:pb-16">
        <AnchorNav />
        <div className="mt-4 grid grid-cols-1 gap-12 md:mt-2 md:grid-cols-[1fr_360px] md:gap-14">
          <div>
            {/* Story */}
            {itinerary.why_it_works && (
              <section id="why" className="scroll-mt-24">
                <p className="mb-3 font-body text-xs font-medium lowercase tracking-[0.18em] text-shell-ink/55">
                  why this one
                </p>
                <p className="max-w-prose font-body text-base leading-relaxed text-shell-ink md:text-lg">
                  {itinerary.why_it_works}
                </p>
              </section>
            )}

            {/* Wow-Factor — sits between the story and the route so it sets
                the tone before the user starts scanning stops. */}
            {itinerary.modifier && (
              <div className="mt-12">
                <ModifierCard modifier={itinerary.modifier} />
              </div>
            )}

            {/* Map */}
            <div id="route" className="mt-12 scroll-mt-24">
              <p className="mb-4 font-body text-xs font-medium lowercase tracking-[0.18em] text-shell-ink/55">
                the route
              </p>
              <ItineraryMap stops={itinerary.stops} />
            </div>

            {/* Timeline — id anchors the gallery's "All N stops" CTA */}
            <div id="timeline" className="mt-16 scroll-mt-24">
              <p className="mb-6 font-body text-xs font-medium lowercase tracking-[0.18em] text-shell-ink/55">
                the night · {TIMEZONE_LABEL.toLowerCase()}
              </p>
              <ol className="space-y-10">
                {itinerary.stops.map((s, i) => (
                  <StopCard
                    key={s.place_id || `stop-${i}`}
                    stop={s}
                    index={i}
                    isLast={i === itinerary.stops.length - 1}
                    fromHref={fromHref}
                  />
                ))}
              </ol>
            </div>

            {/* Things to know — practical heads-up derived from stops */}
            <div className="mt-16">
              <ThingsToKnow itinerary={itinerary} />
            </div>

            {/* More like this — sibling plans on the same template */}
            {similar && similar.length > 0 && (
              <div className="mt-16">
                <SimilarPlans plans={similar} />
              </div>
            )}
          </div>

          {/* Sticky right rail — Airbnb's reserve card analog. Floats while
              the user scrolls so the primary actions never disappear. */}
          <aside className="md:sticky md:top-6 md:self-start">
            <div className="rounded-3xl border border-shell-ink/10 bg-shell-base p-6 shadow-fun md:p-7">
              {/* Headline mirrors the price-first treatment of Airbnb's card */}
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-heading text-3xl lowercase leading-none text-shell-ink [font-variant-numeric:tabular-nums]">
                  ${Math.round(itinerary.total_cost_pp)}
                  <span className="ml-1.5 font-body text-sm font-normal text-shell-ink/70">/ pp</span>
                </p>
                <p className="font-body text-xs font-medium lowercase tracking-[0.16em] text-shell-ink/55">
                  {totalHr} hr
                </p>
              </div>

              <div className="mt-2 font-body text-xs lowercase text-shell-ink/70">
                final price depends on what you order. these are mid-range guesses.
              </div>

              {/* Save toggle — first action so it sits highest. Auth-aware:
                  unauthed clicks bounce through /login and auto-save on return. */}
              {itinerary.id && (
                <div className="mt-5">
                  <SavePlanButton itineraryId={itinerary.id} />
                </div>
              )}

              <div className="mt-3 border-t border-shell-ink/10 pt-5">
                <ItineraryActions itinerary={itinerary} />
              </div>

              {/* Reassurance line — Airbnb's "you won't be charged yet" analog */}
              <p className="mt-4 text-center font-body text-[11px] lowercase text-shell-ink/55">
                free to view · no booking · no fees
              </p>
            </div>

            <div className="mt-5">
              <CuratorCard />
            </div>
          </aside>
        </div>
      </div>
    </article>
  );
}

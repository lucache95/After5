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
              <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted">
                {itinerary.template_name} · Kelowna
              </p>
            )}
            <h1 className="font-display text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-text md:text-5xl lg:text-[56px]">
              {itinerary.title}
            </h1>
            {itinerary.hook && (
              <p className="mt-5 max-w-prose text-lg leading-relaxed text-secondary md:text-xl">
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
              label="KELOWNA · 26"
              size="md"
              rotation={5}
            />
          </div>
        </div>

        {/* Compact meta row — cost · duration · stops · vibes */}
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-secondary [font-variant-numeric:tabular-nums]">
          <span className="font-medium text-text">${Math.round(itinerary.total_cost_pp)}</span>
          <span className="text-border">·</span>
          <span>{totalHr} hr</span>
          <span className="text-border">·</span>
          <span>{itinerary.stops.length} stops</span>
          {itinerary.vibe.length > 0 && (
            <>
              <span className="text-border">·</span>
              <div className="inline-flex flex-wrap items-center gap-1.5">
                {itinerary.vibe.slice(0, 3).map((v) => (
                  <span
                    key={v}
                    className="rounded-pill bg-surface px-2.5 py-0.5 text-[11px] font-medium text-secondary"
                  >
                    {v}
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
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {stats.isGuestFavourite && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-amber-100 px-3 py-1 text-[11px] font-semibold tracking-wide text-amber-950 ring-1 ring-amber-200">
                <span aria-hidden>★</span>
                Guest favourite
              </span>
            )}
            {stats.qualityScore !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-surface px-3 py-1 text-[11px] font-semibold tracking-wide text-text ring-1 ring-border [font-variant-numeric:tabular-nums]">
                <span aria-hidden className="text-amber-600">★</span>
                {stats.qualityScore.toFixed(1)} · {stats.reviewCount} {stats.reviewCount === 1 ? 'review' : 'reviews'}
              </span>
            )}
            {stats.wouldDoPct !== null && stats.wouldDoPct >= 75 && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-emerald-50 px-3 py-1 text-[11px] font-semibold tracking-wide text-emerald-900 ring-1 ring-emerald-200 [font-variant-numeric:tabular-nums]">
                {stats.wouldDoPct}% would do this
              </span>
            )}
            {stats.topStop && (
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-rose-50 px-3 py-1 text-[11px] font-semibold tracking-wide text-rose-900 ring-1 ring-rose-200">
                Top stop · {stats.topStop}
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
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                  Why this works
                </p>
                <p className="max-w-prose text-base leading-relaxed text-text md:text-lg">
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
              <p className="mb-4 text-xs font-medium uppercase tracking-[0.18em] text-muted">
                The route
              </p>
              <ItineraryMap stops={itinerary.stops} />
            </div>

            {/* Timeline — id anchors the gallery's "All N stops" CTA */}
            <div id="timeline" className="mt-16 scroll-mt-24">
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
            <div className="rounded-[16px] border border-border bg-background p-6 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.12)] md:p-7">
              {/* Headline mirrors the price-first treatment of Airbnb's card */}
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-display text-2xl font-bold leading-none text-text [font-variant-numeric:tabular-nums]">
                  ${Math.round(itinerary.total_cost_pp)}
                  <span className="ml-1.5 text-sm font-normal text-secondary">/ pp</span>
                </p>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted">
                  {totalHr} hr
                </p>
              </div>

              <div className="mt-2 text-xs text-secondary">
                Final price depends on what you order. We use mid-range estimates.
              </div>

              {/* Save toggle — first action so it sits highest. Auth-aware:
                  unauthed clicks bounce through /login and auto-save on return. */}
              {itinerary.id && (
                <div className="mt-5">
                  <SavePlanButton itineraryId={itinerary.id} />
                </div>
              )}

              <div className="mt-3 border-t border-border pt-5">
                <ItineraryActions itinerary={itinerary} />
              </div>

              {/* Reassurance line — Airbnb's "you won't be charged yet" analog */}
              <p className="mt-4 text-center text-[11px] text-muted">
                Free to view · No booking · No fees
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

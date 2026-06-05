'use client';
import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { MapPin } from 'lucide-react';
import { imageForStop } from '@/lib/place-image';
import { type NightDetailStop } from '@/lib/after5/client';
import { LocalTime } from '@/components/LocalTime';

// Shared blind-safe stop timeline, extracted verbatim from feed/NightDetailSheet so
// the feed sheet, OfferDetail, and LockDetail all render an IDENTICAL plan (no fork,
// no drift — D-12). It renders ONLY blind-safe fields: numbered photo thumb + dashed
// connector + name + "neighborhood · type · time" + one-line desc w/ "more" + "$ pp" +
// a coord (else name-query) map link. Do NOT swap in components/itinerary/StopCard.tsx
// — it links /places/[slug] (identity-bearing) and is wrong for offer/match. The StopRow
// shape is already blind-safe and renders fine whether identity is hidden (pre-swipe) or
// revealed (post-lock) — no reveal-ordering change (D-07).
//
// E20 (REQ-E20): the per-stop "map" link deep-links coordinates when the stop carries
// lat/lng (else the legacy name search). E21 (REQ-E21 / D-01): the stop NAME may link
// to /places/[slug], but ONLY when the caller opts in via `linkSlugs` (default OFF) AND
// the stop has a catalog slug. The blind feed sheet + offer surfaces MUST leave
// `linkSlugs` off so venue identity never leaks (T-07-12); only the post-lock LockDetail
// sets it true. A stop with no slug degrades to plain text — never a broken /places link.

// Hour-truncated, lowercase local time for a stop — blind-safe (never minute-
// precise) and tiny, e.g. "7pm". Returns a <LocalTime> so it stays SSR-safe.
function StopTime({ iso }: { iso: string | null }) {
  if (!iso) return null;
  // Stop start_time can arrive as a bare "HH:MM" clock string (legacy seed
  // shape) or a full ISO datetime. Normalize a bare clock to a parseable ISO.
  const isoish = /^\d{1,2}:\d{2}/.test(iso) ? `1970-01-01T${iso.length === 4 ? '0' : ''}${iso}` : iso;
  return (
    <LocalTime
      iso={isoish}
      format={(d) => d.toLocaleTimeString('en-US', { hour: 'numeric' }).toLowerCase().replace(/\s/g, '')}
      fallback=""
    />
  );
}

// Blind-safe timeline stop: numbered photo thumb + name + "neighborhood · type ·
// time" + a one-line desc with "more" + "$ pp" + a name-query "map" link. NO slug
// link, NO reservation_url — the RPC already scrubbed identity vectors. A dashed
// connector links each stop to the next, so the column reads as a route.
function StopRow({
  stop, index, last, accent, vibeTags, linkSlugs,
}: {
  stop: NightDetailStop; index: number; last: boolean; accent: string;
  vibeTags: string[] | null; linkSlugs: boolean;
}) {
  const [open, setOpen] = useState(false);
  // E20: deep-link the stop's coordinates when present, else fall back to the legacy
  // name text-search. Label/icon/target are unchanged.
  const directions =
    stop.lat != null && stop.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${stop.lat},${stop.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
  // E21 / D-01: opt-in /places link. Only when the caller passes linkSlugs AND the stop
  // has a catalog slug; otherwise the name is plain text (blind contract + graceful degrade).
  const slugHref = linkSlugs && stop.place_slug ? `/places/${stop.place_slug}` : null;
  // Per-stop thumbnail — real photo when present, else a type/vibe mood shot.
  // Never an empty src; imageForStop always returns a shipped local asset (#77).
  const thumb = imageForStop({
    photo_url: stop.photo_url,
    place_type: stop.type,
    vibe_tags: vibeTags,
    seedKey: stop.name,
  });
  const desc = stop.what_to_do?.trim() ?? '';
  const DESC_LIMIT = 90;
  const descLong = desc.length > DESC_LIMIT;
  const descShown = open || !descLong ? desc : `${desc.slice(0, DESC_LIMIT).trimEnd()}…`;
  const meta = [stop.neighborhood, stop.type?.replace(/_/g, ' ')].filter(Boolean).join(' · ').toLowerCase();

  return (
    <li className="flex gap-3">
      {/* rail: numbered thumb + dashed connector to the next stop */}
      <div className="flex shrink-0 flex-col items-center">
        <div className="relative h-16 w-16 overflow-hidden rounded-2xl bg-shell-pink">
          <Image src={thumb} alt="" fill sizes="64px" className="object-cover" draggable={false} />
          <span
            className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full font-body text-[11px] font-bold text-white ring-2 ring-white"
            style={{ background: accent }}
          >
            {index + 1}
          </span>
        </div>
        {!last && <span className="my-1 w-0 flex-1 border-l-2 border-dashed border-shell-accent/30" aria-hidden />}
      </div>

      <div className="min-w-0 flex-1 pb-4">
        {slugHref ? (
          <Link
            href={slugHref}
            className="font-heading text-lg lowercase leading-tight text-shell-ink underline decoration-shell-accent/40 decoration-2 underline-offset-4"
          >
            {stop.name.toLowerCase()}
          </Link>
        ) : (
          <p className="font-heading text-lg lowercase leading-tight text-shell-ink">{stop.name.toLowerCase()}</p>
        )}
        {(meta || stop.start_time) && (
          <p className="mt-0.5 flex flex-wrap items-center gap-1 font-body text-[11px] lowercase tracking-[0.06em] text-shell-ink/55">
            {meta}
            {stop.start_time && (
              <>
                {meta && <span aria-hidden>·</span>}
                <StopTime iso={stop.start_time} />
              </>
            )}
          </p>
        )}
        {desc && (
          <p className="mt-1.5 font-body text-[13px] leading-snug text-shell-ink/85">
            {descShown}
            {descLong && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="ml-1 font-bold text-shell-accent underline decoration-2 underline-offset-2"
              >
                {open ? 'less' : 'more'}
              </button>
            )}
          </p>
        )}
        {stop.local_insight && open && (
          <p className="mt-1.5 font-body text-[12px] leading-snug text-shell-ink/65">tip: {stop.local_insight}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs font-semibold text-shell-ink/75">
          {stop.cost_pp != null && (
            <span className="text-shell-accent">{stop.cost_pp > 0 ? `$${Math.round(stop.cost_pp)} pp` : 'free'}</span>
          )}
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-shell-ink/75 underline decoration-2 underline-offset-2"
          >
            <MapPin className="h-3 w-3" aria-hidden /> map
          </a>
        </div>
      </div>
    </li>
  );
}

/**
 * The canonical blind-safe stop timeline: an <ol> of numbered StopRows. Shared by
 * the feed NightDetailSheet, OfferDetail, and LockDetail so every screen renders an
 * identical plan. Pass the vibe-derived `accent` (from `vibePalette(vibeTags).accent`).
 * `stops` must already be normalized `NightDetailStop`s — callers that read raw
 * `itineraries.stops` JSON (rich/thin shape drift) normalize via
 * `normalizeNightDetailStops` BEFORE passing them in (E13 loaders + `get_night_detail`
 * both do). An empty array renders nothing (the caller owns its degrade/empty copy).
 *
 * `linkSlugs` (default false) is the E21 / D-01 opt-in: when true, a stop with a catalog
 * `place_slug` renders its name as a `/places/[slug]` link. It MUST stay false on the blind
 * feed sheet + offer surfaces (venue identity must not leak — T-07-12); only the post-lock
 * LockDetail passes `linkSlugs`.
 */
export function PlanTimeline({
  stops, accent, vibeTags, linkSlugs = false,
}: {
  stops: NightDetailStop[];
  accent: string;
  vibeTags: string[] | null;
  linkSlugs?: boolean;
}) {
  if (stops.length === 0) return null;
  return (
    <ol className="flex flex-col">
      {stops.map((s, idx) => (
        <StopRow
          key={`${s.name}-${idx}`}
          stop={s}
          index={idx}
          last={idx === stops.length - 1}
          accent={accent}
          vibeTags={vibeTags}
          linkSlugs={linkSlugs}
        />
      ))}
    </ol>
  );
}

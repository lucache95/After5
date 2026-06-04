'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { MapPin, Clock, Wallet } from 'lucide-react';
import { vibePalette } from '@after5/business';
import { stickerRotation } from '@/lib/sticker';
import { coverImageForNight } from '@/lib/place-image';
import { formatDistanceAway, formatReach } from '@/lib/distance';
import type { FeedNight } from '@/lib/after5/client';
import { LocalTime } from '@/components/LocalTime';

// Tier-2 experience surface (DESIGN-SYSTEM §1/§5): the PHOTOGRAPH leads. The cover
// fills the card behind a bottom scrim; the title sits on the scrim. The card
// still carries the experience's vibe palette (from vibe_tags via vibePalette())
// for the chips + accents, applied as inline CSS vars.
// BLIND CONTRACT: FeedNight has no creator identity and we never render one. The
// meta row stays coarse — weekday + hour bucket, city/area, rounded distance and
// reach radius — never a precise minute or address.

// Coarse, blind-by-design time: weekday + hour bucket only. Never a precise minute.
function coarseTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const hour = d.toLocaleTimeString('en-US', { hour: 'numeric' }).toLowerCase().replace(/\s/g, '');
  return `${weekday} · ${hour}`;
}

// Back-compat km helper (kept for callers/tests that imported it from here).
function km(distanceM: number | null): string | null {
  return formatDistanceAway(distanceM);
}

// The feed RPC doesn't expose a human city name or this date's reach radius yet
// (FeedNight carries only city_id + distance_m — see report's gated follow-up).
// Read them defensively so the card lights up the moment the RPC adds them,
// without changing the contract today.
type MaybeGeoFields = { city_name?: string | null; reach_radius_km?: number | null };

export function NightCard({ night }: { night: FeedNight }) {
  const pal = vibePalette(night.vibe_tags);
  const tags = (night.vibe_tags ?? []).filter(Boolean).slice(0, 4);

  // Locale-aware distance + reach. Resolve on the client after mount so SSR and
  // hydration agree (the server has no viewer locale); pre-mount uses the km
  // default, which the post-mount value then reconciles.
  const [locale, setLocale] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (typeof navigator !== 'undefined') setLocale(navigator.language);
  }, []);

  const distance = formatDistanceAway(night.distance_m, locale);
  const geo = night as FeedNight & MaybeGeoFields;
  const city = geo.city_name?.trim().toLowerCase() || night.venue_neighborhood?.toLowerCase() || null;
  const reach = formatReach(geo.reach_radius_km ?? null, locale);

  // Always resolve to a tasteful, on-theme image — never an empty pink panel.
  const cover = coverImageForNight({
    cover_image_url: night.cover_image_url,
    vibe_tags: night.vibe_tags,
    seedKey: night.date_instance_id ?? night.title,
  });

  return (
    <article
      className="relative flex h-full flex-col overflow-hidden rounded-3xl bg-[var(--exp-bg)] text-[var(--exp-ink)] shadow-fun"
      style={
        {
          '--exp-bg': pal.bg,
          '--exp-accent': pal.accent,
          '--exp-ink': pal.ink,
        } as React.CSSProperties
      }
    >
      {/* PHOTO LEADS — full-bleed cover behind a bottom scrim (DESIGN-SYSTEM §5). */}
      <Image
        src={cover}
        alt=""
        fill
        sizes="420px"
        className="object-cover"
        draggable={false}
        priority
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 38%, rgba(0,0,0,0.78) 100%)' }}
        aria-hidden
      />

      {night.is_seed && (
        <span
          className="absolute left-3 top-3 rounded-full px-3 py-1 font-body text-xs font-semibold text-white shadow-md"
          style={{ background: pal.accent, transform: `rotate(${stickerRotation('curated')}deg)` }}
        >
          ★ curated
        </span>
      )}

      {/* CONTENT — sits on the scrim, pinned to the bottom of the photo. */}
      <div className="relative mt-auto flex flex-col gap-2.5 p-5 text-white">
        {/* E10/D-03 fit pill: a quiet, flattering targeting signal. Renders ONLY when
            FeedNight.fit is true — never a score, never on a non-matching card. accent
            text on white/85 so it reads on any vibe photo without fighting the palette
            (the pill is one of accent's few reserved uses). Static, not actionable. */}
        {night.fit === true && (
          <p className="w-fit rounded-full bg-white/85 px-3 py-1 font-body text-[13px] font-semibold lowercase text-shell-accent shadow-md">
            <span aria-hidden>✨ </span>looks for someone like you
          </p>
        )}

        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li
                key={tag}
                className="rounded-full px-3 py-1 font-body text-xs font-semibold shadow-md"
                style={{
                  background: pal.accent,
                  color: pal.bg,
                  transform: `rotate(${stickerRotation(tag)}deg)`,
                }}
              >
                {tag.toLowerCase()}
              </li>
            ))}
          </ul>
        )}

        <h2 className="font-heading text-3xl lowercase leading-[1.02] drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
          {night.title?.toLowerCase() ?? 'a night out'}
        </h2>

        {night.why_note && (
          <p className="line-clamp-2 font-body text-[15px] leading-snug text-white/85">
            {night.why_note}
          </p>
        )}

        <dl className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-0.5 font-body text-[13px] text-white/90">
          {night.time_window_start && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4 shrink-0" aria-hidden />
              <dt className="sr-only">when</dt>
              <dd>
                <LocalTime
                  iso={night.time_window_start}
                  format={(d) => {
                    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                    const hour = d.toLocaleTimeString('en-US', { hour: 'numeric' }).toLowerCase().replace(/\s/g, '');
                    return `${weekday} · ${hour}`;
                  }}
                  fallback=""
                />
              </dd>
            </div>
          )}
          {city && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              <dt className="sr-only">where</dt>
              <dd>{city}</dd>
            </div>
          )}
          {(distance || reach) && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">{reach ? 'distance and reach' : 'distance'}</dt>
              <dd>{[distance, reach].filter(Boolean).join(' · ')}</dd>
            </div>
          )}
          {night.pay_setting && (
            <div className="flex items-center gap-1.5">
              <Wallet className="h-4 w-4 shrink-0" aria-hidden />
              <dt className="sr-only">who pays</dt>
              <dd>{night.pay_setting.toLowerCase()}</dd>
            </div>
          )}
        </dl>
      </div>
    </article>
  );
}

export { coarseTime, km };

'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Drawer } from 'vaul';
import { MapPin, Clock, Wallet, Heart, X } from 'lucide-react';
import { vibePalette } from '@after5/business';
import { stickerRotation } from '@/lib/sticker';
import { coverImageForNight, imageForStop } from '@/lib/place-image';
import {
  browserAfter5Client, getNightDetail,
  type FeedNight, type NightDetailNight, type NightDetailStop,
} from '@/lib/after5/client';
import { LocalTime } from '@/components/LocalTime';
import { cn } from '@/lib/cn';

// Pre-swipe DATE DETAIL (DESIGN-SYSTEM §4 "ExperienceDetail" branch).
// A vaul bottom-sheet that opens when the swiper TAPS the active card, so they
// can read the full plan before deciding — then swipe right/left from inside.
//
// BLIND CONTRACT (matches the feed's existing model): this renders ONLY the
// blind-safe fields. There is NO host name, NO host photo, NO precise venue
// address, NO minute-precise time — same projection browse_feed_for_viewer
// already exposes. We show the DATE, not the person.
//
// On open, the sheet fetches get_night_detail(p_instance) (the blind-safe FULL
// detail RPC, shipped in migration 20260601210000) and renders the real
// itinerary: the stops timeline, total cost, and the story. The RPC scrubs any
// per-stop reservation_url and never returns itinerary_id/creator_id/venue_id,
// so identity stays hidden. The blind FeedNight summary renders immediately as
// the instant fallback while detail loads (or if the fetch fails).

function km(distanceM: number | null): string | null {
  if (distanceM == null) return null;
  const value = distanceM / 1000;
  return value < 1
    ? `${Math.max(0.1, Math.round(value * 10) / 10)} km away`
    : `${Math.round(value)} km away`;
}

export function NightDetailSheet({
  night,
  open,
  busy,
  onOpenChange,
  onCommit,
}: {
  night: FeedNight | null;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (direction: 'left' | 'right') => void;
}) {
  const [detail, setDetail] = useState<NightDetailNight | null>(null);
  const instanceId = night?.date_instance_id ?? null;

  useEffect(() => {
    if (!open || !instanceId) return;
    let cancelled = false;
    setDetail(null);
    getNightDetail(browserAfter5Client(), instanceId)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((err) => {
        // Fall back to the blind summary, but log so a broken RPC doesn't degrade silently in prod.
        // eslint-disable-next-line no-console
        console.warn('[night-detail] get_night_detail failed; showing blind summary', err);
        if (!cancelled) setDetail(null);
      });
    return () => { cancelled = true; };
  }, [open, instanceId]);

  if (!night) return null;
  const pal = vibePalette(night.vibe_tags);
  const distance = km(night.distance_m);
  const tags = (night.vibe_tags ?? []).filter(Boolean);
  // Always resolve to a tasteful, on-theme hero. Once the detail RPC lands we
  // can upgrade to a real stop photo; until then the vibe/lifestyle fallback
  // keeps the hero from showing an empty pink panel.
  const cover = coverImageForNight({
    cover_image_url: night.cover_image_url,
    vibe_tags: night.vibe_tags,
    stops: detail?.stops.map((s) => ({ photo_url: s.photo_url, place_type: s.type })) ?? null,
    seedKey: night.date_instance_id ?? night.title,
  });

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[420px] flex-col rounded-t-3xl bg-[var(--exp-bg)] text-[var(--exp-ink)] shadow-fun outline-none"
          style={
            {
              '--exp-bg': pal.bg,
              '--exp-accent': pal.accent,
              '--exp-ink': pal.ink,
            } as React.CSSProperties
          }
        >
          {/* grab handle */}
          <div className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-current opacity-30" aria-hidden />

          <Drawer.Title className="sr-only">
            {night.title ?? 'a night out'} — full date detail
          </Drawer.Title>
          <Drawer.Description className="sr-only">
            read the full plan, then swipe to decide. the host stays anonymous until you match.
          </Drawer.Description>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--exp-accent)]/15">
              <Image
                src={cover}
                alt=""
                fill
                sizes="420px"
                className="object-cover"
                draggable={false}
              />
              {night.is_seed && (
                <span
                  className="absolute left-3 top-3 rounded-full px-3 py-1 font-body text-xs font-semibold shadow-md"
                  style={{ background: pal.accent, color: pal.bg, transform: `rotate(${stickerRotation('curated')}deg)` }}
                >
                  ★ curated
                </span>
              )}
            </div>

            <div className="flex flex-col gap-4 p-5 pb-6">
              <h2 className="font-heading text-4xl lowercase leading-[1.02]">
                {night.title?.toLowerCase() ?? 'a night out'}
              </h2>

              {night.why_note && (
                <div>
                  <p className="mb-1 font-body text-xs lowercase tracking-[0.14em] opacity-60">
                    the why
                  </p>
                  <p className="font-body text-[16px] leading-relaxed opacity-90">{night.why_note}</p>
                </div>
              )}

              {tags.length > 0 && (
                <div>
                  <p className="mb-2 font-body text-xs lowercase tracking-[0.14em] opacity-60">
                    the vibe
                  </p>
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
                </div>
              )}

              <div>
                <p className="mb-2 font-body text-xs lowercase tracking-[0.14em] opacity-60">
                  the plan
                </p>
                <dl className="flex flex-col gap-2.5 font-body text-[15px] opacity-90">
                  {night.time_window_start && (
                    <div className="flex items-center gap-2.5">
                      <Clock className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                      <dt className="sr-only">when</dt>
                      <dd>
                        <LocalTime
                          iso={night.time_window_start}
                          format={(d) => {
                            const weekday = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
                            const hour = d
                              .toLocaleTimeString('en-US', { hour: 'numeric' })
                              .toLowerCase()
                              .replace(/\s/g, '');
                            return `${weekday} · around ${hour}`;
                          }}
                          fallback=""
                        />
                      </dd>
                    </div>
                  )}
                  {night.venue_neighborhood && (
                    <div className="flex items-center gap-2.5">
                      <MapPin className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                      <dt className="sr-only">where</dt>
                      <dd>
                        {night.venue_neighborhood.toLowerCase()}
                        {distance ? ` · ${distance}` : ''}
                      </dd>
                    </div>
                  )}
                  {night.pay_setting && (
                    <div className="flex items-center gap-2.5">
                      <Wallet className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                      <dt className="sr-only">who pays</dt>
                      <dd>{night.pay_setting.toLowerCase()}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {detail && (
                <>
                  {(detail.why_it_works || detail.hook) && (
                    <div>
                      <p className="mb-1 font-body text-xs lowercase tracking-[0.14em] opacity-60">
                        the story
                      </p>
                      <p className="font-body text-[16px] leading-relaxed opacity-90">
                        {(detail.why_it_works ?? detail.hook ?? '').toLowerCase()}
                      </p>
                    </div>
                  )}

                  {detail.stops.length > 0 && (
                    <div>
                      <p className="mb-2 font-body text-xs lowercase tracking-[0.14em] opacity-60">
                        the night
                      </p>
                      <ol className="flex flex-col gap-3">
                        {detail.stops.map((s, idx) => (
                          <StopRow
                            key={`${s.name}-${idx}`}
                            stop={s}
                            index={idx}
                            accent={pal.accent}
                            bg={pal.bg}
                            vibeTags={night.vibe_tags}
                          />
                        ))}
                      </ol>
                    </div>
                  )}

                  {detail.total_cost_pp != null && detail.total_cost_pp > 0 && (
                    <div className="flex items-center gap-2.5 font-body text-[15px] opacity-90">
                      <Wallet className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                      <span>around ${Math.round(detail.total_cost_pp)} each</span>
                    </div>
                  )}
                </>
              )}

              {/* Blind reassurance — sets the expectation that identity stays hidden. */}
              <p className="font-body text-[13px] leading-relaxed opacity-60">
                you’re swiping on the night, not the person. who’s hosting stays a
                secret until you both match.
              </p>
            </div>
          </div>

          {/* Swipe actions — decide after reading. Mirrors the deck buttons. */}
          <div className="flex shrink-0 items-center justify-center gap-6 border-t border-current/10 bg-[var(--exp-bg)] px-5 py-4">
            <button
              type="button"
              onClick={() => onCommit('left')}
              disabled={busy}
              aria-label="nope, pass on this one"
              className={cn(
                'flex h-14 w-14 items-center justify-center rounded-full bg-white text-shell-ink shadow-fun transition',
                'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-ink/50',
                'motion-reduce:transition-none motion-reduce:hover:scale-100',
                busy && 'opacity-50',
              )}
            >
              <X className="h-6 w-6" strokeWidth={2.5} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => onCommit('right')}
              disabled={busy}
              aria-label="interested — slide this onto my list"
              className={cn(
                'flex h-14 w-14 items-center justify-center rounded-full bg-shell-accent text-white shadow-fun transition',
                'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                'motion-reduce:transition-none motion-reduce:hover:scale-100',
                busy && 'opacity-50',
              )}
            >
              <Heart className="h-6 w-6" strokeWidth={2.5} fill="currentColor" aria-hidden />
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// Blind-safe stop renderer: name, type, what_to_do, cost, local insight, and a
// name-query "map" link (same pattern the public StopCard uses). NO slug link,
// NO reservation_url — the RPC already scrubbed identity vectors.
function StopRow({
  stop, index, accent, bg, vibeTags,
}: {
  stop: NightDetailStop; index: number; accent: string; bg: string;
  vibeTags: string[] | null;
}) {
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
  // Per-stop thumbnail — real photo when present, else a type/vibe mood shot.
  // Never an empty src; imageForStop always returns a shipped local asset.
  const thumb = imageForStop({
    photo_url: stop.photo_url,
    place_type: stop.type,
    vibe_tags: vibeTags,
    seedKey: stop.name,
  });
  return (
    <li className="relative flex gap-3 rounded-2xl bg-current/5 p-3">
      <span
        className="absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full font-heading text-xs shadow-md"
        style={{ background: accent, color: bg }}
      >
        {index + 1}
      </span>
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-current/10">
        <Image
          src={thumb}
          alt=""
          fill
          sizes="64px"
          className="object-cover"
          draggable={false}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-heading text-lg lowercase leading-tight">{stop.name.toLowerCase()}</p>
        {(stop.neighborhood || stop.type) && (
          <p className="mt-0.5 font-body text-xs lowercase tracking-[0.1em] opacity-55">
            {[stop.neighborhood, stop.type?.replace(/_/g, ' ')].filter(Boolean).join(' · ').toLowerCase()}
          </p>
        )}
        {stop.what_to_do && (
          <p className="mt-2 font-body text-[14px] leading-relaxed opacity-85">{stop.what_to_do}</p>
        )}
        {stop.local_insight && (
          <p className="mt-2 font-body text-[13px] leading-relaxed opacity-70">
            tip: {stop.local_insight}
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs opacity-70">
          {stop.cost_pp != null && (
            <span>{stop.cost_pp > 0 ? `$${Math.round(stop.cost_pp)} pp` : 'free'}</span>
          )}
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline decoration-2 underline-offset-2"
          >
            <MapPin className="h-3 w-3" aria-hidden /> map
          </a>
        </div>
      </div>
    </li>
  );
}

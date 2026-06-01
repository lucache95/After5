'use client';
import Image from 'next/image';
import { Drawer } from 'vaul';
import { MapPin, Clock, Wallet, Sparkles, Heart, X } from 'lucide-react';
import { vibePalette } from '@after5/business';
import { stickerRotation } from '@/lib/sticker';
import type { FeedNight } from '@/lib/after5/client';
import { LocalTime } from '@/components/LocalTime';
import { cn } from '@/lib/cn';

// Pre-swipe DATE DETAIL (DESIGN-SYSTEM §4 "ExperienceDetail" branch).
// A vaul bottom-sheet that opens when the swiper TAPS the active card, so they
// can read the full plan before deciding — then swipe right/left from inside.
//
// BLIND CONTRACT (matches the feed's existing model): this renders ONLY the
// blind-safe FeedNight fields. There is NO host name, NO host photo, NO precise
// venue address, NO minute-precise time — same projection browse_feed_for_viewer
// already exposes. We show the DATE, not the person.
//
// DATA NOTE: FeedNight carries no per-stop list / cost / story today (the feed
// RPC returns the thin projection only). Full stop-level detail needs a
// blind-safe `get_night_detail(p_instance)` RPC — flagged as a GATED prod
// migration, NOT invented here. This sheet shows the maximum the existing
// blind data path allows.

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
  if (!night) return null;
  const pal = vibePalette(night.vibe_tags);
  const distance = km(night.distance_m);
  const tags = (night.vibe_tags ?? []).filter(Boolean);

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
              {night.cover_image_url ? (
                <Image
                  src={night.cover_image_url}
                  alt=""
                  fill
                  sizes="420px"
                  className="object-cover"
                  draggable={false}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Sparkles className="h-10 w-10 opacity-30" style={{ color: pal.accent }} aria-hidden />
                </div>
              )}
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

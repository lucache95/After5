'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Drawer } from 'vaul';
import { MapPin, Clock, Wallet, Heart, X, Music, Users, Sparkles, Route } from 'lucide-react';
import { vibePalette } from '@after5/business';
import { stickerRotation } from '@/lib/sticker';
import { coverImageForNight, imageForStop } from '@/lib/place-image';
import {
  browserAfter5Client, getNightDetail,
  type FeedNight, type NightDetailNight, type NightDetailStop,
} from '@/lib/after5/client';
import { LocalTime } from '@/components/LocalTime';
import { cn } from '@/lib/cn';

// Pre-swipe DATE DETAIL (DESIGN-SYSTEM §4 "ExperienceDetail" branch), redesigned
// to SELL the night instead of reading like a wall of text (#80):
//   full-bleed hero (cover + scrim + title overlay + curated badge + soundtrack)
//   → scannable chip row (when · distance · $pp · who-pays · vibe · duration·stops)
//   → one-line italic hook with "more"
//   → "the night" as a visual TIMELINE (photo thumb + name + meta + desc + $ + map)
//   → route mini-map placeholder
//   → sticky skip / i'm-in CTA.
//
// BLIND CONTRACT (matches the feed's existing model): this renders ONLY the
// blind-safe fields. There is NO host name, NO host photo, NO precise venue
// address, NO minute-precise time — same projection browse_feed_for_viewer
// already exposes, and get_night_detail scrubs reservation_url and never returns
// itinerary_id/creator_id/venue_id. We show the DATE, not the person. This
// redesign changes presentation only; the data contract is untouched.
//
// On open the sheet fetches get_night_detail(p_instance) (the blind-safe FULL
// detail RPC) and renders the real itinerary. The blind FeedNight summary
// renders immediately as the instant fallback while detail loads (or if it fails).

function km(distanceM: number | null): string | null {
  if (distanceM == null) return null;
  const value = distanceM / 1000;
  return value < 1
    ? `${Math.max(0.1, Math.round(value * 10) / 10)} km away`
    : `${Math.round(value)} km away`;
}

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

// A pill chip in the scannable fact row. Icon + short lowercase value.
function Chip({
  icon, children, tone = 'plain',
}: {
  icon: React.ReactNode; children: React.ReactNode; tone?: 'plain' | 'pay';
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-body text-xs font-semibold lowercase',
        tone === 'pay'
          ? 'bg-shell-pink text-shell-accent'
          : 'bg-white/90 text-shell-ink ring-1 ring-shell-ink/10',
      )}
    >
      <span className="opacity-70" aria-hidden>{icon}</span>
      {children}
    </span>
  );
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
  const [hookOpen, setHookOpen] = useState(false);
  const instanceId = night?.date_instance_id ?? null;

  useEffect(() => {
    if (!open || !instanceId) return;
    let cancelled = false;
    setDetail(null);
    setHookOpen(false);
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
  const stops = detail?.stops ?? [];

  // Always resolve to a tasteful, on-theme hero (#77 — never an empty src).
  const cover = coverImageForNight({
    cover_image_url: night.cover_image_url,
    vibe_tags: night.vibe_tags,
    stops: stops.map((s) => ({ photo_url: s.photo_url, place_type: s.type })),
    seedKey: night.date_instance_id ?? night.title,
  });

  // The one-line hook that sells the night. Prefer the authored hook, then
  // why_it_works, then why_note. Trimmed to a punchy line; "more" expands it.
  const hookText = (detail?.hook ?? detail?.why_it_works ?? night.why_note ?? '').trim();
  const HOOK_LIMIT = 120;
  const hookLong = hookText.length > HOOK_LIMIT;
  const hookShown = hookOpen || !hookLong ? hookText : `${hookText.slice(0, HOOK_LIMIT).trimEnd()}…`;

  // Total $ per person and the duration·stops summary for the chip row.
  const totalPp = detail?.total_cost_pp != null && detail.total_cost_pp > 0
    ? Math.round(detail.total_cost_pp) : null;
  const durHrs = detail?.total_duration_min != null && detail.total_duration_min > 0
    ? Math.round(detail.total_duration_min / 60) : null;

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-shell-ink/40" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[92dvh] w-full max-w-[420px] flex-col overflow-hidden rounded-t-3xl bg-shell-base text-shell-ink shadow-fun outline-none"
        >
          <Drawer.Title className="sr-only">
            {night.title ?? 'a night out'} — full date detail
          </Drawer.Title>
          <Drawer.Description className="sr-only">
            read the full plan, then swipe to decide. the host stays anonymous until you match.
          </Drawer.Description>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* HERO — full-bleed cover with scrim, title overlay, badge + soundtrack */}
            <div className="relative aspect-[5/4] w-full overflow-hidden bg-shell-pink">
              <Image src={cover} alt="" fill sizes="420px" className="object-cover" draggable={false} priority />
              <div
                className="absolute inset-0"
                style={{ background: 'linear-gradient(180deg, rgba(61,15,46,0) 30%, rgba(61,15,46,0.82) 100%)' }}
                aria-hidden
              />
              {/* grab handle, on the scrim so it reads on the photo */}
              <div className="absolute left-1/2 top-3 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/70" aria-hidden />

              {night.is_seed && (
                <span
                  className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-shell-accent px-3 py-1 font-body text-[11px] font-bold lowercase text-white shadow-md"
                  style={{ transform: `rotate(${stickerRotation('curated')}deg)` }}
                >
                  <Sparkles className="h-3 w-3" aria-hidden /> curated
                </span>
              )}
              {night.ambient_sound_name && (
                <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 font-body text-[11px] font-semibold lowercase text-shell-ink shadow-md">
                  <Music className="h-3 w-3" aria-hidden /> {night.ambient_sound_name.toLowerCase()}
                </span>
              )}

              <h2 className="absolute inset-x-0 bottom-0 px-5 pb-4 font-heading text-[34px] lowercase leading-[0.98] text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.35)]">
                {night.title?.toLowerCase() ?? 'a night out'}
              </h2>
            </div>

            <div className="flex flex-col gap-4 px-5 pb-6 pt-4">
              {/* SCANNABLE CHIP ROW — the facts at a glance */}
              <ul className="flex flex-wrap gap-2" aria-label="the plan at a glance">
                {night.time_window_start && (
                  <li>
                    <Chip icon={<Clock className="h-3.5 w-3.5" />}>
                      <LocalTime
                        iso={night.time_window_start}
                        format={(d) => {
                          const weekday = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
                          const hour = d.toLocaleTimeString('en-US', { hour: 'numeric' }).toLowerCase().replace(/\s/g, '');
                          return `${weekday} · ${hour}`;
                        }}
                        fallback="soon"
                      />
                    </Chip>
                  </li>
                )}
                {distance && (
                  <li><Chip icon={<MapPin className="h-3.5 w-3.5" />}>{distance}</Chip></li>
                )}
                {totalPp != null && (
                  <li><Chip icon={<Wallet className="h-3.5 w-3.5" />}>${totalPp} pp</Chip></li>
                )}
                {night.pay_setting && (
                  <li><Chip icon={<Users className="h-3.5 w-3.5" />} tone="pay">{night.pay_setting.toLowerCase()}</Chip></li>
                )}
                {tags[0] && (
                  <li><Chip icon={<Sparkles className="h-3.5 w-3.5" />}>{tags[0].toLowerCase()}</Chip></li>
                )}
                {(durHrs || stops.length > 0) && (
                  <li>
                    <Chip icon={<Clock className="h-3.5 w-3.5" />}>
                      {[durHrs ? `~${durHrs} hr${durHrs === 1 ? '' : 's'}` : null,
                        stops.length > 0 ? `${stops.length} stop${stops.length === 1 ? '' : 's'}` : null]
                        .filter(Boolean).join(' · ')}
                    </Chip>
                  </li>
                )}
              </ul>

              {/* ONE-LINE HOOK — italic, the story trimmed to a punchy line */}
              {hookText && (
                <p className="font-heading text-[17px] italic leading-snug text-shell-ink/90">
                  {/* sr-only label keeps the "the why" landmark the prior copy carried */}
                  <span className="sr-only">the why: </span>
                  &ldquo;{hookShown}&rdquo;
                  {hookLong && (
                    <button
                      type="button"
                      onClick={() => setHookOpen((v) => !v)}
                      className="ml-1 font-body text-sm font-bold not-italic text-shell-accent underline decoration-2 underline-offset-2"
                    >
                      {hookOpen ? 'less' : 'more'}
                    </button>
                  )}
                </p>
              )}

              {/* THE VIBE — sticker chips (kept as its own labelled landmark) */}
              {tags.length > 0 && (
                <div>
                  <p className="mb-2 font-body text-[11px] font-bold lowercase tracking-[0.16em] text-shell-ink/50">
                    the vibe
                  </p>
                  <ul className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <li
                        key={tag}
                        className="rounded-full px-3 py-1 font-body text-xs font-semibold lowercase shadow-md"
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

              {/* THE NIGHT — visual timeline of stops */}
              {stops.length > 0 && (
                <div>
                  <p className="mb-2 font-body text-[11px] font-bold lowercase tracking-[0.16em] text-shell-ink/50">
                    the night
                  </p>
                  <ol className="flex flex-col">
                    {stops.map((s, idx) => (
                      <StopRow
                        key={`${s.name}-${idx}`}
                        stop={s}
                        index={idx}
                        last={idx === stops.length - 1}
                        accent={pal.accent}
                        vibeTags={night.vibe_tags}
                      />
                    ))}
                  </ol>
                </div>
              )}

              {/* THE ROUTE — mini-map placeholder (no real map wired yet) */}
              {stops.length > 1 && (
                <div>
                  <p className="mb-2 font-body text-[11px] font-bold lowercase tracking-[0.16em] text-shell-ink/50">
                    the route
                  </p>
                  <div className="relative flex h-24 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-shell-pink to-shell-base ring-1 ring-shell-ink/10">
                    <Route className="h-5 w-5 text-shell-ink/40" aria-hidden />
                    <span className="ml-2 font-body text-xs lowercase text-shell-ink/50">
                      {stops.length} stops, a short hop apart
                    </span>
                    {stops.slice(0, 4).map((s, idx) => (
                      <span
                        key={`pin-${s.name}-${idx}`}
                        className="absolute flex h-5 w-5 items-center justify-center rounded-full bg-shell-accent font-body text-[10px] font-bold text-white ring-2 ring-white"
                        style={{ left: `${18 + idx * 22}%`, top: idx % 2 === 0 ? '26%' : '60%' }}
                        aria-hidden
                      >
                        {idx + 1}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Blind reassurance — sets the expectation that identity stays hidden. */}
              <p className="font-body text-[13px] leading-relaxed text-shell-ink/55">
                you&rsquo;re swiping on the night, not the person. who&rsquo;s hosting stays a
                secret until you both match.
              </p>
            </div>
          </div>

          {/* Sticky bottom CTA — decide after reading. Skip / i'm in. */}
          <div className="flex shrink-0 items-center justify-center gap-6 border-t border-shell-ink/10 bg-shell-base/95 px-5 py-4 backdrop-blur">
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
                'flex h-16 items-center justify-center gap-2 rounded-full bg-shell-accent px-7 font-heading text-lg lowercase text-white shadow-fun transition',
                'hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40',
                'motion-reduce:transition-none motion-reduce:hover:scale-100',
                busy && 'opacity-50',
              )}
            >
              <Heart className="h-6 w-6" strokeWidth={2.5} fill="currentColor" aria-hidden />
              i&rsquo;m in
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

// Blind-safe timeline stop: numbered photo thumb + name + "neighborhood · type ·
// time" + a one-line desc with "more" + "$ pp" + a name-query "map" link. NO slug
// link, NO reservation_url — the RPC already scrubbed identity vectors. A dashed
// connector links each stop to the next, so the column reads as a route.
function StopRow({
  stop, index, last, accent, vibeTags,
}: {
  stop: NightDetailStop; index: number; last: boolean; accent: string;
  vibeTags: string[] | null;
}) {
  const [open, setOpen] = useState(false);
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(stop.name)}`;
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
        <p className="font-heading text-lg lowercase leading-tight text-shell-ink">{stop.name.toLowerCase()}</p>
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

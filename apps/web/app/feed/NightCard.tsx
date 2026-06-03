import Image from 'next/image';
import { MapPin, Clock, Wallet } from 'lucide-react';
import { vibePalette } from '@after5/business';
import { stickerRotation } from '@/lib/sticker';
import { coverImageForNight } from '@/lib/place-image';
import type { FeedNight } from '@/lib/after5/client';
import { LocalTime } from '@/components/LocalTime';

// Tier-2 experience surface (DESIGN-SYSTEM §1). The card carries the *experience's*
// vibe palette, not the global pink — derived from vibe_tags via vibePalette() and
// applied as inline CSS vars so Tailwind arbitrary values can read them.
// BLIND CONTRACT: FeedNight has no creator identity and we never render one.

// Coarse, blind-by-design time: weekday + hour bucket only. Never a precise minute.
function coarseTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const hour = d.toLocaleTimeString('en-US', { hour: 'numeric' }).toLowerCase().replace(/\s/g, '');
  return `${weekday} · ${hour}`;
}

function km(distanceM: number | null): string | null {
  if (distanceM == null) return null;
  const value = distanceM / 1000;
  return value < 1 ? `${Math.max(0.1, Math.round(value * 10) / 10)} km away` : `${Math.round(value)} km away`;
}

export function NightCard({ night }: { night: FeedNight }) {
  const pal = vibePalette(night.vibe_tags);
  const distance = km(night.distance_m);
  const tags = (night.vibe_tags ?? []).filter(Boolean).slice(0, 4);
  // Always resolve to a tasteful, on-theme image — never an empty pink panel.
  const cover = coverImageForNight({
    cover_image_url: night.cover_image_url,
    vibe_tags: night.vibe_tags,
    seedKey: night.date_instance_id ?? night.title,
  });

  return (
    <article
      className="flex h-full flex-col overflow-hidden rounded-3xl bg-[var(--exp-bg)] text-[var(--exp-ink)] shadow-fun"
      style={
        {
          '--exp-bg': pal.bg,
          '--exp-accent': pal.accent,
          '--exp-ink': pal.ink,
        } as React.CSSProperties
      }
    >
      <div className="relative h-[54%] w-full shrink-0 overflow-hidden bg-[var(--exp-accent)]/15">
        <Image
          src={cover}
          alt=""
          fill
          sizes="420px"
          className="object-cover"
          draggable={false}
          priority
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
        <h2 className="font-heading text-3xl lowercase leading-[1.05]">
          {night.title?.toLowerCase() ?? 'a night out'}
        </h2>

        {night.why_note && (
          <p className="font-body text-[15px] leading-relaxed opacity-80">{night.why_note}</p>
        )}

        {tags.length > 0 && (
          <ul className="flex flex-wrap gap-2 pt-0.5">
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

        <dl className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 font-body text-[13px] opacity-80">
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
          {night.venue_neighborhood && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden />
              <dt className="sr-only">where</dt>
              <dd>{night.venue_neighborhood.toLowerCase()}</dd>
            </div>
          )}
          {distance && (
            <div className="flex items-center gap-1.5">
              <dt className="sr-only">distance</dt>
              <dd>{distance}</dd>
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

// Read-only gallery of curated nights near you (reuses existing itineraries content).
// The desire engine while the live match loop (S5/S6) is not built. Polaroid collage
// (DESIGN-SYSTEM §5): warm-filmic covers in tilted polaroid frames, sticker-chip meta,
// the photography is the hero and pink is reserved for the meta chip + links.
import Link from 'next/link';
import type { TeaserCard } from '@/lib/onboarding/teaser';
import { Polaroid } from '@/components/Polaroid';
import { stickerRotation } from '@/lib/sticker';

// Deterministic tilt per slot so the wall feels hand-placed but never jitters
// across renders (DESIGN-SYSTEM §5 polaroid motif: -3°..+3° band, alternating).
const TILTS = [-3, 2.5, -2, 3, -2.5, 2];

// Manifest fallbacks (apps/web/public/gallery): used when an itinerary has no
// cover so the wall is never broken or empty. Warm-filmic, on-vibe.
const COVER_FALLBACKS = [
  '/gallery/pottery-wheel.jpg',
  '/gallery/beach-cards-sunset.jpg',
  '/gallery/bar-couple-cozy.jpg',
  '/gallery/rooftop-pizza-wine.jpg',
  '/gallery/ramen-couple.jpg',
  '/gallery/outdoor-movie-night.jpg',
];

function metaLabel(c: TeaserCard): string | null {
  const cost = c.costPp != null ? `$${Math.round(c.costPp)}` : null;
  const dur = c.durationMin != null ? `${Math.round((c.durationMin / 60) * 10) / 10} hr` : null;
  return [cost, dur].filter(Boolean).join(' · ') || null;
}

export function TeaserGallery({ cards }: { cards: TeaserCard[] }) {
  if (cards.length === 0) {
    return (
      <section className="mt-14">
        <h2 className="font-heading text-2xl lowercase text-shell-ink">the kind of nights ahead</h2>
        <p className="mt-2 font-body text-sm text-shell-ink/60">curating nights near you. give it a sec.</p>
      </section>
    );
  }

  return (
    <section className="mt-14">
      <h2 className="font-heading text-2xl lowercase leading-tight text-shell-ink">the kind of nights you&apos;ll match around</h2>
      <ul className="mt-6 grid grid-cols-2 gap-x-3 gap-y-8">
        {cards.map((c, idx) => {
          const meta = metaLabel(c);
          const cover = c.cover ?? COVER_FALLBACKS[idx % COVER_FALLBACKS.length];
          return (
            <li key={c.id} className="flex flex-col items-center text-center">
              <Polaroid
                tone="dating"
                src={cover}
                alt={c.title}
                size="lg"
                rotation={TILTS[idx % TILTS.length]}
                href={c.href}
              />
              <Link
                href={c.href}
                className="mt-2 max-w-[170px] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shell-accent/40"
              >
                <h3 className="line-clamp-2 font-heading text-base lowercase leading-tight text-shell-ink">{c.title}</h3>
              </Link>
              {c.hook && (
                <p className="mt-1 line-clamp-2 max-w-[170px] font-body text-[12px] leading-snug text-shell-ink/55">{c.hook}</p>
              )}
              {meta && (
                <span
                  className="mt-2 inline-block rounded-full bg-shell-pink px-2.5 py-1 font-body text-[11px] font-semibold lowercase text-shell-accent shadow-md ring-1 ring-shell-accent/15 [font-variant-numeric:tabular-nums]"
                  style={{ transform: `rotate(${stickerRotation(c.id)}deg)` }}
                >
                  {meta}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

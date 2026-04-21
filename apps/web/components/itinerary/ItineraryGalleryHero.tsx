// Airbnb-style photo grid that opens the plan detail page. Hero stop on
// the left + up to 4 supporting tiles on the right. Title and meta
// move BELOW the gallery (rather than overlaid on the image like the
// previous editorial hero) so photography always reads as photography.
//
// Design notes:
// - 12px corner radius matches Airbnb's tile rounding without being soft
// - 2px gutters keep tiles from feeling like a single posterized image
// - Mobile collapses to a single hero image with a "+N photos" chip in
//   the corner — the rest of the photos surface in the timeline below.

import Image from 'next/image';
import Link from 'next/link';
import { ImageIcon } from 'lucide-react';
import { imageForStop } from '@/lib/place-image';
import type { Stop } from '@/lib/itinerary-types';

export function ItineraryGalleryHero({ stops }: { stops: Stop[] }) {
  if (stops.length === 0) return null;

  const heroStop = stops[0];
  const heroImg = imageForStop({
    photo_url: heroStop.photo_url,
    place_type: heroStop.place_type,
  });

  // Up to 4 tiles after the hero. Real plans have 3-5 stops; we adapt
  // the grid layout based on how many tile slots we actually fill.
  const tileStops = stops.slice(1, 5);
  const tiles = tileStops.map((s) => ({
    src: imageForStop({ photo_url: s.photo_url, place_type: s.place_type }),
    name: s.place_name,
  }));

  // How many extra photos the user can browse via the timeline below.
  const totalPhotos = stops.length;

  return (
    <section className="mx-auto max-w-content px-4 pt-6 md:px-10 md:pt-10">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.6fr_1fr] md:gap-2">
        {/* Hero — full size on desktop, 4:3 on mobile */}
        <div className="group relative aspect-[4/3] overflow-hidden rounded-[14px] bg-surface md:aspect-auto md:min-h-[440px] md:rounded-l-[14px] md:rounded-r-none">
          <Image
            src={heroImg}
            alt={heroStop.place_name}
            fill
            priority
            sizes="(max-width: 768px) 100vw, 60vw"
            className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.02]"
          />
          {/* Bottom-left chip naming the hero stop — gives the photo context
              without a heavy overlay. */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[80%]">
            <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/95 px-3 py-1.5 text-[11px] font-medium tracking-wide text-text shadow-sm backdrop-blur-sm">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              Stop 1 · {heroStop.place_name}
            </span>
          </div>
        </div>

        {/* Right column: 2x2 grid of supporting tiles */}
        {tiles.length > 0 && (
          <div
            className={
              tiles.length >= 2
                ? 'grid grid-cols-2 grid-rows-2 gap-2'
                : 'grid grid-cols-1 grid-rows-1 gap-2'
            }
          >
            {tiles.map((t, i) => {
              // Round only the corner that meets the page edge; inner tiles
              // are slightly rounded too so they don't fight the hero.
              const roundClass = roundForTile(i, tiles.length);
              return (
                <div
                  key={`${t.src}-${i}`}
                  className={`group relative overflow-hidden bg-surface ${roundClass}`}
                >
                  <Image
                    src={t.src}
                    alt={t.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                  <p className="pointer-events-none absolute bottom-2 left-2.5 right-2.5 text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] truncate">
                    Stop {i + 2} · {t.name}
                  </p>
                  {/* "Show all photos" CTA on the last tile, mirroring Airbnb */}
                  {i === tiles.length - 1 && (
                    <Link
                      href="#timeline"
                      className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-pill bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-text shadow-sm backdrop-blur-sm transition-transform hover:-translate-y-0.5"
                    >
                      <ImageIcon className="h-3 w-3" strokeWidth={2.25} />
                      All {totalPhotos} stops
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// Determine which corner of which tile gets the outer page-edge radius.
// 4-tile grid: top-right (i=1), bottom-right (i=3) get the right edge.
// 3-tile or 2-tile grid: similar logic compacted.
function roundForTile(i: number, total: number): string {
  if (total === 1) return 'rounded-[14px] md:rounded-l-none md:rounded-r-[14px]';
  if (total === 2) {
    // Stacked vertically on the right
    if (i === 0) return 'rounded-[12px] md:rounded-bl-none md:rounded-tr-[14px] md:rounded-br-none md:rounded-tl-none';
    return 'rounded-[12px] md:rounded-tl-none md:rounded-tr-none md:rounded-bl-none md:rounded-br-[14px]';
  }
  // 3 or 4 tiles in 2x2
  const corners: string[] = [
    'rounded-[10px] md:rounded-tl-none md:rounded-tr-[14px] md:rounded-bl-none md:rounded-br-none', // top-right
    'rounded-[10px] md:rounded-tl-none md:rounded-tr-none md:rounded-bl-none md:rounded-br-none',   // top-left of right pair
    'rounded-[10px] md:rounded-tl-none md:rounded-tr-none md:rounded-bl-none md:rounded-br-none',   // bottom-left of right pair
    'rounded-[10px] md:rounded-tl-none md:rounded-tr-none md:rounded-bl-none md:rounded-br-[14px]', // bottom-right
  ];
  // Reorder for a cleaner read in 2x2 (top-right, top-left-of-pair, bottom-left, bottom-right)
  return corners[i] ?? 'rounded-[10px]';
}

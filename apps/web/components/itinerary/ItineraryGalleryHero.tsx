'use client';

// Airbnb-style photo grid + click-to-open lightbox. Hero stop on the
// left + up to 4 supporting tiles on the right. Tapping any tile
// opens a full-screen lightbox with arrow-key nav, swipe support
// implicit via touch on the image, and Escape to close.
//
// Title and meta move BELOW the gallery (rather than overlaid on the
// image like the previous editorial hero) so photography always reads
// as photography.

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ImageIcon, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { imageForStop } from '@/lib/place-image';
import type { Stop } from '@/lib/itinerary-types';

interface Photo {
  src: string;
  name: string;
  index: number;
}

export function ItineraryGalleryHero({ stops }: { stops: Stop[] }) {
  const [lightboxAt, setLightboxAt] = useState<number | null>(null);

  if (stops.length === 0) return null;

  // Build the full ordered photo list: every stop, in order.
  const photos: Photo[] = stops.map((s, i) => ({
    src: imageForStop({ photo_url: s.photo_url, place_type: s.place_type }),
    name: s.place_name,
    index: i,
  }));

  const heroPhoto = photos[0];
  const tiles = photos.slice(1, 5);
  const totalPhotos = photos.length;

  return (
    <>
      <section className="mx-auto max-w-content px-4 pt-6 md:px-10 md:pt-10">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1.6fr_1fr] md:gap-2">
          {/* Hero — full size on desktop, 4:3 on mobile */}
          <button
            type="button"
            onClick={() => setLightboxAt(0)}
            className="group relative aspect-[4/3] overflow-hidden rounded-[14px] bg-surface md:aspect-auto md:min-h-[440px] md:rounded-l-[14px] md:rounded-r-none"
            aria-label={`Open ${heroPhoto.name}`}
          >
            <Image
              src={heroPhoto.src}
              alt={heroPhoto.name}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 60vw"
              className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.02]"
            />
            <span className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[80%]">
              <span className="inline-flex items-center gap-1.5 rounded-pill bg-white/95 px-3 py-1.5 text-[11px] font-medium tracking-wide text-text shadow-sm backdrop-blur-sm">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                Stop 1 · {heroPhoto.name}
              </span>
            </span>
          </button>

          {tiles.length > 0 && (
            <div
              className={
                tiles.length >= 2
                  ? 'grid grid-cols-2 grid-rows-2 gap-2'
                  : 'grid grid-cols-1 grid-rows-1 gap-2'
              }
            >
              {tiles.map((t, i) => {
                const roundClass = roundForTile(i, tiles.length);
                return (
                  <button
                    type="button"
                    key={`${t.src}-${i}`}
                    onClick={() => setLightboxAt(t.index)}
                    className={`group relative overflow-hidden bg-surface ${roundClass}`}
                    aria-label={`Open ${t.name}`}
                  >
                    <Image
                      src={t.src}
                      alt={t.name}
                      fill
                      sizes="(max-width: 768px) 50vw, 25vw"
                      className="object-cover transition-transform duration-[600ms] group-hover:scale-[1.03]"
                    />
                    <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-transparent" />
                    <span className="pointer-events-none absolute bottom-2 left-2.5 right-2.5 truncate text-[11px] font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                      Stop {i + 2} · {t.name}
                    </span>
                    {i === tiles.length - 1 && (
                      <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-pill bg-white/95 px-3 py-1.5 text-[11px] font-semibold text-text shadow-sm backdrop-blur-sm">
                        <ImageIcon className="h-3 w-3" strokeWidth={2.25} />
                        All {totalPhotos} stops
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {lightboxAt !== null && (
        <PhotoLightbox
          photos={photos}
          startIndex={lightboxAt}
          onClose={() => setLightboxAt(null)}
        />
      )}
    </>
  );
}

function PhotoLightbox({
  photos,
  startIndex,
  onClose,
}: {
  photos: Photo[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);

  const prev = useCallback(
    () => setIdx((i) => (i - 1 + photos.length) % photos.length),
    [photos.length],
  );
  const next = useCallback(
    () => setIdx((i) => (i + 1) % photos.length),
    [photos.length],
  );

  // Keyboard nav + scroll lock while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose, prev, next]);

  const photo = photos[idx];

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      {/* Close */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Close"
        className="absolute right-5 top-5 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" strokeWidth={2.25} />
      </button>

      {/* Counter */}
      <div className="absolute left-5 top-5 z-10 rounded-pill bg-white/10 px-3 py-1 text-xs font-medium tracking-wide text-white [font-variant-numeric:tabular-nums]">
        {idx + 1} / {photos.length}
      </div>

      {/* Prev */}
      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); prev(); }}
          aria-label="Previous"
          className="absolute left-3 top-1/2 z-10 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 md:left-6 md:h-14 md:w-14"
        >
          <ChevronLeft className="h-6 w-6" strokeWidth={2} />
        </button>
      )}

      {/* Image */}
      <div
        className="relative mx-4 my-20 h-[calc(100vh-160px)] w-full max-w-5xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          key={photo.src}
          src={photo.src}
          alt={photo.name}
          fill
          sizes="100vw"
          className="object-contain animate-[lightboxIn_.25s_ease-out]"
        />
        <div className="pointer-events-none absolute -bottom-12 left-0 right-0 text-center">
          <p className="inline-flex items-center gap-2 rounded-pill bg-white/10 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Stop {photo.index + 1} · {photo.name}
          </p>
        </div>
      </div>

      {/* Next */}
      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); next(); }}
          aria-label="Next"
          className="absolute right-3 top-1/2 z-10 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 md:right-6 md:h-14 md:w-14"
        >
          <ChevronRight className="h-6 w-6" strokeWidth={2} />
        </button>
      )}

      <style jsx global>{`
        @keyframes lightboxIn {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// Determine which corner of which tile gets the outer page-edge radius.
function roundForTile(i: number, total: number): string {
  if (total === 1) return 'rounded-[14px] md:rounded-l-none md:rounded-r-[14px]';
  if (total === 2) {
    if (i === 0) return 'rounded-[12px] md:rounded-bl-none md:rounded-tr-[14px] md:rounded-br-none md:rounded-tl-none';
    return 'rounded-[12px] md:rounded-tl-none md:rounded-tr-none md:rounded-bl-none md:rounded-br-[14px]';
  }
  const corners: string[] = [
    'rounded-[10px] md:rounded-tl-none md:rounded-tr-[14px] md:rounded-bl-none md:rounded-br-none',
    'rounded-[10px] md:rounded-tl-none md:rounded-tr-none md:rounded-bl-none md:rounded-br-none',
    'rounded-[10px] md:rounded-tl-none md:rounded-tr-none md:rounded-bl-none md:rounded-br-none',
    'rounded-[10px] md:rounded-tl-none md:rounded-tr-none md:rounded-bl-none md:rounded-br-[14px]',
  ];
  return corners[i] ?? 'rounded-[10px]';
}

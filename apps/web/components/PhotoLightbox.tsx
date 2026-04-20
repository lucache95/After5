'use client';

// Click any thumbnail to open a full-screen lightbox. Arrow keys + click-outside
// to close. Used on /places/[slug] for the Google photo gallery.

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

export function PhotoLightbox({ photos }: { photos: string[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const close = useCallback(() => setOpenIdx(null), []);
  const next = useCallback(
    () => setOpenIdx((i) => (i === null ? null : (i + 1) % photos.length)),
    [photos.length],
  );
  const prev = useCallback(
    () => setOpenIdx((i) => (i === null ? null : (i - 1 + photos.length) % photos.length)),
    [photos.length],
  );

  useEffect(() => {
    if (openIdx === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    }
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [openIdx, close, next, prev]);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        {photos.map((url, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpenIdx(i)}
            className="group relative aspect-square overflow-hidden rounded-card bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`Open photo ${i + 1} of ${photos.length}`}
          >
            <Image
              src={url}
              alt=""
              fill
              sizes="(max-width: 768px) 50vw, 33vw"
              className="object-cover transition-transform duration-[400ms] group-hover:scale-[1.03]"
              unoptimized
            />
          </button>
        ))}
      </div>

      {openIdx !== null && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          onClick={close}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm md:p-10"
        >
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="absolute right-5 top-5 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-2xl leading-none text-white transition-colors hover:bg-white/20"
          >
            &times;
          </button>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  prev();
                }}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 z-10 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 md:left-6"
              >
                &larr;
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  next();
                }}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 z-10 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 md:right-6"
              >
                &rarr;
              </button>
            </>
          )}

          <div
            className="relative h-full w-full max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={photos[openIdx]}
              alt=""
              fill
              sizes="100vw"
              className="object-contain"
              unoptimized
              priority
            />
          </div>

          {photos.length > 1 && (
            <p className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs font-medium uppercase tracking-[0.18em] text-white/70 [font-variant-numeric:tabular-nums]">
              {openIdx + 1} / {photos.length}
            </p>
          )}
        </div>
      )}
    </>
  );
}

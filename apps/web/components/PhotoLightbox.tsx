'use client';

// Click any thumbnail to open a full-screen lightbox. Arrow keys + click-outside
// to close. Used on /places/[slug] for the Google photo gallery.

import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';

export function PhotoLightbox({
  photos: rawPhotos,
  limit = 6,
  pinterestQuery,
}: {
  photos: string[];
  limit?: number;
  pinterestQuery?: string;
}) {
  // Dedupe: Google Places sometimes returns the same physical photo under
  // multiple refs. Strip the signed-URL query string (it varies per fetch)
  // and keep the first occurrence of each path. Slice AFTER dedup so we
  // always show `limit` unique images when available.
  const photos = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const url of rawPhotos) {
      const key = url.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(url);
      if (out.length >= limit) break;
    }
    return out;
  })();

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

  const pinterestHref = pinterestQuery
    ? `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(pinterestQuery)}`
    : null;

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

      {pinterestHref && (
        <a
          href={pinterestHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 text-sm text-secondary underline decoration-border decoration-1 underline-offset-[6px] transition-colors hover:text-text hover:decoration-text"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
            <path d="M12 0a12 12 0 0 0-4.37 23.17c-.1-.94-.2-2.4.04-3.43.22-.94 1.4-5.94 1.4-5.94s-.36-.72-.36-1.78c0-1.66.97-2.9 2.17-2.9 1.02 0 1.52.77 1.52 1.69 0 1.03-.66 2.57-1 4-.28 1.2.6 2.18 1.78 2.18 2.14 0 3.78-2.26 3.78-5.51 0-2.88-2.07-4.9-5.03-4.9-3.42 0-5.43 2.57-5.43 5.22 0 1.03.4 2.14.9 2.74.1.12.11.22.08.34l-.34 1.36c-.05.22-.18.27-.41.16-1.5-.7-2.45-2.9-2.45-4.66 0-3.8 2.76-7.28 7.95-7.28 4.18 0 7.42 2.98 7.42 6.96 0 4.15-2.62 7.49-6.25 7.49-1.22 0-2.37-.63-2.76-1.38l-.75 2.86c-.27 1.05-1 2.36-1.5 3.16A12 12 0 1 0 12 0Z" />
          </svg>
          Find more on Pinterest
        </a>
      )}

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

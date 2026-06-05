'use client';

// Static Mapbox image of a night's route — the dating-vertical sibling of
// ItineraryMap. Same engine (a server-rendered Mapbox static PNG, no WebGL, so
// it's inherently reduced-motion friendly), re-skinned for the Barbiecore detail
// sheet: pins + route line in `shell.accent` pink, warm-cream/white chrome.
//
// Consumes already-normalized NightDetailStop[] (the same blind-safe shape the
// detail sheet timeline renders). It plots ONLY coordinates — never names or
// slugs — so it carries no identity (the coords come pre-scrubbed from
// get_night_detail; we never run a client-side `places` query). With zero
// coords it returns null and the caller keeps its own "short hop apart"
// placeholder; never a broken tile.
//
// Click-to-expand into a full-screen lightbox (Esc to close, body-scroll-lock,
// backdrop click closes) — the only motion is the existing lightbox open, which
// already settles under motion-reduce.

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Maximize2, X } from 'lucide-react';
import type { NightDetailStop } from '@/lib/after5/client';

// Read the token lazily (not at module scope) so it's resolved at render time,
// not at import-hoist time.
const token = () => process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
// Barbiecore pink, BARE hex (no leading '#') — Mapbox static overlays reject a
// '#'-prefixed color (07-RESEARCH Pitfall 5). Base style stays light-v11 so the
// warm-cream sheet and the map read as one surface.
const ACCENT = 'E0218A';

// Google polyline encoder for the route line. Compact algorithm, no dependency.
// Reused verbatim from ItineraryMap (Don't-Hand-Roll).
function encodePolyline(coords: Array<[number, number]>): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = '';
  for (const [lng, lat] of coords) {
    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    result += encodeSigned(latE5 - lastLat) + encodeSigned(lngE5 - lastLng);
    lastLat = latE5;
    lastLng = lngE5;
  }
  return result;
}
function encodeSigned(n: number): string {
  let v = n < 0 ? ~(n << 1) : n << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  out += String.fromCharCode(v + 63);
  return out;
}

function buildStaticMapUrl(
  placed: Array<{ lng: number; lat: number }>,
  size: 'card' | 'lightbox',
): string | null {
  const TOKEN = token();
  if (!TOKEN || placed.length === 0) return null;
  const pins = placed
    .map((s, i) => `pin-s-${i + 1}+${ACCENT}(${s.lng.toFixed(5)},${s.lat.toFixed(5)})`)
    .join(',');
  let overlays = pins;
  if (placed.length >= 2) {
    const polyline = encodePolyline(placed.map((s) => [s.lng, s.lat]));
    const encodedPath = `path-3+${ACCENT}-0.85(${encodeURIComponent(polyline)})`;
    overlays = `${encodedPath},${pins}`;
  }
  // card = inline render; lightbox = larger pull for full-screen modal.
  const dims = size === 'card' ? '1200x420@2x' : '1280x900@2x';
  const padding = size === 'card' ? '80,40,40,40' : '120,80,80,80';
  return `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${overlays}/auto/${dims}?access_token=${TOKEN}&padding=${padding}`;
}

export function RouteMap({ stops }: { stops: NightDetailStop[] }) {
  const [open, setOpen] = useState(false);

  const placed = stops.filter(
    (s): s is NightDetailStop & { lat: number; lng: number } =>
      typeof s.lat === 'number' && typeof s.lng === 'number',
  );

  const cardUrl = buildStaticMapUrl(placed, 'card');
  const lightboxUrl = buildStaticMapUrl(placed, 'lightbox');

  // Render only when >=1 stop has coords; else the sheet keeps its own
  // "short hop apart" placeholder (UI-SPEC E20) — never a broken tile.
  if (!cardUrl) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full overflow-hidden rounded-3xl bg-shell-base ring-1 ring-shell-accent/15 focus:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40"
        aria-label="expand the route map"
      >
        <Image
          src={cardUrl}
          alt={`map of ${placed.length} stops on the route`}
          width={1200}
          height={420}
          unoptimized
          className="h-auto w-full transition-transform duration-[600ms] group-hover:scale-[1.01]"
        />
        <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 font-body text-[11px] font-semibold lowercase tracking-wide text-shell-ink shadow-sm backdrop-blur-sm">
          <Maximize2 className="h-3 w-3" strokeWidth={2.25} />
          expand
        </span>
      </button>

      {open && lightboxUrl && (
        <RouteMapLightbox
          src={lightboxUrl}
          alt={`map of ${placed.length} stops on the route`}
          stopCount={placed.length}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RouteMapLightbox({
  src,
  alt,
  stopCount,
  onClose,
}: {
  src: string;
  alt: string;
  stopCount: number;
  onClose: () => void;
}) {
  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [close]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      onClick={close}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); close(); }}
        aria-label="close"
        className="absolute right-5 top-5 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" strokeWidth={2.25} />
      </button>

      <div
        className="relative mx-4 my-20 h-[calc(100vh-160px)] w-full max-w-6xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Image
          src={src}
          alt={alt}
          fill
          unoptimized
          sizes="100vw"
          className="object-contain animate-[lightboxIn_.25s_ease-out]"
        />
        <div className="pointer-events-none absolute -bottom-12 left-0 right-0 text-center">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 font-body text-sm font-medium lowercase text-white backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-shell-accent" aria-hidden />
            {stopCount} stops · the route
          </p>
        </div>
      </div>
    </div>
  );
}

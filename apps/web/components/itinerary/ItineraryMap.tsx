'use client';

// Static Mapbox image of the route — pre-rendered server-side by Mapbox, served
// as a PNG. No WebGL required (interactive map was failing for users with
// WebGL disabled / unavailable). For the actual zooming + panning experience
// users tap "Open route in Maps" which deep-links Google Maps directions.
//
// The map is also click-to-expand: tapping the static image opens a
// full-screen lightbox showing a higher-res render. Same surface treatment
// as PhotoLightbox in ItineraryGalleryHero so the interaction feels native.

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { Maximize2, X } from 'lucide-react';
import type { Stop } from '@/lib/itinerary-types';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const ACCENT = 'C2552B';

// Google polyline encoder for the route line. Compact algorithm, no dependency.
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

export function ItineraryMap({ stops }: { stops: Stop[] }) {
  const [open, setOpen] = useState(false);

  const placed = stops.filter(
    (s): s is Stop & { lat: number; lng: number } =>
      typeof s.lat === 'number' && typeof s.lng === 'number',
  );

  const cardUrl = buildStaticMapUrl(placed, 'card');
  const lightboxUrl = buildStaticMapUrl(placed, 'lightbox');

  if (!cardUrl) {
    return (
      <FallbackList
        title={!TOKEN ? 'Map token missing' : 'No coordinates yet'}
        body={
          !TOKEN
            ? "NEXT_PUBLIC_MAPBOX_TOKEN isn't in the client bundle."
            : "These stops don't have lat/lng stored, so there's nothing to plot."
        }
        stops={stops}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block w-full overflow-hidden rounded-card border border-border bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label="Expand route map"
      >
        <Image
          src={cardUrl}
          alt={`Map of ${placed.length} stops in the route`}
          width={1200}
          height={420}
          unoptimized
          className="h-auto w-full transition-transform duration-[600ms] group-hover:scale-[1.01]"
        />
        <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-pill bg-white/95 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-text shadow-sm backdrop-blur-sm">
          <Maximize2 className="h-3 w-3" strokeWidth={2.25} />
          Expand map
        </span>
      </button>

      {open && lightboxUrl && (
        <MapLightbox
          src={lightboxUrl}
          alt={`Map of ${placed.length} stops in the route`}
          stopCount={placed.length}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function MapLightbox({
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
        aria-label="Close"
        className="absolute right-5 top-5 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
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
          <p className="inline-flex items-center gap-2 rounded-pill bg-white/10 px-4 py-1.5 text-sm font-medium text-white backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            {stopCount} stops · The route
          </p>
        </div>
      </div>
    </div>
  );
}

function FallbackList({
  title,
  body,
  stops,
}: {
  title: string;
  body: string;
  stops: Stop[];
}) {
  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted">{title}</p>
      <p className="mt-2 text-sm text-secondary">{body}</p>
      {stops.length > 0 && (
        <ol className="mt-5 space-y-2 text-sm text-text">
          {stops.map((s, i) => (
            <li key={s.place_id} className="flex items-baseline gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
                {i + 1}
              </span>
              <span className="font-medium">{s.place_name}</span>
              {s.neighborhood && (
                <span className="text-muted">· {s.neighborhood}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

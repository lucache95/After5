// Static Mapbox image of the route — pre-rendered server-side by Mapbox, served
// as a PNG. No WebGL required (interactive map was failing for users with
// WebGL disabled / unavailable). For the actual zooming + panning experience
// users tap "Open route in Maps" which deep-links Google Maps directions.

import Image from 'next/image';
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

function buildStaticMapUrl(placed: Array<{ lng: number; lat: number }>): string | null {
  if (!TOKEN || placed.length === 0) return null;
  const pins = placed
    .map((s, i) => `pin-s-${i + 1}+${ACCENT}(${s.lng.toFixed(5)},${s.lat.toFixed(5)})`)
    .join(',');
  let overlays = pins;
  if (placed.length >= 2) {
    const polyline = encodePolyline(placed.map((s) => [s.lng, s.lat]));
    // Polyline characters need URL encoding when embedded in the path.
    const encodedPath = `path-3+${ACCENT}-0.85(${encodeURIComponent(polyline)})`;
    overlays = `${encodedPath},${pins}`;
  }
  // auto fits the viewport to overlays. 1200x420@2x = retina-ready 2400x840.
  return `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${overlays}/auto/1200x420@2x?access_token=${TOKEN}&padding=80,40,40,40`;
}

export function ItineraryMap({ stops }: { stops: Stop[] }) {
  const placed = stops.filter(
    (s): s is Stop & { lat: number; lng: number } =>
      typeof s.lat === 'number' && typeof s.lng === 'number',
  );

  const url = buildStaticMapUrl(placed);

  if (!url) {
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
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <Image
        src={url}
        alt={`Map of ${placed.length} stops in the route`}
        width={1200}
        height={420}
        unoptimized
        className="h-auto w-full"
      />
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

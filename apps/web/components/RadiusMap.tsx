'use client';

// Mapbox Static map of Kelowna with a filled circle overlay showing the
// current radius. Updates as the user drags the slider. No WebGL — same
// approach as the itinerary route map; rebuilds the image URL on each change.

import Image from 'next/image';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const KELOWNA = { lat: 49.888, lng: -119.496 };
const ACCENT = 'C2552B';

// Build 36 points on a circle of `radiusKm` around Kelowna using simple
// equirectangular approximation. Good enough for a visual at this scale.
function circlePoints(radiusKm: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const latDelta = radiusKm / 111; // ~111 km per deg lat
  const lngDelta = radiusKm / (111 * Math.cos((KELOWNA.lat * Math.PI) / 180));
  for (let i = 0; i <= 36; i++) {
    const angle = (i / 36) * Math.PI * 2;
    points.push([
      KELOWNA.lng + lngDelta * Math.cos(angle),
      KELOWNA.lat + latDelta * Math.sin(angle),
    ]);
  }
  return points;
}

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

function buildUrl(radiusKm: number): string {
  const pts = circlePoints(radiusKm);
  const polyline = encodePolyline(pts);
  // path-{stroke}+{strokeColor}-{strokeOpacity}+{fillColor}-{fillOpacity}(polyline)
  const path = `path-2+${ACCENT}-0.85+${ACCENT}-0.18(${encodeURIComponent(polyline)})`;
  const pin = `pin-s+${ACCENT}(${KELOWNA.lng},${KELOWNA.lat})`;
  // auto fits the bounds to overlays — circle gets centered with appropriate zoom.
  return `https://api.mapbox.com/styles/v1/mapbox/light-v11/static/${path},${pin}/auto/600x320@2x?access_token=${TOKEN}&padding=40`;
}

export function RadiusMap({ radiusKm }: { radiusKm: number }) {
  if (!TOKEN) return null;
  const url = buildUrl(radiusKm);
  return (
    <div className="overflow-hidden rounded-card border border-border">
      <Image
        src={url}
        alt={`${radiusKm} km radius around Kelowna`}
        width={600}
        height={320}
        unoptimized
        className="h-auto w-full"
      />
    </div>
  );
}

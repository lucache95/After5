'use client';

// Interactive Mapbox map showing all stops with numbered pins and a route line
// connecting them in order. Light style to match the After5 cream palette.
//
// Defensive rendering: the map has three visible states so we never ship a
// silently-empty box again. If a render still fails, onError surfaces the
// Mapbox error into the UI so we (or the user) can see what's wrong.

import { useMemo, useState } from 'react';
import Map, { Marker, Source, Layer, NavigationControl } from 'react-map-gl/mapbox';
import type { Stop } from '@/lib/itinerary-types';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function ItineraryMap({ stops }: { stops: Stop[] }) {
  const [mapError, setMapError] = useState<string | null>(null);

  const placed = stops.filter(
    (s): s is Stop & { lat: number; lng: number } =>
      typeof s.lat === 'number' && typeof s.lng === 'number',
  );

  const routeData = useMemo(() => {
    if (placed.length < 2) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [
        {
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'LineString' as const,
            coordinates: placed.map((s) => [s.lng, s.lat]),
          },
        },
      ],
    };
  }, [placed]);

  if (!TOKEN) {
    return (
      <FallbackList
        title="Map token missing"
        body="NEXT_PUBLIC_MAPBOX_TOKEN isn't in the client bundle. Rebuild with it set."
        stops={placed}
      />
    );
  }

  if (placed.length === 0) {
    return (
      <FallbackList
        title="No coordinates yet"
        body="These stops don't have lat/lng stored, so there's nothing to plot."
        stops={stops}
      />
    );
  }

  if (mapError) {
    return (
      <FallbackList
        title="Map failed to load"
        body={`Mapbox reported: ${mapError}. The stops below are the route in order.`}
        stops={placed}
      />
    );
  }

  // Center on the centroid of placed stops and pad bounds.
  const lngs = placed.map((s) => s.lng);
  const lats = placed.map((s) => s.lat);
  const centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;

  return (
    <div className="overflow-hidden rounded-card border border-border">
      <Map
        mapboxAccessToken={TOKEN}
        initialViewState={{
          longitude: centerLng,
          latitude: centerLat,
          zoom: 11,
        }}
        style={{ width: '100%', height: 420 }}
        mapStyle="mapbox://styles/mapbox/light-v11"
        attributionControl={false}
        onError={(e) => {
          console.error('Mapbox error:', e);
          const msg = e?.error?.message ?? 'unknown error';
          setMapError(msg);
        }}
      >
        {routeData && (
          <Source id="route" type="geojson" data={routeData}>
            <Layer
              id="route-line"
              type="line"
              paint={{
                'line-color': '#C2552B',
                'line-width': 3,
                'line-opacity': 0.85,
                'line-dasharray': [1, 0],
              }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </Source>
        )}

        {placed.map((s, i) => (
          <Marker key={s.place_id} longitude={s.lng} latitude={s.lat} anchor="bottom">
            <div className="group cursor-pointer">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent font-display text-sm font-semibold text-white shadow-[0_4px_14px_rgba(0,0,0,0.25)] ring-2 ring-white transition-transform group-hover:scale-110">
                {i + 1}
              </div>
            </div>
          </Marker>
        ))}

        <NavigationControl position="top-right" showCompass={false} />
      </Map>
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

'use client';

// Interactive Mapbox map showing all stops with numbered pins and a route line
// connecting them in order. Light style to match the After5 cream palette.
// Renders nothing if a token isn't configured (so the page still works for devs).

import { useMemo } from 'react';
import Map, { Marker, Source, Layer, NavigationControl } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { Stop } from '@/lib/itinerary-types';

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function ItineraryMap({ stops }: { stops: Stop[] }) {
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
      <div className="flex h-[360px] w-full items-center justify-center rounded-card bg-surface text-sm text-muted">
        Map unavailable — set NEXT_PUBLIC_MAPBOX_TOKEN.
      </div>
    );
  }

  if (placed.length === 0) {
    return null;
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

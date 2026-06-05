import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

// next/image renders nothing useful in jsdom (and `fill` warns); stub to a plain img
// that surfaces its src so we can assert the built Mapbox URL.
vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  default: (props: Record<string, unknown>) => <img {...(props as Record<string, never>)} />,
}));

beforeAll(() => {
  // RouteMap reads NEXT_PUBLIC_MAPBOX_TOKEN at module scope; set it before import.
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = 'pk.test-token';
});

import { RouteMap } from '../RouteMap';
import type { NightDetailStop } from '@/lib/after5/client';

function stop(over: Partial<NightDetailStop>): NightDetailStop {
  return {
    name: 'a spot', type: null, start_time: null, duration_min: null,
    cost_pp: null, what_to_do: null, neighborhood: null, local_insight: null,
    photo_url: null, lat: null, lng: null, place_slug: null, drive_to_next_min: null,
    ...over,
  };
}

describe('RouteMap', () => {
  it('builds a pink Mapbox static URL from >=1 coord and renders an image', () => {
    const stops = [
      stop({ name: 'rooftop bar', lat: 49.888, lng: -119.496 }),
      stop({ name: 'jazz cellar', lat: 49.882, lng: -119.49 }),
    ];
    render(<RouteMap stops={stops} />);
    const img = screen.getByRole('img');
    const src = img.getAttribute('src') ?? '';
    expect(src).toContain('api.mapbox.com');
    expect(src).toContain('mapbox/light-v11');
    // Barbiecore pink, bare hex (no leading '#')
    expect(src).toContain('E0218A');
    expect(src).not.toContain('C2552B');
    // both pins present
    expect(src).toContain('pin-s-1');
    expect(src).toContain('pin-s-2');
    // a route polyline for >=2 coords
    expect(src).toContain('path-3');
  });

  it('builds a URL with a single pin and no polyline for exactly 1 coord', () => {
    const stops = [stop({ name: 'rooftop bar', lat: 49.888, lng: -119.496 })];
    render(<RouteMap stops={stops} />);
    const src = screen.getByRole('img').getAttribute('src') ?? '';
    expect(src).toContain('pin-s-1');
    expect(src).not.toContain('path-3');
  });

  it('renders nothing (null) when no stop has coords', () => {
    const stops = [stop({ name: 'rooftop bar' }), stop({ name: 'ramen' })];
    const { container } = render(<RouteMap stops={stops} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.firstChild).toBeNull();
  });

  it('ignores stops missing one of lat/lng', () => {
    const stops = [
      stop({ name: 'no lng', lat: 49.9, lng: null }),
      stop({ name: 'good', lat: 49.88, lng: -119.49 }),
    ];
    render(<RouteMap stops={stops} />);
    const src = screen.getByRole('img').getAttribute('src') ?? '';
    // only one placed pin → no polyline
    expect(src).toContain('pin-s-1');
    expect(src).not.toContain('pin-s-2');
    expect(src).not.toContain('path-3');
  });
});

import { describe, it, expect } from 'vitest';
import { googlePlaceToStop, googlePlaceToSubmission, mapType, type GooglePlace } from '../normalize';

const full: GooglePlace = {
  id: 'abc123',
  displayName: { text: 'quiet coffee co' },
  formattedAddress: '123 main st, kelowna',
  location: { latitude: 49.88, longitude: -119.49 },
  types: ['coffee_shop', 'cafe'],
  photos: [{ name: 'places/abc123/photos/xyz' }],
};

describe('mapType', () => {
  it('maps known google types to our place_type-ish strings', () => {
    expect(mapType(['cafe'])).toBe('cafe');
    expect(mapType(['coffee_shop'])).toBe('cafe');
    expect(mapType(['restaurant'])).toBe('restaurant');
    expect(mapType(['bar'])).toBe('bar');
    expect(mapType(['park'])).toBe('park');
  });
  it('defaults to activity for unknown or empty types', () => {
    expect(mapType(['something_weird'])).toBe('activity');
    expect(mapType([])).toBe('activity');
    expect(mapType(undefined)).toBe('activity');
  });
});

describe('googlePlaceToStop', () => {
  it('maps a full google result with the custom: prefix and sane stop defaults', () => {
    const stop = googlePlaceToStop(full);
    expect(stop.place_id).toBe('custom:abc123');
    expect(stop.place_name).toBe('quiet coffee co');
    expect(stop.place_type).toBe('cafe');
    expect(stop.address).toBe('123 main st, kelowna');
    expect(stop.lat).toBe(49.88);
    expect(stop.lng).toBe(-119.49);
    expect(stop.start_time).toBe('19:00');
    expect(stop.duration_min).toBe(60);
    expect(stop.estimated_cost_pp).toBe(0);
    // v1: photo_url is null to avoid leaking GOOGLE_PLACES_API_KEY in a client URL.
    // The raw result (with photos[].name) is recorded so a server job can fetch it
    // at promotion time.
    expect(stop.photo_url).toBeNull();
  });

  it('is safe when optional fields are missing', () => {
    const stop = googlePlaceToStop({ id: 'x' });
    expect(stop.place_id).toBe('custom:x');
    expect(stop.place_name).toBe('');
    expect(stop.place_type).toBe('activity');
    expect(stop.address).toBeNull();
    expect(stop.lat).toBeNull();
    expect(stop.lng).toBeNull();
    expect(stop.photo_url).toBeNull();
  });
});

describe('googlePlaceToSubmission', () => {
  it('maps to a custom_venue_submissions insert row carrying the raw result', () => {
    const sub = googlePlaceToSubmission(full, 'itin-1');
    expect(sub.itinerary_id).toBe('itin-1');
    expect(sub.google_place_id).toBe('abc123');
    expect(sub.name).toBe('quiet coffee co');
    expect(sub.lat).toBe(49.88);
    expect(sub.lng).toBe(-119.49);
    expect(sub.raw).toEqual(full);
  });

  it('falls back to an empty name and null coords when missing', () => {
    const sub = googlePlaceToSubmission({ id: 'x' }, null);
    expect(sub.itinerary_id).toBeNull();
    expect(sub.name).toBe('');
    expect(sub.lat).toBeNull();
    expect(sub.lng).toBeNull();
  });
});

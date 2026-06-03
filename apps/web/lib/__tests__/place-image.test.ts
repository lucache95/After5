import { describe, it, expect } from 'vitest';
import { imageForStop, coverImageFor, coverImageForNight } from '../place-image';

describe('imageForStop', () => {
  it('prefers a real photo_url', () => {
    expect(imageForStop({ photo_url: 'https://x/p.jpg', place_type: 'cafe' })).toBe('https://x/p.jpg');
  });

  it('prefers a generated_photo_url over the type fallback', () => {
    expect(imageForStop({ generated_photo_url: 'gen.jpg', place_type: 'cafe' })).toBe('gen.jpg');
  });

  it('falls back to a type image', () => {
    expect(imageForStop({ place_type: 'restaurant' })).toBe('/places/place-restaurant.jpg');
  });

  it('maps coarse buckets (food/drinks/outdoor)', () => {
    expect(imageForStop({ place_type: 'food' })).toBe('/places/place-restaurant.jpg');
    expect(imageForStop({ place_type: 'drinks' })).toBe('/places/place-cocktail-bar.jpg');
    expect(imageForStop({ place_type: 'outdoor' })).toBe('/places/place-beach.jpg');
  });

  it('falls back to a vibe image when no type matches', () => {
    expect(imageForStop({ vibe_tags: ['super romantic'] })).toBe('/vibes/vibe-romantic.jpg');
    expect(imageForStop({ vibe_tags: ['Adventurous'] })).toBe('/vibes/vibe-adventurous.jpg');
  });

  it('never returns an empty string', () => {
    expect(imageForStop({})).toBe('/places/place-walk.jpg');
    expect(imageForStop({ photo_url: null, place_type: null, vibe_tags: null })).toBe('/places/place-walk.jpg');
  });
});

describe('coverImageForNight', () => {
  it('prefers the curated cover_image_url', () => {
    expect(coverImageForNight({ cover_image_url: 'cover.jpg', vibe_tags: ['romantic'] })).toBe('cover.jpg');
  });

  it('uses a real stop photo when present', () => {
    const r = coverImageForNight({
      stops: [{ photo_url: null, place_type: 'cafe' }, { photo_url: 'real.jpg', place_type: 'bar' }],
    });
    expect(r).toBe('real.jpg');
  });

  it('falls back to a vibe image', () => {
    expect(coverImageForNight({ vibe_tags: ['chill night'] })).toBe('/vibes/vibe-chill.jpg');
  });

  it('returns a deterministic lifestyle variant when no vibe/photo', () => {
    const a = coverImageForNight({ seedKey: 'date-a', vibe_tags: [] });
    const a2 = coverImageForNight({ seedKey: 'date-a', vibe_tags: [] });
    const b = coverImageForNight({ seedKey: 'date-zzz', vibe_tags: [] });
    expect(a).toBe(a2); // deterministic
    expect(a.startsWith('/pins/')).toBe(true);
    expect(b.startsWith('/pins/')).toBe(true);
    // Different seeds should usually pick different variants across the set.
    const variants = new Set(
      ['s1', 's2', 's3', 's4', 's5', 's6'].map((s) => coverImageForNight({ seedKey: s, vibe_tags: [] })),
    );
    expect(variants.size).toBeGreaterThan(1);
  });

  it('never returns an empty string', () => {
    expect(coverImageForNight({})).not.toBe('');
    expect(coverImageForNight({ cover_image_url: null, vibe_tags: null, stops: null })).not.toBe('');
  });
});

describe('coverImageFor (legacy planner resolver, unchanged behavior)', () => {
  it('prefers itineraryCover', () => {
    expect(coverImageFor([{ place_type: 'cafe' }], { itineraryCover: 'c.jpg' })).toBe('c.jpg');
  });
  it('falls back to a stop photo then type', () => {
    expect(coverImageFor([{ photo_url: 'p.jpg' }])).toBe('p.jpg');
    expect(coverImageFor([{ place_type: 'hike' }])).toBe('/places/place-hike.jpg');
  });
  it('handles empty stops', () => {
    expect(coverImageFor([])).toBe('/places/place-walk.jpg');
  });
});

import { describe, it, expect } from 'vitest';
import { spaceBySound } from '../spaceBySound';
import type { FeedNight } from '@after5/api-client';

// Minimal FeedNight stub — only the fields spaceBySound touches.
function night(id: string, sound: string | null): FeedNight {
  return {
    date_instance_id: id,
    city_id: 'c',
    time_window_start: '2026-06-16T20:00:00.000Z',
    pay_setting: null,
    vibe_tags: null,
    why_note: null,
    cover_image_url: null,
    title: id,
    venue_neighborhood: null,
    is_seed: false,
    distance_m: null,
    ambient_sound_path: sound,
    ambient_sound_name: null,
    fit: false,
    host_blurred_photo_url: null,
    host_first_name: null,
    host_age: null,
    city_name: null,
  };
}

function sounds(nights: FeedNight[]): (string | null)[] {
  return nights.map((n) => n.ambient_sound_path);
}

describe('spaceBySound', () => {
  // (a) AABB → no adjacent equal non-null sounds
  it('separates back-to-back duplicates (AABB → ABAB-ish)', () => {
    const input = [
      night('1', 'jazz.mp3'),
      night('2', 'jazz.mp3'),
      night('3', 'pop.mp3'),
      night('4', 'pop.mp3'),
    ];
    const result = spaceBySound(input);
    // No two adjacent non-null sounds should be equal
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1]!.ambient_sound_path;
      const curr = result[i]!.ambient_sound_path;
      if (prev && curr) {
        expect(prev).not.toBe(curr);
      }
    }
  });

  // (b) All-same input: no suitable swap exists → returned unchanged (same ids, same order)
  it('leaves all-same-sound input unchanged', () => {
    const input = [
      night('1', 'ambient.mp3'),
      night('2', 'ambient.mp3'),
      night('3', 'ambient.mp3'),
    ];
    const result = spaceBySound(input);
    expect(sounds(result)).toEqual(['ambient.mp3', 'ambient.mp3', 'ambient.mp3']);
    // Order preserved
    expect(result.map((n) => n.date_instance_id)).toEqual(['1', '2', '3']);
  });

  // (c) Nulls: allowed as neighbours — never moved, no spacing applied
  it('treats null sounds as always-allowed neighbours', () => {
    const input = [
      night('1', null),
      night('2', null),
      night('3', 'jazz.mp3'),
      night('4', null),
    ];
    const result = spaceBySound(input);
    // Nulls stay in place; no unnecessary swaps
    expect(result.map((n) => n.date_instance_id)).toEqual(['1', '2', '3', '4']);
    expect(sounds(result)).toEqual([null, null, 'jazz.mp3', null]);
  });

  it('does not space null next to non-null of same-group (null is always-ok)', () => {
    const input = [
      night('1', 'jazz.mp3'),
      night('2', null),
      night('3', 'jazz.mp3'),
    ];
    // No conflict: null can sit between two jazz.mp3 items, and null itself has no
    // sound so the null/jazz boundary is fine.
    const result = spaceBySound(input);
    expect(result.map((n) => n.date_instance_id)).toEqual(['1', '2', '3']);
  });

  // (d) Ranking preserved: first element never moves; minimal swaps
  it('never moves the first element', () => {
    const input = [
      night('first', 'jazz.mp3'),
      night('second', 'jazz.mp3'),
      night('third', 'pop.mp3'),
    ];
    const result = spaceBySound(input);
    expect(result[0]!.date_instance_id).toBe('first');
  });

  it('performs only the minimal swap needed (one targeted swap, not a full reshuffle)', () => {
    // [A, A, B, C] → swap index 1 (A) with index 2 (B) → [A, B, A, C]
    const input = [
      night('1', 'sound-a'),
      night('2', 'sound-a'),
      night('3', 'sound-b'),
      night('4', 'sound-c'),
    ];
    const result = spaceBySound(input);
    expect(result.map((n) => n.date_instance_id)).toEqual(['1', '3', '2', '4']);
    expect(sounds(result)).toEqual(['sound-a', 'sound-b', 'sound-a', 'sound-c']);
  });

  it('handles empty and single-item arrays without throwing', () => {
    expect(spaceBySound([])).toEqual([]);
    const single = [night('1', 'jazz.mp3')];
    expect(spaceBySound(single)).toEqual(single);
  });

  it('does not mutate the original array', () => {
    const input = [night('1', 'jazz.mp3'), night('2', 'jazz.mp3'), night('3', 'pop.mp3')];
    const originalIds = input.map((n) => n.date_instance_id);
    spaceBySound(input);
    expect(input.map((n) => n.date_instance_id)).toEqual(originalIds);
  });
});

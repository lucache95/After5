import { describe, it, expect } from 'vitest';
import { pickCounterpart, bucketLocksByStart, ratingOpensAt, isRatingOpen, matchChipLabel } from '../lock-view';

const profile = (id: string) => ({ id, first_name: 'x', age: 30, city: 'c', neighborhood: null, clear_photo_url: null, vibe_tags: [] });

describe('pickCounterpart', () => {
  it('returns matched when viewer is creator', () => {
    const lock = { creator_id: 'me', matched_user_id: 'them', creator: profile('me'), matched: profile('them') } as any;
    expect(pickCounterpart(lock, 'me')?.id).toBe('them');
  });
  it('returns creator when viewer is matched', () => {
    const lock = { creator_id: 'them', matched_user_id: 'me', creator: profile('them'), matched: profile('me') } as any;
    expect(pickCounterpart(lock, 'me')?.id).toBe('them');
  });
});

describe('bucketLocksByStart', () => {
  const NOW = new Date('2026-06-09T12:00:00Z');
  const at = (iso: string | null) => (iso ? { starts_at: iso } : null);

  it('puts an active lock with a future night under upcoming, everything else under past', () => {
    const rows = [
      { id: 'future', status: 'active', instance: at('2026-06-10T19:00:00Z') },
      { id: 'happened', status: 'active', instance: at('2026-06-08T19:00:00Z') },
      { id: 'done', status: 'completed', instance: at('2026-06-10T19:00:00Z') },
      { id: 'dead', status: 'cancelled', instance: at('2026-06-10T19:00:00Z') },
      { id: 'ghosted', status: 'no_show', instance: at('2026-06-01T19:00:00Z') },
    ] as any[];
    const { upcoming, past } = bucketLocksByStart(rows, NOW);
    expect(upcoming.map(r => r.id)).toEqual(['future']);
    expect(past.map(r => r.id)).toEqual(['happened', 'done', 'dead', 'ghosted']);
  });

  it('keeps an active lock with no start (date tbd) under upcoming', () => {
    const rows = [{ id: 'tbd', status: 'active', instance: null }] as any[];
    const { upcoming, past } = bucketLocksByStart(rows, NOW);
    expect(upcoming.map(r => r.id)).toEqual(['tbd']);
    expect(past).toEqual([]);
  });
});

describe('rating window (starts_at + duration + 2h)', () => {
  const instance = { starts_at: '2026-05-01T18:00:00Z', time_range: '["2026-05-01 18:00:00+00","2026-05-01 20:30:00+00")' } as any;
  it('opens 2h after time_range upper', () => {
    expect(ratingOpensAt(instance)?.toISOString()).toBe('2026-05-01T22:30:00.000Z');
  });
  it('closed before open time', () => {
    expect(isRatingOpen(instance, new Date('2026-05-01T22:29:00Z'))).toBe(false);
  });
  it('open at exactly the boundary', () => {
    expect(isRatingOpen(instance, new Date('2026-05-01T22:30:00Z'))).toBe(true);
  });
  it('falls back to starts_at + 150 + 120 when time_range is null', () => {
    expect(ratingOpensAt({ starts_at: '2026-05-01T18:00:00Z', time_range: null } as any)?.toISOString())
      .toBe('2026-05-01T22:30:00.000Z');
  });
});

describe('matchChipLabel', () => {
  it('always reads upcoming in the upcoming bucket', () => {
    expect(matchChipLabel('active', true)).toBe('upcoming');
  });
  it('maps past statuses to lowercase copy', () => {
    expect(matchChipLabel('completed', false)).toBe('done');
    expect(matchChipLabel('cancelled', false)).toBe('cancelled');
    expect(matchChipLabel('no_show', false)).toBe('no-show');
    // active-but-past-dated: the night happened, the sweep just hasn't run.
    expect(matchChipLabel('active', false)).toBe('done');
  });
});

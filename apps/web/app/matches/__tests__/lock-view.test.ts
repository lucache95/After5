import { describe, it, expect } from 'vitest';
import { pickCounterpart, bucketLocks, ratingOpensAt, isRatingOpen, lockStatusLabel } from '../lock-view';

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

describe('bucketLocks', () => {
  it('splits active from past', () => {
    const rows = [
      { id: '1', status: 'active' }, { id: '2', status: 'completed' }, { id: '3', status: 'cancelled' },
    ] as any[];
    const { active, past } = bucketLocks(rows);
    expect(active.map(r => r.id)).toEqual(['1']);
    expect(past.map(r => r.id)).toEqual(['2', '3']);
  });
  it('treats no_show as past', () => {
    const rows = [{ id: '1', status: 'active' }, { id: '2', status: 'no_show' }] as any[];
    const { active, past } = bucketLocks(rows);
    expect(active.map(r => r.id)).toEqual(['1']);
    expect(past.map(r => r.id)).toEqual(['2']);
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

describe('lockStatusLabel', () => {
  it('maps statuses to lowercase copy', () => {
    expect(lockStatusLabel('active')).toBe('locked in');
    expect(lockStatusLabel('completed')).toBe('done');
    expect(lockStatusLabel('cancelled')).toBe('cancelled');
  });
});

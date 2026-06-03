import { describe, it, expect } from 'vitest';
import { prefersMiles, formatDistanceAway, formatReach } from '../distance';

describe('prefersMiles', () => {
  it('reads miles for US/UK locales', () => {
    expect(prefersMiles('en-US')).toBe(true);
    expect(prefersMiles('en-GB')).toBe(true);
  });
  it('reads km elsewhere', () => {
    expect(prefersMiles('en-CA')).toBe(false);
    expect(prefersMiles('fr-FR')).toBe(false);
    expect(prefersMiles('de')).toBe(false);
  });
  it('falls back to km on garbage input', () => {
    expect(prefersMiles('not-a-locale!!')).toBe(false);
  });
});

describe('formatDistanceAway', () => {
  it('returns null for null distance', () => {
    expect(formatDistanceAway(null)).toBeNull();
  });
  it('rounds km, floors sub-1km to a tenth, min 0.1', () => {
    expect(formatDistanceAway(100, 'en-CA')).toBe('0.1 km away');
    expect(formatDistanceAway(12400, 'en-CA')).toBe('12 km away');
  });
  it('converts to miles for US viewers', () => {
    // 16093.44 m = 10 mi exactly
    expect(formatDistanceAway(16093.44, 'en-US')).toBe('10 mi away');
  });
});

describe('formatReach', () => {
  it('returns null when radius is missing', () => {
    expect(formatReach(null)).toBeNull();
    expect(formatReach(undefined)).toBeNull();
  });
  it('renders km by default and mi for US', () => {
    expect(formatReach(30, 'en-CA')).toBe('30 km');
    expect(formatReach(30, 'en-US')).toBe('19 mi');
  });
});

import { describe, it, expect } from 'vitest';
import { vibePalette } from '../vibePalette';

describe('vibePalette', () => {
  it('returns a palette with bg, accent, ink all as #-prefixed hex strings', () => {
    const p = vibePalette(['jazz']);
    expect(p.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(p.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(p.ink).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('jazz tag returns midnight-blue palette', () => {
    const p = vibePalette(['jazz']);
    expect(p).toEqual(vibePalette(['jazz'])); // deterministic
    expect(p.bg).toBe('#0E1A2B');
  });

  it('substring match — "live jazz" resolves to jazz palette', () => {
    expect(vibePalette(['live jazz'])).toEqual(vibePalette(['jazz']));
  });

  it('case-insensitive — "JAZZ" matches jazz palette', () => {
    expect(vibePalette(['JAZZ'])).toEqual(vibePalette(['jazz']));
  });

  it('beach tag returns coral/peachy palette', () => {
    const p = vibePalette(['beach']);
    expect(p.bg).toBe('#FDE8DC');
  });

  it('pottery tag returns warm clay palette', () => {
    const p = vibePalette(['pottery']);
    expect(p.bg).toBe('#EDD9C0');
  });

  it('coffee tag returns latte palette', () => {
    const p = vibePalette(['coffee']);
    expect(p.bg).toBe('#F5ECD7');
  });

  it('active tag returns fresh green palette', () => {
    const p = vibePalette(['active']);
    expect(p.bg).toBe('#D4EDDA');
  });

  it('first-match-wins when multiple tags match different moods', () => {
    // First tag is "beach", second is "jazz" — should return beach palette
    const p = vibePalette(['beach', 'jazz']);
    expect(p).toEqual(vibePalette(['beach']));
  });

  it('null returns the default Barbiecore-neutral palette', () => {
    const p = vibePalette(null);
    expect(p.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('undefined returns the default Barbiecore-neutral palette', () => {
    expect(vibePalette(undefined)).toEqual(vibePalette(null));
  });

  it('empty array returns the default Barbiecore-neutral palette', () => {
    expect(vibePalette([])).toEqual(vibePalette(null));
  });

  it('completely unknown tags return the default palette', () => {
    expect(vibePalette(['zorblax', 'quux'])).toEqual(vibePalette(null));
  });

  it('returns the same default palette deterministically', () => {
    expect(vibePalette(null)).toEqual(vibePalette(null));
  });
});

import { describe, it, expect } from 'vitest';
import { normalizeSubscribeInput } from '../subscribe';

describe('normalizeSubscribeInput', () => {
  it('lowercases + trims email and rejects malformed', () => {
    expect(normalizeSubscribeInput({ email: '  A@B.CO ' }).email).toBe('a@b.co');
    expect(normalizeSubscribeInput({ email: 'nope' }).valid).toBe(false);
  });
  it('clamps city + first_name length', () => {
    const out = normalizeSubscribeInput({ email: 'a@b.co', city: 'x'.repeat(200), first_name: 'y'.repeat(200) });
    expect(out.city!.length).toBe(80);
    expect(out.first_name!.length).toBe(40);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveCitySlug } from '../cities';

const known = [
  { slug: 'kelowna', name: 'Kelowna' },
  { slug: 'vancouver', name: 'Vancouver' },
];

describe('resolveCitySlug', () => {
  it('matches a known city case-insensitively from the geo header', () => {
    expect(resolveCitySlug('Vancouver', known)).toEqual({ slug: 'vancouver', fellBack: false });
  });
  it('url-decodes the header value', () => {
    expect(resolveCitySlug('Kelowna', known)).toEqual({ slug: 'kelowna', fellBack: false });
  });
  it('falls back to kelowna for an unknown city', () => {
    expect(resolveCitySlug('Toronto', known)).toEqual({ slug: 'kelowna', fellBack: true });
  });
  it('falls back to kelowna when the header is missing', () => {
    expect(resolveCitySlug(null, known)).toEqual({ slug: 'kelowna', fellBack: true });
  });
});

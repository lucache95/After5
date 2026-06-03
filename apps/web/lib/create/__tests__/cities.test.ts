import { describe, it, expect } from 'vitest';
import { initialCityText } from '../cities';

describe('initialCityText', () => {
  it('seeds the input from the geo header', () => {
    expect(initialCityText('Vancouver')).toBe('Vancouver');
  });
  it('url-decodes the header value', () => {
    expect(initialCityText('New%20York')).toBe('New York');
  });
  it('returns empty when the header is missing', () => {
    expect(initialCityText(null)).toBe('');
    expect(initialCityText(undefined)).toBe('');
  });
});

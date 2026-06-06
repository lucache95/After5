// @after5/date-quality — live noHallucinatedVenue resolver tests (Area 3, T-09-09).
//
// The anti-fabrication check lives in the LIVE runner (scripts/eval-dategen.ts),
// NOT in the pure gate set: dry mode writes copy over FROZEN place_ids and so
// can never hallucinate. The teeth are in --live, where a generated place_id
// that does not resolve against a pinned places snapshot is a CRITICAL failure.
//
// We import the pure resolver from the script module so it is unit-testable
// without fs / a real LLM.

import { describe, it, expect } from 'vitest';

import { noHallucinatedVenue } from '../../scripts/eval-dategen';

describe('noHallucinatedVenue', () => {
  const snapshot = new Set([
    'c01d0000-0001-4b01-8101-000000000001',
    'c01d0000-0001-4b01-8101-000000000002',
  ]);

  it('passes when every emitted place_id resolves in the snapshot', () => {
    const r = noHallucinatedVenue(
      [
        { place_id: 'c01d0000-0001-4b01-8101-000000000001', place_name: 'A' },
        { place_id: 'c01d0000-0001-4b01-8101-000000000002', place_name: 'B' },
      ],
      snapshot,
    );
    expect(r.pass).toBe(true);
    expect(r.severity).toBe('critical');
    expect(r.unresolved).toEqual([]);
  });

  it('fails CRITICALLY when an emitted place_id is absent from the snapshot', () => {
    const r = noHallucinatedVenue(
      [
        { place_id: 'c01d0000-0001-4b01-8101-000000000001', place_name: 'A' },
        { place_id: 'deadbeef-0000-4000-8000-000000000000', place_name: 'Ghost Bar' },
      ],
      snapshot,
    );
    expect(r.pass).toBe(false);
    expect(r.severity).toBe('critical');
    expect(r.unresolved).toContain('deadbeef-0000-4000-8000-000000000000');
    expect(r.evidence.join(' ')).toContain('Ghost Bar');
  });

  it('passes vacuously on an empty stop set', () => {
    const r = noHallucinatedVenue([], snapshot);
    expect(r.pass).toBe(true);
    expect(r.unresolved).toEqual([]);
  });
});

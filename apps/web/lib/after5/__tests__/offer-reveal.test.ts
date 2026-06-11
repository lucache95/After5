// Reveal-at-pick gate (2026-06-10): must mirror match_reveal_allowed_pair's
// offer branch — candidate only, accepted always, active only while unexpired.
import { describe, it, expect } from 'vitest';
import { offerRevealsHostClear } from '../offer-reveal';

const future = new Date(Date.now() + 3600_000).toISOString();
const past = new Date(Date.now() - 1000).toISOString();

describe('offerRevealsHostClear', () => {
  it('true for the candidate of an active unexpired offer', () => {
    expect(offerRevealsHostClear('cand', { candidate_id: 'cand', status: 'active', expires_at: future })).toBe(true);
  });

  it('true for the candidate of an accepted offer (regardless of expiry)', () => {
    expect(offerRevealsHostClear('cand', { candidate_id: 'cand', status: 'accepted', expires_at: past })).toBe(true);
  });

  it('false once the active offer is past expires_at (self-revoking)', () => {
    expect(offerRevealsHostClear('cand', { candidate_id: 'cand', status: 'active', expires_at: past })).toBe(false);
  });

  it('false for passed/expired statuses', () => {
    expect(offerRevealsHostClear('cand', { candidate_id: 'cand', status: 'passed', expires_at: future })).toBe(false);
    expect(offerRevealsHostClear('cand', { candidate_id: 'cand', status: 'expired', expires_at: future })).toBe(false);
  });

  it('false for the HOST (host-side stays lock-gated)', () => {
    expect(offerRevealsHostClear('host', { candidate_id: 'cand', status: 'active', expires_at: future })).toBe(false);
  });

  it('false for null offer or missing expires_at on active', () => {
    expect(offerRevealsHostClear('cand', null)).toBe(false);
    expect(offerRevealsHostClear('cand', { candidate_id: 'cand', status: 'active', expires_at: null })).toBe(false);
  });
});

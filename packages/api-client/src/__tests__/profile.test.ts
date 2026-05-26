// packages/api-client/src/__tests__/profile.test.ts
import { describe, it, expect, vi } from 'vitest';
import { savePreferences, getMyBadge } from '../profile';
import type { After5Client } from '../index';
function fakeClient(rows: unknown) {
  const single = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ single, maybeSingle: single }));
  const update = vi.fn(() => ({ eq }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update, select }));
  return { client: { from } as unknown as After5Client, from, update };
}
describe('savePreferences', () => {
  it('writes the mapped preference columns to profiles', async () => {
    const { client, from, update } = fakeClient({});
    await savePreferences(client, 'user-1', {
      gender: 'woman', gender_preferences: ['man'],
      age_min: 25, age_max: 40, distance_pref_km: 35, dealbreakers: ['smoking'],
    });
    expect(from).toHaveBeenCalledWith('profiles');
    const patch = update.mock.calls[0][0];
    expect(patch.gender).toBe('woman');
    expect(patch.distance_pref_km).toBe(35);
    expect(patch.age_pref).toBe('[25,40]');
  });
});
describe('getMyBadge', () => {
  it('derives the badge from the fetched profile row', async () => {
    const { client } = fakeClient({ verification: 'verified', reliability_score: null });
    const badge = await getMyBadge(client, 'user-1');
    expect(badge).toEqual({ verified: true, isNew: true });
  });
});

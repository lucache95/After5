// packages/api-client/src/__tests__/profile.test.ts
import { describe, it, expect, vi } from 'vitest';
import { savePreferences, getMyBadge, saveFeedFilters, type FeedFilters } from '../profile';
import type { After5Client } from '../index';
function fakeClient(rows: unknown) {
  const single = vi.fn().mockResolvedValue({ data: rows, error: null });
  const eq = vi.fn(() => ({ single, maybeSingle: single }));
  const update = vi.fn((_patch: Record<string, unknown>) => ({ eq }));
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
    const patch = update.mock.calls[0]![0];
    expect(patch.gender).toBe('woman');
    expect(patch.distance_pref_km).toBe(35);
    expect(patch.age_pref).toBe('[25,40]');
    // DLB facts omitted → columns left untouched (not nulled out)
    expect('smokes' in patch).toBe(false);
    expect('wants_kids' in patch).toBe(false);
  });

  it('DLB: writes supplied lifestyle facts, including explicit null (clear answer)', async () => {
    const { client, update } = fakeClient({});
    await savePreferences(client, 'user-1', {
      gender: 'woman', gender_preferences: ['man'],
      age_min: 25, age_max: 40, distance_pref_km: 35, dealbreakers: [],
      smokes: true, drinks: null, has_pets: false,
    });
    const patch = update.mock.calls[0]![0];
    expect(patch.smokes).toBe(true);
    expect(patch.drinks).toBeNull();
    expect(patch.has_pets).toBe(false);
    expect('wants_kids' in patch).toBe(false); // undefined = untouched
  });
});
describe('getMyBadge', () => {
  it('derives the badge from the fetched profile row', async () => {
    const { client } = fakeClient({ verification: 'verified', reliability_score: null });
    const badge = await getMyBadge(client, 'user-1');
    expect(badge).toEqual({ verified: true, isNew: true });
  });
});

// A client whose update(...).eq(...) RESOLVES to { error } — the self-write path
// awaits the eq() result directly (unlike the read path which chains .single()).
function writeClient(error: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn((_patch: Record<string, unknown>) => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from } as unknown as After5Client, from, update, eq };
}

describe('saveFeedFilters', () => {
  it('self-writes feed_filters scoped to .eq("id", userId)', async () => {
    const { client, from, update, eq } = writeClient();
    const filters: FeedFilters = {
      host_genders: ['woman'],
      max_price: 80,
      max_distance_km: 25,
      vibes: ['cozy'],
      who_pays: ['split'],
      time_buckets: ['evening'],
      host_age_range: [25, 40],
    };
    await saveFeedFilters(client, 'user-1', filters);
    expect(from).toHaveBeenCalledWith('profiles');
    const patch = update.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.feed_filters).toEqual(filters);
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });
  it('throws when the update returns an error', async () => {
    const { client } = writeClient({ message: 'denied', code: '42501' });
    await expect(saveFeedFilters(client, 'user-1', {})).rejects.toBeTruthy();
  });
});

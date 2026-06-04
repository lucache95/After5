import { describe, it, expect, vi } from 'vitest';
import { postNight, browseFeed, ambientSoundUrl, updateItineraryStops, cancelNight, updateNight, reachPreview, type FeedNight } from '../feed';

function mockClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) } as never;
}

// A client whose rpc resolves and whose auth.getUser returns a stable uid, so the
// E6/E7 wrappers can resolve p_actor. rpc default returns { data: null, error: null }.
function mockAuthedClient(uid = 'host-1', rpcResult: { data: unknown; error: unknown } = { data: null, error: null }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: uid } }, error: null }) },
  } as never;
}

describe('postNight', () => {
  it('passes p_ambient_sound_id when provided', async () => {
    const c = mockClient({ data: 'inst-1', error: null });
    await postNight(c, { itinerary_id: 'it-1', starts_at: 'T', ambient_sound_id: 'amb-9' });
    expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'post_night',
      expect.objectContaining({ p_itinerary: 'it-1', p_ambient_sound_id: 'amb-9' }),
    );
  });
  it('passes undefined ambient id when omitted (vibe-auto fallback path)', async () => {
    const c = mockClient({ data: 'inst-1', error: null });
    await postNight(c, { itinerary_id: 'it-1', starts_at: 'T' });
    expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'post_night',
      expect.objectContaining({ p_ambient_sound_id: undefined }),
    );
  });
});

describe('ambientSoundUrl', () => {
  it('prefixes the public bucket base for a relative path', () => {
    expect(ambientSoundUrl('lofi/calm.m4a', 'https://x.supabase.co'))
      .toBe('https://x.supabase.co/storage/v1/object/public/ambient-sounds/lofi/calm.m4a');
  });
  it('strips a trailing slash from the base URL', () => {
    expect(ambientSoundUrl('lofi/calm.m4a', 'https://x.supabase.co/'))
      .toBe('https://x.supabase.co/storage/v1/object/public/ambient-sounds/lofi/calm.m4a');
  });
  it('returns null for a null path', () => {
    expect(ambientSoundUrl(null, 'https://x.supabase.co')).toBeNull();
  });
});

describe('browseFeed', () => {
  it('passes ambient_sound_path through into FeedNight', async () => {
    const row: Partial<FeedNight> & { ambient_sound_path: string } = {
      date_instance_id: 'd1', ambient_sound_path: 'lofi/calm.m4a', ambient_sound_name: 'calm',
    };
    const c = mockClient({ data: [row], error: null });
    const out = await browseFeed(c);
    expect(out[0]?.ambient_sound_path).toBe('lofi/calm.m4a');
    expect(out[0]?.ambient_sound_name).toBe('calm');
  });
});

describe('cancelNight', () => {
  it('calls cancel_night with p_actor (uid), p_instance, and a generated p_idem_key', async () => {
    const c = mockAuthedClient('host-1');
    await cancelNight(c, { instance_id: 'inst-9' });
    const rpc = (c as { rpc: ReturnType<typeof vi.fn> }).rpc;
    expect(rpc).toHaveBeenCalledWith('cancel_night', expect.objectContaining({
      p_actor: 'host-1', p_instance: 'inst-9',
    }));
    const arg = rpc.mock.calls[0]![1] as { p_idem_key: string };
    expect(typeof arg.p_idem_key).toBe('string');
    expect(arg.p_idem_key.length).toBeGreaterThan(0);
  });
  it('forwards a supplied idem_key (retry no-op contract)', async () => {
    const c = mockAuthedClient('host-1');
    await cancelNight(c, { instance_id: 'inst-9', idem_key: 'fixed-key' });
    expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'cancel_night', expect.objectContaining({ p_idem_key: 'fixed-key' }),
    );
  });
  it('throws when the RPC returns an error', async () => {
    const c = mockAuthedClient('host-1', { data: null, error: { message: 'not_creator', code: '42501' } });
    await expect(cancelNight(c, { instance_id: 'inst-9' })).rejects.toBeTruthy();
  });
});

describe('updateNight', () => {
  it('sends only provided fields; omitted fields are null (leave-unchanged)', async () => {
    const c = mockAuthedClient('host-1');
    await updateNight(c, { instance_id: 'inst-9', starts_at: '2026-07-01T19:00:00Z', venue: 'venue-2' });
    expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith('update_night', expect.objectContaining({
      p_actor: 'host-1',
      p_instance: 'inst-9',
      p_starts_at: '2026-07-01T19:00:00Z',
      p_venue: 'venue-2',
      p_duration_min: null,
      p_ambient_sound_id: null,
    }));
  });
  it('throws when the RPC returns an error', async () => {
    const c = mockAuthedClient('host-1', { data: null, error: { message: 'not_cancellable', code: 'P0001' } });
    await expect(updateNight(c, { instance_id: 'inst-9', duration_min: 90 })).rejects.toBeTruthy();
  });
});

describe('browseFeed fit column', () => {
  it('carries the targeting-only fit boolean from the RPC payload', async () => {
    const row: Partial<FeedNight> & { fit: boolean } = { date_instance_id: 'd1', fit: true };
    const c = mockClient({ data: [row], error: null });
    const out = await browseFeed(c);
    expect(out[0]?.fit).toBe(true);
  });
});

describe('reachPreview', () => {
  it('calls reach_preview with the real signature and returns the count', async () => {
    const c = mockClient({ data: 7, error: null });
    const n = await reachPreview(c, {
      target_genders: ['woman'],
      target_age_range: '[25,40)',
      city: 'city-1',
      radius_km: 25,
    });
    expect(n).toBe(7);
    expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'reach_preview',
      expect.objectContaining({
        p_target_genders: ['woman'],
        p_target_age_range: '[25,40)',
        p_city: 'city-1',
        p_radius_km: 25,
      }),
    );
  });
  it('sends undefined for omitted optional params (open default)', async () => {
    const c = mockClient({ data: 0, error: null });
    await reachPreview(c, { city: 'city-1' });
    expect((c as { rpc: ReturnType<typeof vi.fn> }).rpc).toHaveBeenCalledWith(
      'reach_preview',
      expect.objectContaining({
        p_target_genders: undefined,
        p_target_age_range: undefined,
        p_city: 'city-1',
        p_radius_km: undefined,
      }),
    );
  });
  it('throws when the RPC returns an error', async () => {
    const c = mockClient({ data: null, error: { message: 'denied', code: '42501' } });
    await expect(reachPreview(c, { city: 'city-1' })).rejects.toBeTruthy();
  });
  it('coerces a null/absent count to 0', async () => {
    const c = mockClient({ data: null, error: null });
    expect(await reachPreview(c, { city: 'city-1' })).toBe(0);
  });
});

describe('updateItineraryStops', () => {
  it('calls the RPC with mapped params and returns the id', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 'itin-1', error: null });
    const client = { rpc } as never;
    const id = await updateItineraryStops(client, {
      itinerary_id: 'itin-1',
      stops: [{ place_id: 'p1', place_name: 'clay', start_time: '18:00', duration_min: 90, estimated_cost_pp: 35 }],
      title: 'pottery + ramen',
    });
    expect(id).toBe('itin-1');
    expect(rpc).toHaveBeenCalledWith('update_itinerary_stops', expect.objectContaining({
      p_itinerary: 'itin-1', p_title: 'pottery + ramen',
    }));
  });
});

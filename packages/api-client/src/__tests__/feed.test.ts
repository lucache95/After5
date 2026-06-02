import { describe, it, expect, vi } from 'vitest';
import { postNight, browseFeed, ambientSoundUrl, type FeedNight } from '../feed';

function mockClient(result: { data: unknown; error: unknown }) {
  return { rpc: vi.fn().mockResolvedValue(result) } as never;
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

// apps/web/lib/after5/photos.test.ts
// Wave-0 unit cover for signBlurredUrls (E15 / REQ-E15 / D-01). The blurred signer
// is the rung-1/2 host-hint path; it mirrors signClearUrls but needs NO reveal gate
// (storage policy profile_photos_blurred_read_v2 authorizes any authenticated read).
// Signing is per-path (createSignedUrl) since the batch API can't transform; this
// suite runs in jsdom (window defined) so the signer takes the direct, uncached path.
import { describe, it, expect, vi } from 'vitest';
import type { After5Client } from '@after5/api-client';
import { signBlurredUrls } from './photos';

// A minimal storage double: createSignedUrl is the only call the signer makes.
function clientWith(createSignedUrl: ReturnType<typeof vi.fn>): After5Client {
  return { storage: { from: () => ({ createSignedUrl }) } } as unknown as After5Client;
}

describe('signBlurredUrls', () => {
  it('short-circuits on an empty array without touching storage', async () => {
    const createSignedUrl = vi.fn();
    const out = await signBlurredUrls(clientWith(createSignedUrl), []);
    expect(out).toEqual([]);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('signs each blurred path in the profile-photos bucket with the 1h ttl', async () => {
    const createSignedUrl = vi.fn().mockImplementation((path: string) =>
      Promise.resolve({ data: { signedUrl: `https://x/storage/v1/object/sign/${path}?token=t` }, error: null }));
    const paths = ['a/1_blurred.jpg', 'b/2_blurred.jpg'];
    const out = await signBlurredUrls(clientWith(createSignedUrl), paths);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
    expect(createSignedUrl).toHaveBeenCalledWith('a/1_blurred.jpg', 3600, undefined);
    expect(createSignedUrl).toHaveBeenCalledWith('b/2_blurred.jpg', 3600, undefined);
    expect(out).toEqual([
      'https://x/storage/v1/object/sign/a/1_blurred.jpg?token=t',
      'https://x/storage/v1/object/sign/b/2_blurred.jpg?token=t',
    ]);
  });

  it('drops null signed urls', async () => {
    const createSignedUrl = vi.fn()
      .mockResolvedValueOnce({ data: { signedUrl: 'https://x/ok_blurred.jpg' }, error: null })
      .mockResolvedValueOnce({ data: { signedUrl: null }, error: null });
    const out = await signBlurredUrls(clientWith(createSignedUrl), ['ok_blurred.jpg', 'bad_blurred.jpg']);
    expect(out).toEqual(['https://x/ok_blurred.jpg']);
  });

  it('throws the storage error message when signing fails', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(signBlurredUrls(clientWith(createSignedUrl), ['a_blurred.jpg'])).rejects.toThrow('nope');
  });

  it('throws on non-blurred paths before touching storage (clear-photo guard)', async () => {
    const createSignedUrl = vi.fn();
    await expect(signBlurredUrls(clientWith(createSignedUrl), ['a/1_blurred.jpg', 'a/1.jpg']))
      .rejects.toThrow('signBlurredUrls received non-blurred path(s): a/1.jpg');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});

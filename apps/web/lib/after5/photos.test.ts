// apps/web/lib/after5/photos.test.ts
// Wave-0 unit cover for signBlurredUrls (E15 / REQ-E15 / D-01). The blurred signer
// is the rung-1/2 host-hint path; it mirrors signClearUrls but needs NO reveal gate
// (storage policy profile_photos_blurred_read_v2 authorizes any authenticated read).
import { describe, it, expect, vi } from 'vitest';
import type { After5Client } from '@after5/api-client';
import { signBlurredUrls } from './photos';

// A minimal storage double: createSignedUrls is the only call the signer makes.
function clientWith(createSignedUrls: ReturnType<typeof vi.fn>): After5Client {
  return { storage: { from: () => ({ createSignedUrls }) } } as unknown as After5Client;
}

describe('signBlurredUrls', () => {
  it('short-circuits on an empty array without touching storage', async () => {
    const createSignedUrls = vi.fn();
    const out = await signBlurredUrls(clientWith(createSignedUrls), []);
    expect(out).toEqual([]);
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('signs the blurred paths in the profile-photos bucket with a 600s ttl', async () => {
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [
        { signedUrl: 'https://x/storage/v1/object/sign/a/1_blurred.jpg?token=aa' },
        { signedUrl: 'https://x/storage/v1/object/sign/b/2_blurred.jpg?token=bb' },
      ],
      error: null,
    });
    const paths = ['a/1_blurred.jpg', 'b/2_blurred.jpg'];
    const out = await signBlurredUrls(clientWith(createSignedUrls), paths);
    expect(createSignedUrls).toHaveBeenCalledWith(paths, 600);
    expect(out).toEqual([
      'https://x/storage/v1/object/sign/a/1_blurred.jpg?token=aa',
      'https://x/storage/v1/object/sign/b/2_blurred.jpg?token=bb',
    ]);
  });

  it('drops null signed urls', async () => {
    const createSignedUrls = vi.fn().mockResolvedValue({
      data: [{ signedUrl: 'https://x/ok_blurred.jpg' }, { signedUrl: null }],
      error: null,
    });
    const out = await signBlurredUrls(clientWith(createSignedUrls), ['ok_blurred.jpg', 'bad_blurred.jpg']);
    expect(out).toEqual(['https://x/ok_blurred.jpg']);
  });

  it('throws the storage error message when signing fails', async () => {
    const createSignedUrls = vi.fn().mockResolvedValue({ data: null, error: { message: 'nope' } });
    await expect(signBlurredUrls(clientWith(createSignedUrls), ['a_blurred.jpg'])).rejects.toThrow('nope');
  });
});

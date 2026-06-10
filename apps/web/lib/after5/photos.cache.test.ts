// @vitest-environment node
// apps/web/lib/after5/photos.cache.test.ts
// Stable-signed-URL behavior (perf fix): on the server, signClearUrls /
// signBlurredUrls wrap per-path signing in Next's data cache so repeated
// requests within the revalidate window get the SAME url (browser + next/image
// caches hit). Runs in node (no window) so the cached branch is exercised;
// next/cache is mocked with a memoizing stand-in for the incremental cache.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { After5Client } from '@after5/api-client';

// vi.mock is hoisted above imports, so the mock state must be hoisted too.
const { memo, unstableCacheSpy } = vi.hoisted(() => {
  const memo = new Map<string, Promise<unknown>>();
  const unstableCacheSpy = vi.fn(
    (cb: () => Promise<unknown>, keyParts: string[], _opts: { revalidate: number }) =>
      () => {
        const key = keyParts.join('|');
        if (!memo.has(key)) memo.set(key, cb());
        return memo.get(key)!;
      },
  );
  return { memo, unstableCacheSpy };
});
vi.mock('next/cache', () => ({ unstable_cache: unstableCacheSpy }));

import { signClearUrls, signBlurredUrls } from './photos';

function clientWith(createSignedUrl: ReturnType<typeof vi.fn>): After5Client {
  return { storage: { from: () => ({ createSignedUrl }) } } as unknown as After5Client;
}

// A signer double that mints a DIFFERENT token per call — like real storage.
function mintingSigner() {
  let n = 0;
  return vi.fn().mockImplementation((path: string) =>
    Promise.resolve({ data: { signedUrl: `https://x/sign/${path}?token=${++n}` }, error: null }));
}

beforeEach(() => {
  memo.clear();
  unstableCacheSpy.mockClear();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
});

describe('signed-url stability (unstable_cache wrapper)', () => {
  it('returns the SAME url for repeated calls with the same path (cache hit, one storage call)', async () => {
    const createSignedUrl = mintingSigner();
    const client = clientWith(createSignedUrl);
    const [first] = await signClearUrls(client, ['u/p.jpg']);
    const [second] = await signClearUrls(client, ['u/p.jpg']);
    expect(first).toBe(second);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    expect(unstableCacheSpy).toHaveBeenCalledWith(
      expect.any(Function),
      ['after5-signed-photo-v2', 'u/p.jpg', '3600', 'orig'],
      { revalidate: 1800 },
    );
  });

  it('caches per path + width: different widths are distinct entries', async () => {
    const createSignedUrl = mintingSigner();
    const client = clientWith(createSignedUrl);
    const [orig] = await signClearUrls(client, ['u/p.jpg']);
    const [w400] = await signClearUrls(client, ['u/p.jpg'], { width: 400 });
    const [w400again] = await signClearUrls(client, ['u/p.jpg'], { width: 400 });
    expect(orig).not.toBe(w400);
    expect(w400).toBe(w400again);
    expect(createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('passes the storage transform when width is set against a hosted project', async () => {
    const createSignedUrl = mintingSigner();
    await signClearUrls(clientWith(createSignedUrl), ['u/p.jpg'], { width: 400 });
    // Square contain box: width-only transforms do NOT preserve aspect ratio
    // (prod returned 400×1080 from a 1080×1080 original — the "zoomed in" bug).
    expect(createSignedUrl).toHaveBeenCalledWith('u/p.jpg', 3600, {
      transform: { width: 400, height: 400, resize: 'contain' },
    });
  });

  it('skips the transform on the local stack (image_transformation disabled in config.toml)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    const createSignedUrl = mintingSigner();
    await signClearUrls(clientWith(createSignedUrl), ['u/p.jpg'], { width: 400 });
    expect(createSignedUrl).toHaveBeenCalledWith('u/p.jpg', 3600, undefined);
  });

  it('signBlurredUrls shares the cache wrapper and keeps the non-blurred guard', async () => {
    const createSignedUrl = mintingSigner();
    const client = clientWith(createSignedUrl);
    const [first] = await signBlurredUrls(client, ['u/p_blurred.jpg']);
    const [second] = await signBlurredUrls(client, ['u/p_blurred.jpg']);
    expect(first).toBe(second);
    expect(createSignedUrl).toHaveBeenCalledTimes(1);
    await expect(signBlurredUrls(client, ['u/p.jpg'])).rejects.toThrow('non-blurred');
  });

  it('does not cache failures: a signing error propagates and the next call retries', async () => {
    const createSignedUrl = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: { signedUrl: 'https://x/sign/u/p.jpg?token=ok' }, error: null });
    const client = clientWith(createSignedUrl);
    await expect(signClearUrls(client, ['u/p.jpg'])).rejects.toThrow('boom');
    // The memoizing double caches the rejected promise; clear it the way the
    // real data cache does (failed cb results are not persisted).
    memo.clear();
    await expect(signClearUrls(client, ['u/p.jpg'])).resolves.toEqual(['https://x/sign/u/p.jpg?token=ok']);
  });
});

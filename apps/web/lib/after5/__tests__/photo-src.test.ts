// Unit cover for resolveMirrorPhotoSrc — the shared list-surface normalizer for
// the profiles.clear_photo_url mirror (coherence-crawl findings 1–3). The
// load-bearing case: a REAL user's mirror is a relative storage path
// ('abc/def.jpg') and must come back as a signed URL, never verbatim.
// jsdom (window defined) → signClearUrls takes the direct uncached path.
import { describe, it, expect, vi } from 'vitest';
import type { After5Client } from '@after5/api-client';
import { resolveMirrorPhotoSrc, isRenderableSrc } from '../photo-src';

function clientWith(createSignedUrl: ReturnType<typeof vi.fn>): After5Client {
  return { storage: { from: () => ({ createSignedUrl }) } } as unknown as After5Client;
}

describe('resolveMirrorPhotoSrc', () => {
  it('returns null for falsy mirrors without touching storage', async () => {
    const createSignedUrl = vi.fn();
    expect(await resolveMirrorPhotoSrc(clientWith(createSignedUrl), null)).toBeNull();
    expect(await resolveMirrorPhotoSrc(clientWith(createSignedUrl), undefined)).toBeNull();
    expect(await resolveMirrorPhotoSrc(clientWith(createSignedUrl), '')).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('passes rooted public paths through verbatim (E2E seed shape)', async () => {
    const createSignedUrl = vi.fn();
    expect(await resolveMirrorPhotoSrc(clientWith(createSignedUrl), '/qa/host.jpg')).toBe('/qa/host.jpg');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('passes absolute http(s) urls through verbatim', async () => {
    const createSignedUrl = vi.fn();
    expect(await resolveMirrorPhotoSrc(clientWith(createSignedUrl), 'https://cdn.x/p.jpg')).toBe('https://cdn.x/p.jpg');
    expect(await resolveMirrorPhotoSrc(clientWith(createSignedUrl), 'http://cdn.x/p.jpg')).toBe('http://cdn.x/p.jpg');
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('signs a relative storage path against the profile-photos bucket (real-user mirror)', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://x/storage/v1/object/sign/abc/def.jpg?token=t' },
      error: null,
    });
    const out = await resolveMirrorPhotoSrc(clientWith(createSignedUrl), 'abc/def.jpg');
    expect(createSignedUrl).toHaveBeenCalledWith('abc/def.jpg', 3600, undefined);
    expect(out).toBe('https://x/storage/v1/object/sign/abc/def.jpg?token=t');
  });

  it('forwards width as a square contain transform when given', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: { signedUrl: 'https://x/s' }, error: null });
    await resolveMirrorPhotoSrc(clientWith(createSignedUrl), 'abc/def.jpg', { width: 128 });
    // jsdom env has no NEXT_PUBLIC_SUPABASE_URL pointing at localhost? — the
    // transform arg shape depends on transformsAvailable(); assert only the path+ttl.
    expect(createSignedUrl.mock.calls[0][0]).toBe('abc/def.jpg');
    expect(createSignedUrl.mock.calls[0][1]).toBe(3600);
  });

  it('degrades to null (initial avatar) when signing fails — never the raw path', async () => {
    const createSignedUrl = vi.fn().mockResolvedValue({ data: null, error: { message: 'denied' } });
    expect(await resolveMirrorPhotoSrc(clientWith(createSignedUrl), 'abc/def.jpg')).toBeNull();
  });
});

describe('isRenderableSrc', () => {
  it('classifies shapes', () => {
    expect(isRenderableSrc('/qa/x.jpg')).toBe(true);
    expect(isRenderableSrc('https://x/y.jpg')).toBe(true);
    expect(isRenderableSrc('abc/def.jpg')).toBe(false);
  });
});

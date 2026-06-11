// apps/web/lib/after5/photo-src.ts
// Shared normalizer for the profiles.clear_photo_url / blurred_photo_url
// MIRROR columns. Real users' mirrors hold a RELATIVE storage path
// ('<uid>/<photoId>.jpg' inside the profile-photos bucket — written by the
// generate-blur edge fn), while E2E seeds write rooted public paths
// ('/qa/...jpg'). Rendering the raw mirror into next/image therefore breaks
// for every real user (prod: broken img → initial avatar; dev: route crash).
//
// One contract for every LIST surface, matching the detail page's fallback
// (app/matches/[lockId]/page.tsx):
//   - falsy            → null (caller renders its initial-letter avatar)
//   - rooted '/...'    → returned as-is (public asset, e.g. seed fixtures)
//   - absolute http(s) → returned as-is (already a URL)
//   - anything else    → treated as a profile-photos storage path and signed
//                        via signClearUrls (unstable_cache'd, so the URL is
//                        stable for ~30min — browser/optimizer caches hit).
//
// SECURITY: this helper does not widen anything. The caller only possesses a
// storage path because an RLS'd profiles read projected it (post-lock /
// reveal-stage policies), and the signing call runs under the SAME viewer
// client — storage policy still has to pass. Callers stay responsible for
// their own gating (e.g. inbox only passes the mirror when lock_id is set).
import type { After5Client } from '@after5/api-client';
import { signClearUrls, type SignOptions } from './photos';

export function isRenderableSrc(path: string): boolean {
  return path.startsWith('/') || /^https?:\/\//i.test(path);
}

export async function resolveMirrorPhotoSrc(
  client: After5Client,
  path: string | null | undefined,
  opts: SignOptions = {},
): Promise<string | null> {
  if (!path) return null;
  if (isRenderableSrc(path)) return path;
  try {
    const [signed] = await signClearUrls(client, [path], opts);
    return signed ?? null;
  } catch {
    // Signing can fail (revoked policy, deleted object). Never propagate a
    // raw storage path to next/image — degrade to the initial avatar.
    return null;
  }
}

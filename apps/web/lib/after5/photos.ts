// apps/web/lib/after5/photos.ts
// M6 multi-photo gallery helpers. One profile_photos row per photo; clear object
// at profile-photos/<uid>/<id>.jpg, blurred sibling at <uid>/<id>_blurred.jpg
// (written by the generate-blur edge fn). profiles.clear_photo_url /
// blurred_photo_url stay a denormalized mirror of the PRIMARY photo. All writes
// go through the caller's RLS'd client (owner-scoped: .eq('user_id', userId)).
import { unstable_cache } from 'next/cache';
import type { After5Client } from '@after5/api-client';
import { MAX_PHOTOS } from '@after5/validators';

export interface PhotoRow {
  id: string;
  user_id: string;
  clear_path: string;
  blurred_path: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at: string;
}

const BUCKET = 'profile-photos';

// ─── pure helpers (unit-tested) ──────────────────────────────────────
export function nextSortOrder(rows: Pick<PhotoRow, 'sort_order'>[]): number {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((r) => r.sort_order)) + 1;
}

export function toReorderPayload<T extends { id: string }>(rows: T[]): { id: string; sort_order: number }[] {
  return rows.map((r, i) => ({ id: r.id, sort_order: i }));
}

// ─── client operations ───────────────────────────────────────────────
export async function listMyPhotos(client: After5Client, userId: string): Promise<PhotoRow[]> {
  const { data, error } = await client
    .from('profile_photos')
    .select('id, user_id, clear_path, blurred_path, sort_order, is_primary, created_at')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PhotoRow[];
}

// Upload a new clear photo, insert its row, and kick off the per-photo blur.
// First photo for a user becomes primary. Returns the new row id.
export async function addPhoto(client: After5Client, userId: string, blob: Blob): Promise<string> {
  const existing = await listMyPhotos(client, userId);
  if (existing.length >= MAX_PHOTOS) throw new Error('photo_limit_reached');
  const id = crypto.randomUUID();
  const clearPath = `${userId}/${id}.jpg`;
  const { error: upErr } = await client.storage
    .from(BUCKET)
    .upload(clearPath, blob, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw new Error(upErr.message);
  const isPrimary = existing.length === 0;
  const { error: insErr } = await client.from('profile_photos').insert({
    id,
    user_id: userId,
    clear_path: clearPath,
    sort_order: nextSortOrder(existing),
    is_primary: isPrimary,
  });
  if (insErr) throw insErr;
  const { error: blurErr } = await client.functions.invoke('generate-blur', { body: { clear_path: clearPath } });
  if (blurErr) throw new Error(blurErr.message ?? 'blur_failed');
  return id;
}

// Persist a dragged order. Mirrors InterestedList.persistOrder: one update per row.
export async function reorderPhotos(
  client: After5Client,
  userId: string,
  payload: { id: string; sort_order: number }[],
): Promise<void> {
  for (const { id, sort_order } of payload) {
    const { error } = await client
      .from('profile_photos')
      .update({ sort_order })
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  }
}

// Make one photo primary (clear all, set one), then re-blur it so the profiles
// mirror columns (clear_photo_url / blurred_photo_url) update via generate-blur.
export async function setPrimary(client: After5Client, userId: string, id: string): Promise<void> {
  const rows = await listMyPhotos(client, userId);
  const target = rows.find((r) => r.id === id);
  if (!target) throw new Error('photo_not_found');
  const { error: clearErr } = await client
    .from('profile_photos')
    .update({ is_primary: false })
    .eq('user_id', userId)
    .eq('is_primary', true);
  if (clearErr) throw clearErr;
  const { error: setErr } = await client
    .from('profile_photos')
    .update({ is_primary: true })
    .eq('id', id)
    .eq('user_id', userId);
  if (setErr) throw setErr;
  const { error: blurErr } = await client.functions.invoke('generate-blur', { body: { clear_path: target.clear_path } });
  if (blurErr) throw new Error(blurErr.message ?? 'blur_failed');
}

// Delete storage objects then the row. If it was primary, promote the lowest
// remaining sort_order to primary + re-blur so the mirror stays correct.
export async function removePhoto(client: After5Client, userId: string, photo: PhotoRow): Promise<void> {
  const paths = [photo.clear_path, photo.blurred_path].filter((p): p is string => !!p);
  if (paths.length) {
    const { error: rmErr } = await client.storage.from(BUCKET).remove(paths);
    if (rmErr) throw new Error(rmErr.message);
  }
  const { error: delErr } = await client.from('profile_photos').delete().eq('id', photo.id).eq('user_id', userId);
  if (delErr) throw delErr;
  if (photo.is_primary) {
    const remaining = await listMyPhotos(client, userId);
    if (remaining.length > 0) {
      await setPrimary(client, userId, remaining[0].id);
    }
  }
}

// ─── signed-URL signing + caching ────────────────────────────────────
// Signed URLs used to be minted fresh on every request (ttl 600s): each page
// view produced a NEW token → new URL → both the browser cache and the
// next/image optimizer cache missed → every photo fully re-downloaded on every
// view. Fix: mint 1h tokens and serve the SAME url for 30min via Next's data
// cache (unstable_cache), keyed per storage path. The browser then sees a
// stable URL and serves the bytes from its own cache; the worst-case cached
// url still has ≥30min of token life left.
const SIGN_TTL_S = 3600;
const SIGN_REVALIDATE_S = 1800;

export interface SignOptions {
  /** Token lifetime in seconds. Defaults to SIGN_TTL_S (1h). */
  ttl?: number;
  /**
   * Target render width in px (pass the ~2x device-pixel size of the slot).
   * Served via Supabase storage's /render/image transform — verified live on
   * prod (421KB original → 60KB at width 400). The local CLI stack ships with
   * [storage.image_transformation] disabled (Pro-plan API), so transform is
   * skipped there and the original object is signed instead.
   */
  width?: number;
}

// The local Supabase stack would 4xx on /render/image URLs (transform API off
// in supabase/config.toml), so only request transforms against hosted projects.
function transformsAvailable(): boolean {
  return !/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
}

// Single-path signer. createSignedUrls (batch) does not support transform, so
// signing is per-path; misses fan out in parallel and hits cost zero calls.
//
// TRANSFORM SHAPE — width-only does NOT proportionally downscale: live repro on
// prod returned 400×1080 from a 1080×1080 original (a center sliver), which CSS
// object-cover then re-cropped into a "zoomed in" face. Pass a SQUARE bounding
// box with resize:'contain' instead: pure proportional downscale (longest side
// = width), aspect ratio always preserved; the rendering layer owns cropping.
async function signOne(client: After5Client, path: string, ttl: number, width?: number): Promise<string | null> {
  const transform =
    width != null && transformsAvailable()
      ? { transform: { width, height: width, resize: 'contain' as const } }
      : undefined;
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, ttl, transform);
  if (error) throw new Error(error.message);
  return data?.signedUrl ?? null;
}

// Cache wrapper. unstable_cache needs the Next server runtime (incremental
// cache); photos.ts is also bundled into the client (ProfileEditor) and runs
// under vitest, where it either must not run or throws its "incrementalCache
// missing" invariant — fall back to direct signing there (per-request URLs,
// same as the old behavior).
//
// SECURITY NOTE — the cache key is the storage path (+ttl/width), NOT the
// viewer: a cache hit can replay a URL minted by a different viewer. That is
// acceptable because every calling surface only learns a path via an RLS'd
// profile_photos row read at request time (owner / lock-party / blurred-public
// policies), so possession of the path already implies DB-level authorization;
// the storage signing policy was enforced for the viewer who minted the entry
// ≤30min ago, and signed URLs already outlive revocation by their token TTL.
async function signOneCached(client: After5Client, path: string, ttl: number, width?: number): Promise<string | null> {
  if (typeof window !== 'undefined') return signOne(client, path, ttl, width);
  try {
    return await unstable_cache(
      () => signOne(client, path, ttl, width),
      // -v2: transform shape changed (square contain box) — new key segment so
      // stale width-only URLs cached pre-fix don't serve for another 30min.
      ['after5-signed-photo-v2', path, String(ttl), String(width ?? 'orig')],
      { revalidate: SIGN_REVALIDATE_S },
    )();
  } catch (err) {
    if (err instanceof Error && err.message.includes('incrementalCache')) {
      return signOne(client, path, ttl, width);
    }
    throw err;
  }
}

// Sign clear-photo paths for the carousel/view. Server-side (the reveal page) the
// passed client is RLS'd as the viewer, so signing only succeeds when the
// reveal-gated storage policy passes (see the cache-key note on signOneCached).
export async function signClearUrls(client: After5Client, paths: string[], opts: SignOptions = {}): Promise<string[]> {
  if (paths.length === 0) return [];
  const ttl = opts.ttl ?? SIGN_TTL_S;
  const urls = await Promise.all(paths.map((p) => signOneCached(client, p, ttl, opts.width)));
  return urls.filter((u): u is string => !!u);
}

// Sign BLURRED-photo paths (the reveal-ladder rung 1/2 host hint). Mechanically
// identical to signClearUrls, but blurred reads need NO reveal gate: any
// authenticated viewer is authorized by storage policy profile_photos_blurred_read_v2.
// The blurred asset IS the privacy artifact (already downscaled to 64px), so it is
// safe to sign pre-match — NEVER sign the clear path on a pre-lock surface.
export async function signBlurredUrls(client: After5Client, paths: string[], opts: SignOptions = {}): Promise<string[]> {
  if (paths.length === 0) return [];
  // Defense-in-depth: the privacy invariant is enforced in the DB (storage policy
  // profile_photos_blurred_read_v2 only permits *_blurred.jpg reads), but fail fast
  // app-side too so a future caller can never mint a clear-photo signing request on a
  // pre-lock surface through the "blurred-only" signer.
  const bad = paths.filter((p) => !/_blurred\.jpe?g$/i.test(p));
  if (bad.length) throw new Error(`signBlurredUrls received non-blurred path(s): ${bad.join(', ')}`);
  const ttl = opts.ttl ?? SIGN_TTL_S;
  const urls = await Promise.all(paths.map((p) => signOneCached(client, p, ttl, opts.width)));
  return urls.filter((u): u is string => !!u);
}

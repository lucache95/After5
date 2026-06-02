// apps/web/lib/after5/photos.ts
// M6 multi-photo gallery helpers. One profile_photos row per photo; clear object
// at profile-photos/<uid>/<id>.jpg, blurred sibling at <uid>/<id>_blurred.jpg
// (written by the generate-blur edge fn). profiles.clear_photo_url /
// blurred_photo_url stay a denormalized mirror of the PRIMARY photo. All writes
// go through the caller's RLS'd client (owner-scoped: .eq('user_id', userId)).
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

// Sign clear-photo paths for the carousel/view. Server-side (the reveal page) the
// passed client is RLS'd as the viewer, so signing only succeeds when the
// reveal-gated storage policy passes.
export async function signClearUrls(client: After5Client, paths: string[], ttl = 600): Promise<string[]> {
  if (paths.length === 0) return [];
  const { data, error } = await client.storage.from(BUCKET).createSignedUrls(paths, ttl);
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => d.signedUrl).filter((u): u is string => !!u);
}

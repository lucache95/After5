// Re-host venue photos into Supabase storage so feed/cover images stop breaking.
//
// PROBLEM: covers + stop photos point at raw Google Places (New) photo URLs whose
// photo *resource names* expire — they now 400 "photo resource invalid", so the
// feed shows broken cards. (Confirmed 2026-06-22.) No stable images existed.
//
// FIX: for each distinct venue in the LIVE seed feed, re-query Google for a FRESH
// photo, download the bytes, upload to the public `itinerary-covers` bucket under
// venues/<google_place_id>.jpg (a stable URL that never expires), then repoint:
//   - places.photo_url
//   - itineraries.stops[].photo_url        (rewrite the jsonb)
//   - itineraries.cover_image_url           (= first stop's re-hosted photo)
//
// Scoped to the live feed (cheap: ~1 Place Details + 1 photo fetch per venue).
//
//   node scripts/rehost-venue-photos.mjs            # DRY RUN (no writes)
//   node scripts/rehost-venue-photos.mjs --apply    # write to prod
//
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, GOOGLE_PLACES_API_KEY
// from apps/web/.env.local.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY;
const GKEY = env.GOOGLE_PLACES_API_KEY;
if (!URL_ || !SECRET || !GKEY) throw new Error('need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, GOOGLE_PLACES_API_KEY');

const APPLY = process.argv.includes('--apply');
const BUCKET = 'itinerary-covers';
const sb = createClient(URL_, SECRET, { auth: { autoRefreshToken: false, persistSession: false } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fresh Google photo for a google_place_id → image bytes (or null).
async function fetchFreshPhoto(googlePlaceId) {
  const det = await fetch(
    `https://places.googleapis.com/v1/places/${googlePlaceId}?fields=photos&key=${GKEY}`,
  ).then((r) => r.json()).catch(() => null);
  const name = det?.photos?.[0]?.name;
  if (!name) return null;
  const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&key=${GKEY}`);
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || 'image/jpeg';
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: ct };
}

async function main() {
  // 1) Live seed itineraries + their stops.
  const { data: insts, error: e1 } = await sb
    .from('date_instances')
    .select('itinerary_id, itineraries(id, cover_image_url, stops)')
    .eq('is_seed', true).eq('status', 'seeking')
    .gte('starts_at', new Date().toISOString());
  if (e1) throw new Error(`instances: ${e1.message}`);

  const itins = new Map();
  for (const row of insts ?? []) {
    const it = row.itineraries;
    if (it && !itins.has(it.id)) itins.set(it.id, it);
  }
  console.log(`live seed itineraries: ${itins.size}`);

  // 2) Distinct internal place_ids across their stops.
  const placeIds = new Set();
  for (const it of itins.values()) {
    for (const s of Array.isArray(it.stops) ? it.stops : []) {
      if (s.place_id) placeIds.add(s.place_id);
    }
  }
  console.log(`distinct venues: ${placeIds.size}`);

  // 3) Map internal place_id → google_place_id.
  const { data: places, error: e2 } = await sb
    .from('places').select('id, google_place_id, photo_url').in('id', [...placeIds]);
  if (e2) throw new Error(`places: ${e2.message}`);
  const gById = new Map();
  for (const p of places ?? []) gById.set(p.id, p.google_place_id);

  // 4) Re-host each venue once → stable storage URL.
  const stableUrl = new Map(); // internal place_id → storage url
  let ok = 0, fail = 0;
  for (const pid of placeIds) {
    const g = gById.get(pid);
    if (!g) { console.log(`  ✗ ${pid}: no google_place_id`); fail++; continue; }
    const photo = await fetchFreshPhoto(g);
    if (!photo) { console.log(`  ✗ ${pid} (${g}): no fresh photo`); fail++; continue; }
    const path = `venues/${g}.jpg`;
    if (APPLY) {
      const up = await sb.storage.from(BUCKET).upload(path, photo.bytes, { contentType: photo.contentType, upsert: true });
      if (up.error) { console.log(`  ✗ ${pid}: upload ${up.error.message}`); fail++; continue; }
    }
    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    stableUrl.set(pid, url);
    ok++;
    console.log(`  ✓ ${g} → ${url}${APPLY ? '' : '  [dry-run]'}`);
    await sleep(150); // polite pacing
  }
  console.log(`re-hosted ${ok}/${placeIds.size} venues (${fail} failed)`);

  // 5) Repoint places.photo_url.
  if (APPLY) {
    for (const [pid, url] of stableUrl) {
      await sb.from('places').update({ photo_url: url }).eq('id', pid);
    }
  }

  // 6) Rewrite each itinerary's stops[].photo_url + cover_image_url.
  let itinUpdated = 0;
  for (const it of itins.values()) {
    const stops = (Array.isArray(it.stops) ? it.stops : []).map((s) => {
      const url = s.place_id ? stableUrl.get(s.place_id) : null;
      return url ? { ...s, photo_url: url } : s;
    });
    const firstWithPhoto = stops.find((s) => s.photo_url && stableUrl.has(s.place_id));
    const cover = firstWithPhoto?.photo_url ?? it.cover_image_url;
    if (APPLY) {
      const { error } = await sb.from('itineraries').update({ stops, cover_image_url: cover }).eq('id', it.id);
      if (error) { console.log(`  ✗ itinerary ${it.id}: ${error.message}`); continue; }
    }
    itinUpdated++;
  }
  console.log(`${APPLY ? 'updated' : 'would update'} ${itinUpdated} itineraries (covers + stop photos)`);
  console.log(APPLY ? 'DONE — applied to prod.' : 'DRY RUN — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });

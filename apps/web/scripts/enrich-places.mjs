// Enrich every place that has a google_place_id with deep Google Places data:
// phone, website, rating, review count, full review snippets, multiple photos,
// and weekly hours. Powers the rich /places/[slug] page.
//
// Run: node scripts/enrich-places.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

async function fetchDetails(googlePlaceId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${googlePlaceId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask':
        'displayName,formattedAddress,nationalPhoneNumber,internationalPhoneNumber,websiteUri,rating,userRatingCount,reviews,photos,regularOpeningHours',
    },
  });
  if (!res.ok) throw new Error(`Google Place Details ${res.status}: ${await res.text()}`);
  return res.json();
}

function buildPhotoUrl(photoResource, width = 1200) {
  return `https://places.googleapis.com/v1/${photoResource}/media?maxWidthPx=${width}&key=${GOOGLE_KEY}`;
}

async function enrichOne(place) {
  const d = await fetchDetails(place.google_place_id);
  const reviews = (d.reviews ?? []).slice(0, 5).map((r) => ({
    author: r.authorAttribution?.displayName ?? 'Anonymous',
    rating: r.rating ?? null,
    text: r.text?.text ?? r.originalText?.text ?? '',
    relative_time: r.relativePublishTimeDescription ?? null,
  }));
  // Dedupe pipeline:
  //   1. Skip the first photo (already photo_url).
  //   2. Dedupe by photo `name` (cheap; catches exact dup uploads).
  //   3. Fetch a small thumbnail of each surviving candidate, hash the
  //      bytes — Google sometimes returns the SAME image under different
  //      `name` values (different photo IDs, identical bytes). Hash dedup
  //      catches those. Verified case: Naked Café had two storefront
  //      photos with different names but identical SHA-256.
  const seenNames = new Set();
  const seenHashes = new Set();
  const photos = [];
  for (const p of (d.photos ?? []).slice(1)) {
    if (!p.name || seenNames.has(p.name)) continue;
    seenNames.add(p.name);
    // Hash a 400px thumbnail (faster than full-res) to dedup by content.
    try {
      const thumb = await fetch(buildPhotoUrl(p.name, 400));
      if (!thumb.ok) continue;
      const bytes = new Uint8Array(await thumb.arrayBuffer());
      const hashBuf = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(hashBuf))
        .slice(0, 12)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);
    } catch (e) {
      // Network error mid-fetch — keep the candidate rather than drop silently.
      console.warn(`  ! hash check failed for ${p.name.slice(-12)}: ${e.message}`);
    }
    photos.push(buildPhotoUrl(p.name, 1200));
    if (photos.length >= 6) break;
  }
  const updates = {
    phone: d.nationalPhoneNumber ?? d.internationalPhoneNumber ?? null,
    website: d.websiteUri ?? null,
    rating: d.rating ?? null,
    review_count: d.userRatingCount ?? null,
    reviews,
    photos,
    hours_week: d.regularOpeningHours?.weekdayDescriptions ?? null,
  };
  const { error } = await supabase.from('places').update(updates).eq('id', place.id);
  if (error) throw new Error(`DB update ${place.name}: ${error.message}`);
  return updates;
}

async function main() {
  const { data: places } = await supabase
    .from('places')
    .select('id, name, google_place_id, rating')
    .not('google_place_id', 'is', null)
    .order('name');
  console.log(`Enriching ${places.length} places with google_place_id…\n`);

  let ok = 0, skipped = 0, failed = 0;
  for (const p of places) {
    if (p.rating !== null && p.rating !== undefined) {
      // Already enriched (rating is the cheapest field to check).
      skipped++;
      continue;
    }
    try {
      const u = await enrichOne(p);
      ok++;
      console.log(`  ✓ ${p.name} — ★${u.rating ?? '?'} (${u.review_count ?? 0}), ${u.reviews.length} reviews, ${u.photos.length} extra photos`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${p.name}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`\nDone. Enriched ${ok}, skipped ${skipped}, failed ${failed}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

// One-shot backfill script.
// For each active place, query Google Places "searchText" to find the matching
// place_id, grab its first photo resource, and store both into the places table:
//   - google_place_id      → for future use (hours, reviews, refresh)
//   - photo_url            → direct Google Places Photo API URL
//
// Run: node scripts/backfill-google-photos.mjs
//
// SECURITY: photo_url ends up containing GOOGLE_PLACES_API_KEY in the URL string.
// Restrict the key in GCP Console to HTTP referrers (after5.app, *.vercel.app)
// + restrict to "Places API (New)" so abuse is bounded.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Co-located with apps/web — .env.local is one dir up.
const envPath = join(__dirname, '..', '.env.local');
const envText = readFileSync(envPath, 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET_KEY;
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET || !GOOGLE_KEY) {
  console.error('Missing env: need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, GOOGLE_PLACES_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

async function searchPlace(name, neighborhood) {
  // The new Places API. searchText with a textQuery returns the best match.
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      // Field mask: only ask for what we need so the call stays cheap.
      'X-Goog-FieldMask': 'places.id,places.displayName,places.photos,places.formattedAddress',
    },
    body: JSON.stringify({
      textQuery: `${name}, Kelowna, British Columbia, Canada`,
      maxResultCount: 1,
      // Bias toward Kelowna so we don't get a same-named place in another city.
      locationBias: {
        circle: {
          center: { latitude: 49.888, longitude: -119.496 },
          radius: 30000, // 30 km — covers Kelowna + West Kelowna + Lake Country
        },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google searchText ${res.status}: ${body}`);
  }
  const json = await res.json();
  return json.places?.[0] ?? null;
}

function buildPhotoUrl(photoResource) {
  // Returns a URL the browser can <img src=...> directly. Google redirects to
  // the actual googleusercontent.com image. The API key is in the URL — that's
  // why GCP referrer restrictions matter.
  const params = new URLSearchParams({
    maxWidthPx: '1200',
    key: GOOGLE_KEY,
  });
  return `https://places.googleapis.com/v1/${photoResource}/media?${params}`;
}

async function backfillOne(place) {
  const result = await searchPlace(place.name, place.neighborhood);
  if (!result) {
    console.log(`  ✗ no match for ${place.name}`);
    return { ok: false, reason: 'no_match' };
  }
  const placeId = result.id;
  const photoResource = result.photos?.[0]?.name;
  if (!photoResource) {
    // Save the place_id even if no photo so we can retry later.
    await supabase.from('places').update({ google_place_id: placeId }).eq('id', place.id);
    console.log(`  ✗ matched ${result.displayName?.text ?? placeId} but no photo`);
    return { ok: false, reason: 'no_photo' };
  }
  const photoUrl = buildPhotoUrl(photoResource);
  const { error } = await supabase
    .from('places')
    .update({ google_place_id: placeId, photo_url: photoUrl })
    .eq('id', place.id);
  if (error) {
    console.log(`  ✗ DB update failed for ${place.name}: ${error.message}`);
    return { ok: false, reason: 'db' };
  }
  console.log(`  ✓ ${place.name} → ${result.displayName?.text}`);
  return { ok: true };
}

async function main() {
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name, neighborhood, photo_url, google_place_id')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;

  console.log(`Backfilling photos for ${places.length} places…\n`);
  const results = { ok: 0, no_match: 0, no_photo: 0, db: 0 };
  for (const place of places) {
    if (place.photo_url && place.google_place_id) {
      console.log(`  • skipping ${place.name} (already has photo + place_id)`);
      results.ok++;
      continue;
    }
    try {
      const r = await backfillOne(place);
      results[r.ok ? 'ok' : r.reason]++;
    } catch (e) {
      console.log(`  ✗ error for ${place.name}: ${e.message}`);
      results.db++;
    }
    // Be polite to Google — small delay between requests.
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\nDone.');
  console.log(`  Photos saved:    ${results.ok}`);
  console.log(`  No match:        ${results.no_match}`);
  console.log(`  Match no photo:  ${results.no_photo}`);
  console.log(`  Other failures:  ${results.db}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

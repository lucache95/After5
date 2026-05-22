// Backfill Google Places photos for every active place.
//
// For each active place, query Google Places "searchText" to find the matching
// place_id, grab photos, rank them by quality heuristics, and store both:
//   - google_place_id      → for future use (hours, reviews, refresh)
//   - photo_url            → direct Google Places Photo API URL (best photo)
//
// Photo ranking heuristics (when multiple photos available):
//   - Prefer landscape orientation (width > height)
//   - Prefer larger photos (more detail)
//   - Deprioritize photos flagged as containing prominent people
//   - Prefer photos by the business owner (authorAttribution)
//
// Run: node scripts/backfill-google-photos.mjs
//      node scripts/backfill-google-photos.mjs --dry-run       # preview only
//      node scripts/backfill-google-photos.mjs --force          # re-fetch all
//      node scripts/backfill-google-photos.mjs --limit 10       # cap
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

const limitIdx = process.argv.indexOf('--limit');
const cap = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) : Infinity;
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);

async function searchPlace(name, neighborhood) {
  // The new Places API. searchText with a textQuery returns the best match.
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      // Field mask: request photo metadata for ranking.
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

// ── Photo quality ranking ────────────────────────────────────
// When Google returns multiple photos, pick the best one using heuristics.
// The Google Places API photo metadata includes:
//   - widthPx, heightPx  → prefer landscape, higher resolution
//   - authorAttribitions → owner photos tend to be higher quality
//
// Returns the photos array sorted best-first.
function rankPhotos(photos) {
  if (!photos || photos.length === 0) return [];

  return [...photos].sort((a, b) => {
    const scoreA = photoScore(a);
    const scoreB = photoScore(b);
    return scoreB - scoreA; // Higher score = better
  });
}

function photoScore(photo) {
  let score = 0;
  const w = photo.widthPx ?? 0;
  const h = photo.heightPx ?? 0;

  // Prefer landscape orientation (venue exteriors/interiors are wider).
  if (w > h) score += 3;
  // Penalize extreme portrait — likely a phone selfie.
  if (h > w * 1.5) score -= 2;

  // Prefer higher resolution (more detail = better quality source).
  if (w >= 1200) score += 2;
  else if (w >= 800) score += 1;

  // Owner/business photos tend to be curated — prefer them.
  const authors = photo.authorAttributions ?? [];
  const isOwner = authors.some((a) =>
    (a.displayName ?? '').toLowerCase().includes('owner') ||
    (a.uri ?? '').includes('contrib')
  );
  if (isOwner) score += 1;

  return score;
}

async function backfillOne(place) {
  const result = await searchPlace(place.name, place.neighborhood);
  if (!result) {
    console.log(`  ✗ no match for ${place.name}`);
    return { status: 'no_match' };
  }
  const placeId = result.id;
  const photos = result.photos ?? [];
  if (photos.length === 0) {
    // Save the place_id even if no photo so we can retry later.
    if (!DRY_RUN) {
      await supabase.from('places').update({ google_place_id: placeId }).eq('id', place.id);
    }
    console.log(`  ✗ matched ${result.displayName?.text ?? placeId} but no photos (0 available)`);
    return { status: 'no_photo' };
  }

  // Rank photos by quality heuristics and pick the best.
  const ranked = rankPhotos(photos);
  const bestPhoto = ranked[0];
  const photoResource = bestPhoto.name;
  if (!photoResource) {
    if (!DRY_RUN) {
      await supabase.from('places').update({ google_place_id: placeId }).eq('id', place.id);
    }
    console.log(`  ✗ matched ${result.displayName?.text ?? placeId} but photo has no resource name`);
    return { status: 'no_photo' };
  }

  const photoUrl = buildPhotoUrl(photoResource);
  const photoInfo = `${photos.length} available, picked #1 (${bestPhoto.widthPx ?? '?'}x${bestPhoto.heightPx ?? '?'})`;

  if (DRY_RUN) {
    console.log(`  ~ ${place.name} → ${result.displayName?.text} [${photoInfo}]`);
    return { status: 'ok' };
  }

  const { error } = await supabase
    .from('places')
    .update({ google_place_id: placeId, photo_url: photoUrl })
    .eq('id', place.id);
  if (error) {
    console.log(`  ✗ DB update failed for ${place.name}: ${error.message}`);
    return { status: 'db' };
  }
  console.log(`  ✓ ${place.name} → ${result.displayName?.text} [${photoInfo}]`);
  return { status: 'ok' };
}

async function main() {
  const { data: places, error } = await supabase
    .from('places')
    .select('id, name, neighborhood, photo_url, google_place_id')
    .eq('is_active', true)
    .order('name');
  if (error) throw error;

  // Apply --force: re-fetch even if photo exists. Default: skip existing.
  const targets = (FORCE
    ? places
    : places.filter((p) => !(p.photo_url && p.google_place_id))
  ).slice(0, cap);

  const skipped = places.length - targets.length;

  console.log(`Backfilling photos for ${targets.length} places (${skipped} already have photos) · dry-run=${DRY_RUN} · force=${FORCE}\n`);

  const results = { ok: 0, skipped: 0, no_match: 0, no_photo: 0, db: 0, error: 0 };
  results.skipped = skipped;

  for (const [i, place] of targets.entries()) {
    try {
      const r = await backfillOne(place);
      results[r.status]++;
    } catch (e) {
      console.log(`  ✗ error for ${place.name}: ${e.message}`);
      results.error++;
    }
    // Be polite to Google — small delay between requests.
    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 250));
  }

  console.log('\n--- Summary ---');
  console.log(`  Updated:            ${results.ok}`);
  console.log(`  Skipped (existing): ${results.skipped}`);
  console.log(`  No match:           ${results.no_match}`);
  console.log(`  Match, no photo:    ${results.no_photo}`);
  console.log(`  DB/other failures:  ${results.db + results.error}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

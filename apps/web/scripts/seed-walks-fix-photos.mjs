// Post-audit fixes for the corpus activation (2026-06-09):
//   1. Seed verifiable waterfront walk routes — walks were the #1 supply gap
//      (4 live vs target 6+). Same searchText-resolve pattern as seed-sunset-spots.
//   2. Backfill photo_url on the 2 live view-spots Google text-search returned
//      no photo for (Knox Apex Trail, Paul's Tomb) via Place Details photos.
//
// Run: node scripts/seed-walks-fix-photos.mjs           (live)
//      node scripts/seed-walks-fix-photos.mjs --dry      (resolve only)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const DRY = process.argv.includes('--dry');
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY;
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

const photoUrl = (name) => `https://places.googleapis.com/v1/${name}/media?maxWidthPx=1200&key=${GOOGLE_KEY}`;

const WALKS = [
  { q: 'Gellatly Bay Recreational Trail West Kelowna', name: 'Gellatly Bay Recreational Trail',
    neighborhood: 'West Kelowna', drive_cluster: 'west_kelowna',
    insight: 'Flat lakeside boardwalk past the heritage nut farm — west-shore light, sailboats, and almost no crowds on weeknights.' },
  { q: 'Rotary Marsh Park Kelowna', name: 'Rotary Marsh Park Loop',
    neighborhood: 'Downtown', drive_cluster: 'downtown',
    insight: 'Tiny bird-sanctuary loop where the boardwalk meets the lake — start here, then drift down the waterfront promenade toward Stuart Park.' },
  { q: 'Abbott Street Recreation Corridor Kelowna', name: 'Abbott Street Heritage Walk',
    neighborhood: 'South Pandosy', drive_cluster: 'pandosy',
    insight: 'Tree-tunnel street of 1900s heritage homes linking downtown to the beaches — the classic “which house would you pick” walk.' },
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function searchText(q) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.photos,places.formattedAddress',
    },
    body: JSON.stringify({ textQuery: q, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`searchText ${res.status}: ${await res.text()}`);
  return (await res.json()).places?.[0] ?? null;
}

async function detailsPhotos(placeId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: { 'X-Goog-Api-Key': GOOGLE_KEY, 'X-Goog-FieldMask': 'photos' },
  });
  if (!res.ok) throw new Error(`details ${res.status}`);
  return (await res.json()).photos ?? [];
}

async function main() {
  console.log(`${DRY ? '[DRY] ' : ''}— Seeding ${WALKS.length} walk routes —`);
  for (const w of WALKS) {
    try {
      const g = await searchText(w.q);
      if (!g) { console.log(`  ✗ ${w.name}: no Google match — skipping`); continue; }
      const photo = g.photos?.[0]?.name ? photoUrl(g.photos[0].name) : null;
      if (!photo) { console.log(`  ✗ ${w.name}: resolved but no photo — skipping (gate requires photo)`); continue; }
      const row = {
        name: w.name, slug: slugify(w.name),
        address: g.formattedAddress ?? null,
        neighborhood: w.neighborhood, drive_cluster: w.drive_cluster,
        lat: g.location.latitude, lng: g.location.longitude,
        type: 'walk',
        vibe_tags: ['chill', 'romantic', 'casual'],
        pairing_tags: ['lake_view', 'conversation_friendly'],
        time_of_day: ['morning', 'evening'],
        weather_dependent: true, weather_works_in: 'dry_only',
        seasonality: ['year_round'], typical_duration_min: 45,
        opens: '00:00', closes: '23:59', price_tier: '$',
        photo_url: photo, local_insight: w.insight,
        source: 'curated', approval_status: 'live', is_active: true,
        google_place_id: g.id,
      };
      console.log(`  ✓ ${w.name} → ${g.location.latitude.toFixed(4)},${g.location.longitude.toFixed(4)}`);
      if (!DRY) {
        const { error } = await supabase.from('places').upsert(row, { onConflict: 'google_place_id' });
        if (error) throw new Error(error.message);
      }
    } catch (e) { console.log(`  ✗ ${w.name}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\n${DRY ? '[DRY] ' : ''}— Fixing missing photos on live view-spots —`);
  const { data: noPhoto } = await supabase
    .from('places').select('id, name, google_place_id')
    .eq('source', 'curated').eq('approval_status', 'live')
    .or('photo_url.is.null,photo_url.eq.')
    .not('google_place_id', 'is', null);
  for (const p of noPhoto ?? []) {
    try {
      const photos = await detailsPhotos(p.google_place_id);
      if (!photos[0]?.name) { console.log(`  – ${p.name}: Google has no photos`); continue; }
      if (!DRY) {
        const { error } = await supabase.from('places').update({ photo_url: photoUrl(photos[0].name) }).eq('id', p.id);
        if (error) throw new Error(error.message);
      }
      console.log(`  ✓ ${p.name}: photo set`);
    } catch (e) { console.log(`  ✗ ${p.name}: ${e.message}`); }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}Done.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

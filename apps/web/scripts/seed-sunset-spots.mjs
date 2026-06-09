// Seed dedicated west-facing-over-the-lake LOOKOUTS that the corpus is missing.
// Kelowna already has west-facing beaches (Tugboat/Rotary/Hot Sands) + Kalamoir
// viewpoint, so the sunset-date pack is satisfiable — but the "payoff" pool is
// thin. These elevated lookouts + south-Mission sunset beaches enrich it.
//
// Each spot is resolved through Google Places Text Search (that resolution IS
// the existence/verification check) → place_id + coords + photo, then upserted
// (onConflict google_place_id) as a LIVE curated delighter, golden-hour tagged.
//
// Run: node scripts/seed-sunset-spots.mjs           (live)
//      node scripts/seed-sunset-spots.mjs --dry      (resolve only, no writes)

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

// Verified, public, west-facing-over-Okanagan-Lake spots not already in the corpus.
const SPOTS = [
  { q: 'Dilworth Mountain Park Kelowna', name: 'Dilworth Mountain Park', type: 'viewpoint',
    neighborhood: 'Dilworth', drive_cluster: 'glenmore',
    insight: 'Short climb to a 360° bench over the city and lake — quiet at golden hour, almost nobody knows the upper loop.' },
  { q: 'Mount Boucherie Regional Park West Kelowna', name: 'Mount Boucherie Regional Park', type: 'viewpoint',
    neighborhood: 'West Kelowna', drive_cluster: 'west_kelowna',
    insight: 'Old volcano core ringed by vineyards; the west ridge looks straight down the lake as the sun drops.' },
  { q: 'Knox Mountain Park Apex Lookout Kelowna', name: 'Knox Mountain Apex Lookout', type: 'sunset_spot',
    neighborhood: 'North End', drive_cluster: 'north_east',
    insight: 'Drive or hike to the top deck — the classic Kelowna sunset, lake and bridge laid out below you.' },
  { q: "Paul's Tomb Knox Mountain Kelowna", name: "Paul's Tomb (Knox Mountain)", type: 'viewpoint',
    neighborhood: 'North End', drive_cluster: 'north_east',
    insight: 'Lake-level pebble cove at the end of a flat shoreline walk — west-facing, swimmable, dramatic at dusk.' },
  { q: 'Sarsons Beach Kelowna', name: 'Sarsons Beach', type: 'sunset_spot',
    neighborhood: 'Lower Mission', drive_cluster: 'lower_mission',
    insight: 'Grassy, willow-lined and west-facing — the locals’ sunset beach without the downtown crowds.' },
  { q: 'Bluebird Beach Kelowna', name: 'Bluebird Beach', type: 'sunset_spot',
    neighborhood: 'Lower Mission', drive_cluster: 'lower_mission',
    insight: 'Tiny tucked-away access between the big parks — feels private, faces the sunset straight on.' },
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function resolve(q) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.photos,places.formattedAddress',
    },
    body: JSON.stringify({ textQuery: q, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`searchText ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.places?.[0] ?? null;
}

async function main() {
  console.log(`${DRY ? '[DRY] ' : ''}Seeding ${SPOTS.length} sunset/viewpoint lookouts…\n`);
  let ok = 0, failed = 0;
  for (const s of SPOTS) {
    try {
      const g = await resolve(s.q);
      if (!g) { failed++; console.log(`  ✗ ${s.name}: no Google match`); continue; }
      const photo = g.photos?.[0]?.name
        ? `https://places.googleapis.com/v1/${g.photos[0].name}/media?maxWidthPx=1200&key=${GOOGLE_KEY}`
        : null;
      const row = {
        name: s.name,
        slug: slugify(s.name),
        address: g.formattedAddress ?? null,
        neighborhood: s.neighborhood,
        drive_cluster: s.drive_cluster,
        lat: g.location.latitude,
        lng: g.location.longitude,
        type: s.type,
        vibe_tags: ['romantic', 'chill', 'unique'],
        pairing_tags: ['sunset_spot', 'lake_view', 'golden_hour'],
        time_of_day: ['evening'],
        weather_dependent: true,
        weather_works_in: 'dry_only',
        seasonality: ['year_round'],
        typical_duration_min: 60,
        opens: '00:00',
        closes: '23:59',
        price_tier: '$',
        photo_url: photo,
        local_insight: s.insight,
        is_delighter: true,
        source: 'curated',
        approval_status: 'live',
        is_active: true,
        google_place_id: g.id,
      };
      console.log(`  ✓ ${s.name} (${s.type}) → ${g.location.latitude.toFixed(4)},${g.location.longitude.toFixed(4)} ${photo ? '📷' : '(no photo)'}`);
      if (!DRY) {
        const { error } = await supabase.from('places').upsert(row, { onConflict: 'google_place_id' });
        if (error) throw new Error(error.message);
      }
      ok++;
    } catch (e) {
      failed++;
      console.log(`  ✗ ${s.name}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}Done. upserted ${ok}, failed ${failed}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

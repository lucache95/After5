// Final gap-fills from the acquisition backlog (2026-06-09):
//   P1  markets/shopping/bookstores (1 live vs target 3+): Mosaic Books,
//       Kelowna Night Market (seasonal), Milkcrate Records.
//   P2  bounded named adds the user explicitly wanted (NOT an open scrape):
//       a floating sauna + a pool/billiards hall, IF Google verifies they exist.
//
// Same verified-seed pattern as seed-sunset-spots/seed-walks: Google Text Search
// resolution IS the existence check; rows are skipped when there's no clean
// match or no photo (the completeness gate requires one).
//
// Run: node scripts/seed-gap-fills.mjs --dry   (resolve + preview only)
//      node scripts/seed-gap-fills.mjs          (live upsert)

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

const SEEDS = [
  // ── P1: markets / shopping / bookstores ──────────────────────────────────
  { q: 'Mosaic Books Kelowna', name: 'Mosaic Books', type: 'shop',
    neighborhood: 'Downtown', drive_cluster: 'downtown',
    vibe: ['cozy', 'chill', 'creative'], tod: ['morning', 'evening'],
    weather_dependent: false, seasonality: ['year_round'], price: '$', delighter: false,
    insight: 'Independent since 1968 — split up, each pick a book the other should read, and compare notes over coffee next door.' },
  // NOTE: "Kelowna Night Market" was removed — Google resolves that query to the
  // SAME place listing as the existing Farmers' & Crafters' Market row, and the
  // google_place_id upsert silently clobbered it (restored 2026-06-09). There is
  // no separate verified Night Market listing; events belong in the P3 tier.
  { q: 'Milkcrate Records Kelowna', name: 'Milkcrate Records', type: 'shop',
    neighborhood: 'Downtown', drive_cluster: 'downtown',
    vibe: ['unique', 'chill', 'creative'], tod: ['morning', 'evening'],
    weather_dependent: false, seasonality: ['year_round'], price: '$', delighter: false,
    insight: 'Flip through the crates and trade desert-island albums — instant taste compatibility test.' },
  // ── P2: bounded named novelty adds ────────────────────────────────────────
  { q: 'floating sauna Okanagan Lake Kelowna', name: null /* take Google's name */, type: 'activity',
    neighborhood: 'Downtown', drive_cluster: 'downtown',
    vibe: ['unique', 'adventurous', 'intimate'], tod: ['morning', 'evening'],
    weather_dependent: false, seasonality: ['year_round'], price: '$$$', delighter: true,
    insight: 'Sauna heat, then a cold plunge straight into the lake — the date story neither of you will stop telling.' },
  { q: 'billiards pool hall Kelowna', name: null, type: 'activity',
    neighborhood: 'Downtown', drive_cluster: 'downtown',
    vibe: ['fun', 'casual', 'lively'], tod: ['evening'],
    weather_dependent: false, seasonality: ['year_round'], price: '$', delighter: false,
    insight: 'Best-of-three with stakes — loser buys the next round. Built-in banter, zero awkward silences.' },
];

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const photoUrl = (n) => `https://places.googleapis.com/v1/${n}/media?maxWidthPx=1200&key=${GOOGLE_KEY}`;

async function searchText(q) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.location,places.photos,places.formattedAddress,places.regularOpeningHours',
    },
    body: JSON.stringify({ textQuery: q, maxResultCount: 1 }),
  });
  if (!res.ok) throw new Error(`searchText ${res.status}: ${await res.text()}`);
  return (await res.json()).places?.[0] ?? null;
}

const pad = (n) => String(n).padStart(2, '0');
function hoursFromPeriods(reg) {
  const periods = reg?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return { opens: null, closes: null };
  const counts = new Map();
  for (const p of periods) {
    if (!p.open) continue;
    const key = `${pad(p.open.hour ?? 0)}:${pad(p.open.minute ?? 0)}|${p.close ? `${pad(p.close.hour ?? 0)}:${pad(p.close.minute ?? 0)}` : '23:59'}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = null, bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  if (!best) return { opens: null, closes: null };
  const [opens, closes] = best.split('|');
  return { opens, closes };
}

async function main() {
  console.log(`${DRY ? '[DRY] ' : ''}Resolving ${SEEDS.length} gap-fill candidates…\n`);
  let ok = 0, skipped = 0;
  for (const s of SEEDS) {
    try {
      const g = await searchText(s.q);
      if (!g) { skipped++; console.log(`  ✗ "${s.q}": no Google match — skipping`); continue; }
      const resolvedName = s.name ?? g.displayName?.text ?? s.q;
      // Sanity: result must actually be in the Kelowna area.
      const inArea = g.formattedAddress?.match(/Kelowna|West Kelowna|Westbank|Lake Country/i)
        && Math.abs(g.location.latitude - 49.88) < 0.25 && Math.abs(g.location.longitude + 119.49) < 0.35;
      if (!inArea) { skipped++; console.log(`  ✗ "${s.q}" → ${resolvedName} @ ${g.formattedAddress} — OUTSIDE Kelowna, skipping`); continue; }
      const photo = g.photos?.[0]?.name ? photoUrl(g.photos[0].name) : null;
      if (!photo) { skipped++; console.log(`  ✗ ${resolvedName}: no photo — skipping (gate)`); continue; }
      // CLOBBER GUARD: if this google_place_id already exists, SKIP — an upsert
      // would silently overwrite a curated row (this bit the farmers' market).
      const { data: existing } = await supabase
        .from('places').select('id, name').eq('google_place_id', g.id).maybeSingle();
      if (existing) { skipped++; console.log(`  – "${s.q}" → already in corpus as "${existing.name}" — skipping`); continue; }
      let { opens, closes } = hoursFromPeriods(g.regularOpeningHours);
      if (!opens) {
        // Conservative defaults by type when Google has none.
        ({ opens, closes } = s.type === 'market' ? { opens: '17:00', closes: '22:00' } : { opens: '11:00', closes: '19:00' });
      }
      const row = {
        name: resolvedName, slug: slugify(resolvedName),
        address: g.formattedAddress ?? null,
        neighborhood: s.neighborhood, drive_cluster: s.drive_cluster,
        lat: g.location.latitude, lng: g.location.longitude,
        type: s.type, vibe_tags: s.vibe, pairing_tags: [],
        time_of_day: s.tod, weather_dependent: s.weather_dependent,
        weather_works_in: s.weather_dependent ? 'dry_only' : 'any',
        seasonality: s.seasonality, typical_duration_min: 60,
        opens, closes, price_tier: s.price, photo_url: photo,
        local_insight: s.insight, is_delighter: s.delighter,
        source: 'curated', approval_status: 'live', is_active: true,
        google_place_id: g.id,
      };
      console.log(`  ✓ ${resolvedName} (${s.type}) @ ${g.formattedAddress} — ${opens}–${closes}`);
      if (!DRY) {
        const { error } = await supabase.from('places').upsert(row, { onConflict: 'google_place_id' });
        if (error) throw new Error(error.message);
      }
      ok++;
    } catch (e) { skipped++; console.log(`  ✗ "${s.q}": ${e.message}`); }
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}Done. upserted ${ok}, skipped ${skipped}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

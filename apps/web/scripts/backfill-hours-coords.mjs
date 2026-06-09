// Backfill the STRUCTURED generator fields the rich /places enrich script never
// writes: opens / closes (time) and lat / lng. The generator's isOpenAt + hop
// guards fail-loud on null opens/closes/lat/lng, so any curated row missing them
// is silently dropped from generation. enrich-places.mjs only writes hours_week
// (display text) + photos, and skips already-rated rows — it does NOT fix these.
//
// Targets every curated row with a google_place_id that is missing opens, closes,
// lat, or lng. Updates ONLY the null fields (never overwrites good data).
// Always-open outdoor types (park/beach/viewpoint/...) get 00:00–23:59 when
// Google returns no hours, so they aren't excluded by the fail-loud hours guard.
//
// Run: node scripts/backfill-hours-coords.mjs          (live)
//      node scripts/backfill-hours-coords.mjs --dry     (no DB writes; preview)

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
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
);

// Outdoor types that are effectively always open — default to all-day when
// Google has no posted hours, rather than leaving null (which excludes them).
const ALWAYS_OPEN = new Set(['park', 'garden', 'beach', 'viewpoint', 'sunset_spot', 'walk', 'hike']);

const pad = (n) => String(n).padStart(2, '0');

async function fetchDetails(googlePlaceId) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${googlePlaceId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_KEY,
      'X-Goog-FieldMask': 'location,regularOpeningHours',
    },
  });
  if (!res.ok) throw new Error(`Google Place Details ${res.status}: ${await res.text()}`);
  return res.json();
}

// Collapse Google's per-day periods into one representative opens/closes pair by
// taking the MODAL (most common) (open,close) across the week. Google day:
// 0=Sun..6=Sat; a 24h business is a single period with open at 00:00 and no
// close — we render that as 00:00–23:59. Returns {opens,closes} as "HH:MM" or
// nulls if no usable period.
function hoursFromPeriods(reg) {
  const periods = reg?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return { opens: null, closes: null };
  const counts = new Map();
  for (const p of periods) {
    if (!p.open) continue;
    const opens = `${pad(p.open.hour ?? 0)}:${pad(p.open.minute ?? 0)}`;
    // No close = open 24h → treat as all-day.
    const closes = p.close ? `${pad(p.close.hour ?? 0)}:${pad(p.close.minute ?? 0)}` : '23:59';
    const key = `${opens}|${closes}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return { opens: null, closes: null };
  // Most common pair; tie-break on earliest open for determinism.
  let best = null, bestN = -1;
  for (const [key, n] of counts) {
    const earlier = best && key.split('|')[0] < best.split('|')[0];
    if (n > bestN || (n === bestN && earlier)) { best = key; bestN = n; }
  }
  const [opens, closes] = best.split('|');
  return { opens, closes };
}

async function main() {
  const { data: rows, error } = await supabase
    .from('places')
    .select('id, name, type, opens, closes, lat, lng, google_place_id')
    .eq('source', 'curated')
    .not('google_place_id', 'is', null)
    .or('opens.is.null,closes.is.null,lat.is.null,lng.is.null')
    .order('name');
  if (error) throw new Error(error.message);
  console.log(`${DRY ? '[DRY] ' : ''}Backfilling ${rows.length} curated rows missing opens/closes/lat/lng…\n`);

  let hoursFixed = 0, coordsFixed = 0, allDay = 0, failed = 0, noop = 0;
  for (const p of rows) {
    try {
      const d = await fetchDetails(p.google_place_id);
      const updates = {};

      // Coords — only if missing.
      if ((p.lat === null || p.lng === null) && d.location) {
        updates.lat = d.location.latitude;
        updates.lng = d.location.longitude;
        coordsFixed++;
      }

      // Hours — only if missing.
      if (p.opens === null || p.closes === null) {
        let { opens, closes } = hoursFromPeriods(d.regularOpeningHours);
        if ((!opens || !closes) && ALWAYS_OPEN.has(p.type)) {
          opens = '00:00'; closes = '23:59'; allDay++;
        }
        if (opens && closes) {
          if (p.opens === null) updates.opens = opens;
          if (p.closes === null) updates.closes = closes;
          hoursFixed++;
        }
      }

      if (Object.keys(updates).length === 0) {
        noop++;
        console.log(`  – ${p.name} (${p.type}): nothing to fill (no Google hours/location)`);
        continue;
      }
      if (!DRY) {
        const { error: uerr } = await supabase.from('places').update(updates).eq('id', p.id);
        if (uerr) throw new Error(uerr.message);
      }
      console.log(`  ✓ ${p.name} (${p.type}): ${Object.entries(updates).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${p.name}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`\n${DRY ? '[DRY] ' : ''}Done. hours filled: ${hoursFixed} (of which all-day defaults: ${allDay}), coords filled: ${coordsFixed}, no-op: ${noop}, failed: ${failed}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });

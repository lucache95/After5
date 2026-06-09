// Date Generation Variety Test (corpus-activation WS8).
// The real question: can the generator make dates that FEEL different, or does it
// repeat the same handful of structures? Generates N plans per intent against the
// PROD corpus, measures distinct venues / activities / structures, then DELETES
// the test itineraries it created (precise id-scoped cleanup — no prod litter).
//
// Run: node scripts/variety-test.mjs --probe     (1 call, dump shape)
//      node scripts/variety-test.mjs --n 5        (5 per intent + cleanup)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
for (const line of readFileSync(join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const FN = `${URL}/functions/v1/generate-plan`;
const supabase = createClient(URL, KEY);

const PROBE = process.argv.includes('--probe');
const nFlag = process.argv.indexOf('--n');
const N = nFlag >= 0 ? Number(process.argv[nFlag + 1]) : 5;

const INTENTS = {
  romantic: ['romantic'],
  adventurous: ['adventurous'],
  foodie: ['food_focused'],
  creative: ['creative'],
};

async function generate(vibe) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}`, apikey: KEY },
    body: JSON.stringify({
      occasion: 'date', vibe, time_of_day: 'evening',
      budget_per_person: 60, duration_min: 180, when: 'tonight',
    }),
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Extract {id, venues[], types[]} from each itinerary in a response.
function parse(resp) {
  const its = resp.itineraries ?? [];
  return its.map((it) => {
    const stops = it.stops ?? it.itinerary?.stops ?? [];
    const venues = stops.map((s) => s.place_name ?? s.name ?? s.place?.name ?? '?');
    const types = stops.map((s) => s.type ?? s.place_type ?? s.place?.type ?? '?');
    return { id: it.id, venues, types };
  });
}

async function main() {
  if (PROBE) {
    const resp = await generate(['romantic']);
    console.log(JSON.stringify(resp, null, 2).slice(0, 4000));
    const parsed = parse(resp);
    console.log('\nPARSED:', JSON.stringify(parsed, null, 2));
    // Clean up the probe rows.
    const ids = parsed.map((p) => p.id).filter(Boolean);
    if (ids.length) await supabase.from('itineraries').delete().in('id', ids);
    console.log(`\n[probe] cleaned up ${ids.length} itineraries`);
    return;
  }

  const createdIds = [];
  const byIntent = {};
  for (const [intent, vibe] of Object.entries(INTENTS)) {
    const venueSet = new Set(), activitySet = new Set(), structSet = new Set();
    let dates = 0;
    for (let i = 0; i < N; i++) {
      try {
        const parsed = parse(await generate(vibe));
        for (const it of parsed) {
          if (it.id) createdIds.push(it.id);
          dates++;
          it.venues.forEach((v) => venueSet.add(v));
          it.types.forEach((t, idx) => { if (['activity', 'hike', 'walk', 'beach', 'viewpoint', 'sunset_spot'].includes(t)) activitySet.add(it.venues[idx]); });
          structSet.add(it.types.join(' → '));
        }
      } catch (e) {
        console.log(`  ! ${intent} #${i}: ${e.message}`);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    byIntent[intent] = { dates, distinct_venues: venueSet.size, distinct_activities: activitySet.size, distinct_structures: structSet.size, structures: [...structSet] };
    console.log(`${intent.padEnd(12)} dates:${dates}  venues:${venueSet.size}  activities:${activitySet.size}  structures:${structSet.size}`);
  }

  // Cleanup — delete ONLY the itineraries this test created.
  if (createdIds.length) {
    const { error } = await supabase.from('itineraries').delete().in('id', createdIds);
    console.log(error ? `cleanup error: ${error.message}` : `\nCleaned up ${createdIds.length} test itineraries.`);
  }
  console.log('\nJSON:\n' + JSON.stringify(byIntent, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });

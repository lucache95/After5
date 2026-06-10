// One-shot verification script for the 2026-06-09 quality reseed.
// node scripts/verify-reseed.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SECRET_KEY;
if (!URL_ || !SERVICE) throw new Error('missing prod url / service key');
const sb = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const SEED_EMAILS = ['seed-host-1@after5.seed', 'seed-host-2@after5.seed', 'seed-host-5@after5.seed'];

async function main() {
  // 1. Get seed host IDs
  const { data: profiles, error: pErr } = await sb.from('profiles')
    .select('id,first_name,email').in('email', SEED_EMAILS);
  if (pErr) throw pErr;
  const hostIds = profiles.map((p) => p.id);
  console.log(`\n--- Seed hosts found: ${profiles.length} ---`);
  profiles.forEach((p) => console.log(`  ${p.first_name} <${p.email}> — ${p.id}`));

  if (!hostIds.length) {
    console.log('ERROR: No seed host profiles found. Reseed may not have run.');
    return;
  }

  // 2. Get upcoming date_instances
  const now = new Date().toISOString();
  const { data: nights, error: nErr } = await sb.from('date_instances')
    .select('id,starts_at,status,itinerary_id,creator_id,ambient_sound_id,is_seed')
    .in('creator_id', hostIds)
    .gte('starts_at', now)
    .order('starts_at');
  if (nErr) throw nErr;
  console.log(`\n--- Upcoming seed nights: ${nights.length} ---`);

  // 3. Ambient sound distribution
  const soundCount = new Map();
  for (const n of nights) {
    const sid = n.ambient_sound_id ?? 'NULL';
    soundCount.set(sid, (soundCount.get(sid) ?? 0) + 1);
  }

  // Fetch sound names
  const soundIds = [...soundCount.keys()].filter((s) => s !== 'NULL');
  let soundNames = new Map();
  if (soundIds.length) {
    const { data: sounds } = await sb.from('ambient_sounds')
      .select('id,name,vibe_tags').in('id', soundIds);
    sounds?.forEach((s) => soundNames.set(s.id, `${s.name} [${(s.vibe_tags ?? []).join(',')}]`));
  }

  console.log('\n--- Ambient sound distribution ---');
  let soundProblems = 0;
  for (const [sid, count] of soundCount.entries()) {
    const label = sid === 'NULL' ? 'NULL (no sound assigned)' : (soundNames.get(sid) ?? sid);
    const flag = (sid === 'NULL' || count > 2) ? '  *** PROBLEM ***' : '';
    console.log(`  ${label}: ${count} nights${flag}`);
    if (sid === 'NULL' || count > 2) soundProblems++;
  }

  // Check adjacency in start_time order
  console.log('\n--- Adjacent-sound check (feed order) ---');
  let adjacentProblems = 0;
  for (let i = 1; i < nights.length; i++) {
    if (nights[i].ambient_sound_id && nights[i - 1].ambient_sound_id &&
        nights[i].ambient_sound_id === nights[i - 1].ambient_sound_id) {
      const name = soundNames.get(nights[i].ambient_sound_id) ?? nights[i].ambient_sound_id;
      console.log(`  *** ADJACENT: positions ${i - 1} and ${i} both use ${name}`);
      adjacentProblems++;
    }
  }
  if (!adjacentProblems) console.log('  OK — no identical adjacent sounds');

  // 4. Fetch itineraries
  const itinIds = nights.map((n) => n.itinerary_id);
  const { data: itins, error: iErr } = await sb.from('itineraries')
    .select('id,title,hook,cover_image_url,stops').in('id', itinIds);
  if (iErr) throw iErr;
  const itinMap = new Map(itins.map((i) => [i.id, i]));

  // 5. Cover image check
  console.log('\n--- Cover image coverage ---');
  let coversSet = 0, coversNull = 0, coversStock = 0, coversStorage = 0;
  for (const it of itins) {
    const url = it.cover_image_url;
    if (!url) { coversNull++; continue; }
    coversSet++;
    if (url.startsWith('/places/') || url.startsWith('/icons/') || url.startsWith('/stock/')) {
      coversStock++;
      console.log(`  *** STOCK/BAD cover: ${it.title} → ${url}`);
    } else if (url.includes('supabase.co') || url.includes('storage')) {
      coversStorage++;
    } else {
      // Could be a CDN/foursquare/google photo URL — that's fine
      coversStorage++;
    }
  }
  console.log(`  set: ${coversSet}/${itins.length}, null: ${coversNull}/${itins.length}, stock/bad: ${coversStock}, real photo: ${coversStorage}`);

  // 6. Stop start_time ordering
  console.log('\n--- Stop chronological order check ---');
  let orderProblems = 0;
  for (const it of itins) {
    const stops = Array.isArray(it.stops) ? it.stops : [];
    for (let i = 1; i < stops.length; i++) {
      const a = String(stops[i - 1].start_time ?? '');
      const b = String(stops[i].start_time ?? '');
      if (a && b && a > b) {
        orderProblems++;
        console.log(`  *** OUT OF ORDER: "${it.title}" — stop ${i - 1} (${a}) > stop ${i} (${b})`);
      }
    }
  }
  if (!orderProblems) console.log('  OK — all stops ascending');

  // 7. Sample hooks
  console.log('\n--- Sample hooks (first-person check) ---');
  const sampledItins = itins.slice(0, Math.min(4, itins.length));
  for (const it of sampledItins) {
    const hook = it.hook ?? '(null)';
    // Flag if it looks like LLM brochure copy (third-person or title-case trigger words)
    const looksLLM = /^[A-Z].*[!.]$/.test(hook) && !/^I\b/i.test(hook);
    const flag = looksLLM ? '  [may be LLM copy]' : '';
    console.log(`  "${it.title}"\n    hook: "${hook}"${flag}`);
  }

  // 8. Night × itinerary table
  console.log('\n--- Night details ---');
  for (const n of nights) {
    const it = itinMap.get(n.itinerary_id);
    const stops = Array.isArray(it?.stops) ? it.stops : [];
    const soundLabel = n.ambient_sound_id ? (soundNames.get(n.ambient_sound_id) ?? n.ambient_sound_id.slice(0, 8)) : 'NULL';
    const cover = it?.cover_image_url ? (it.cover_image_url.length > 60 ? it.cover_image_url.slice(0, 60) + '…' : it.cover_image_url) : 'null';
    const startTimes = stops.map((s) => s.start_time ?? '?').join(' → ');
    console.log(`  ${n.starts_at.slice(0, 10)} | ${it?.title ?? '??'}`);
    console.log(`    sound: ${soundLabel}`);
    console.log(`    cover: ${cover}`);
    console.log(`    stops: ${startTimes}`);
    console.log(`    hook:  "${it?.hook ?? 'null'}"`);
  }

  // 9. Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Nights seeded:        ${nights.length} / 12 expected`);
  console.log(`Sound problems:       ${soundProblems} (want 0)`);
  console.log(`Adjacent problems:    ${adjacentProblems} (want 0)`);
  console.log(`Covers set:           ${coversSet} / ${itins.length}`);
  console.log(`Covers null:          ${coversNull} / ${itins.length}`);
  console.log(`Covers stock/bad:     ${coversStock} (want 0)`);
  console.log(`Stop order problems:  ${orderProblems} (want 0)`);

  const allGood = nights.length >= 8 && soundProblems === 0 && adjacentProblems === 0
    && coversStock === 0 && orderProblems === 0;
  console.log(`\nOverall: ${allGood ? 'PASS' : 'FAIL — see problems above'}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

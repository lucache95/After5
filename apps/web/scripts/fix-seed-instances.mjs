// One-shot fixer: the 2026-06-09 quality reseed generated + polished 9
// itineraries but was rate-limited before inserting date_instances.
// This script links them to the seed hosts with vibe-matched ambient sounds
// and proper date spread — NO generation calls, pure data write.
//
//   node scripts/fix-seed-instances.mjs
//
// Safe to re-run: checks for existing seed nights first (idempotent).
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

// The 9 polished itineraries, in generated_at order (= GEN order for the 9
// that succeeded: vibes 0-8).
const POLISHED_ITIN_IDS = [
  'cfdb4429-ad30-4b9a-87e1-9ee2f0f24149', // romantic
  'd7dc3bff-dde8-421e-a589-c6e8df70605c', // adventurous
  'b632f37a-e8b3-4e84-a843-959cd0c267e2', // food_focused
  'af4ee1ef-2c69-46e6-8e3a-0c399522ce6c', // creative
  '2268a2c8-0083-49d6-b35f-4f00a94d7ccc', // chill
  '2230d3d6-68ff-4a59-9298-881fdda555c4', // romantic+unique
  '505c9a4c-2c25-4010-869f-f2f15f0ff401', // fun+lively
  'ce510bcd-490e-45bd-94a5-7762da013908', // cozy
  '674e2a7b-1b81-464e-a095-ff53cf938d1b', // adventurous+casual
];

// Mirror of GEN entries for the 9 that were generated (vibes 0-8, indices 9-11
// were rate-limited).
const GEN_SLICE = [
  { vibe: ['romantic'] },
  { vibe: ['adventurous'] },
  { vibe: ['food_focused'] },
  { vibe: ['creative'] },
  { vibe: ['chill'] },
  { vibe: ['romantic', 'unique'] },
  { vibe: ['fun', 'lively'] },
  { vibe: ['cozy'] },
  { vibe: ['adventurous', 'casual'] },
];

const VIBE_TO_SOUND_TAGS = {
  romantic:     ['romantic', 'intimate'],
  adventurous:  ['adventurous', 'active', 'outdoorsy'],
  food_focused: ['local', 'energetic'],
  creative:     ['art'],
  chill:        ['chill', 'relaxed'],
  cozy:         ['cozy'],
  unique:       ['scenic', 'art'],
  fun:          ['energetic', 'nightlife'],
  lively:       ['energetic', 'nightlife'],
  casual:       ['casual'],
  boujee:       ['upscale', 'classy'],
};
const MAX_NIGHTS_PER_SOUND = 2;

function assignSounds(vibeSlice, sounds) {
  const usage = new Map(sounds.map((s) => [s.id, 0]));
  const picks = vibeSlice.map((g) => {
    const want = new Set(g.vibe.flatMap((v) => VIBE_TO_SOUND_TAGS[v] ?? []));
    const scored = sounds.map((s) => ({ s, score: (s.vibe_tags ?? []).filter((t) => want.has(t)).length }));
    const underCap = scored.filter((x) => usage.get(x.s.id) < MAX_NIGHTS_PER_SOUND);
    const pool = underCap.filter((x) => x.score > 0);
    const ranked = (pool.length ? pool : (underCap.length ? underCap : scored)).sort((a, b) =>
      usage.get(a.s.id) - usage.get(b.s.id) || b.score - a.score || a.s.sort_order - b.s.sort_order);
    const chosen = ranked[0].s;
    usage.set(chosen.id, usage.get(chosen.id) + 1);
    return chosen;
  });
  // de-adjacent pass
  const okAt = (k) => k <= 0 || k >= picks.length || picks[k].id !== picks[k - 1].id;
  for (let i = 1; i < picks.length; i++) {
    if (picks[i].id !== picks[i - 1].id) continue;
    for (let j = 0; j < picks.length; j++) {
      if (j === i || picks[j].id === picks[i].id) continue;
      [picks[i], picks[j]] = [picks[j], picks[i]];
      if (okAt(i) && okAt(i + 1) && okAt(j) && okAt(j + 1)) break;
      [picks[i], picks[j]] = [picks[j], picks[i]];
    }
  }
  return picks;
}

const SEED_EMAILS = ['seed-host-1@after5.seed', 'seed-host-2@after5.seed', 'seed-host-5@after5.seed'];
const HOST_KEYS = ['kel-w', 'kel-m', 'kel-w2'];

async function main() {
  // 1. Resolve seed host IDs
  const { data: profiles, error: pErr } = await sb.from('profiles')
    .select('id,first_name,email').in('email', SEED_EMAILS);
  if (pErr) throw pErr;
  if (profiles.length !== 3) throw new Error(`Expected 3 seed hosts, got ${profiles.length}`);
  // Order by email to match HOST_KEYS order
  const sortedProfiles = SEED_EMAILS.map((e) => profiles.find((p) => p.email === e));
  const hostIds = sortedProfiles.map((p) => p.id);
  console.log('Seed hosts:');
  sortedProfiles.forEach((p, i) => console.log(`  [${HOST_KEYS[i]}] ${p.first_name} <${p.email}>`));

  // 2. Idempotency check
  const { data: existing } = await sb.from('date_instances')
    .select('id').in('creator_id', hostIds).eq('is_seed', true)
    .gte('starts_at', new Date().toISOString());
  if (existing?.length >= POLISHED_ITIN_IDS.length) {
    console.log(`Already have ${existing.length} seed nights live — nothing to do.`);
    return;
  }
  if (existing?.length > 0) {
    console.log(`WARNING: ${existing.length} seed nights already exist — will add more. Run cleanup first if you want a clean slate.`);
  }

  // 3. Verify itineraries exist and are polished
  const { data: itins, error: iErr } = await sb.from('itineraries')
    .select('id,title,hook,cover_image_url,stops').in('id', POLISHED_ITIN_IDS);
  if (iErr) throw iErr;
  if (itins.length !== POLISHED_ITIN_IDS.length) {
    throw new Error(`Expected ${POLISHED_ITIN_IDS.length} itineraries, found ${itins.length}. IDs may be stale.`);
  }
  // Order by POLISHED_ITIN_IDS order (preserves GEN vibe mapping)
  const itinMap = new Map(itins.map((i) => [i.id, i]));
  const orderedItins = POLISHED_ITIN_IDS.map((id) => itinMap.get(id));

  console.log('\nItineraries to link:');
  orderedItins.forEach((it, i) => {
    const cover = it.cover_image_url ? 'SET' : 'NULL';
    const hook = it.hook ?? 'null';
    console.log(`  [${i}] ${it.title}`);
    console.log(`       cover: ${cover} | hook: "${hook.slice(0, 50)}"`);
  });

  // 4. Fetch ambient sounds + assign
  const { data: sounds, error: sErr } = await sb.from('ambient_sounds')
    .select('id,name,vibe_tags,sort_order').eq('is_active', true).order('sort_order');
  if (sErr) throw sErr;
  const picks = assignSounds(GEN_SLICE, sounds);
  console.log(`\nSound assignments: ${picks.map((p) => p.name).join(' | ')}`);

  // 5. Resolve Kelowna city id
  const { data: cities, error: cErr } = await sb.from('cities').select('id,slug').eq('slug', 'kelowna').single();
  if (cErr) throw cErr;

  // 6. Build date_instances rows — spread 1 per day starting tomorrow evening
  const rows = orderedItins.map((it, i) => {
    const startsAt = new Date(Date.now() + (i + 1) * 24 * 3600 * 1000);
    startsAt.setUTCHours(2, 0, 0, 0); // ~evening PT
    return {
      itinerary_id: it.id,
      creator_id: hostIds[i % hostIds.length],
      city_id: cities.id,
      starts_at: startsAt.toISOString(),
      duration_min: 180,
      status: 'seeking',
      moderation_status: 'approved',
      is_seed: true,
      ambient_sound_id: picks[i].id,
    };
  });

  // 7. Insert
  const { data: inserted, error: insErr } = await sb.from('date_instances').insert(rows).select('id,starts_at,ambient_sound_id');
  if (insErr) throw new Error(`date_instances insert: ${insErr.message}`);
  console.log(`\nSEEDED ${inserted.length} date_instances:`);
  inserted.forEach((n, i) => {
    const soundName = sounds.find((s) => s.id === n.ambient_sound_id)?.name ?? 'unknown';
    console.log(`  ${n.starts_at.slice(0, 10)} | ${orderedItins[i].title} | ${soundName}`);
  });

  console.log('\nDone. Run node scripts/verify-reseed.mjs to confirm.');
}

main().catch((e) => { console.error('FIX FAILED:', e.message); process.exit(1); });

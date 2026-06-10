// Seed a "bunch" of rich, swipeable nights into the Kelowna feed. Uses REAL
// generation (generate-plan edge fn) for the itineraries, hosted by a small set
// of clearly-tagged, broadly-visible SEED profiles (email '*@after5.seed',
// date_instances.is_seed = true) so they're trivially cleanable.
//
//   node scripts/seed-feed-dates.mjs
//
// 2026-06-09 refresh (post corpus-activation, post generate-1):
//   * generate-plan now returns ONE itinerary per call (was ~3), so the GEN list
//     is 12 calls across the vibes the 184-venue corpus now actually supports.
//   * Calls run SEQUENTIALLY with spacing — a parallel burst tripped Anthropic
//     rate limits during the corpus variety test (2026-06-08).
//   * KELOWNA-ONLY: Vancouver has 0 live places (google_legacy relabel), so its
//     old seed nights are cleaned up and not replaced. Single-city MVP.
//   * Real (non-seed) nights are untouched — cleanup only removes @after5.seed
//     hosts and their rows.
//
// 2026-06-09 portraits: the 3 hosts now carry REAL portrait photos (storage
// paths under profile-photos/<uid>/, written by scripts/seed-host-portraits.mjs).
// Reseeds REUSE the host accounts (stable uids) instead of delete/recreate, and
// never touch the photo columns — a non-storage path like '/places/...' makes
// the feed's signBlurredUrls throw, which drops EVERY card's avatar.
//
// Reads SUPABASE_SECRET_KEY (prod service role) + the anon key + the prod URL from
// apps/web/.env.local. Idempotent: clears prior seed nights (and any seed users
// that are NOT the 3 hosts) first.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SECRET_KEY;
const ANON = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !SERVICE || !ANON) throw new Error('missing prod url / service / anon key in apps/web/.env.local');
const sb = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const BROAD_PREFS = ['man', 'woman', 'nonbinary'];

// 3 broadly-visible Kelowna seed hosts: mixed gender, wide prefs/age, so the
// 12 nights spread 4-per-host instead of looking like one spammy account.
const HOSTS = [
  { key: 'kel-w',  email: 'seed-host-1@after5.seed', name: 'Maya', gender: 'woman', city: 'kelowna', birthdate: '1994-05-10' },
  { key: 'kel-m',  email: 'seed-host-2@after5.seed', name: 'Liam', gender: 'man',   city: 'kelowna', birthdate: '1991-11-02' },
  { key: 'kel-w2', email: 'seed-host-5@after5.seed', name: 'Ava',  gender: 'woman', city: 'kelowna', birthdate: '1997-07-23' },
];

// 12 generation requests spanning the post-activation corpus variety: each call
// returns ONE itinerary (generate-1). Vibes chosen to exercise the categories the
// diversity audit brought to target (sunset/viewpoints, activities, foodie,
// creative, budget + boujee spread).
const GEN = [
  { vibe: ['romantic'],                 budget: 80 },
  { vibe: ['adventurous'],              budget: 60 },
  { vibe: ['food_focused'],             budget: 90 },
  { vibe: ['creative'],                 budget: 70 },
  { vibe: ['chill'],                    budget: 50 },
  { vibe: ['romantic', 'unique'],       budget: 70 },
  { vibe: ['fun', 'lively'],            budget: 60 },
  { vibe: ['cozy'],                     budget: 55 },
  { vibe: ['adventurous', 'casual'],    budget: 65 },
  { vibe: ['food_focused', 'boujee'],   budget: 110 },
  { vibe: ['unique'],                   budget: 60 },
  { vibe: ['chill', 'romantic'],        budget: 75 },
];

async function cityIds() {
  const { data, error } = await sb.from('cities').select('id,slug').eq('slug', 'kelowna');
  if (error) throw error;
  return Object.fromEntries(data.map((c) => [c.slug, c.id]));
}

async function cleanup() {
  // Clear prior seed nights for ALL seed users, but only DELETE accounts that
  // aren't the 3 hosts: the hosts keep stable uids so their portrait storage
  // paths (profiles.clear/blurred_photo_url + profile_photos rows, written by
  // scripts/seed-host-portraits.mjs) stay valid across reseeds.
  const hostEmails = new Set(HOSTS.map((h) => h.email));
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const seedUsers = (list?.users ?? []).filter((u) => (u.email ?? '').endsWith('@after5.seed'));
  let removed = 0;
  for (const u of seedUsers) {
    // remove their seed itineraries first (date_instances cascade on itinerary delete)
    await sb.from('itineraries').delete().eq('user_id', u.id);
    await sb.from('date_instances').delete().eq('creator_id', u.id);
    if (!hostEmails.has(u.email)) { await sb.auth.admin.deleteUser(u.id); removed++; }
  }
  return removed;
}

async function makeHost(h, cityId) {
  // Reuse the existing host account when present (preserves uid + portraits).
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  let id = (list?.users ?? []).find((u) => u.email === h.email)?.id;
  if (!id) {
    const { data, error } = await sb.auth.admin.createUser({ email: h.email, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${h.email}: ${error?.message}`);
    id = data.user.id;
  }
  // birthdate FIRST (age-gate trigger gates dating_enabled).
  let r = await sb.from('profiles_private').upsert({ user_id: id, birthdate: h.birthdate }, { onConflict: 'user_id' });
  if (r.error) throw new Error(`profiles_private ${h.email}: ${r.error.message}`);
  // NOTE: photo columns are intentionally NOT set here. Portraits are owned by
  // scripts/seed-host-portraits.mjs (real storage paths). Writing a public-asset
  // path like '/places/...' breaks signBlurredUrls for the WHOLE feed. A brand
  // new host simply shows the letter monogram until the portrait script runs.
  r = await sb.from('profiles').update({
    first_name: h.name, gender: h.gender, gender_preferences: BROAD_PREFS,
    age_pref: '[18,100)', primary_city_id: cityId, distance_pref_km: 60,
    vibe_tags: ['cozy', 'creative', 'nightlife'],
    verification: 'verified', dating_enabled: true,
    onboarding_step: 'done', onboarding_completed_at: new Date().toISOString(),
  }).eq('id', id);
  if (r.error) throw new Error(`profiles ${h.email}: ${r.error.message}`);
  return id;
}

// One generation call = one itinerary id (generate-1). One retry on failure
// (rate limits / transient LLM errors), then give up on that slot.
async function generate(g, attempt = 1) {
  try {
    const res = await fetch(`${URL_}/functions/v1/generate-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ vibe: g.vibe, city_slug: 'kelowna', occasion: 'date', budget_per_person: g.budget, duration_min: 180 }),
    });
    const j = await res.json();
    const id = j.itineraries?.[0]?.id;
    if (!id) throw new Error(JSON.stringify(j).slice(0, 160));
    return { id, title: j.itineraries[0].title };
  } catch (e) {
    if (attempt < 2) {
      console.log(`  ! [${g.vibe.join('+')}] failed (${e.message.slice(0, 80)}) — retrying in 20s`);
      await new Promise((r) => setTimeout(r, 20_000));
      return generate(g, attempt + 1);
    }
    console.log(`  ✗ [${g.vibe.join('+')}] gave up: ${e.message.slice(0, 120)}`);
    return null;
  }
}

async function main() {
  const removed = await cleanup();
  console.log(`cleanup: cleared prior seed nights, removed ${removed} non-host seed user(s)`);
  const cities = await cityIds();

  const hostIds = {};
  for (const h of HOSTS) hostIds[h.key] = await makeHost(h, cities[h.city]);
  console.log(`ensured ${HOSTS.length} seed hosts (reused if existing — portraits preserved)`);

  // generate SEQUENTIALLY with spacing (rate-limit hazard, 2026-06-08).
  const itins = [];
  for (const g of GEN) {
    const r = await generate(g);
    if (r) { itins.push(r); console.log(`  ✓ [${g.vibe.join('+')}] ${r.title}`); }
    await new Promise((res) => setTimeout(res, 2_000));
  }
  console.log(`generated ${itins.length}/${GEN.length} kelowna itineraries`);
  if (itins.length === 0) throw new Error('no itineraries generated — aborting before touching date_instances');

  // build date_instances: spread across the hosts and the next ~2 weeks of evenings.
  const hostKeys = HOSTS.map((h) => h.key);
  const rows = itins.map((it, i) => {
    const startsAt = new Date(Date.now() + (i + 1) * 24 * 3600 * 1000);
    startsAt.setUTCHours(2, 0, 0, 0); // ~evening PT
    return {
      itinerary_id: it.id, creator_id: hostIds[hostKeys[i % hostKeys.length]],
      city_id: cities.kelowna, starts_at: startsAt.toISOString(),
      duration_min: 180, status: 'seeking', moderation_status: 'approved', is_seed: true,
    };
  });

  const { data: inserted, error } = await sb.from('date_instances').insert(rows).select('id');
  if (error) throw new Error(`date_instances insert: ${error.message}`);
  console.log(`SEEDED ${inserted.length} swipeable kelowna nights (is_seed=true)`);
}

main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });

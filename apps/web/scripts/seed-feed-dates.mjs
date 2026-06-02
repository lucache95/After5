// Seed a "bunch" of rich, swipeable nights into the feed across the live cities
// (Kelowna + Vancouver). Uses REAL generation (generate-plan edge fn) for the
// itineraries, hosted by a small set of clearly-tagged, broadly-visible SEED
// profiles (email '*@after5.seed', date_instances.is_seed = true) so they're
// trivially cleanable.
//
//   node scripts/seed-feed-dates.mjs
//
// Reads SUPABASE_SECRET_KEY (prod service role) + the anon key + the prod URL from
// apps/web/.env.local. Idempotent: deletes prior seed hosts + their seed nights first.
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

const SEED_PHOTO = '/places/place-walk.jpg';
const BROAD_PREFS = ['man', 'woman', 'nonbinary'];

// 4 broadly-visible seed hosts: mixed gender, both live cities, wide prefs/age.
const HOSTS = [
  { key: 'kel-w', email: 'seed-host-1@after5.seed', name: 'Maya',   gender: 'woman', city: 'kelowna',   birthdate: '1994-05-10' },
  { key: 'kel-m', email: 'seed-host-2@after5.seed', name: 'Liam',   gender: 'man',   city: 'kelowna',   birthdate: '1991-11-02' },
  { key: 'van-w', email: 'seed-host-3@after5.seed', name: 'Priya',  gender: 'woman', city: 'vancouver', birthdate: '1996-02-21' },
  { key: 'van-m', email: 'seed-host-4@after5.seed', name: 'Noah',   gender: 'man',   city: 'vancouver', birthdate: '1990-08-15' },
];

// generation requests → which city + vibes. Each returns ~3 itineraries.
const GEN = [
  { city: 'kelowna',   vibe: ['creative'], budget: 70 },
  { city: 'kelowna',   vibe: ['foodie'],   budget: 90 },
  { city: 'vancouver', vibe: ['chill'],    budget: 70 },
  { city: 'vancouver', vibe: ['romantic'], budget: 110 },
];

async function cityIds() {
  const { data, error } = await sb.from('cities').select('id,slug').in('slug', ['kelowna', 'vancouver']);
  if (error) throw error;
  return Object.fromEntries(data.map((c) => [c.slug, c.id]));
}

async function cleanup() {
  // delete prior seed hosts (and cascade their date_instances/itineraries via FKs).
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const seedUsers = (list?.users ?? []).filter((u) => (u.email ?? '').endsWith('@after5.seed'));
  for (const u of seedUsers) {
    // remove their seed itineraries first (date_instances cascade on itinerary delete)
    await sb.from('itineraries').delete().eq('user_id', u.id);
    await sb.from('date_instances').delete().eq('creator_id', u.id);
    await sb.auth.admin.deleteUser(u.id);
  }
  return seedUsers.length;
}

async function makeHost(h, cityId) {
  const { data, error } = await sb.auth.admin.createUser({ email: h.email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${h.email}: ${error?.message}`);
  const id = data.user.id;
  // birthdate FIRST (age-gate trigger gates dating_enabled).
  let r = await sb.from('profiles_private').upsert({ user_id: id, birthdate: h.birthdate }, { onConflict: 'user_id' });
  if (r.error) throw new Error(`profiles_private ${h.email}: ${r.error.message}`);
  r = await sb.from('profiles').update({
    first_name: h.name, gender: h.gender, gender_preferences: BROAD_PREFS,
    age_pref: '[18,100)', primary_city_id: cityId, distance_pref_km: 60,
    vibe_tags: ['cozy', 'creative', 'nightlife'],
    clear_photo_url: SEED_PHOTO, blurred_photo_url: SEED_PHOTO,
    verification: 'verified', dating_enabled: true,
    onboarding_step: 'done', onboarding_completed_at: new Date().toISOString(),
  }).eq('id', id);
  if (r.error) throw new Error(`profiles ${h.email}: ${r.error.message}`);
  return id;
}

async function generate(g) {
  const res = await fetch(`${URL_}/functions/v1/generate-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ vibe: g.vibe, city_slug: g.city, occasion: 'date', budget_per_person: g.budget, duration_min: 180 }),
  });
  const j = await res.json();
  if (!j.itineraries?.length) throw new Error(`generate ${g.city}/${g.vibe}: ${JSON.stringify(j).slice(0, 200)}`);
  return j.itineraries.map((it) => it.id).filter(Boolean);
}

async function main() {
  const removed = await cleanup();
  console.log(`cleanup: removed ${removed} prior seed host(s)`);
  const cities = await cityIds();

  // hosts per city
  const hostIds = {};
  for (const h of HOSTS) hostIds[h.key] = await makeHost(h, cities[h.city]);
  console.log(`created ${HOSTS.length} seed hosts`);

  // generate (parallel) → itinerary ids per city
  const byCity = { kelowna: [], vancouver: [] };
  const gen = await Promise.all(GEN.map(async (g) => ({ city: g.city, ids: await generate(g) })));
  for (const r of gen) byCity[r.city].push(...r.ids);
  console.log(`generated itineraries: kelowna=${byCity.kelowna.length} vancouver=${byCity.vancouver.length}`);

  // build date_instances: distribute each city's itineraries across that city's 2 hosts.
  const rows = [];
  let dayOffset = 1;
  const assign = (city, hostKeys) => {
    byCity[city].forEach((itinId, i) => {
      const startsAt = new Date(Date.now() + dayOffset * 24 * 3600 * 1000);
      startsAt.setUTCHours(2, 0, 0, 0); // ~evening PT
      rows.push({
        itinerary_id: itinId, creator_id: hostIds[hostKeys[i % hostKeys.length]],
        city_id: cities[city], starts_at: startsAt.toISOString(),
        duration_min: 180, status: 'seeking', moderation_status: 'approved', is_seed: true,
      });
      dayOffset += 1;
    });
  };
  assign('kelowna', ['kel-w', 'kel-m']);
  assign('vancouver', ['van-w', 'van-m']);

  const { data: inserted, error } = await sb.from('date_instances').insert(rows).select('id');
  if (error) throw new Error(`date_instances insert: ${error.message}`);
  console.log(`SEEDED ${inserted.length} swipeable nights (is_seed=true) across kelowna + vancouver`);
}

main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });

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
// 2026-06-09 quality pass (4 live-feed bugs):
//   1. ambient_sound_id per night, vibe-matched against ambient_sounds.vibe_tags
//      with variety (≤2 nights per loop, no identical neighbours in feed order).
//   2. cover_image_url = the first stop photo, so the card and the detail sheet
//      show the SAME real venue image (no more stock-vs-venue mismatch).
//   3. stops sorted by start_time before the night goes live; if the generated
//      title sequenced the stops ("X, then Y") in the old order, it's rebuilt
//      from the sorted place types.
//   4. hooks are authored HERE in host voice (first-person, lowercase, dry) —
//      the LLM hooks read like brochures. Per-stop what_to_do comes straight
//      from venue local-insight data via generate-plan, so it is NOT touched.
//
// Reads SUPABASE_SECRET_KEY (prod service role) + the anon key + the prod URL from
// apps/web/.env.local. Idempotent: clears prior seed nights (and any seed users
// that are NOT the 3 hosts) first.
//
//   --top-up   generate-plan caps anonymous callers at 10 generations per clock
//              hour, so a full 12-slot reseed strands the tail slots. After the
//              hour rolls over, `node scripts/seed-feed-dates.mjs --top-up`
//              SKIPS cleanup, generates only the missing tail GEN slots, and
//              continues the host rotation, evening schedule, and ambient-sound
//              variety from the nights already live.
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
//
// `hook` is the HOST'S voice — a person inviting you, not ad copy. First-person,
// lowercase, dry, ≤12 words. It overwrites the LLM hook after generation (those
// read third-person/brochure: "Two ways to use your body, zero planning
// required."). Vibe-generic on purpose: stops are generated fresh each run, so
// the hook can't name venues without going stale.
const GEN = [
  { vibe: ['romantic'],                 budget: 80,  hook: 'i know a patio that does golden hour right' },
  { vibe: ['adventurous'],              budget: 60,  hook: "i'll go first on the scary parts. probably." },
  { vibe: ['food_focused'],             budget: 90,  hook: 'three stops, all food. i already know your order' },
  { vibe: ['creative'],                 budget: 70,  hook: "we make something with our hands. i won't laugh much" },
  { vibe: ['chill'],                    budget: 50,  hook: 'no agenda. coffee, the lake, see where it goes' },
  { vibe: ['romantic', 'unique'],       budget: 70,  hook: "i have a sunset spot. not telling you where yet" },
  { vibe: ['fun', 'lively'],            budget: 60,  hook: 'loser of the first round buys the next one' },
  { vibe: ['cozy'],                     budget: 55,  hook: "bring a sweater. i've got the rest covered" },
  { vibe: ['adventurous', 'casual'],    budget: 65,  hook: 'nothing fancy. we move, then we eat' },
  { vibe: ['food_focused', 'boujee'],   budget: 110, hook: "wear something nice. i'm not telling you the bill" },
  { vibe: ['unique'],                   budget: 60,  hook: "i promise you haven't done this date before" },
  { vibe: ['chill', 'romantic'],        budget: 75,  hook: "slow night, good views. i talk less than you'd think" },
];

// ---- ambient sound matching (bug 1) ----------------------------------------
// Map our generation vibes onto the vocabulary ambient_sounds.vibe_tags uses
// (cozy/chill/relaxed, nightlife/energetic/local, romantic/classy/intimate,
// adventurous/outdoorsy/active, art, scenic, casual, upscale).
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

async function fetchSounds() {
  const { data, error } = await sb.from('ambient_sounds')
    .select('id,name,vibe_tags,sort_order').eq('is_active', true).order('sort_order');
  if (error) throw new Error(`ambient_sounds: ${error.message}`);
  if (!data?.length) throw new Error('no active ambient_sounds on prod');
  return data;
}

// Deterministic, variety-first assignment: for each night (in insert order),
// rank active sounds by least-used → best vibe match → sort_order, capped at
// MAX_NIGHTS_PER_SOUND. Then a local-swap pass guarantees no two neighbouring
// nights (insert order = starts_at order = feed order) share a loop.
// `baseUsage` / `prevId` let --top-up continue variety from live nights: counts
// already on the board, and the sound of the night the first new one follows.
function assignSounds(itins, sounds, baseUsage = null, prevId = null) {
  const usage = new Map(sounds.map((s) => [s.id, baseUsage?.get(s.id) ?? 0]));
  const picks = itins.map((it) => {
    const want = new Set(it.gen.vibe.flatMap((v) => VIBE_TO_SOUND_TAGS[v] ?? []));
    const scored = sounds.map((s) => ({ s, score: (s.vibe_tags ?? []).filter((t) => want.has(t)).length }));
    const underCap = scored.filter((x) => usage.get(x.s.id) < MAX_NIGHTS_PER_SOUND);
    const pool = underCap.filter((x) => x.score > 0);
    const ranked = (pool.length ? pool : (underCap.length ? underCap : scored)).sort((a, b) =>
      usage.get(a.s.id) - usage.get(b.s.id) || b.score - a.score || a.s.sort_order - b.s.sort_order);
    const chosen = ranked[0].s;
    usage.set(chosen.id, usage.get(chosen.id) + 1);
    return chosen;
  });
  // de-adjacent: swap a later pick in when two neighbours match, as long as the
  // swap doesn't create a new adjacent pair around either position. Index -1 is
  // the last pre-existing night (top-up mode).
  const idAt = (k) => (k === -1 ? prevId : picks[k]?.id);
  const okAt = (k) => k <= -1 || k >= picks.length || picks[k].id !== idAt(k - 1);
  for (let i = 0; i < picks.length; i++) {
    if (picks[i].id !== idAt(i - 1)) continue;
    for (let j = 0; j < picks.length; j++) {
      if (j === i || picks[j].id === picks[i].id) continue;
      [picks[i], picks[j]] = [picks[j], picks[i]];
      if (okAt(i) && okAt(i + 1) && okAt(j) && okAt(j + 1)) break;
      [picks[i], picks[j]] = [picks[j], picks[i]]; // revert, try next j
    }
  }
  return picks;
}

// ---- post-generation polish (bugs 2, 3, 4) ----------------------------------
// Short, venue-anonymous labels for rebuilding a title when the chronological
// sort contradicts the LLM's "X, then Y" sequencing.
const TYPE_LABEL = {
  restaurant: 'Dinner', cafe: 'Coffee', winery: 'Wine', brewery: 'Beers',
  cocktail_bar: 'Cocktails', bar: 'Drinks', dessert: 'Dessert',
  ice_cream: 'Ice Cream', bakery: 'Pastries', hike: 'a Hike',
  viewpoint: 'a View', sunset_spot: 'Sunset', beach: 'the Beach',
  park: 'the Park', garden: 'the Gardens', walk: 'a Walk',
  activity: 'Something Hands-On', gallery: 'Art', market: 'the Market',
  shop: 'Browsing',
};

function rebuildTitle(stops) {
  const labels = stops.map((s) => TYPE_LABEL[s.place_type] ?? 'a Surprise');
  if (labels.length <= 1) return labels[0] ?? 'A Night Out';
  return `${labels.slice(0, -1).join(', ')}, Then ${labels[labels.length - 1]}`;
}

// Mirrors apps/web/lib/slug.ts (and generate-plan/persist.ts) so a rebuilt
// title keeps a resolvable /dates/[slug] URL.
function slugify(title, id) {
  const base = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  const tail = id.replace(/-/g, '').slice(0, 6);
  return base ? `${base}-${tail}` : tail;
}

// Sort stops chronologically, fix a now-contradicted title, set the cover to
// the first stop photo (card + detail show the SAME venue image), and replace
// the LLM hook with the authored host-voice one. what_to_do is venue
// local-insight data — left untouched.
async function polish(itinId, hook) {
  const { data: it, error } = await sb.from('itineraries').select('id,title,stops').eq('id', itinId).single();
  if (error) throw new Error(`fetch itinerary ${itinId}: ${error.message}`);
  const orig = Array.isArray(it.stops) ? it.stops : [];
  const stops = [...orig].sort((a, b) => String(a.start_time ?? '').localeCompare(String(b.start_time ?? '')));
  const reordered = stops.some((s, i) => s !== orig[i]);
  const patch = { stops, hook };
  if (reordered && /\b(then|first|before|after)\b/i.test(it.title)) {
    patch.title = rebuildTitle(stops);
    patch.slug = slugify(patch.title, itinId);
    console.log(`  ~ sorted stops contradicted title — "${it.title}" → "${patch.title}"`);
  }
  patch.cover_image_url = stops.find((s) => s.photo_url)?.photo_url ?? null;
  if (!patch.cover_image_url) console.log(`  ! ${itinId}: no stop photo — cover left null (vibe stock fallback)`);
  const r = await sb.from('itineraries').update(patch).eq('id', itinId);
  if (r.error) throw new Error(`polish ${itinId}: ${r.error.message}`);
}

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
  const topUp = process.argv.includes('--top-up');
  const cities = await cityIds();

  if (!topUp) {
    const removed = await cleanup();
    console.log(`cleanup: cleared prior seed nights, removed ${removed} non-host seed user(s)`);
  }

  const hostIds = {};
  for (const h of HOSTS) hostIds[h.key] = await makeHost(h, cities[h.city]);
  console.log(`ensured ${HOSTS.length} seed hosts (reused if existing — portraits preserved)`);

  // top-up: count what's already live so we only generate the missing tail
  // slots (generation runs in GEN order, so rate-limit failures are the tail)
  // and continue the day/host/sound sequences instead of restarting them.
  let existing = [];
  if (topUp) {
    const { data, error } = await sb.from('date_instances')
      .select('id, ambient_sound_id, starts_at')
      .in('creator_id', Object.values(hostIds)).eq('is_seed', true)
      .gte('starts_at', new Date().toISOString()).order('starts_at');
    if (error) throw new Error(`existing seed nights: ${error.message}`);
    existing = data ?? [];
    if (existing.length >= GEN.length) { console.log(`top-up: all ${GEN.length} slots already live — nothing to do`); return; }
    console.log(`top-up: ${existing.length} nights live, generating the ${GEN.length - existing.length} missing slot(s)`);
  }
  const slots = topUp ? GEN.slice(existing.length) : GEN;

  // generate SEQUENTIALLY with spacing (rate-limit hazard, 2026-06-08).
  const itins = [];
  for (const g of slots) {
    const r = await generate(g);
    if (r) { itins.push({ ...r, gen: g }); console.log(`  ✓ [${g.vibe.join('+')}] ${r.title}`); }
    await new Promise((res) => setTimeout(res, 2_000));
  }
  console.log(`generated ${itins.length}/${slots.length} kelowna itineraries`);
  if (itins.length === 0) throw new Error('no itineraries generated — aborting before touching date_instances');

  // polish each itinerary BEFORE the night goes live: chronological stops,
  // real-venue cover, host-voice hook (bugs 2/3/4).
  for (const it of itins) await polish(it.id, it.gen.hook);
  console.log(`polished ${itins.length} itineraries (sorted stops, stop-photo covers, host-voice hooks)`);

  // vibe-matched ambient loop per night, with variety (bug 1). In top-up mode
  // the live nights' counts + the last night's sound seed the variety state.
  const sounds = await fetchSounds();
  const baseUsage = new Map();
  for (const n of existing) {
    if (n.ambient_sound_id) baseUsage.set(n.ambient_sound_id, (baseUsage.get(n.ambient_sound_id) ?? 0) + 1);
  }
  const prevSoundId = existing.at(-1)?.ambient_sound_id ?? null;
  const picks = assignSounds(itins, sounds, baseUsage, prevSoundId);
  console.log(`ambient sounds: ${picks.map((p) => p.name).join(' | ')}`);

  // build date_instances: spread across the hosts and the next ~2 weeks of
  // evenings, continuing after any already-live nights in top-up mode.
  const hostKeys = HOSTS.map((h) => h.key);
  const offset = existing.length;
  const rows = itins.map((it, i) => {
    const startsAt = new Date(Date.now() + (offset + i + 1) * 24 * 3600 * 1000);
    startsAt.setUTCHours(2, 0, 0, 0); // ~evening PT
    return {
      itinerary_id: it.id, creator_id: hostIds[hostKeys[(offset + i) % hostKeys.length]],
      city_id: cities.kelowna, starts_at: startsAt.toISOString(),
      duration_min: 180, status: 'seeking', moderation_status: 'approved', is_seed: true,
      ambient_sound_id: picks[i].id,
    };
  });

  const { data: inserted, error } = await sb.from('date_instances').insert(rows).select('id');
  if (error) throw new Error(`date_instances insert: ${error.message}`);
  console.log(`SEEDED ${inserted.length} swipeable kelowna nights (is_seed=true)${topUp ? ' [top-up]' : ''}`);
}

main().catch((e) => { console.error('SEED FAILED:', e.message); process.exit(1); });

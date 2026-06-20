// apps/web/scripts/seed-cohort.mjs
// Seed a 20+ MIXED-gender cohort of rich, browsable Kelowna daters so the feed /
// candidate surfaces feel populated. Each profile gets 3 AI portraits (Replicate
// FLUX schnell, blurred the same way generate-blur does), a real bio, 3 prompts,
// full demographics, and — for the first 13 — one of the founder's provided
// Instagram handles on the PUBLIC profiles.instagram_handle column (rendered only
// on clear-identity surfaces via ProfileCard, never the blurred feed).
//
//   node apps/web/scripts/seed-cohort.mjs            # full run (creates/upserts all)
//   node apps/web/scripts/seed-cohort.mjs --photos=4 # override portraits per person
//
// ⚠️ Writes to PROD (apps/web/.env.local → ufufmcpnysvwtutpbian) and spends
// Replicate credits (~12s/portrait). Idempotent: identified by seed-cohort-*@after5.seed;
// skips photo regeneration once a profile already has the target count.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = env.SUPABASE_SECRET_KEY;
const REPLICATE = env.REPLICATE_API_TOKEN;
if (!URL_ || !SERVICE) throw new Error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY in apps/web/.env.local');
if (!REPLICATE) throw new Error('missing REPLICATE_API_TOKEN in apps/web/.env.local');
const sb = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const BUCKET = 'profile-photos';
const REPLICATE_MODEL = 'black-forest-labs/flux-schnell';
const KELOWNA = '06b7bad2-9918-44cf-8d45-b611e053fa27';
const STYLE = 'natural skin texture, shot on 50mm lens, shallow depth of field, photorealistic, candid, no text, no watermark';
const PHOTOS = Number((process.argv.find((a) => a.startsWith('--photos=')) || '').split('=')[1]) || 3;

// Rotating settings pool — each persona's N shots pick distinct settings by offset
// so the same face appears in varied, on-brand Kelowna scenes.
const SETTINGS = [
  'at a sunlit cafe table with a coffee, warm morning light',
  'on the Kelowna lakefront promenade at golden hour, mountains behind',
  'laughing on a tree-lined trail in a denim jacket, late afternoon',
  'at a cozy wine bar counter, soft warm evening light',
  'at an outdoor night market holding street food, string-light bokeh',
  'on a sunny patio with a cold drink, relaxed weekend morning',
];

// 20 personas. gender + look drive the portrait; handle (first 13) is the founder's
// real network — EDIT the handle↔persona pairing freely, it's cosmetic to the AI face.
const HANDLES = ['danikelowna','raelynpollard','ms_hails13','pimkie101','testawich','haripath20',
  'deejgains','mikemeansbusiness_v_','joel.gagnier','mackthiessen','dbaumer17','daxguestross','madduxxii_x_agfa'];

const COHORT = [
  { name: 'Dani',    g: 'woman', pn: 'she/her', age: 29, occ: 'nurse',                 h: 165, hood: 'Lower Mission',  vibes: ['cozy','outdoors'],            look: 'a white woman in her late 20s with long brown hair and a warm freckled smile', bio: 'ICU nurse, weekend hiker. I will out-pace you up Knox and pretend I am not winded.', prompts: [['my_ideal_first_date','A trail walk with a coffee, then patio fries if we are still talking.'],['green_flag','You text your mom back. It says everything.'],['weekend_plan','Sunrise hike, big breakfast, nap with zero guilt.']] },
  { name: 'Raelyn',  g: 'woman', pn: 'she/her', age: 27, occ: 'graphic designer',      h: 168, hood: 'Pandosy',       vibes: ['creative','nightlife'],      look: 'a woman in her late 20s with wavy auburn hair and bold eyeliner, easy grin', bio: 'I design by day and lose at trivia by night. Bring strong opinions about fonts.', prompts: [['two_truths','I have lived on three continents, I can juggle, I hate the beach. One is a lie.'],['the_ick','Calling it "adulting." We are just doing the dishes, Brad.'],['we_vibe_when','you have a song you make everyone listen to in the car.']] },
  { name: 'Hailey',  g: 'woman', pn: 'she/her', age: 31, occ: 'pastry chef',           h: 160, hood: 'Downtown',      vibes: ['cozy','creative'],           look: 'an East Asian woman in her early 30s with a sleek black bob and soft smile', bio: 'I make croissants for a living, so brunch dates feel a little like homework I love.', prompts: [['unusual_skill','I can tell your oven temperature by smell. It is a curse.'],['a_perfect_sunday','Market in the morning, flour everywhere by noon, movie by 8.'],['green_flag','You eat the whole thing and tell me what you actually thought.']] },
  { name: 'Priya',   g: 'woman', pn: 'she/her', age: 33, occ: 'physiotherapist',       h: 163, hood: 'Glenmore',      vibes: ['outdoors','cozy'],           look: 'a South Asian woman in her early 30s with long dark hair in a loose ponytail, athletic and bright', bio: 'I fix people’s backs and over-explain stretching. Yes I will judge your posture, lovingly.', prompts: [['my_ideal_first_date','Paddleboards, then tacos. If you fall in, bonus points.'],['weekend_plan','Long run, ridiculous brunch, fixing my bike in the driveway.'],['roman_empire','How the Okanagan has no decent late-night food. It keeps me up.']] },
  { name: 'Mara',    g: 'woman', pn: 'she/her', age: 24, occ: 'barista & art student', h: 158, hood: 'Rutland',       vibes: ['creative','nightlife'],      look: 'a Latina woman in her mid 20s with curly dark hair and gold hoops, playful smirk', bio: 'Pulling shots and finishing my degree. I will draw you on a napkin if it is going well.', prompts: [['chronically_online','I have a Pinterest board for a house I cannot afford.'],['the_ick','Aux cord confidence with no follow-through.'],['we_vibe_when','it is 1am and we both still want fries.']] },
  { name: 'Soph',    g: 'woman', pn: 'she/her', age: 36, occ: 'high school teacher',   h: 170, hood: 'Kettle Valley', vibes: ['cozy','outdoors'],           look: 'a woman in her mid 30s with shoulder-length blonde hair and kind eyes, navy sweater', bio: 'I teach teenagers, so a quiet patio and a full sentence feel like a vacation.', prompts: [['my_ideal_first_date','Somewhere I can actually hear you. A loud bar is my villain origin story.'],['green_flag','You are kind to people who cannot do anything for you.'],['a_perfect_sunday','Farmers market, lake swim, early bed, no apologies.']] },
  { name: 'Jas',     g: 'woman', pn: 'they/them', age: 28, occ: 'sound engineer',      h: 172, hood: 'Downtown',      vibes: ['nightlife','creative'],      look: 'an androgynous person in their late 20s with a short dark undercut and silver earrings', bio: 'I mix live shows. I will absolutely have notes on the venue’s sound and I am usually right.', prompts: [['unusual_skill','I can name a snare drum from across a room.'],['we_vibe_when','you let a silence sit instead of filling it with podcast facts.'],['roman_empire','The Tragically Hip’s last show. I still think about it.']] },
  { name: 'Bea',     g: 'woman', pn: 'she/her', age: 41, occ: 'realtor',               h: 166, hood: 'Lakeview Heights', vibes: ['outdoors','nightlife'],   look: 'a Black woman in her early 40s with natural curls and a confident warm smile, emerald top', bio: 'I sell lake views and lose at golf gracefully. Looking for someone who plans the second date.', prompts: [['two_truths','I have sold a house with a moat, I speak French, I have never been camping. One lies.'],['green_flag','Your apology does not have the word "but" in it.'],['weekend_plan','Vineyard patio, a long walk, and absolutely no spreadsheets.']] },
  { name: 'Nat',     g: 'woman', pn: 'she/her', age: 30, occ: 'vet tech',              h: 162, hood: 'Glenmore',      vibes: ['cozy','outdoors'],           look: 'a woman in her early 30s with chestnut waves and a gentle freckled face, flannel shirt', bio: 'I will love your dog more than you for the first three dates. Fair warning.', prompts: [['my_ideal_first_date','Dog park, then a beer somewhere that lets the dog in.'],['the_ick','People who are rude to the server and sweet to me.'],['a_perfect_sunday','Trail with the dog, lake dip, and a book I will not finish.']] },
  { name: 'Lena',    g: 'woman', pn: 'she/her', age: 26, occ: 'winery host',           h: 169, hood: 'East Kelowna',  vibes: ['outdoors','creative'],       look: 'a woman in her mid 20s with long light-brown hair, sun-kissed, easy laugh, linen dress', bio: 'I pour wine and pretend to be casual about sunsets. I am not casual about sunsets.', prompts: [['my_ideal_first_date','Tasting flight, then watch the light go down over the lake.'],['green_flag','You ask the bartender what they’d order.'],['we_vibe_when','you have a strong, unserious opinion about something delicious.']] },

  { name: 'Deej',    g: 'man',   pn: 'he/him', age: 31, occ: 'electrician',           h: 180, hood: 'Rutland',       vibes: ['outdoors','nightlife'],      look: 'a white man in his early 30s with a short beard, ball cap, and easy grin', bio: 'I wire houses and over-commit to fantasy football. I make a mean campfire breakfast.', prompts: [['my_ideal_first_date','Drive to a lookout, gas-station snacks, playlist as a personality test.'],['green_flag','You return the cart. Every time. Even in the rain.'],['weekend_plan','Lake in summer, sled in winter, nap in all seasons.']] },
  { name: 'Mike',    g: 'man',   pn: 'he/him', age: 38, occ: 'small-business owner',   h: 183, hood: 'Lower Mission',  vibes: ['nightlife','cozy'],          look: 'a man in his late 30s with salt-and-pepper stubble and a sharp casual blazer', bio: 'I run a couple of shops downtown. I am better at listening than the espresso suggests.', prompts: [['two_truths','I once met a prime minister, I cannot whistle, I read 40 books last year. One lies.'],['the_ick','Talking about "the grind" at brunch. Let the eggs breathe.'],['a_perfect_sunday','Slow coffee, a long walk, and somebody to argue with about the crossword.']] },
  { name: 'Joel',    g: 'man',   pn: 'he/him', age: 29, occ: 'paramedic',             h: 178, hood: 'Glenmore',      vibes: ['outdoors','cozy'],           look: 'a man in his late 20s with short dark hair, clean jaw, calm reassuring smile', bio: 'I keep calm for a living, so chaos on a date is honestly kind of refreshing.', prompts: [['green_flag','You stretch before things. It tells me you respect your hamstrings and plan ahead.'],['my_ideal_first_date','A walk by the water and a question you actually want the answer to.'],['we_vibe_when','you can sit in a quiet moment without reaching for your phone.']] },
  { name: 'Mack',    g: 'man',   pn: 'he/him', age: 27, occ: 'carpenter',             h: 185, hood: 'East Kelowna',  vibes: ['outdoors','creative'],       look: 'a man in his late 20s with sandy hair, light beard, flannel, sun-touched skin', bio: 'I build things and fix the ones I break. Your wobbly table is safe with me.', prompts: [['unusual_skill','I can eyeball a 45-degree cut. Your IKEA shelf does not scare me.'],['weekend_plan','Sled, lake, a project in the driveway with a podcast on.'],['the_ick','Sending the steak back well done and then complaining it is dry.']] },
  { name: 'Dom',     g: 'man',   pn: 'he/him', age: 34, occ: 'chef',                  h: 176, hood: 'Downtown',      vibes: ['nightlife','creative'],      look: 'a Black man in his mid 30s with a short fade and warm grin, dark henley', bio: 'I cook all day so on a date I just want you to pick the place and surprise me.', prompts: [['my_ideal_first_date','You cook, badly, and narrate your panic about the onions. I am in.'],['green_flag','You are curious about the little details and kind to the staff.'],['roman_empire','Why nowhere good is open past 11 here. It haunts me.']] },
  { name: 'Dax',     g: 'man',   pn: 'he/him', age: 32, occ: 'photographer',          h: 181, hood: 'Pandosy',       vibes: ['creative','outdoors'],       look: 'a man in his early 30s with longish wavy hair and a film camera around his neck', bio: 'I shoot weddings and landscapes. I promise not to direct you into golden-hour poses. Mostly.', prompts: [['unusual_skill','I can find the one good light in any room. Comes in handy.'],['a_perfect_sunday','Chase the light somewhere, end up somewhere with good fries.'],['we_vibe_when','you point at something ordinary and call it beautiful.']] },
  { name: 'Hari',    g: 'man',   pn: 'he/him', age: 30, occ: 'software developer',     h: 174, hood: 'Glenmore',      vibes: ['cozy','creative'],           look: 'a South Asian man in his early 30s with dark wavy hair, glasses, and a soft smile', bio: 'I write code and bad puns. I will lose to you at board games and call it strategy.', prompts: [['chronically_online','I have strong opinions about keyboards. Strong.'],['my_ideal_first_date','A bakery, two pastries we split badly, and an argument about which won.'],['green_flag','You laugh at the bad pun before pretending you did not.']] },
  { name: 'Theo',    g: 'man',   pn: 'he/him', age: 39, occ: 'park ranger',           h: 182, hood: 'Lakeview Heights', vibes: ['outdoors','cozy'],         look: 'a man in his late 30s with a trimmed beard, weathered tan, and crinkly-eyed smile', bio: 'I spend my days outside and my evenings being told I should post more. Here I am.', prompts: [['my_ideal_first_date','A short hike to a view, then a beer that tastes better because we earned it.'],['weekend_plan','Up before the lake wakes, back before anyone notices I left.'],['the_ick','Leaving a trail messier than you found it. Hard no.']] },
  { name: 'Sam',     g: 'man',   pn: 'they/them', age: 25, occ: 'bartender',          h: 177, hood: 'Downtown',      vibes: ['nightlife','creative'],      look: 'an androgynous person in their mid 20s with a tousled fade and a couple of tasteful tattoos', bio: 'I make your drink and remember your order. Looking for a slow night and a fast laugh.', prompts: [['we_vibe_when','you tip well and tip in stories.'],['the_ick','Snapping at the bartender to get served faster. It works slower, friend.'],['a_perfect_sunday','Late start, record store, one good meal, no plans.']] },
  { name: 'Ben',     g: 'man',   pn: 'he/him', age: 35, occ: 'physiotherapy assistant', h: 179, hood: 'Kettle Valley', vibes: ['outdoors','cozy'],         look: 'a man in his mid 30s with short curly hair and a broad friendly smile, quarter-zip', bio: 'Recovering gym rat, current dad-joke enthusiast. I will spot you and your puns.', prompts: [['green_flag','You text to say you got home safe without being asked.'],['my_ideal_first_date','Climbing gym, then somewhere we can keep talking after.'],['roman_empire','The 2011 Canucks. We do not have to talk about it. But we can.']] },
];

// ---- blur recipe (exact mirror of generate-blur / seed-interested-women) -----
function blurParams(width, height) {
  const MAX = 64;
  const scale = Math.min(1, MAX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { width: w, height: h, blurRadius: Math.max(2, Math.round(Math.max(w, h) / 8)) };
}
async function makeBlurred(clearJpeg) {
  const meta = await sharp(clearJpeg).metadata();
  const p = blurParams(meta.width, meta.height);
  const tinyW = Math.max(1, Math.round(p.width / p.blurRadius));
  const tinyH = Math.max(1, Math.round(p.height / p.blurRadius));
  const tiny = await sharp(clearJpeg).resize(tinyW, tinyH, { fit: 'fill' }).toBuffer();
  return sharp(tiny).resize(p.width, p.height, { fit: 'fill' }).jpeg({ quality: 70 }).toBuffer();
}

async function generatePortrait(prompt, attempt = 1) {
  const create = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REPLICATE}`, 'Content-Type': 'application/json', Prefer: 'wait=30' },
    body: JSON.stringify({ input: { prompt, aspect_ratio: '3:4', output_format: 'jpg', output_quality: 92, num_inference_steps: 4, go_fast: true } }),
  });
  if (create.status === 429 && attempt < 6) {
    console.log(`  … replicate 429, retrying in 30s (attempt ${attempt + 1}/6)`);
    await new Promise((r) => setTimeout(r, 30_000));
    return generatePortrait(prompt, attempt + 1);
  }
  if (!create.ok) throw new Error(`replicate create ${create.status}: ${(await create.text()).slice(0, 160)}`);
  let pred = await create.json();
  if (pred.error) throw new Error(`replicate: ${pred.error}`);
  const pollUrl = pred.urls?.get ?? `https://api.replicate.com/v1/predictions/${pred.id}`;
  for (let i = 0; i < 60 && !(pred.status === 'succeeded' && pred.output); i++) {
    if (pred.status === 'failed' || pred.status === 'canceled') throw new Error(`replicate ${pred.status}: ${pred.error}`);
    await new Promise((r) => setTimeout(r, 1000));
    const r = await fetch(pollUrl, { headers: { Authorization: `Bearer ${REPLICATE}` } });
    if (!r.ok) throw new Error(`replicate poll ${r.status}`);
    pred = await r.json();
  }
  const out = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!out) throw new Error('replicate poll timeout');
  const img = await fetch(out);
  if (!img.ok) throw new Error(`image fetch ${img.status}`);
  return sharp(Buffer.from(await img.arrayBuffer())).jpeg({ quality: 92 }).toBuffer();
}

async function addPhoto(uid, prompt, sortOrder, isPrimary) {
  await new Promise((r) => setTimeout(r, 12_000)); // pace the low-credit throttle
  const clear = await generatePortrait(prompt);
  const blurred = await makeBlurred(clear);
  const photoId = randomUUID();
  const clearPath = `${uid}/${photoId}.jpg`;
  const blurredPath = `${uid}/${photoId}_blurred.jpg`;
  let r = await sb.storage.from(BUCKET).upload(clearPath, clear, { contentType: 'image/jpeg', upsert: true });
  if (r.error) throw new Error(`upload clear ${uid}: ${r.error.message}`);
  r = await sb.storage.from(BUCKET).upload(blurredPath, blurred, { contentType: 'image/jpeg', upsert: true });
  if (r.error) throw new Error(`upload blurred ${uid}: ${r.error.message}`);
  r = await sb.from('profile_photos').insert({ id: photoId, user_id: uid, clear_path: clearPath, blurred_path: blurredPath, sort_order: sortOrder, is_primary: isPrimary });
  if (r.error) throw new Error(`profile_photos ${uid}: ${r.error.message}`);
  console.log(`  ✓ photo ${sortOrder} (${clear.length}b clear / ${blurred.length}b blurred)`);
  return { clearPath, blurredPath };
}

async function findUserByEmail(email) {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email)?.id ?? null;
}

const PREF = { man: ['woman'], woman: ['man'], nonbinary: ['man', 'woman', 'nonbinary'] };
function birthdateFor(age) { const y = new Date().getUTCFullYear() - age; return `${y}-06-15`; }
function shotsFor(p, n) {
  return Array.from({ length: n }, (_, i) =>
    `Candid dating-profile photograph of ${p.look}, ${SETTINGS[(p._idx + i) % SETTINGS.length]}, ${STYLE}`);
}

async function seedPerson(p, idx) {
  const email = `seed-cohort-${idx + 1}@after5.seed`;
  p._idx = idx;
  let uid = await findUserByEmail(email);
  if (uid) {
    console.log(`${p.name}: exists (${uid}) — refreshing profile`);
  } else {
    const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
    uid = data.user.id;
    console.log(`${p.name}: created ${uid}`);
  }

  // birthdate + bio FIRST (age-gate trigger needs birthdate before dating_enabled flips).
  let { error } = await sb.from('profiles_private').upsert(
    { user_id: uid, birthdate: birthdateFor(p.age), bio: p.bio }, { onConflict: 'user_id' });
  if (error) throw new Error(`profiles_private ${p.name}: ${error.message}`);

  const handle = HANDLES[idx] ?? null; // first 13 get the founder's real handles
  ({ error } = await sb.from('profiles').update({
    first_name: p.name, age: p.age, gender: p.g, pronouns: p.pn, occupation: p.occ,
    height_cm: p.h, neighborhood: p.hood, vibe_tags: p.vibes,
    prompt_answers: p.prompts.map(([prompt_id, answer]) => ({ prompt_id, answer })),
    instagram_handle: handle, primary_city_id: KELOWNA, dating_enabled: true,
    verification: 'verified', account_state: 'active', standing: 'good',
    gender_preferences: PREF[p.g] ?? PREF.nonbinary, age_pref: '[24,48)', distance_pref_km: 40,
    onboarding_step: 'done', onboarding_completed_at: new Date().toISOString(),
  }).eq('id', uid));
  if (error) throw new Error(`profiles ${p.name}: ${error.message}`);

  // Photos: idempotent — skip if already at target count.
  const { count } = await sb.from('profile_photos').select('id', { count: 'exact', head: true }).eq('user_id', uid);
  if ((count ?? 0) >= PHOTOS) { console.log(`  photos present (${count}) — skipping`); return uid; }
  await sb.from('profile_photos').delete().eq('user_id', uid);
  const shots = shotsFor(p, PHOTOS);
  let primary;
  for (let i = 0; i < shots.length; i++) {
    const res = await addPhoto(uid, shots[i], i, i === 0);
    if (i === 0) primary = res;
  }
  ({ error } = await sb.from('profiles').update({ clear_photo_url: primary.clearPath, blurred_photo_url: primary.blurredPath }).eq('id', uid));
  if (error) throw new Error(`profiles mirror ${p.name}: ${error.message}`);
  return uid;
}

async function main() {
  console.log(`Seeding ${COHORT.length} cohort daters × ${PHOTOS} photos (≈${COHORT.length * PHOTOS} portraits, ~${Math.round(COHORT.length * PHOTOS * 12 / 60)} min)\n`);
  let ok = 0;
  for (let i = 0; i < COHORT.length; i++) {
    try { await seedPerson(COHORT[i], i); ok++; }
    catch (e) { console.error(`  ✗ ${COHORT[i].name}: ${e.message}`); }
  }
  console.log(`\nDONE: ${ok}/${COHORT.length} cohort daters seeded (first ${HANDLES.length} carry IG handles).`);
}

main().catch((e) => { console.error('SEED-COHORT FAILED:', e.message); process.exit(1); });

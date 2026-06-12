// 10 fully-built interested women on the founder's hosted night
// "Coffee, a Park Loop, and French Pastry" (instance 70cdb78f-8e4e-4ff1-91d6-72beb2efb2b0).
//
//   node scripts/seed-interested-women.mjs
//
// What it does (idempotent, fail-loud):
//   1. Creates 7 NEW women as complete fake profiles (founder rule: photos through
//      the real profile-photos storage pipeline, prompts, age, pronouns, occupation,
//      height). 2 distinct FLUX portraits each (clear + blurred sibling, exactly the
//      generate-blur recipe), profile_photos rows, mirror columns = storage paths.
//   2. Completes Chris in-place (age 29, she/her, occupation, height, 3 prompts) and
//      REGENERATES her photos — her old mirror paths (clear.jpg / blurred.jpg) break
//      signBlurredUrls, which requires the *_blurred.jpg convention.
//   3. Tops up Ava + Maya with a second candid shot so every candidate gallery has
//      2 profile_photos rows like a real user.
//   4. Inserts swipes (direction right) + queue_entries (status interested) for all
//      10 women on the founder's instance, skipping existing rows, plus ONE
//      interest_received notification for the host (dedup-keyed, conflict-skipped).
//   5. Verifies: 10 interested queue_entries; each candidate has 2 photos +
//      non-null age/pronouns/occupation/height_cm + prompt answers; every blurred
//      mirror path signs + downloads.
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY + REPLICATE_API_TOKEN from
// apps/web/.env.local. Replicate low-credit throttle: pace 12s + retry on 429
// inside node. Never prints secrets.
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
if (!URL_ || !SERVICE || !REPLICATE) throw new Error('missing prod url / service key / REPLICATE_API_TOKEN in apps/web/.env.local');
const sb = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });

const BUCKET = 'profile-photos';
const REPLICATE_MODEL = 'black-forest-labs/flux-schnell';
const INSTANCE_ID = '70cdb78f-8e4e-4ff1-91d6-72beb2efb2b0';
const HOST_ID = '3e7e47b2-81f3-4e40-9934-338b3c5433f0';
const KELOWNA = '06b7bad2-9918-44cf-8d45-b611e053fa27';

const EXISTING = {
  ava: 'ae62da9b-ec7b-4708-a00d-6b26288f501e',
  maya: '2fdbff20-eb79-4690-a5ba-2a747edabafe',
  chris: '27ff1888-64b5-4a62-a23d-bd8b053e575d',
};

const STYLE = 'natural skin texture, shot on 50mm lens, shallow depth of field, photorealistic, no text, no watermark';

// 7 new women. Distinct people, varied ages/ethnicities/styles, candid warm settings.
const NEW_WOMEN = [
  {
    email: 'seed-interest-1@after5.seed', name: 'Priya', age: 31, birthdate: '1995-03-17',
    pronouns: 'she/her', occupation: 'pharmacist', heightCm: 163, vibes: ['cozy', 'creative', 'outdoors'],
    prompts: [
      { prompt_id: 'my_ideal_first_date', answer: 'Coffee first so I can tell if you talk to baristas like a person. Then a walk with no destination.' },
      { prompt_id: 'green_flag', answer: 'You return the cart. Every time. Even in the rain.' },
      { prompt_id: 'unusual_skill', answer: 'I can fold a fitted sheet correctly and I will demonstrate unprompted.' },
    ],
    shots: [
      `Candid dating-profile photograph of a South Asian woman in her early 30s with long black hair, soft confident smile, wearing a mustard cardigan, sitting at a sunlit cafe table with a flat white, warm morning light, ${STYLE}`,
      `Candid photograph of the same South Asian woman in her early 30s with long black hair, laughing on a walking trail among autumn trees, denim jacket, golden hour, ${STYLE}`,
    ],
  },
  {
    email: 'seed-interest-2@after5.seed', name: 'Sienna', age: 26, birthdate: '2000-07-02',
    pronouns: 'she/her', occupation: 'dental hygienist', heightCm: 168, vibes: ['cozy', 'nightlife'],
    prompts: [
      { prompt_id: 'a_perfect_sunday', answer: 'Gyro Beach early before the crowds, then pancakes I did not cook and will not clean up.' },
      { prompt_id: 'the_ick', answer: 'Men who clap when the plane lands.' },
      { prompt_id: 'we_vibe_when', answer: 'you let the comfortable silence sit instead of filling it with podcast facts.' },
    ],
    shots: [
      `Candid dating-profile photograph of a young woman in her mid 20s with wavy blonde hair and light tan, easy grin, white tank top, leaning on a beach boardwalk railing at golden hour, ${STYLE}`,
      `Candid photograph of the same young blonde woman in her mid 20s, sitting cross-legged on a picnic blanket in a park holding an iced drink, summer afternoon light, ${STYLE}`,
    ],
  },
  {
    email: 'seed-interest-3@after5.seed', name: 'Noor', age: 28, birthdate: '1998-01-25',
    pronouns: 'she/her', occupation: 'UX researcher', heightCm: 160, vibes: ['creative', 'cozy'],
    prompts: [
      { prompt_id: 'my_ideal_first_date', answer: 'A bakery, two pastries we split badly, and an argument about which one was better.' },
      { prompt_id: 'chronically_online', answer: 'I have opinions about fonts. Strong ones. Helvetica apologists need not apply.' },
      { prompt_id: 'two_truths', answer: 'I have been to 23 countries, I once interviewed a goat farmer for work, I like cilantro. One is a lie.' },
    ],
    shots: [
      `Candid dating-profile photograph of a Middle Eastern woman in her late 20s with dark shoulder-length hair and bold brows, warm half-smile, rust linen blouse, seated by a bakery window with pastries in soft focus, morning light, ${STYLE}`,
      `Candid photograph of the same Middle Eastern woman in her late 20s with dark shoulder-length hair, browsing a bookshop shelf, holding a paperback, soft indoor light, ${STYLE}`,
    ],
  },
  {
    email: 'seed-interest-4@after5.seed', name: 'Daniela', age: 33, birthdate: '1992-11-08',
    pronouns: 'she/her', occupation: 'physiotherapist', heightCm: 172, vibes: ['outdoors', 'cozy'],
    prompts: [
      { prompt_id: 'best_kelowna_spot', answer: 'Knox Mountain at 7am. I will not be taking questions about the hour.' },
      { prompt_id: 'green_flag', answer: 'You stretch before things. Any things. It tells me you plan ahead and respect your hamstrings.' },
      { prompt_id: 'a_perfect_sunday', answer: 'Long trail run, a ridiculous brunch to undo it, then fixing my bike in the driveway with a podcast on.' },
    ],
    shots: [
      `Candid dating-profile photograph of a Latina woman in her early 30s with dark hair in a loose ponytail, athletic build, bright genuine laugh, wearing a teal quarter-zip, standing on a mountain trail overlook at sunrise, ${STYLE}`,
      `Candid photograph of the same Latina woman in her early 30s with dark ponytail, sitting on a patio in a denim shirt with a coffee mug, relaxed weekend morning, ${STYLE}`,
    ],
  },
  {
    email: 'seed-interest-5@after5.seed', name: 'Claire', age: 38, birthdate: '1988-05-30',
    pronouns: 'she/her', occupation: 'elementary school principal', heightCm: 166, vibes: ['cozy', 'creative'],
    prompts: [
      { prompt_id: 'my_ideal_first_date', answer: 'Somewhere I can hear you. I spend all day being yelled at by nine-year-olds. A quiet patio is a luxury good.' },
      { prompt_id: 'unusual_skill', answer: 'I can silence a room of 30 children with one look. It also works on adults at dinner parties.' },
      { prompt_id: 'roman_empire', answer: 'The fact that the Hudson Bay Company is older than gravity. The theory of it, anyway.' },
    ],
    shots: [
      `Candid dating-profile photograph of a woman in her late 30s with chin-length chestnut bob and kind eyes, soft knowing smile, navy blazer over a white tee, seated at a wine bar counter in warm evening light, ${STYLE}`,
      `Candid photograph of the same woman in her late 30s with chestnut bob, walking through a farmers market holding flowers, light summer dress, late afternoon, ${STYLE}`,
    ],
  },
  {
    email: 'seed-interest-6@after5.seed', name: 'Tess', age: 24, birthdate: '2001-09-14',
    pronouns: 'she/her', occupation: 'line cook', heightCm: 158, vibes: ['nightlife', 'creative'],
    prompts: [
      { prompt_id: 'my_ideal_first_date', answer: 'Cook for me. I do not care if it is bad. I want to watch you hold a knife wrong and panic about onions.' },
      { prompt_id: 'the_ick', answer: 'Sending the steak back well done and then complaining it is dry.' },
      { prompt_id: 'we_vibe_when', answer: 'it is 1am, the kitchen is closed, and you still want fries from the only place open.' },
    ],
    shots: [
      `Candid dating-profile photograph of an East Asian woman in her mid 20s with a black shag haircut and small silver earrings, playful smirk, vintage band tee, sitting at a late-night diner booth under warm neon glow, ${STYLE}`,
      `Candid photograph of the same East Asian woman in her mid 20s with black shag hair, at an outdoor night market holding street food, string lights bokeh, ${STYLE}`,
    ],
  },
  {
    email: 'seed-interest-7@after5.seed', name: 'Marisol', age: 35, birthdate: '1991-02-19',
    pronouns: 'she/her', occupation: 'real estate appraiser', heightCm: 175, vibes: ['outdoors', 'nightlife'],
    prompts: [
      { prompt_id: 'best_kelowna_spot', answer: 'The bench at the top of Paul’s Tomb. Free, quiet, and the lake does all the work.' },
      { prompt_id: 'two_truths', answer: 'I have appraised a house with a moat, I speak three languages, I have never lost at cribbage. The cribbage one is the lie and it haunts me.' },
      { prompt_id: 'green_flag', answer: 'Your apology does not contain the word "but".' },
    ],
    shots: [
      `Candid dating-profile photograph of a tall Black woman in her mid 30s with natural curls and gold hoop earrings, confident warm smile, emerald wrap top, standing on a lakefront promenade at dusk, city lights behind, ${STYLE}`,
      `Candid photograph of the same Black woman in her mid 30s with natural curls, laughing over a glass of red wine at a vineyard patio table, golden hour, ${STYLE}`,
    ],
  },
];

const CHRIS = {
  id: EXISTING.chris, name: 'Chris', age: 29, birthdate: '1997-04-03',
  pronouns: 'she/her', occupation: 'heavy equipment operator', heightCm: 169,
  prompts: [
    { prompt_id: 'my_ideal_first_date', answer: 'A drive somewhere with a view, snacks from the gas station, and the playlist on shuffle as a personality test.' },
    { prompt_id: 'unusual_skill', answer: 'I can parallel park a 40-tonne excavator. Your Corolla does not scare me.' },
    { prompt_id: 'a_perfect_sunday', answer: 'Sled in winter, lake in summer, nap in all seasons.' },
  ],
  shots: [
    `Candid dating-profile photograph of a woman in her late 20s with sandy brown hair in a loose braid, sun-touched skin, easy outdoorsy grin, flannel shirt over a white tee, leaning against a pickup truck tailgate at a lake lookout, late afternoon, ${STYLE}`,
    `Candid photograph of the same woman in her late 20s with sandy brown braid, sitting around a campfire holding an enamel mug, warm firelight, mountains behind, ${STYLE}`,
  ],
};

// Second candid shots for Ava + Maya (their galleries currently have 1 photo).
const TOPUPS = [
  { id: EXISTING.ava, name: 'Ava', shot: `Candid photograph of a woman in her late 20s with long auburn hair and light freckles, cream linen shirt, strolling through a winery garden holding a glass of white wine, warm late afternoon light, ${STYLE}` },
  { id: EXISTING.maya, name: 'Maya', shot: `Candid photograph of a woman in her early 30s with shoulder-length dark wavy hair and olive complexion, rust knit sweater, browsing a farmers market stall and smiling at someone off camera, golden hour, ${STYLE}` },
];

// ---- blur recipe (exact mirror of generate-blur / seed-host-portraits) -----
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
    body: JSON.stringify({
      input: { prompt, aspect_ratio: '3:4', output_format: 'jpg', output_quality: 92, num_inference_steps: 4, go_fast: true },
    }),
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

// Generate → blur → upload both → profile_photos row. Returns {clearPath, blurredPath}.
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
  r = await sb.from('profile_photos').insert({
    id: photoId, user_id: uid, clear_path: clearPath, blurred_path: blurredPath,
    sort_order: sortOrder, is_primary: isPrimary,
  });
  if (r.error) throw new Error(`profile_photos ${uid}: ${r.error.message}`);
  console.log(`  ✓ photo ${sortOrder} → ${clearPath} (${clear.length}b clear / ${blurred.length}b blurred)`);
  return { clearPath, blurredPath };
}

async function findUserByEmail(email) {
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email === email)?.id ?? null;
}

async function seedWoman(w) {
  let uid = await findUserByEmail(w.email);
  if (uid) {
    console.log(`${w.name}: exists (${uid}) — refreshing profile, keeping photos if 2 present`);
  } else {
    const { data, error } = await sb.auth.admin.createUser({ email: w.email, email_confirm: true });
    if (error || !data.user) throw new Error(`createUser ${w.email}: ${error?.message}`);
    uid = data.user.id;
    console.log(`${w.name}: created ${uid}`);
  }

  // birthdate FIRST — the age-gate trigger requires it before dating_enabled flips true.
  let { error } = await sb.from('profiles_private').upsert({ user_id: uid, birthdate: w.birthdate }, { onConflict: 'user_id' });
  if (error) throw new Error(`profiles_private ${w.name}: ${error.message}`);

  ({ error } = await sb.from('profiles').update({
    first_name: w.name, age: w.age, gender: 'woman', pronouns: w.pronouns,
    occupation: w.occupation, height_cm: w.heightCm, vibe_tags: w.vibes,
    prompt_answers: w.prompts, primary_city_id: KELOWNA,
    dating_enabled: true, verification: 'verified', account_state: 'active', standing: 'good',
    gender_preferences: ['man'], age_pref: '[25,45)', distance_pref_km: 40,
    onboarding_step: 'done', onboarding_completed_at: new Date().toISOString(),
  }).eq('id', uid));
  if (error) throw new Error(`profiles ${w.name}: ${error.message}`);

  // Photos: skip generation if this user already has 2 photos (idempotent rerun).
  const { count } = await sb.from('profile_photos').select('id', { count: 'exact', head: true }).eq('user_id', uid);
  if ((count ?? 0) >= 2) {
    console.log(`  photos already present (${count}) — skipping generation`);
    return uid;
  }
  // clean any partial state
  await sb.from('profile_photos').delete().eq('user_id', uid);
  const primary = await addPhoto(uid, w.shots[0], 0, true);
  await addPhoto(uid, w.shots[1], 1, false);
  ({ error } = await sb.from('profiles').update({ clear_photo_url: primary.clearPath, blurred_photo_url: primary.blurredPath }).eq('id', uid));
  if (error) throw new Error(`profiles mirror ${w.name}: ${error.message}`);
  return uid;
}

async function completeChris() {
  const c = CHRIS;
  let { error } = await sb.from('profiles_private').upsert({ user_id: c.id, birthdate: c.birthdate }, { onConflict: 'user_id' });
  if (error) throw new Error(`profiles_private Chris: ${error.message}`);
  ({ error } = await sb.from('profiles').update({
    age: c.age, pronouns: c.pronouns, occupation: c.occupation, height_cm: c.heightCm,
    prompt_answers: c.prompts, dating_enabled: true,
  }).eq('id', c.id));
  if (error) throw new Error(`profiles Chris: ${error.message}`);
  console.log('Chris: persona completed');

  // Her old photos use clear.jpg/blurred.jpg paths — signBlurredUrls requires
  // *_blurred.jpg. Regenerate through the real pipeline unless already fixed.
  const { data: photos } = await sb.from('profile_photos').select('blurred_path').eq('user_id', c.id);
  const ok = (photos ?? []).filter((p) => p.blurred_path?.endsWith('_blurred.jpg'));
  if (ok.length >= 2) { console.log('  Chris photos already conformant — skipping'); return; }
  await sb.from('profile_photos').delete().eq('user_id', c.id);
  const { data: objs } = await sb.storage.from(BUCKET).list(c.id, { limit: 100 });
  const names = (objs ?? []).map((o) => `${c.id}/${o.name}`);
  if (names.length) await sb.storage.from(BUCKET).remove(names);
  const primary = await addPhoto(c.id, c.shots[0], 0, true);
  await addPhoto(c.id, c.shots[1], 1, false);
  ({ error } = await sb.from('profiles').update({ clear_photo_url: primary.clearPath, blurred_photo_url: primary.blurredPath }).eq('id', c.id));
  if (error) throw new Error(`profiles mirror Chris: ${error.message}`);
}

async function topUpSecondPhoto(t) {
  const { count } = await sb.from('profile_photos').select('id', { count: 'exact', head: true }).eq('user_id', t.id);
  if ((count ?? 0) >= 2) { console.log(`${t.name}: already has ${count} photos — skipping top-up`); return; }
  console.log(`${t.name}: adding second candid`);
  await addPhoto(t.id, t.shot, 1, false);
}

async function queueInterest(candidateIds) {
  for (const cid of candidateIds) {
    const { data: sw } = await sb.from('swipes').select('id').eq('swiper_id', cid).eq('date_instance_id', INSTANCE_ID).maybeSingle();
    if (!sw) {
      const { error } = await sb.from('swipes').insert({ swiper_id: cid, date_instance_id: INSTANCE_ID, creator_id: HOST_ID, direction: 'right' });
      if (error) throw new Error(`swipes ${cid}: ${error.message}`);
    }
    const { data: qe } = await sb.from('queue_entries').select('id').eq('candidate_id', cid).eq('date_instance_id', INSTANCE_ID).maybeSingle();
    if (!qe) {
      const { error } = await sb.from('queue_entries').insert({ date_instance_id: INSTANCE_ID, candidate_id: cid, creator_id: HOST_ID, status: 'interested' });
      if (error) throw new Error(`queue_entries ${cid}: ${error.message}`);
    }
  }
  // One host notification, dedup-keyed. The (type,dedup_key) unique index is
  // PARTIAL (WHERE dedup_key IS NOT NULL) — PostgREST upsert can't target it,
  // so select-then-insert; a duplicate-key race just means the row exists.
  const dedupKey = `interest_received:${INSTANCE_ID}`;
  const { data: existing } = await sb.from('notifications').select('id')
    .eq('type', 'interest_received').eq('dedup_key', dedupKey).maybeSingle();
  if (!existing) {
    const { error } = await sb.from('notifications').insert({
      user_id: HOST_ID, type: 'interest_received',
      payload: { date_instance_id: INSTANCE_ID, new_count: candidateIds.length, dedup_key: dedupKey },
      dedup_key: dedupKey,
    });
    if (error && !/duplicate key/.test(error.message)) throw new Error(`notifications: ${error.message}`);
  }
}

async function verify(candidateIds) {
  // All 10 must be IN the queue. They land as 'interested'; if the host has
  // since shortlisted/passed some in the live app, that is real product state —
  // report it, don't revert it.
  const { data: entries, error: qErr } = await sb.from('queue_entries').select('candidate_id, status')
    .eq('date_instance_id', INSTANCE_ID).in('candidate_id', candidateIds);
  if (qErr) throw new Error(`verify queue: ${qErr.message}`);
  console.log(`\nVERIFY: queue_entries for our 10 = ${entries.length}`);
  if (entries.length !== 10) throw new Error(`expected 10 queue_entries, got ${entries.length}`);
  const advanced = entries.filter((e) => e.status !== 'interested');
  if (advanced.length) console.log(`  note: ${advanced.length} already progressed by the host: ${advanced.map((e) => e.status).join(', ')}`);

  for (const cid of candidateIds) {
    const { data: p, error } = await sb.from('profiles')
      .select('first_name, age, pronouns, occupation, height_cm, prompt_answers, blurred_photo_url')
      .eq('id', cid).single();
    if (error || !p) throw new Error(`verify profile ${cid}: ${error?.message}`);
    const { count: pc } = await sb.from('profile_photos').select('id', { count: 'exact', head: true }).eq('user_id', cid);
    const missing = ['age', 'pronouns', 'occupation', 'height_cm'].filter((k) => p[k] == null);
    if (missing.length || !Array.isArray(p.prompt_answers) || p.prompt_answers.length < 2 || (pc ?? 0) < 2) {
      throw new Error(`verify FAILED ${p.first_name} (${cid}): photos=${pc} missing=${missing.join(',')} prompts=${p.prompt_answers?.length}`);
    }
    // Blurred mirror must sign + download (the interested page path).
    const { data: signed, error: sErr } = await sb.storage.from(BUCKET).createSignedUrl(p.blurred_photo_url, 600);
    if (sErr || !signed?.signedUrl) throw new Error(`sign FAILED ${p.first_name}: ${sErr?.message} (${p.blurred_photo_url})`);
    const resp = await fetch(signed.signedUrl);
    if (!resp.ok) throw new Error(`download FAILED ${p.first_name}: http ${resp.status}`);
    console.log(`  ✓ ${p.first_name}: photos=${pc} age=${p.age} ${p.pronouns} "${p.occupation}" ${p.height_cm}cm prompts=${p.prompt_answers.length} blurred signs+downloads`);
  }
  console.log('\nDONE: 10 fully-built interested women on the founder’s night');
}

async function main() {
  const newIds = [];
  for (const w of NEW_WOMEN) newIds.push(await seedWoman(w));
  await completeChris();
  for (const t of TOPUPS) await topUpSecondPhoto(t);
  const all = [...newIds, EXISTING.ava, EXISTING.maya, EXISTING.chris];
  await queueInterest(all);
  await verify(all);
}

main().catch((e) => { console.error('SEED-INTERESTED-WOMEN FAILED:', e.message); process.exit(1); });

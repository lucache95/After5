// Service-role seed (reality #5). Bypasses RLS for setup writes ONLY — never to fake a
// user read the test is meant to verify. Mirrors scripts/5b-smoke-prod/{1,2,3}.sql.
//
// FOUNDER RULE: every fake profile is FULLY built out to read like a real user —
// portraits through the real profile-photos storage pipeline (clear + blurred
// sibling + profile_photos row, exactly like scripts/seed-host-portraits.mjs does
// on prod), occupation / height / pronouns / prompt answers, and a realistic
// evening start time. "It's not helpful if there are no images."
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Local Supabase CLI service-role key (this stack); override via env in CI from `supabase status -o env`.
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export interface SeedResult {
  hostEmail: string;
  candEmail: string;
  hostId: string;
  candId: string;
  instanceId: string;
}

const PHOTO_BUCKET = 'profile-photos';

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Resolve a public/seed asset regardless of where the helper runs from
// (Playwright runs with cwd=apps/web; one-shot tsx scripts may run from the
// repo root). Blurred siblings (public/seed/*_blurred.jpg) were pre-generated
// once with sharp using the exact generate-blur blurParams() recipe — see
// scripts/seed-host-portraits.mjs makeBlurred().
function seedAssetBytes(file: string): Buffer {
  const candidates = [
    path.join(process.cwd(), 'public', 'seed', file),
    path.join(process.cwd(), 'apps', 'web', 'public', 'seed', file),
  ];
  for (const c of candidates) if (existsSync(c)) return readFileSync(c);
  throw new Error(`seed asset missing: ${file} (cwd=${process.cwd()})`);
}

// Real photo pipeline: upload the portrait + its blurred sibling into the
// profile-photos bucket under the canonical real-user convention
// (<uid>/<photoId>.jpg + <uid>/<photoId>_blurred.jpg) and insert the matching
// primary profile_photos row. The reveal modal + galleries read profile_photos
// rows through signClearUrls/signBlurredUrls — mirror columns alone left the
// reveal showing "no photo yet." during founder demos.
async function seedProfilePhoto(sb: SupabaseClient, userId: string, publicAssetPath: string) {
  // Founder rule: seed galleries look like REAL galleries — primary portrait
  // plus a second candid shot of the same persona (portrait-<x>-2.jpg), so the
  // carousel/reveal surfaces exercise multi-photo behavior.
  const base = path.basename(publicAssetPath, '.jpg'); // e.g. 'portrait-woman'
  const shots = [`${base}.jpg`, `${base}-2.jpg`];

  for (let i = 0; i < shots.length; i++) {
    const stem = shots[i].replace(/\.jpg$/, '');
    const clearBytes = seedAssetBytes(`${stem}.jpg`);
    const blurredBytes = seedAssetBytes(`${stem}_blurred.jpg`);

    const photoId = randomUUID();
    const clearPath = `${userId}/${photoId}.jpg`;
    const blurredPath = `${userId}/${photoId}_blurred.jpg`;

    let r = await sb.storage.from(PHOTO_BUCKET).upload(clearPath, clearBytes, { contentType: 'image/jpeg', upsert: true });
    if (r.error) throw new Error(`upload clear ${userId}: ${r.error.message}`);
    r = await sb.storage.from(PHOTO_BUCKET).upload(blurredPath, blurredBytes, { contentType: 'image/jpeg', upsert: true });
    if (r.error) throw new Error(`upload blurred ${userId}: ${r.error.message}`);

    const { error } = await sb.from('profile_photos').insert({
      id: photoId, user_id: userId, clear_path: clearPath, blurred_path: blurredPath,
      sort_order: i, is_primary: i === 0,
    });
    if (error) throw new Error(`profile_photos ${userId}: ${error.message}`);
  }
}

// Storage objects do NOT cascade when the auth user is deleted — remove the
// seeded folder (and rows, belt-and-braces: rows would cascade anyway).
async function removeProfilePhotos(sb: SupabaseClient, userId: string) {
  await sb.from('profile_photos').delete().eq('user_id', userId);
  const { data: objs } = await sb.storage.from(PHOTO_BUCKET).list(userId, { limit: 100 });
  const names = (objs ?? []).map((o) => `${userId}/${o.name}`);
  if (names.length) await sb.storage.from(PHOTO_BUCKET).remove(names);
}

async function createUser(sb: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

async function promoteProfile(
  sb: SupabaseClient,
  userId: string,
  opts: {
    firstName: string;
    birthdate: string;
    gender: string;
    prefs: string[];
    verified?: boolean;
    photo?: string;
    // FOUNDER RULE persona fields — every seeded profile carries the full set a
    // real completed profile would (SelfViewSheet/ProfileCard/RevealModal read
    // occupation, height_cm, pronouns + prompt_answers jsonb keyed to
    // profile_prompts ids).
    occupation?: string;
    heightCm?: number;
    pronouns?: string;
    promptAnswers?: { prompt_id: string; answer: string }[];
    lifestyle?: { smokes?: boolean; drinks?: boolean; has_pets?: boolean; wants_kids?: boolean };
  },
) {
  // birthdate FIRST — the age-gate trigger requires it before dating_enabled can flip true.
  let { error } = await sb
    .from('profiles_private')
    .upsert({ user_id: userId, birthdate: opts.birthdate }, { onConflict: 'user_id' });
  if (error) throw new Error(`profiles_private ${userId}: ${error.message}`);

  const { data: city, error: cityErr } = await sb.from('cities').select('id').eq('slug', 'kelowna').single();
  if (cityErr || !city) throw new Error(`cities slug=kelowna: ${cityErr?.message}`);

  const photo = opts.photo ?? '/seed/portrait-man.jpg';
  const photoBase = path.basename(photo, '.jpg');

  ({ error } = await sb
    .from('profiles')
    .update({
      first_name: opts.firstName,
      gender: opts.gender,
      gender_preferences: opts.prefs,
      age_pref: '[25,45)',
      primary_city_id: city.id,
      distance_pref_km: 40,
      vibe_tags: ['cozy', 'creative', 'nightlife'],
      // Mirror columns stay LOCAL PUBLIC ASSET paths (cheap surfaces read the
      // mirror directly; a remote host would need next.config images
      // allow-listing and next/image throws (→ server error) on an
      // un-configured hostname). Real PERSON portraits (public/seed/*.jpg,
      // FLUX-generated like the prod seed hosts) — a street scene in the
      // polaroid read as a bug during founder walkthroughs. The blurred mirror
      // points at the pre-generated blurred PUBLIC sibling so a raw render of
      // it never shows the clear face.
      clear_photo_url: photo,
      blurred_photo_url: `/seed/${photoBase}_blurred.jpg`,
      verification: opts.verified === false ? 'unverified' : 'verified',
      dating_enabled: opts.verified === false ? false : true,
      onboarding_step: 'done',
      onboarding_completed_at: new Date().toISOString(),
      // Full persona — distinct, plausible values per seeded user.
      occupation: opts.occupation ?? null,
      height_cm: opts.heightCm ?? null,
      pronouns: opts.pronouns ?? null,
      prompt_answers: opts.promptAnswers ?? [],
      smokes: opts.lifestyle?.smokes ?? null,
      drinks: opts.lifestyle?.drinks ?? null,
      has_pets: opts.lifestyle?.has_pets ?? null,
      wants_kids: opts.lifestyle?.wants_kids ?? null,
    })
    .eq('id', userId));
  if (error) throw new Error(`profiles ${userId}: ${error.message}`);

  // Real photo pipeline: storage objects + profile_photos row (what the reveal
  // modal and galleries actually read).
  await seedProfilePhoto(sb, userId, photo);

  return city.id as string;
}

export async function seedTwoUsersAndNight(): Promise<SeedResult> {
  const sb = admin();
  const runId = Date.now().toString(36);
  const hostEmail = `host+${runId}@e2e.local`;
  const candEmail = `cand+${runId}@e2e.local`;

  const hostId = await createUser(sb, hostEmail);
  const candId = await createUser(sb, candEmail);

  const cityId = await promoteProfile(sb, hostId, {
    firstName: `Maya ${runId}`,
    birthdate: '1992-04-12',
    gender: 'woman',
    prefs: ['man', 'woman'],
    photo: '/seed/portrait-woman.jpg',
    occupation: 'er nurse',
    heightCm: 165,
    pronouns: 'she/her',
    promptAnswers: [
      { prompt_id: 'my_ideal_first_date', answer: 'tacos somewhere a little too loud, then a slow walk by the lake so we can actually talk' },
      { prompt_id: 'unusual_skill', answer: 'i can name almost any 2000s song from the first three notes' },
      { prompt_id: 'a_perfect_sunday', answer: 'farmers market coffee, a long ride on the rail trail, then a nap i swear was not planned' },
    ],
    lifestyle: { smokes: false, drinks: true, has_pets: true },
  });
  await promoteProfile(sb, candId, {
    firstName: `Jordan ${runId}`,
    birthdate: '1995-09-21',
    gender: 'man',
    prefs: ['woman'],
    photo: '/seed/portrait-man.jpg',
    occupation: 'finish carpenter',
    heightCm: 183,
    pronouns: 'he/him',
    promptAnswers: [
      { prompt_id: 'my_ideal_first_date', answer: 'a dive bar with a good jukebox and a pool table i will absolutely lose at' },
      { prompt_id: 'green_flag', answer: 'you ask the server how their night is going and actually mean it' },
      { prompt_id: 'weekend_plan', answer: 'early hike up knox, a big diner breakfast, then fixing something in the garage with the radio on' },
    ],
    lifestyle: { smokes: false, drinks: true, has_pets: false },
  });

  // Host itinerary (FK target) → date_instance (status 'seeking').
  const { data: itin, error: itinErr } = await sb
    .from('itineraries')
    .insert({
      user_id: hostId,
      inputs: { e2e: true, neighborhood: 'Downtown Kelowna' },
      // Rich generated-shape stop + an identifying-looking reservation_url so the
      // blind-leak assertion is meaningful (the RPC must scrub it). Additive: the
      // 5b tests only read the thin feed card, which is unaffected.
      // Two stops so demos read like a real planned night, not a one-liner.
      // SPEC PARITY: m5-night-detail.spec.ts asserts "the train station pub",
      // "split the charcuterie" and the "$56 pp" total chip — stop 1 and
      // total_cost_pp stay EXACTLY as-is; stop 2 (28) sums with stop 1 (28) to 56.
      stops: [{
        place_name: 'The Train Station Pub', place_type: 'cocktail_bar', start_time: '19:00',
        duration_min: 90, estimated_cost_pp: 28, what_to_do: 'split the charcuterie',
        neighborhood: 'Downtown', lat: 49.888, lng: -119.496,
        local_insight: 'ask for the corner booth',
        reservation_url: 'https://instagram.com/the-secret-host',
      }, {
        place_name: 'amore mio gelato', place_type: 'dessert', start_time: '20:45',
        duration_min: 45, estimated_cost_pp: 28, what_to_do: 'cap the night with a scoop each and trade bites',
        neighborhood: 'Downtown', lat: 49.8867, lng: -119.4944,
        local_insight: 'the pistachio sells out early',
      }],
      title: `E2E night ${runId}`,
      hook: 'a slow burn',
      why_it_works: 'walkable, low-key, and actually fun',
      why_note: 'walkable and low-key',
      total_cost_pp: 56,
      total_duration_min: 180,
      cover_image_url: null,
      pay_setting: 'split',
      city_id: cityId,
      is_public: false,
      vibe_tags: ['cozy', 'creative'],
    })
    .select('id')
    .single();
  if (itinErr || !itin) throw new Error(`itineraries: ${itinErr?.message}`);

  // 5 days out at 02:00 UTC ≈ 7pm Pacific — matches the itinerary's 19:00 first
  // stop (same convention as scripts/seed-feed-dates.mjs setUTCHours(2,0,0,0)).
  // A wall-clock starts_at once demoed as "Monday 9:36 AM" for a 7pm pub plan.
  const startsAtDate = new Date(Date.now() + 5 * 24 * 3600 * 1000);
  startsAtDate.setUTCHours(2, 0, 0, 0);
  const startsAt = startsAtDate.toISOString();
  const { data: inst, error: instErr } = await sb
    .from('date_instances')
    .insert({
      itinerary_id: itin.id,
      creator_id: hostId,
      city_id: cityId,
      starts_at: startsAt,
      duration_min: 150,
      status: 'seeking',
    })
    .select('id')
    .single();
  if (instErr || !inst) throw new Error(`date_instances: ${instErr?.message}`);

  // Reality #3: flip the flag on in the test DB. feature_config.value is jsonb.
  const { error: flagErr } = await sb
    .from('feature_config')
    .update({ value: true, updated_at: new Date().toISOString() })
    .eq('key', 'match_v2_enabled');
  if (flagErr) throw new Error(`feature_config: ${flagErr.message}`);

  return { hostEmail, candEmail, hostId, candId, instanceId: inst.id as string };
}

export async function cleanup(seed: SeedResult) {
  const sb = admin();
  // Best-effort teardown (unique-per-run emails make reruns safe regardless).
  await sb.from('offers').delete().eq('date_instance_id', seed.instanceId);
  await sb.from('date_instances').delete().eq('id', seed.instanceId);
  await sb.from('itineraries').delete().eq('user_id', seed.hostId);
  for (const id of [seed.hostId, seed.candId]) {
    await sb.from('queue_entries').delete().eq('candidate_id', id);
    await removeProfilePhotos(sb, id).catch(() => {});
    await sb.auth.admin.deleteUser(id).catch(() => {});
  }
}

// --- Phase 7 chat seed ----------------------------------------------------
// A chat_thread exists per offer (open_chat_thread runs inside match_make_offer).
// For the chat E2E we don't drive swipe→offer through the UI; we seed the offer +
// open thread directly (service-role setup write, RLS bypassed for SETUP only — the
// tests still read/send under the real authed clients). We also seed a THIRD user
// who is NOT a party to assert the non-party negatives.

export interface ChatSeedResult extends SeedResult {
  // The two parties' display names (run-id suffixed). Host = "Maya …", cand = "Jordan …".
  hostName: string;
  candName: string;
  // The active offer between host (creator) and candidate, and its open chat thread.
  offerId: string;
  threadId: string;
  // A third seeded user with NO offer/thread membership.
  outsiderEmail: string;
  outsiderId: string;
}

export async function seedChatThread(): Promise<ChatSeedResult> {
  const sb = admin();
  const base = await seedTwoUsersAndNight();
  const runId = Date.now().toString(36);

  // Third (non-party) user — a fully promoted profile so /messages renders for them.
  const outsiderEmail = `outsider+${runId}@e2e.local`;
  const outsiderId = await createUser(sb, outsiderEmail);
  await promoteProfile(sb, outsiderId, {
    firstName: `Riley ${runId}`,
    birthdate: '1990-02-02',
    gender: 'woman',
    prefs: ['man', 'woman'],
    photo: '/seed/portrait-woman.jpg',
    occupation: 'high school teacher',
    heightCm: 170,
    pronouns: 'she/they',
    promptAnswers: [
      { prompt_id: 'we_vibe_when', answer: 'you laugh at my bad joke and then make a worse one' },
      { prompt_id: 'a_perfect_sunday', answer: 'thrift stores, a long dog walk, and cooking something i saved weeks ago' },
    ],
    lifestyle: { smokes: false, drinks: false, has_pets: true },
  });

  // Active offer host→candidate, then the open thread (mirrors open_chat_thread:
  // one thread per offer, state 'open'). char-check / RLS untouched — direct insert
  // is a service-role setup write.
  const { data: offer, error: offerErr } = await sb
    .from('offers')
    .insert({
      date_instance_id: base.instanceId,
      creator_id: base.hostId,
      candidate_id: base.candId,
      status: 'active',
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (offerErr || !offer) throw new Error(`offers (chat seed): ${offerErr?.message}`);

  const { data: thread, error: threadErr } = await sb
    .from('chat_threads')
    .insert({ offer_id: offer.id, state: 'open' })
    .select('id')
    .single();
  if (threadErr || !thread) throw new Error(`chat_threads (chat seed): ${threadErr?.message}`);

  return {
    ...base,
    // seedTwoUsersAndNight names host "Maya <runId>" and cand "Jordan <runId>".
    // Tests anchor on these stable first-name prefixes (the run-id suffix varies).
    hostName: 'Maya',
    candName: 'Jordan',
    offerId: offer.id as string,
    threadId: thread.id as string,
    outsiderEmail,
    outsiderId,
  };
}

export async function cleanupChat(seed: ChatSeedResult) {
  const sb = admin();
  // messages/threads/offers cascade off the offer + date_instance; clear explicitly
  // first so the base cleanup's offer delete doesn't trip FK ordering, then base.
  await sb.from('messages').delete().eq('thread_id', seed.threadId);
  await sb.from('chat_threads').delete().eq('id', seed.threadId);
  await cleanup(seed);
  await removeProfilePhotos(sb, seed.outsiderId).catch(() => {});
  await sb.auth.admin.deleteUser(seed.outsiderId).catch(() => {});
}

// Service-role seed (reality #5). Bypasses RLS for setup writes ONLY — never to fake a
// user read the test is meant to verify. Mirrors scripts/5b-smoke-prod/{1,2,3}.sql.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createUser(sb: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return data.user.id;
}

async function promoteProfile(
  sb: SupabaseClient,
  userId: string,
  opts: { firstName: string; birthdate: string; gender: string; prefs: string[]; verified?: boolean },
) {
  // birthdate FIRST — the age-gate trigger requires it before dating_enabled can flip true.
  let { error } = await sb
    .from('profiles_private')
    .upsert({ user_id: userId, birthdate: opts.birthdate }, { onConflict: 'user_id' });
  if (error) throw new Error(`profiles_private ${userId}: ${error.message}`);

  const { data: city, error: cityErr } = await sb.from('cities').select('id').eq('slug', 'kelowna').single();
  if (cityErr || !city) throw new Error(`cities slug=kelowna: ${cityErr?.message}`);

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
      // Local public asset — a remote host would need next.config images allow-listing
      // and next/image throws (→ server error) on an un-configured hostname.
      clear_photo_url: '/places/place-walk.jpg',
      blurred_photo_url: '/places/place-walk.jpg',
      verification: opts.verified === false ? 'unverified' : 'verified',
      dating_enabled: opts.verified === false ? false : true,
      onboarding_step: 'done',
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('id', userId));
  if (error) throw new Error(`profiles ${userId}: ${error.message}`);
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
  });
  await promoteProfile(sb, candId, {
    firstName: `Jordan ${runId}`,
    birthdate: '1995-09-21',
    gender: 'man',
    prefs: ['woman'],
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
      stops: [{
        place_name: 'The Train Station Pub', place_type: 'cocktail_bar', start_time: '19:00',
        duration_min: 90, estimated_cost_pp: 28, what_to_do: 'split the charcuterie',
        neighborhood: 'Downtown', lat: 49.888, lng: -119.496,
        local_insight: 'ask for the corner booth',
        reservation_url: 'https://instagram.com/the-secret-host',
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

  const startsAt = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
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
  await sb.auth.admin.deleteUser(seed.outsiderId).catch(() => {});
}

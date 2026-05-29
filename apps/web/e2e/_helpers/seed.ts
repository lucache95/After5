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
      clear_photo_url: 'https://placeholder.e2e/clear.jpg',
      blurred_photo_url: 'https://placeholder.e2e/blurred.jpg',
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
      stops: [{ name: 'E2E Stop 1', type: 'cocktail_bar' }],
      title: `E2E night ${runId}`,
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

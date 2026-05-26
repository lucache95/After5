// packages/api-client/src/profile.ts
// Phase-1 identity helpers: profile read/write, preferences, verification kickoff,
// onboarding advance, and device registration. All go through the user's RLS'd
// client (publishable key + JWT) — no service-role here.
import type { After5Client } from './index';
import { badgeFor } from '@after5/business';

// ─── Profile read / write ──────────────────────────────────────────────

export async function getMyProfile(client: After5Client, userId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function upsertProfile(
  client: After5Client,
  userId: string,
  patch: Record<string, unknown>,
) {
  // The generated row type is strict; this helper is intentionally freeform so
  // callers can patch any subset of profile columns.
  const { error } = await client
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .update(patch as never)
    .eq('id', userId);
  if (error) throw error;
}

// ─── Preferences ───────────────────────────────────────────────────────

export interface PreferencesInput {
  gender: string;
  gender_preferences: string[];
  age_min: number;
  age_max: number;
  distance_pref_km: number;
  dealbreakers: string[];
}

export async function savePreferences(
  client: After5Client,
  userId: string,
  prefs: PreferencesInput,
) {
  const patch = {
    gender: prefs.gender,
    gender_preferences: prefs.gender_preferences,
    // age_pref is an int4range column; supabase-js accepts the Postgres range
    // literal as a string. The generated type is `unknown`, so we send a string.
    age_pref: `[${prefs.age_min},${prefs.age_max}]`,
    distance_pref_km: prefs.distance_pref_km,
    dealbreakers: prefs.dealbreakers,
  };
  const { error } = await client.from('profiles').update(patch as never).eq('id', userId);
  if (error) throw error;
}

// ─── Badge ─────────────────────────────────────────────────────────────

export async function getMyBadge(client: After5Client, userId: string) {
  const { data, error } = await client
    .from('profiles')
    .select('verification, reliability_score')
    .eq('id', userId)
    .single();
  if (error) throw error;
  const row = data as { verification: string; reliability_score: number | null };
  return badgeFor({
    verification: row.verification as Parameters<typeof badgeFor>[0]['verification'],
    reliability_score: row.reliability_score,
  });
}

// ─── Verification ──────────────────────────────────────────────────────

export async function startVerification(client: After5Client) {
  const { data, error } = await client.functions.invoke('start-verification', { body: {} });
  if (error) throw error;
  return data;
}

export async function confirmPhone(client: After5Client) {
  const { data, error } = await client.functions.invoke('confirm-phone', { body: {} });
  if (error) throw error;
  return data;
}

// ─── Onboarding ────────────────────────────────────────────────────────

export async function advanceOnboarding(client: After5Client, toStep: string) {
  // advance_onboarding_step lands in this batch's migration; the generated
  // Database type may not yet list it, so widen the rpc name.
  const rpc = client.rpc as unknown as (
    fn: string,
    args: { p_to_step: string },
  ) => Promise<{ data: unknown; error: unknown }>;
  const { data, error } = await rpc('advance_onboarding_step', { p_to_step: toStep });
  if (error) throw error;
  return data;
}

// ─── Device registration ───────────────────────────────────────────────

export async function registerDevice(
  client: After5Client,
  token: string,
  platform: string,
  webPush: Record<string, unknown> | null = null,
) {
  const { data, error } = await client.rpc('register_device', {
    p_token: token,
    p_platform: platform,
    p_web_push: webPush as never,
  });
  if (error) throw error;
  return data;
}

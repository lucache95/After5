// packages/api-client/src/profile.ts
// Phase-1 identity helpers: profile read/write, preferences, verification kickoff,
// onboarding advance, and device registration. All go through the user's RLS'd
// client (publishable key + JWT) — no service-role here.
import type { Json } from '@after5/types';
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
  // DLB lifestyle facts (optional "about you"): null = unanswered, never excludes.
  // Optional so callers that don't collect them leave the columns untouched.
  smokes?: boolean | null;
  drinks?: boolean | null;
  has_pets?: boolean | null;
  wants_kids?: boolean | null;
}

export async function savePreferences(
  client: After5Client,
  userId: string,
  prefs: PreferencesInput,
) {
  const patch: Record<string, unknown> = {
    gender: prefs.gender,
    gender_preferences: prefs.gender_preferences,
    // age_pref is an int4range column; supabase-js accepts the Postgres range
    // literal as a string. The generated type is `unknown`, so we send a string.
    age_pref: `[${prefs.age_min},${prefs.age_max}]`,
    distance_pref_km: prefs.distance_pref_km,
    dealbreakers: prefs.dealbreakers,
  };
  // DLB facts: write only when supplied (undefined = leave column unchanged;
  // an explicit null clears the answer back to "unanswered").
  for (const k of ['smokes', 'drinks', 'has_pets', 'wants_kids'] as const) {
    if (prefs[k] !== undefined) patch[k] = prefs[k];
  }
  const { error } = await client.from('profiles').update(patch as never).eq('id', userId);
  if (error) throw error;
}

// ─── Feed filters (E10) ────────────────────────────────────────────────

// The viewer's persisted browse filters. Mirrors the jsonb keys that
// browse_feed_for_viewer unpacks (Plan 04-01): hard filters host_genders /
// max_price / max_distance_km HIDE non-matching nights; soft filters vibes /
// who_pays / time_buckets only re-sort. Every field is optional — an absent key
// is "no filter" (the inclusive empty-object default). host_age_range is the
// inclusive [min, max] pair the RPC reads as an int4range.
export interface FeedFilters {
  host_genders?: string[];
  max_price?: number;
  max_distance_km?: number;
  vibes?: string[];
  who_pays?: string[];
  time_buckets?: string[];
  host_age_range?: [number, number];
}

// Self-write the viewer's feed_filters jsonb. No RPC: feed_filters is an
// owner-scoped column gated by the existing profiles_owner_all policy
// (WITH CHECK id = auth.uid()), so a forged userId fails RLS rather than
// writing another user's row (T-04-04). Throws on error.
export async function saveFeedFilters(
  client: After5Client,
  userId: string,
  filters: FeedFilters,
): Promise<void> {
  const { error } = await client
    .from('profiles')
    .update({ feed_filters: filters as unknown as Json })
    .eq('id', userId);
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
  const { data, error } = await client.rpc('advance_onboarding_step', { p_to_step: toStep });
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
    // jsonb arg: Record<string, unknown> isn't assignable to the generated Json type.
    p_web_push: webPush as never,
  });
  if (error) throw error;
  return data;
}

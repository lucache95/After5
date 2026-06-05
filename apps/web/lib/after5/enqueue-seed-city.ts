// apps/web/lib/after5/enqueue-seed-city.ts
// DATA-02 trigger (server-side ONLY): the moment a user's profile location is
// saved, enqueue a dedup'd `seed_city` job so process-jobs warms that city's
// Foursquare corpus in the background — generation is fast + full by the time the
// user plans.
//
// Security (T-08-11, Elevation of Privilege): `enqueue_job` is REVOKED from the
// `authenticated` role (P2 / 20260525123100), so this MUST run from the
// service-role server context (createAdminClient), never the browser. The cityId
// is validated as a uuid before the rpc so a malformed/hostile value never reaches
// the queue.
//
// Poison-loop safety (T-08-12, DoS): p_dedup_key = cityId means at most one
// pending|running seed per city — repeated location saves (or many users in the
// same city) collapse to a single job. The handler's own fail_job backoff
// dead-letters at attempts>=5.
//
// Fire-and-forget: callers invoke this with a logged `.catch()` so a queue hiccup
// NEVER blocks the user's location save (same posture as the email-notification
// side effects). Resolves quietly on any non-fatal skip.

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';

const CityIdSchema = z.string().uuid();

export interface EnqueueSeedCityResult {
  enqueued: boolean;
  skipped?: 'invalid_city_id' | 'admin_unavailable' | 'enqueue_failed';
}

/**
 * Enqueue a dedup'd `seed_city` job for `cityId` via the service-role client.
 * Server-only. Never throws — returns a discriminated result and logs failures,
 * so it is safe to fire-and-forget after the primary_city_id write.
 */
export async function enqueueSeedCity(cityId: string): Promise<EnqueueSeedCityResult> {
  const parsed = CityIdSchema.safeParse(cityId);
  if (!parsed.success) {
    console.warn('[seed-city] invalid cityId — skip enqueue', cityId);
    return { enqueued: false, skipped: 'invalid_city_id' };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    // SUPABASE_SECRET_KEY / URL missing — log and no-op, never block the save.
    console.warn('[seed-city] admin client unavailable — skip enqueue', err);
    return { enqueued: false, skipped: 'admin_unavailable' };
  }

  // enqueue_job(p_type, p_run_after, p_payload, p_dedup_key) — dedup on city_id.
  // p_type is cast because the generated Database types still enumerate the v1.0
  // job_type values; 'seed_city' is added by 20260606150100 but the type
  // regeneration is owned by the gated 08-06 prod-apply. The value is a fixed
  // server-side literal (never user input), so the cast carries no injection risk.
  const { error } = await admin.rpc('enqueue_job', {
    p_type: 'seed_city' as 'notify',
    p_run_after: new Date().toISOString(),
    p_payload: { city_id: parsed.data },
    p_dedup_key: parsed.data,
  });
  if (error) {
    console.warn('[seed-city] enqueue_job failed — skip', error.message);
    return { enqueued: false, skipped: 'enqueue_failed' };
  }
  return { enqueued: true };
}

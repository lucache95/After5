// generate-plan — After5's hybrid generation Edge Function.
//
// Flow (M1 — provider seam):
//   1. Validate input (Zod)                — UNCHANGED responsibility
//   2. Auth (optional) + rate-limit        — UNCHANGED
//   3. Resolve city (city_slug → cities)   — NEW, additive (default 'kelowna')
//   4. selectProvider(citySlug)            — reads feature_config map
//   5. provider.generate(ctx) → Itinerary[] (+ modifier state)
//   6. persist(...) → withIds
//   7. Return { itineraries, generated_at } — FROZEN response shape
//
// The pipeline (filter → templates → taste → LLM → fixers → photo scrub) lives
// in providers/pipeline.ts; KelownaProvider and OnTheFlyProvider both call it.
// Persistence is shared in persist.ts so a future Railway engine never learns
// our DB schema. Architecture invariant unchanged: the LLM never picks places.

import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { z } from 'npm:zod@3.23.8';

import { corsHeaders } from '../_shared/cors.ts';
import { selectProvider } from './providers/select.ts';
import { PipelineError } from './providers/pipeline.ts';
import { persist } from './persist.ts';
import type { CityRecord } from './types.ts';

// ─── Input schema ──────────────────────────────────────────────────────

const InputSchema = z.object({
  occasion: z.enum(['date', 'solo', 'friends']).default('date'),
  duration_min: z.number().int().min(60).max(720).default(180),
  budget_per_person: z.number().nonnegative().max(1000).default(50),
  vibe: z.array(z.string()).min(1).max(3),
  must_includes: z.array(z.string()).max(12).default([]),
  drive_tolerance_min: z.number().int().min(0).max(120).default(20),
  // Max distance from the city centroid. 30 covers Kelowna proper + West
  // Kelowna + Lake Country. 100 catches Vernon, Big White, Penticton.
  max_radius_km: z.number().int().min(5).max(150).default(30),
  // Out-and-about plans pull from the real catalog. At-home plans pull from
  // the virtual at-home activity pool only (cooking, fondue, fort, etc).
  location: z.enum(['out', 'home']).default('out'),
  effort: z.enum(['low', 'moderate', 'high']).default('low'),
  start_at: z.string().datetime().optional(),
  // Optional context fed to the LLM when writing why_it_works copy.
  you_pronouns: z.enum(['she/her', 'he/him', 'they/them', '']).default(''),
  partner_pronouns: z.enum(['she/her', 'he/him', 'they/them', '']).default(''),
  note: z.string().max(280).default(''),
  // When = "tonight" → hard hours filter + low-friction bias.
  when: z.enum(['tonight', 'future']).default('tonight'),
  future_date: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal('')]).optional().default(''),
  intent: z.enum(['impress', 'chill', 'reconnect', 'try_something_new', '']).default(''),
  time_of_day: z.enum(['morning', 'evening', 'all_day']).default('evening'),
  // Anonymous gate flow: when an unauthed user enters their email, we send
  // a magic link AND tag the resulting itineraries with claim_email so
  // /auth/callback can attach them to the user once they click the link.
  claim_email: z.string().email().optional(),
  // M1: additive + optional. Resolves which city's places + provider to use.
  // Absent ⇒ 'kelowna' (byte-identical to pre-M1).
  city_slug: z.string().min(1).max(60).default('kelowna'),
});

// ─── Rate-limit config ────────────────────────────────────────────────

const RATE_LIMIT_ENDPOINT = 'generate-plan';
const ANON_LIMIT_PER_HOUR = 10;
const AUTH_LIMIT_PER_HOUR = 20;

// ─── Handler ───────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Validate input
    const body = await req.json();
    const parsed = InputSchema.safeParse(body);
    if (!parsed.success) {
      return jsonResponse({ error: 'invalid_input', details: parsed.error.flatten() }, 400);
    }
    const inputs = parsed.data;

    // 2. Set up Supabase client (service role for unrestricted reads/writes)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 2a. Pull user_id from the caller's JWT if present. We don't require auth —
    // anonymous generations still work — but when we have it, we tag the
    // itinerary so the user sees it in their dashboard.
    const authHeader = req.headers.get('Authorization');
    const userId = extractUserIdFromAuthHeader(authHeader);
    console.log('[generate-plan] auth header present:', !!authHeader, 'header_prefix:', authHeader?.slice(0, 30) ?? 'none', 'extracted user_id:', userId);

    // 2b. Rate-limit check — BEFORE any AI API calls.
    const rateLimitIdentifier = userId
      ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? req.headers.get('x-real-ip')
      ?? 'unknown';
    const rateLimitMax = userId ? AUTH_LIMIT_PER_HOUR : ANON_LIMIT_PER_HOUR;

    const rateLimitResult = await checkRateLimit(supabase, rateLimitIdentifier, RATE_LIMIT_ENDPOINT, rateLimitMax);
    const rateLimitFallback = rateLimitResult._fallback === true;
    const extraHeaders: Record<string, string> = rateLimitFallback
      ? { 'X-Rate-Limit-Mode': 'fallback' }
      : {};
    if (!rateLimitResult.allowed) {
      console.warn('[generate-plan] rate limited:', rateLimitIdentifier, 'count:', rateLimitResult.count, 'limit:', rateLimitMax);
      return jsonResponse(
        {
          error: 'rate_limited',
          message: `Too many requests. Limit is ${rateLimitMax} generations per hour. Try again later.`,
          retry_after_seconds: rateLimitResult.retryAfterSeconds,
        },
        429,
        extraHeaders,
      );
    }

    // 3. Resolve the city (M1). Default 'kelowna' keeps a no-city_slug request
    //    byte-identical to today.
    const citySlug = inputs.city_slug ?? 'kelowna';
    const { data: cityRow } = await supabase
      .from('cities')
      .select('id,slug,name,region,timezone,centroid_lat,centroid_lng,default_radius_km')
      .eq('slug', citySlug)
      .maybeSingle();
    if (!cityRow) {
      return jsonResponse({ error: 'unknown_city', message: `No city '${citySlug}'.` }, 422);
    }
    const city = cityRow as CityRecord;

    // 4. Build the generation env + select the provider for this city.
    const env = {
      anthropicKey: Deno.env.get('ANTHROPIC_API_KEY')!,
      anthropicModel: Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6',
      googleKey: Deno.env.get('GOOGLE_PLACES_API_KEY'),
      railwayUrl: Deno.env.get('RAILWAY_GENERATOR_URL'),
      railwayToken: Deno.env.get('RAILWAY_API_TOKEN'),
    };
    const provider = await selectProvider(citySlug, supabase);

    // 5. Generate (provider runs the shared pipeline; on-the-fly warms first).
    const sharedLog: Record<string, unknown> = {};
    const ctx = { inputs, city, supabase, env, log: sharedLog };
    let result;
    try {
      result = await provider.generate(ctx);
    } catch (e) {
      if (e instanceof PipelineError) {
        return jsonResponse({ error: e.code, message: e.message }, e.httpStatus, extraHeaders);
      }
      throw e;
    }

    // Tag the season so we can filter /dates by what's in season later.
    const nowMonth = new Date().getMonth();
    const season =
      nowMonth >= 2 && nowMonth <= 4 ? 'spring' :
      nowMonth >= 5 && nowMonth <= 7 ? 'summer' :
      nowMonth >= 8 && nowMonth <= 10 ? 'fall' : 'winter';

    // 6. Persist (shared across providers) and build the response array.
    const withIds = await persist(supabase, {
      written: result.itineraries,
      inputs,
      modPool: result.modPool,
      modifierIdsPicked: result.modifierIdsPicked,
      sharedLog,
      userId,
      season,
    });

    // 7. FROZEN response shape.
    return jsonResponse(
      {
        itineraries: withIds,
        generated_at: new Date().toISOString(),
      },
      200,
      extraHeaders,
    );
  } catch (err) {
    console.error('generate-plan error', err);
    const msg = err instanceof Error ? err.message : 'unknown error';
    return jsonResponse({ error: 'internal', message: msg }, 500);
  }
});

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json', ...extraHeaders },
  });
}

// Decode the JWT in the Authorization header without verifying signature.
// We only trust the user_id when the request hits us via a real Supabase
// client (which bundles a valid token); even if someone forges a token,
// the worst case is they tag a row with a user_id they don't own — and
// our RLS prevents them from reading anyone else's saved/private data
// from that point forward. Returns null if no header or malformed.
function extractUserIdFromAuthHeader(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    // base64url → base64
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded)) as { sub?: string; aud?: string };
    if (typeof decoded.sub === 'string' && /^[0-9a-f-]{36}$/i.test(decoded.sub)) {
      return decoded.sub;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Rate-limit helpers ───────────────────────────────────────────────

// Fixed-window rate limiter backed by the rate_limits table.
// Returns { allowed: true } and increments the counter if under the limit,
// or { allowed: false, count, retryAfterSeconds } if the caller should wait.
//
// Uses INSERT ... ON CONFLICT to atomically upsert the counter in a single
// round-trip. The window is the current clock-hour (date_trunc('hour')).
async function checkRateLimit(
  supabase: ReturnType<typeof createClient>,
  identifier: string,
  endpoint: string,
  maxRequests: number,
): Promise<({ allowed: true } | { allowed: false; count: number; retryAfterSeconds: number }) & { _fallback?: true }> {
  // Upsert: insert a row with count=1 or increment the existing row's count.
  // Returns the new count so we can decide in one query.
  const { data, error } = await supabase.rpc('rate_limit_check', {
    p_identifier: identifier,
    p_endpoint: endpoint,
    p_max_requests: maxRequests,
  });

  // If the RPC doesn't exist yet (first deploy before migration runs),
  // fall back to a manual check so the function degrades gracefully.
  if (error) {
    console.error(
      '[RATE-LIMIT WARNING] RPC rate_limit_check not available — falling back to non-atomic JS rate limiter. ' +
      'This is NOT safe under concurrency. Deploy the rate_limits migration to fix this. ' +
      `RPC error: ${error.message}`
    );
    const fallbackResult = await checkRateLimitManual(supabase, identifier, endpoint, maxRequests);
    return { ...fallbackResult, _fallback: true as const };
  }

  // The RPC returns { allowed: boolean, current_count: number, retry_after_seconds: number }
  const result = data as { allowed: boolean; current_count: number; retry_after_seconds: number };
  if (result.allowed) {
    return { allowed: true };
  }
  return { allowed: false, count: result.current_count, retryAfterSeconds: result.retry_after_seconds };
}

// TEMPORARY FALLBACK — remove once the rate_limit_check RPC migration is
// confirmed deployed to all environments. This non-atomic JS path uses two
// separate queries (SELECT then INSERT/UPDATE) and is NOT safe under
// concurrency: concurrent requests can read the same count and both pass,
// exceeding the intended limit. The atomic RPC path above is the correct
// implementation; this exists only so the function doesn't hard-fail if the
// migration hasn't run yet.
async function checkRateLimitManual(
  supabase: ReturnType<typeof createClient>,
  identifier: string,
  endpoint: string,
  maxRequests: number,
): Promise<{ allowed: true } | { allowed: false; count: number; retryAfterSeconds: number }> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setMinutes(0, 0, 0); // truncate to current hour

  // Check current count
  const { data: existing } = await supabase
    .from('rate_limits')
    .select('request_count')
    .eq('identifier', identifier)
    .eq('endpoint', endpoint)
    .eq('window_start', windowStart.toISOString())
    .maybeSingle();

  const currentCount = existing?.request_count ?? 0;
  if (currentCount >= maxRequests) {
    const nextHour = new Date(windowStart);
    nextHour.setHours(nextHour.getHours() + 1);
    const retryAfterSeconds = Math.max(1, Math.ceil((nextHour.getTime() - now.getTime()) / 1000));
    return { allowed: false, count: currentCount, retryAfterSeconds };
  }

  // Increment (or insert)
  if (existing) {
    await supabase
      .from('rate_limits')
      .update({ request_count: currentCount + 1 })
      .eq('identifier', identifier)
      .eq('endpoint', endpoint)
      .eq('window_start', windowStart.toISOString());
  } else {
    await supabase
      .from('rate_limits')
      .insert({
        identifier,
        endpoint,
        window_start: windowStart.toISOString(),
        request_count: 1,
      });
  }

  // Fire-and-forget: purge rows older than 2 hours to keep the table small.
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  supabase.from('rate_limits').delete().lt('window_start', cutoff).then(({ error }) => {
    if (error) console.warn('[rate-limit] cleanup error:', error.message);
  });

  return { allowed: true };
}

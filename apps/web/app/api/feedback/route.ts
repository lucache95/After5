import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyFeedbackToken } from '@/lib/email/feedback-token';

// Anonymous feedback capture. Two entry points:
//   1. Post-date email — token-authenticated (source: 'post_date_email')
//   2. In-app pulse after viewing results (source: 'plan_results')
//
// When source is 'post_date_email', the request MUST include a valid
// feedback token. On success, we mark the saved_plan as completed so
// the token becomes single-use.
//
// Rate limit: max 5 submissions per IP per hour (in-memory, resets on
// cold start — good enough for burst protection on serverless).

// ── Rate limiting ─────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateBucket>();

// Clean up stale entries every 10 minutes to prevent unbounded growth.
// This interval is cleaned up when the module is garbage-collected on
// serverless cold-start recycle, so no explicit teardown is needed.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitMap) {
    if (now > bucket.resetAt) rateLimitMap.delete(key);
  }
}, 10 * 60 * 1000).unref();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const bucket = rateLimitMap.get(ip);
  if (!bucket || now > bucket.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

// ── Types ─────────────────────────────────────────────────────────────
interface Body {
  itinerary_id?: string;
  token?: string;
  source?: string;
  stop_votes?: Array<{ stop_idx: number; vote: 'up' | 'down' | 'skip' }>;
  skip_stop_idx?: number | null;
  would_do?: 'yes' | 'maybe' | 'no' | null;
  notes?: string | null;
}

export async function POST(req: Request) {
  // ── Rate limit ────────────────────────────────────────
  const forwarded = req.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many submissions. Try again later.' },
      { status: 429 },
    );
  }

  // ── Parse body ────────────────────────────────────────
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body.itinerary_id || !/^[0-9a-f-]{36}$/i.test(body.itinerary_id)) {
    return NextResponse.json({ error: 'invalid_itinerary_id' }, { status: 400 });
  }

  // ── Token verification for post-date email submissions ─
  let savedPlanId: string | null = null;

  if (body.source === 'post_date_email') {
    if (!body.token) {
      return NextResponse.json({ error: 'missing_token' }, { status: 400 });
    }

    const result = verifyFeedbackToken(body.token);
    if (result.status === 'expired') {
      return NextResponse.json(
        { error: 'token_expired', message: 'This feedback link has expired.' },
        { status: 410 },
      );
    }
    if (result.status === 'invalid') {
      return NextResponse.json({ error: 'invalid_token' }, { status: 403 });
    }

    // Ensure the token's itinerary matches the submitted one
    if (result.itineraryId !== body.itinerary_id) {
      return NextResponse.json({ error: 'token_mismatch' }, { status: 403 });
    }

    savedPlanId = result.savedPlanId;

    // Check one-time use
    const admin = createAdminClient();
    const { data: savedPlan } = await (admin as any)
      .from('saved_plans')
      .select('feedback_completed_at')
      .eq('id', savedPlanId)
      .maybeSingle();

    if (savedPlan?.feedback_completed_at) {
      return NextResponse.json(
        { error: 'already_submitted', message: 'Feedback already submitted for this date.' },
        { status: 409 },
      );
    }
  }

  // ── Insert feedback ───────────────────────────────────
  const supabase = await createClient();
  const userAgent = req.headers.get('user-agent') ?? null;

  // Cast: generated DB types don't yet include plan_feedback.
  const { error } = await (supabase.from('plan_feedback') as any).insert({
    itinerary_id: body.itinerary_id,
    source: body.source ?? 'plan_results',
    stop_votes: body.stop_votes ?? null,
    skip_stop_idx: typeof body.skip_stop_idx === 'number' ? body.skip_stop_idx : null,
    would_do: body.would_do ?? null,
    notes: body.notes?.slice(0, 500) ?? null,
    user_agent: userAgent,
  });

  if (error) {
    console.error('feedback insert error', error);
    return NextResponse.json({ ok: true, persisted: false });
  }

  // ── Mark one-time use for token-based submissions ─────
  if (savedPlanId) {
    const admin = createAdminClient();
    await (admin as any)
      .from('saved_plans')
      .update({ feedback_completed_at: new Date().toISOString() })
      .eq('id', savedPlanId);
  }

  return NextResponse.json({ ok: true });
}

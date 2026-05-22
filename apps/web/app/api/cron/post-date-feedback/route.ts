// /api/cron/post-date-feedback — fires from Vercel Cron once daily
// (10am Pacific, see vercel.json). Sends a "how was your date?" email
// to every user whose saved plan's planned_for_date was yesterday
// (T-24h to T-48h window) and who hasn't already received one.
//
// Auth: requires header `Authorization: Bearer ${CRON_SECRET}`. Vercel
// sends this automatically when invoking via cron.
//
// Manual trigger: ?secret=... query param (same pattern as weekly-broadcast).
// Dry-run: append &dry_run=true to count qualifying plans without sending.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderPostDateFeedbackEmail } from '@/lib/email/post-date-feedback';
import { sendEmail } from '@/lib/email/resend';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Each qualifying row from the join query
interface FeedbackCandidate {
  saved_plan_id: string;
  itinerary_id: string;
  title: string | null;
  cover_image_url: string | null;
  user_email: string;
  first_name: string | null;
}

export async function GET(request: Request) {
  // ── Auth ──────────────────────────────────────────────
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const querySecret = url.searchParams.get('secret');
  const ok =
    authHeader === `Bearer ${expected}` || querySecret === expected;
  if (!ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = url.searchParams.get('dry_run') === 'true';
  const admin = createAdminClient();

  // ── Window: plans whose date was between T-24h and T-48h ──
  // We use a 24h window so a plan scheduled for "2026-05-21" gets
  // picked up on the cron run at 10am May 22. The planned_for_date
  // field is a DATE (no time), so we compare as dates.
  const now = new Date();
  // Yesterday at 00:00 UTC
  const windowEnd = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  ));
  // Day before yesterday at 00:00 UTC
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  const startStr = windowStart.toISOString().split('T')[0]; // YYYY-MM-DD
  const endStr = windowEnd.toISOString().split('T')[0];

  // ── Query: saved_plans → itineraries → profiles, where planned_for_date
  //    is in [startStr, endStr) and no feedback_email_sent_at set ──
  //
  // We use raw SQL via rpc because we need a multi-table join that
  // Supabase JS can't express cleanly (saved_plans has no FK to profiles,
  // we need to go through user_id → profiles + subscribers for email).
  //
  // Instead, we'll do it in two queries:
  //   1. Get saved_plans joined to itineraries where planned_for_date matches
  //   2. For each, look up the user's email from profiles or auth

  // Step 1: Find qualifying saved plans
  const { data: plans, error: plansErr } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        gte: (col: string, val: string) => {
          lte: (col: string, val: string) => {
            is: (col: string, val: null) => Promise<{
              data: Array<{
                id: string;
                user_id: string;
                itinerary_id: string;
                feedback_email_sent_at: string | null;
                itineraries: {
                  id: string;
                  title: string | null;
                  cover_image_url: string | null;
                  planned_for_date: string | null;
                } | null;
              }> | null;
              error: { message: string } | null;
            }>;
          };
        };
      };
    };
  })
    .from('saved_plans')
    .select('id, user_id, itinerary_id, feedback_email_sent_at, itineraries(id, title, cover_image_url, planned_for_date)')
    .gte('itineraries.planned_for_date', startStr)
    .lte('itineraries.planned_for_date', endStr)
    .is('feedback_email_sent_at', null);

  if (plansErr) {
    return NextResponse.json(
      { error: 'query failed', details: plansErr.message },
      { status: 500 },
    );
  }

  // Filter out rows where the itinerary join returned null (no matching date)
  const qualifying = (plans ?? []).filter(
    (p) => p.itineraries && p.itineraries.planned_for_date,
  );

  if (qualifying.length === 0) {
    return NextResponse.json({
      window: `${startStr} to ${endStr}`,
      qualifying: 0,
      sent: 0,
      dry_run: dryRun,
    });
  }

  // Step 2: Get email + name for each user_id
  const userIds = [...new Set(qualifying.map((p) => p.user_id))];
  const { data: profiles } = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        in: (col: string, vals: string[]) => Promise<{
          data: Array<{
            id: string;
            email: string | null;
            first_name: string | null;
          }> | null;
          error: unknown;
        }>;
      };
    };
  })
    .from('profiles')
    .select('id, email, first_name')
    .in('id', userIds);

  const profileMap = new Map<string, { email: string; firstName: string | null }>();
  for (const p of (profiles ?? [])) {
    if (p.email) {
      profileMap.set(p.id, { email: p.email.toLowerCase().trim(), firstName: p.first_name });
    }
  }

  // Build candidate list
  const candidates: FeedbackCandidate[] = [];
  for (const plan of qualifying) {
    const profile = profileMap.get(plan.user_id);
    if (!profile) continue;
    candidates.push({
      saved_plan_id: plan.id,
      itinerary_id: plan.itinerary_id,
      title: plan.itineraries!.title,
      cover_image_url: plan.itineraries!.cover_image_url,
      user_email: profile.email,
      first_name: profile.firstName,
    });
  }

  // De-dupe by email + itinerary (a user might have saved the same plan twice)
  const seen = new Set<string>();
  const deduped = candidates.filter((c) => {
    const key = `${c.user_email}:${c.itinerary_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── Dry-run ───────────────────────────────────────────
  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      window: `${startStr} to ${endStr}`,
      qualifying: deduped.length,
      candidates: deduped.map((c) => ({
        email: c.user_email,
        title: c.title,
      })),
    });
  }

  // ── Send loop ─────────────────────────────────────────
  let sent = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];

  for (const c of deduped) {
    const rendered = renderPostDateFeedbackEmail({
      savedPlanId: c.saved_plan_id,
      itineraryId: c.itinerary_id,
      email: c.user_email,
      firstName: c.first_name,
      dateTitle: c.title ?? 'your date',
      coverImageUrl: c.cover_image_url,
    });

    const send = await sendEmail({
      to: c.user_email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'post_date_feedback',
    });

    // Mark the saved_plan as emailed regardless of send success, so we
    // don't spam on retries. If send failed, the flag still blocks re-send.
    await (admin as unknown as {
      from: (t: string) => {
        update: (row: Record<string, unknown>) => {
          eq: (col: string, val: string) => Promise<{ error: unknown }>;
        };
      };
    })
      .from('saved_plans')
      .update({ feedback_email_sent_at: new Date().toISOString() })
      .eq('id', c.saved_plan_id);

    if (send) {
      sent += 1;
    } else {
      failed += 1;
      errors.push({ email: c.user_email, error: 'resend_send_failed' });
    }

    // Light pacing for Resend rate limits
    await new Promise((res) => setTimeout(res, 110));
  }

  return NextResponse.json({
    window: `${startStr} to ${endStr}`,
    qualifying: deduped.length,
    sent,
    failed,
    errors,
  });
}

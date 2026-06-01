// /api/cron/offer-expiring — fires from Vercel Cron every 30 min (see
// vercel.json). Emails the CANDIDATE a "your offer expires soon" reminder for
// each still-open offer whose expires_at falls inside the next 6h and which
// hasn't already been reminded.
//
// Why web-side: the match edge runtime has a BLANK RESEND_API_KEY, so all
// email must send from Vercel where RESEND_API_KEY / RESEND_FROM_EMAIL live.
//
// Auth: header `Authorization: Bearer ${CRON_SECRET}` (Vercel sends this on
// cron invoke) OR ?secret=... query param. Dry-run: &dry_run=true counts
// qualifying offers without sending.
//
// Best-effort: a single send failure never aborts the sweep, and we stamp
// expiring_email_sent_at regardless of send success so we never re-spam on the
// next run. The dedup column makes the whole route idempotent.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendOfferExpiringEmail } from '@/lib/email/send-offer-expiring';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// How far ahead we consider an offer "expiring soon".
const SOON_WINDOW_MS = 6 * 60 * 60 * 1000;

export async function GET(request: Request) {
  // ── Auth ──────────────────────────────────────────────
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const querySecret = url.searchParams.get('secret');
  const ok = authHeader === `Bearer ${expected}` || querySecret === expected;
  if (!ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dryRun = url.searchParams.get('dry_run') === 'true';

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (err) {
    return NextResponse.json(
      { error: 'admin client unavailable', details: String(err) },
      { status: 500 },
    );
  }

  // ── Window: open offers expiring between now and now+6h ──
  const now = new Date();
  const windowEnd = new Date(now.getTime() + SOON_WINDOW_MS);

  const { data: offers, error } = await admin
    .from('offers')
    .select('id, expires_at')
    .eq('status', 'active')
    .is('expiring_email_sent_at', null)
    .gt('expires_at', now.toISOString())
    .lte('expires_at', windowEnd.toISOString());

  if (error) {
    return NextResponse.json(
      { error: 'query failed', details: error.message },
      { status: 500 },
    );
  }

  const qualifying = offers ?? [];

  if (dryRun) {
    return NextResponse.json({
      dry_run: true,
      window: `${now.toISOString()} to ${windowEnd.toISOString()}`,
      qualifying: qualifying.length,
      offer_ids: qualifying.map((o) => o.id),
    });
  }

  // ── Send loop ─────────────────────────────────────────
  let sent = 0;
  let skipped = 0;
  const results: Array<{ id: string; sent: boolean; skipped?: string }> = [];

  for (const offer of qualifying) {
    let result;
    try {
      result = await sendOfferExpiringEmail(offer.id);
    } catch {
      // sendOfferExpiringEmail never throws, but belt-and-suspenders so one
      // bad row can't abort the whole sweep.
      result = { sent: false, skipped: 'lookup_error' as const };
    }

    // Stamp regardless of send outcome — a failed send must not re-spam on the
    // next run. The flag is the dedup guard; the next cron simply skips it.
    await admin
      .from('offers')
      .update({ expiring_email_sent_at: new Date().toISOString() })
      .eq('id', offer.id);

    if (result.sent) sent += 1;
    else skipped += 1;
    results.push({ id: offer.id, sent: result.sent, skipped: result.skipped });

    // Light pacing for Resend rate limits.
    await new Promise((res) => setTimeout(res, 110));
  }

  return NextResponse.json({
    window: `${now.toISOString()} to ${windowEnd.toISOString()}`,
    qualifying: qualifying.length,
    sent,
    skipped,
    results,
  });
}

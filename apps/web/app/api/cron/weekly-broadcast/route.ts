// /api/cron/weekly-broadcast — fires from Vercel Cron once a week (Sundays
// 9am Pacific, see vercel.json). Sends the rendered weekly digest to every
// subscriber whose email_opt_out is false.
//
// Auth: requires header `Authorization: Bearer ${CRON_SECRET}`. Vercel
// sends this automatically when invoking via cron.
//
// Manual trigger from a browser is supported via ?secret=... query param
// (use sparingly — same secret).
//
// Dry-run: append &dry_run=true to count recipients + render preview
// without actually sending.

import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { renderWeeklyDigest } from '@/lib/email/weekly-digest';
import { sendEmail } from '@/lib/email/resend';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // up to 5 min so a few hundred sends fit

interface SubscriberRow {
  id: string;
  email: string;
  first_name: string | null;
  email_opt_out: boolean | null;
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

  // ── Recipients ────────────────────────────────────────
  // De-dupe by email (an email could appear in multiple sources rows).
  const subsResp = await (admin as unknown as {
    from: (t: string) => {
      select: (cols: string) => Promise<{ data: SubscriberRow[] | null; error: { message: string } | null }>;
    };
  }).from('subscribers').select('id, email, first_name, email_opt_out');

  if (subsResp.error) {
    return NextResponse.json({ error: 'subs query failed', details: subsResp.error.message }, { status: 500 });
  }
  const subs = subsResp.data;

  const byEmail = new Map<string, SubscriberRow>();
  for (const s of (subs ?? [])) {
    if (!s.email || s.email_opt_out) continue;
    const key = s.email.toLowerCase().trim();
    if (!byEmail.has(key)) byEmail.set(key, s);
  }
  const recipients = Array.from(byEmail.values());

  // ── Dry-run: render once + return preview ─────────────
  if (dryRun) {
    const preview = await renderWeeklyDigest({
      email: recipients[0]?.email ?? 'preview@tryafter5.app',
      firstName: recipients[0]?.first_name ?? null,
    });
    return NextResponse.json({
      dry_run: true,
      recipient_count: recipients.length,
      subject: preview.subject,
      spotlight_id: preview.spotlightId,
      plans_shown: preview.plansShown,
      preview_html: preview.html.slice(0, 800) + '…',
    });
  }

  // ── Insert broadcast header row up front ──────────────
  const previewForRow = await renderWeeklyDigest({
    email: recipients[0]?.email ?? 'preview@tryafter5.app',
    firstName: recipients[0]?.first_name ?? null,
  });

  // Cast: generated DB types don't yet include email_broadcasts.
  const { data: broadcastInsert, error: bErr } = await (admin as unknown as {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
        };
      };
    };
  })
    .from('email_broadcasts')
    .insert({
      kind: 'weekly_digest',
      subject: previewForRow.subject,
      body_html: previewForRow.html,
      body_text: previewForRow.text,
      triggered_by: querySecret ? 'manual' : 'cron',
      recipient_count: recipients.length,
      notes: `spotlight=${previewForRow.spotlightId} plans=${previewForRow.plansShown}`,
    })
    .select('id')
    .single();

  if (bErr || !broadcastInsert) {
    return NextResponse.json({ error: 'broadcast insert failed', details: bErr?.message }, { status: 500 });
  }
  const broadcastId = broadcastInsert.id;

  // ── Send loop (sequential — small audience for now) ───
  let sent = 0;
  let failed = 0;
  const errors: Array<{ email: string; error: string }> = [];

  for (const r of recipients) {
    // Skip if we already sent this broadcast to them (idempotency on retry).
    const { data: existing } = await (admin as unknown as {
      from: (t: string) => {
        select: (cols: string) => {
          eq: (col: string, val: string) => {
            eq: (col: string, val: string) => {
              maybeSingle: () => Promise<{ data: { broadcast_id: string } | null }>;
            };
          };
        };
      };
    })
      .from('email_broadcast_sends')
      .select('broadcast_id')
      .eq('broadcast_id', broadcastId)
      .eq('subscriber_id', r.id)
      .maybeSingle();
    if (existing) continue;

    const rendered = await renderWeeklyDigest({ email: r.email, firstName: r.first_name });
    const send = await sendEmail({
      to: r.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag: 'weekly_digest',
    });

    await (admin as unknown as {
      from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<unknown> };
    })
      .from('email_broadcast_sends')
      .insert({
        broadcast_id: broadcastId,
        subscriber_id: r.id,
        resend_id: send?.id ?? null,
        error: send ? null : 'send_failed',
      });

    if (send) {
      sent += 1;
    } else {
      failed += 1;
      errors.push({ email: r.email, error: 'resend_send_failed' });
    }

    // Light pacing to stay under Resend rate limits (~10/sec)
    await new Promise((res) => setTimeout(res, 110));
  }

  return NextResponse.json({
    broadcast_id: broadcastId,
    recipient_count: recipients.length,
    sent,
    failed,
    errors,
  });
}

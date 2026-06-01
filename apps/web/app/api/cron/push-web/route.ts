// apps/web/app/api/cron/push-web/route.ts
// Web Push delivery trigger (Vercel Cron, every minute — see vercel.json).
//
// SEND-TRIGGER ARCHITECTURE (chosen for simplicity + isolation):
//   dispatch_notification (SQL) already picks a channel and writes a
//   notifications row with channel='web_push', delivered=false for users whose
//   only reachable channel is a stored browser subscription. This cron scans
//   those undelivered web_push rows, loads each user's web_push_sub from
//   devices, sends best-effort via lib/push/send.ts (web-push lib), marks the
//   row delivered (or records delivery_error) through mark_notification_delivered,
//   and prunes subscriptions the push service reports as gone (404/410) by
//   nulling devices.web_push_sub.
//
// This keeps Web Push entirely web-side (Node runtime) and never touches the
// originating action: dispatch returns immediately, delivery is async here.
// The native/Expo + email channels stay owned by the Deno edge dispatcher.
//
// INERT WITHOUT VAPID: sendWebPush() returns { ok:false, error:'web_push_not_configured' }
// when VAPID env is absent, so this route never marks anything delivered and
// never prunes — it's a clean no-op until the user sets the VAPID keypair.
//
// Auth: Authorization: Bearer ${CRON_SECRET} OR ?secret=. ?dry_run=true reports
// the candidate count without sending.
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendWebPush, type WebPushSubscription } from '@/lib/push/send';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Only attempt rows from the recent past so a backlog of permanently-undeliverable
// rows (e.g. a user who never granted permission) doesn't get rescanned forever.
const LOOKBACK_MINUTES = 60;
const BATCH_LIMIT = 100;

interface NotifPayload {
  title?: string;
  body?: string;
  url?: string;
  data?: { url?: string } & Record<string, unknown>;
  tag?: string;
}

function isWebPushSub(v: unknown): v is WebPushSubscription {
  if (!v || typeof v !== 'object') return false;
  const s = v as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  return (
    typeof s.endpoint === 'string' &&
    !!s.keys &&
    typeof s.keys.p256dh === 'string' &&
    typeof s.keys.auth === 'string'
  );
}

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });

  const url = new URL(request.url);
  const authHeader = request.headers.get('authorization');
  const querySecret = url.searchParams.get('secret');
  const ok = authHeader === `Bearer ${expected}` || querySecret === expected;
  if (!ok) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = createAdminClient();
  const since = new Date(Date.now() - LOOKBACK_MINUTES * 60_000).toISOString();

  // Candidate notifications: chosen for web push, not yet delivered, recent.
  const { data: notifs, error } = await supabase
    .from('notifications')
    .select('id,user_id,payload')
    .eq('channel', 'web_push')
    .eq('delivered', false)
    .is('delivery_error', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = notifs ?? [];
  if (rows.length === 0) return NextResponse.json({ scanned: 0, sent: 0, failed: 0, pruned: 0 });

  if (url.searchParams.get('dry_run') === 'true') {
    return NextResponse.json({ dry_run: true, scanned: rows.length, sent: 0, failed: 0, pruned: 0 });
  }

  // Load each candidate user's stored web push subscription once.
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: devices } = await supabase
    .from('devices')
    .select('user_id,web_push_sub')
    .in('user_id', userIds)
    .not('web_push_sub', 'is', null);

  const subByUser = new Map<string, WebPushSubscription>();
  for (const d of devices ?? []) {
    if (isWebPushSub(d.web_push_sub)) subByUser.set(d.user_id, d.web_push_sub);
  }

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  const pruneUsers = new Set<string>();

  for (const row of rows) {
    const sub = subByUser.get(row.user_id);
    const payload = (row.payload ?? {}) as NotifPayload;

    if (!sub) {
      // No stored subscription — record the miss so we stop rescanning this row.
      await supabase.rpc('mark_notification_delivered', { p_id: row.id, p_error: 'no_web_push_sub' });
      failed += 1;
      continue;
    }

    const result = await sendWebPush(sub, {
      title: payload.title ?? 'after5',
      body: payload.body ?? 'you have a new update',
      url: payload.url ?? payload.data?.url ?? '/home',
      tag: payload.tag,
    });

    // VAPID not configured: leave the row untouched (delivered=false, no error)
    // so it's retried once keys are set. This is the INERT path.
    if (!result.ok && result.error === 'web_push_not_configured') {
      return NextResponse.json({ scanned: rows.length, sent, failed, pruned, skipped: 'web_push_not_configured' });
    }

    if (result.expired && result.expired.length > 0) {
      pruneUsers.add(row.user_id);
      await supabase.rpc('mark_notification_delivered', { p_id: row.id, p_error: 'subscription_expired' });
      failed += 1;
      continue;
    }

    await supabase.rpc('mark_notification_delivered', { p_id: row.id, p_error: result.ok ? undefined : (result.error ?? 'delivery_failed') });
    if (result.ok) sent += 1;
    else failed += 1;
  }

  // Prune gone (404/410) subscriptions: null out web_push_sub so dispatch stops
  // routing to a dead endpoint. register_device re-populates it on resubscribe.
  for (const uid of pruneUsers) {
    const { error: pruneErr } = await supabase
      .from('devices')
      .update({ web_push_sub: null })
      .eq('user_id', uid)
      .not('web_push_sub', 'is', null);
    if (!pruneErr) pruned += 1;
  }

  return NextResponse.json({ scanned: rows.length, sent, failed, pruned });
}

// supabase/functions/_shared/notify.ts
// Network-delivery half of notification dispatch. Calls the C1 dispatch_notification
// RPC (p_user, p_type, p_payload) for the consent/quiet/ratelimit/log decision, then
// sends over the chosen channel. channel='admin_alert' (safety fail-loud, C11.8)
// emails ops. Providers are injected so unit tests mock the network.

import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Bare SupabaseClient (default generics) so a concrete createClient(url, key)
// result — SupabaseClient<any, 'public', any> — is assignable. ReturnType<typeof
// createClient> would pin the schema generic to `never`, which a real 'public'
// client is NOT assignable to. The {rpc} member keeps the unit-test fake valid.
type DbClient = SupabaseClient | { rpc: (n: string, a: unknown) => Promise<{ data: unknown; error: unknown }> };

// Mirrors the SQL notification_type enum (C1 + C11.11) exactly — 15 values.
export type NotificationType =
  | 'new_match' | 'offer_received' | 'offer_expiring' | 'standby_promoted' | 'date_reconfirm'
  | 'safety_checkin' | 'safety_alert' | 'new_message' | 'rating_request' | 'moderation_action' | 'account'
  | 'verification_passed' | 'verification_failed' | 'appeal_resolved' | 'offer_withdrawn';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  payload: { title?: string; body?: string; data?: Record<string, unknown>; dedup_key?: string };
}

interface DispatchDecision {
  notification_id: string;
  channel: 'push_ios' | 'push_android' | 'web_push' | 'email' | 'admin_alert' | 'suppressed';
  tokens: Array<{ platform: string; expo_push_token?: string; web_push_sub?: unknown }>;
}

export interface NotifyDeps {
  sendExpo?: (tokens: string[], n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
  sendWebPush?: (subs: unknown[], n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
  sendEmail?: (userId: string, n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
  sendOpsEmail?: (n: NotifyInput) => Promise<{ ok: boolean; error?: string }>;
}

const SAFETY = new Set<NotificationType>(['safety_checkin', 'safety_alert']);

// Default Expo push: POST to exp.host, then INSPECT the ticket body — a 200 can
// carry per-message status:'error' (DeviceNotRegistered, MessageRejected). Treat
// any per-message error as a delivery failure (do not trust res.ok alone).
async function defaultSendExpo(tokens: string[], n: NotifyInput) {
  const messages = tokens.map((to) => ({
    to, title: n.payload.title ?? '', body: n.payload.body ?? '', data: n.payload.data ?? {},
    sound: 'default', priority: SAFETY.has(n.type) || n.type === 'date_reconfirm' ? 'high' : 'default',
  }));
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!res.ok) return { ok: false, error: `expo ${res.status}` };
  const body = await res.json().catch(() => null) as { data?: Array<{ status?: string; message?: string }> } | null;
  const errored = body?.data?.find((t) => t.status === 'error');
  return errored ? { ok: false, error: `expo_ticket:${errored.message ?? 'error'}` } : { ok: true };
}

async function defaultSendWebPush(_subs: unknown[], _n: NotifyInput) {
  // Web Push (VAPID) best-effort fallback — uses VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY
  // env (documented in this plan's secrets). Native is load-bearing.
  return { ok: false, error: 'web_push_not_configured' };
}

async function defaultSendEmail(_userId: string, _n: NotifyInput) {
  // High-stakes fallback via the repo's Resend sender. Wired through a small
  // internal endpoint/shared lib; returns ok:false until wired so failures are
  // logged (and, for safety types, escalated to ops) — never silently dropped.
  return { ok: false, error: 'email_not_wired' };
}

async function defaultSendOpsEmail(n: NotifyInput) {
  // Always-on out-of-band ops alert (Resend → ops inbox) — the C11.8 fail-loud sink.
  // Wire to OPS_ALERT_EMAIL + Resend. Returns ok:false until wired (the admin_alerts
  // row already guarantees a human-visible record).
  void n;
  return { ok: false, error: 'ops_email_not_wired' };
}

export async function dispatchNotification(
  db: DbClient, input: NotifyInput, deps: NotifyDeps = {},
): Promise<{ notificationId: string | null; channel: string; delivered: boolean }> {
  const sendExpo = deps.sendExpo ?? defaultSendExpo;
  const sendWebPush = deps.sendWebPush ?? defaultSendWebPush;
  const sendEmail = deps.sendEmail ?? defaultSendEmail;
  const sendOpsEmail = deps.sendOpsEmail ?? defaultSendOpsEmail;

  const { data, error } = await db.rpc('dispatch_notification', {
    p_user: input.userId, p_type: input.type, p_payload: input.payload ?? {},
  });
  if (error) throw new Error(`dispatch_notification rpc failed: ${JSON.stringify(error)}`);
  const decision = data as DispatchDecision;

  if (decision.channel === 'suppressed') {
    return { notificationId: decision.notification_id, channel: 'suppressed', delivered: false };
  }

  // Safety fail-loud: the RPC already raised an admin_alerts row; we ALSO email ops.
  if (decision.channel === 'admin_alert') {
    await sendOpsEmail(input);
    return { notificationId: decision.notification_id, channel: 'admin_alert', delivered: false };
  }

  let result: { ok: boolean; error?: string };
  if (decision.channel === 'push_ios' || decision.channel === 'push_android') {
    result = await sendExpo(decision.tokens.map((t) => t.expo_push_token!).filter(Boolean), input);
  } else if (decision.channel === 'web_push') {
    result = await sendWebPush(decision.tokens.map((t) => t.web_push_sub).filter(Boolean), input);
  } else {
    result = await sendEmail(input.userId, input);
  }

  // Safety types whose delivery failed escalate to ops (never a silent failure).
  if (!result.ok && SAFETY.has(input.type)) {
    await db.rpc('raise_admin_alert', {
      p_kind: 'safety_delivery_failed',
      p_payload: { user_id: input.userId, type: input.type, notification_id: decision.notification_id, error: result.error },
    });
    await sendOpsEmail(input);
  }

  await db.rpc('mark_notification_delivered', {
    p_id: decision.notification_id, p_error: result.ok ? null : (result.error ?? 'delivery_failed'),
  });
  return { notificationId: decision.notification_id, channel: decision.channel, delivered: result.ok };
}

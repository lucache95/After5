// Server-only Web Push sender. Best-effort: never throws — failures log and
// return a result object so callers don't block user-facing flows on a push.
//
// Mirrors lib/email/resend.ts: if the VAPID env is absent we log and skip
// gracefully (returning { ok: false, error: 'web_push_not_configured' })
// rather than throwing. Requires VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY and a
// VAPID contact subject (VAPID_SUBJECT, a `mailto:` or https URL).
//
// NOTE: this is the Next.js (Node runtime) sender used by route handlers and
// cron jobs in apps/web. The Supabase Edge Function (Deno) dispatcher in
// supabase/functions/_shared/notify.ts has its own stub to wire separately.
import webpush from 'web-push';

/** A persisted Web Push subscription, shaped like PushSubscription.toJSON(). */
export interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where notificationclick should navigate. Defaults handled by the SW. */
  url?: string;
  /** Collapse key — later pushes with the same tag replace earlier ones. */
  tag?: string;
}

export interface PushSendResult {
  ok: boolean;
  /** Subscriptions that returned 404/410 (gone) — callers should delete them. */
  expired?: WebPushSubscription[];
  error?: string;
}

let configured: boolean | null = null;

/** Configure web-push from env once. Returns false (and logs) if env is absent. */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:hello@after5.app';

  if (!publicKey || !privateKey) {
    console.warn('[web-push] VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY missing — skip send');
    configured = false;
    return false;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    configured = true;
  } catch (err) {
    console.error('[web-push] setVapidDetails failed', err);
    configured = false;
  }
  return configured;
}

/**
 * Send a push to one or more subscriptions. Best-effort and never throws.
 * Returns { ok: false, error: 'web_push_not_configured' } when VAPID env is
 * absent (mirrors the resend.ts graceful-skip), or { ok: true, expired } once
 * delivery is attempted — `expired` lists subscriptions the push service
 * reported as gone (404/410) so the caller can prune the devices row.
 */
export async function sendWebPush(
  subscriptions: WebPushSubscription[] | WebPushSubscription,
  payload: PushPayload,
): Promise<PushSendResult> {
  if (!ensureConfigured()) {
    return { ok: false, error: 'web_push_not_configured' };
  }

  const subs = Array.isArray(subscriptions) ? subscriptions : [subscriptions];
  const valid = subs.filter((s): s is WebPushSubscription => !!s?.endpoint);
  if (valid.length === 0) return { ok: true, expired: [] };

  const body = JSON.stringify(payload);
  const expired: WebPushSubscription[] = [];

  await Promise.all(
    valid.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, body);
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          // Subscription is gone — signal the caller to prune it.
          expired.push(sub);
        } else {
          console.error('[web-push] send failed', statusCode ?? '', err);
        }
      }
    }),
  );

  return { ok: true, expired };
}

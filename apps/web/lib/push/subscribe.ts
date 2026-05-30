'use client';
// Client-side Web Push subscription helper.
//
// Flow: register the service worker (public/sw.js — already has push +
// notificationclick handlers), request Notification permission, subscribe via
// the PushManager using NEXT_PUBLIC_VAPID_PUBLIC_KEY, then POST the
// subscription to /api/devices which persists it on the caller's `devices` row.
//
// MOUNTING: call enablePushNotifications() AFTER onboarding completes, NOT on
// the landing page. The recommended mount point is a click handler on the
// final onboarding step (app/onboarding/steps/DoneStep.tsx) — e.g. fire it
// right after "turn dating on" succeeds, or behind an explicit "get notified"
// affordance. A browser permission prompt on first paint of a marketing page
// reads as spammy and tanks grant rates, so keep it gesture-triggered and
// post-onboarding. Never import this into the landing page.

export type PushSubscribeOutcome =
  | { ok: true; subscribed: true }
  | { ok: true; subscribed: false; reason: 'unsupported' | 'denied' | 'not_configured' | 'dismissed' }
  | { ok: false; error: string };

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  // Back the array with a plain ArrayBuffer so it satisfies BufferSource
  // (applicationServerKey rejects SharedArrayBuffer-backed views).
  const buffer = new ArrayBuffer(raw.length);
  const output = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

function isSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/**
 * Request notification permission and subscribe to Web Push. Best-effort and
 * never throws — returns a tagged outcome the caller can branch on. Safe to
 * call again: an existing subscription is reused and re-persisted.
 *
 * Call this from a user gesture AFTER onboarding (see mount note above).
 */
export async function enablePushNotifications(): Promise<PushSubscribeOutcome> {
  try {
    if (!isSupported()) return { ok: true, subscribed: false, reason: 'unsupported' };

    const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      console.warn('[push] NEXT_PUBLIC_VAPID_PUBLIC_KEY missing — skip subscribe');
      return { ok: true, subscribed: false, reason: 'not_configured' };
    }

    const registration =
      (await navigator.serviceWorker.getRegistration()) ??
      (await navigator.serviceWorker.register('/sw.js'));
    await navigator.serviceWorker.ready;

    const permission = await Notification.requestPermission();
    if (permission === 'denied') return { ok: true, subscribed: false, reason: 'denied' };
    if (permission !== 'granted') return { ok: true, subscribed: false, reason: 'dismissed' };

    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }));

    const res = await fetch('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'web', subscription: subscription.toJSON() }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[push] persist failed', res.status, txt);
      return { ok: false, error: `persist_failed_${res.status}` };
    }

    return { ok: true, subscribed: true };
  } catch (err) {
    console.error('[push] enable threw', err);
    return { ok: false, error: 'subscribe_threw' };
  }
}

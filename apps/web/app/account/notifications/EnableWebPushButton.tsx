'use client';
// Permission-gated "turn on push on this device" affordance for the
// notification-preferences page. Requests browser notification permission and
// subscribes to Web Push (lib/push/subscribe.ts), persisting the subscription
// on the caller's devices row via /api/devices.
//
// INERT WITHOUT VAPID: renders nothing when NEXT_PUBLIC_VAPID_PUBLIC_KEY is
// absent, so the feature stays invisible until the user sets the keypair. The
// env var is read at module scope (Next inlines NEXT_PUBLIC_* at build time).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { enablePushNotifications } from '@/lib/push/subscribe';
import { cn } from '@/lib/cn';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

type PermState = 'default' | 'granted' | 'denied' | 'unsupported';

export function EnableWebPushButton() {
  const [perm, setPerm] = useState<PermState>('default');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window) || !('PushManager' in window)) {
      setPerm('unsupported');
      return;
    }
    setPerm(Notification.permission as PermState);
  }, []);

  // Feature flag: no VAPID public key => render nothing.
  if (!VAPID_PUBLIC_KEY) return null;
  if (perm === 'unsupported') return null;

  async function enable() {
    if (busy) return;
    setBusy(true);
    try {
      const outcome = await enablePushNotifications();
      if (outcome.ok && outcome.subscribed) {
        setPerm('granted');
        toast.success('push is on for this device.');
      } else if (outcome.ok && !outcome.subscribed) {
        if (outcome.reason === 'denied') {
          setPerm('denied');
          toast.error('push is blocked. turn it on in your browser settings.');
        } else if (outcome.reason === 'not_configured' || outcome.reason === 'unsupported') {
          // Should not reach here (button hidden), but stay quiet if it does.
        } else {
          toast('maybe later, then.');
        }
      } else {
        toast.error("couldn't turn on push. try again?");
      }
    } finally {
      setBusy(false);
    }
  }

  const granted = perm === 'granted';
  const denied = perm === 'denied';

  return (
    <section className="mt-8">
      <h2 className="font-body text-sm font-semibold lowercase tracking-wide text-shell-ink/60">
        push on this device
      </h2>
      <p className="mt-1 font-body text-xs text-shell-ink/55">
        {granted
          ? 'this browser is set up to receive push.'
          : denied
            ? 'push is blocked. turn it on in your browser settings, then reload.'
            : 'allow notifications so matches and messages reach you here.'}
      </p>
      <button
        type="button"
        disabled={busy || granted || denied}
        onClick={() => void enable()}
        className={cn(
          'mt-3 flex min-h-[48px] items-center justify-center rounded-full px-6 font-body font-semibold lowercase transition',
          'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-shell-accent/40 disabled:opacity-50',
          granted ? 'bg-shell-ink/10 text-shell-ink/60' : 'bg-shell-accent text-white',
        )}
      >
        {granted ? 'push is on' : denied ? 'push blocked' : busy ? 'turning on…' : 'turn on push'}
      </button>
    </section>
  );
}

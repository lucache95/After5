'use client';
// Unread-count pill for the bell affordance (G, spec §3/§5.2). Seeded from an
// SSR count, bumped live by realtime inserts, and cleared/decremented when a
// 'notif:read' window event fires (emitted by the center after mark-read).
import { useEffect, useState } from 'react';
import { subscribeNotifications } from '@/lib/after5/realtime';

export function NotificationBadge({ userId, initialCount }: { userId: string; initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const unsub = subscribeNotifications(userId, () => setCount((c) => c + 1));
    function onRead(e: Event) {
      const detail = (e as CustomEvent<{ updated?: number; all?: boolean }>).detail;
      if (detail?.all) { setCount(0); return; }
      setCount((c) => Math.max(0, c - (detail?.updated ?? 1)));
    }
    window.addEventListener('notif:read', onRead);
    return () => { unsub(); window.removeEventListener('notif:read', onRead); };
  }, [userId]);

  if (count <= 0) return null;
  return (
    <span
      aria-label={`${count} unread notifications`}
      className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-shell-accent px-1 text-[10px] font-semibold leading-[18px] text-shell-base"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
